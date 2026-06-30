package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/whatsyitc/backend/internal/models"
)

// UpsertAIUser keeps the canonical contact in bc_retailers, then stores
// AI-only context fields in bc_ai_user_profiles. This lets the AI workspace
// have richer user context without changing the bulk messaging model.
func (s *Store) UpsertAIUser(ctx context.Context, adminUserID int64, name, phone string, extra map[string]string, source string) (*models.AIUser, error) {
	if adminUserID <= 0 {
		return nil, fmt.Errorf("UpsertAIUser: adminUserID required")
	}
	name = strings.TrimSpace(name)
	phone = strings.TrimSpace(phone)
	if name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if phone == "" {
		return nil, fmt.Errorf("phone is required")
	}
	if source = strings.TrimSpace(source); source == "" {
		source = "manual"
	}
	code := "ai-" + phone

	var retailer models.Retailer
	if normalized := onlyDigits(phone); normalized != "" {
		err := s.DB.QueryRow(ctx, `
			SELECT id, admin_user_id, retailer_code, retailer_name, whatsapp_number,
			       city, state, is_opted_out, opted_out_at, opted_out_reason, created_at, updated_at
			FROM bc_retailers
			WHERE admin_user_id = $1
			  AND regexp_replace(whatsapp_number, '[^0-9]', '', 'g') = $2
			ORDER BY id
			LIMIT 1
		`, adminUserID, normalized).Scan(
			&retailer.ID, &retailer.AdminUserID, &retailer.RetailerCode, &retailer.RetailerName,
			&retailer.WhatsappNumber, &retailer.City, &retailer.State, &retailer.IsOptedOut,
			&retailer.OptedOutAt, &retailer.OptedOutReason, &retailer.CreatedAt, &retailer.UpdatedAt,
		)
		if err != nil && err != pgx.ErrNoRows {
			return nil, err
		}
		if err == nil {
			_, err = s.DB.Exec(ctx, `
				UPDATE bc_retailers
				SET retailer_name = CASE
				      WHEN retailer_name = '' OR retailer_name = '(unknown)' OR retailer_name LIKE 'Customer %'
				      THEN $3
				      ELSE retailer_name
				    END,
				    retailer_code = CASE
				      WHEN retailer_code = '' OR retailer_code LIKE 'orphan-%'
				      THEN $4
				      ELSE retailer_code
				    END,
				    updated_at = now()
				WHERE id = $1 AND admin_user_id = $2
			`, retailer.ID, adminUserID, name, code)
			if err != nil {
				return nil, err
			}
			if retailer.RetailerName == "" || retailer.RetailerName == "(unknown)" || strings.HasPrefix(retailer.RetailerName, "Customer ") {
				retailer.RetailerName = name
			}
			if retailer.RetailerCode == "" || strings.HasPrefix(retailer.RetailerCode, "orphan-") {
				retailer.RetailerCode = code
			}
		}
	}
	if retailer.ID == 0 {
		err := s.DB.QueryRow(ctx, `
			INSERT INTO bc_retailers
				(admin_user_id, retailer_code, retailer_name, whatsapp_number)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (admin_user_id, whatsapp_number) WHERE admin_user_id IS NOT NULL DO UPDATE
			  SET retailer_name = CASE
			       WHEN bc_retailers.retailer_name = '' OR bc_retailers.retailer_name = '(unknown)'
			            OR bc_retailers.retailer_name LIKE 'Customer %'
			       THEN EXCLUDED.retailer_name
			       ELSE bc_retailers.retailer_name
			      END,
			      retailer_code = CASE
			       WHEN bc_retailers.retailer_code = '' OR bc_retailers.retailer_code LIKE 'orphan-%'
			       THEN EXCLUDED.retailer_code
			       ELSE bc_retailers.retailer_code
			      END,
			      updated_at = now()
			RETURNING id, admin_user_id, retailer_code, retailer_name, whatsapp_number,
			          city, state, is_opted_out, opted_out_at, opted_out_reason, created_at, updated_at
		`, adminUserID, code, name, phone).Scan(
			&retailer.ID, &retailer.AdminUserID, &retailer.RetailerCode, &retailer.RetailerName,
			&retailer.WhatsappNumber, &retailer.City, &retailer.State, &retailer.IsOptedOut,
			&retailer.OptedOutAt, &retailer.OptedOutReason, &retailer.CreatedAt, &retailer.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
	}

	cleanExtra := cleanAIUserExtraFields(extra)
	rawExtra, err := json.Marshal(cleanExtra)
	if err != nil {
		return nil, err
	}

	var out models.AIUser
	var raw json.RawMessage
	err = s.DB.QueryRow(ctx, `
		INSERT INTO bc_ai_user_profiles
			(admin_user_id, retailer_id, phone, display_name, source, extra_fields, last_imported_at)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb,
		        CASE WHEN $5 = 'import' THEN now() ELSE NULL END)
		ON CONFLICT (admin_user_id, retailer_id) DO UPDATE
		  SET phone = EXCLUDED.phone,
		      display_name = EXCLUDED.display_name,
		      source = EXCLUDED.source,
		      extra_fields = EXCLUDED.extra_fields,
		      last_imported_at = CASE
		        WHEN EXCLUDED.source = 'import' THEN now()
		        ELSE bc_ai_user_profiles.last_imported_at
		      END
		RETURNING id, source, extra_fields, last_imported_at, created_at, updated_at
	`, adminUserID, retailer.ID, phone, name, source, rawExtra).Scan(
		&out.ID, &out.Source, &raw, &out.LastImportedAt, &out.CreatedAt, &out.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	out.RetailerID = retailer.ID
	out.RetailerCode = retailer.RetailerCode
	out.Name = firstNonEmpty(name, retailer.RetailerName)
	out.Phone = retailer.WhatsappNumber
	out.City = retailer.City
	out.State = retailer.State
	out.IsOptedOut = retailer.IsOptedOut
	out.ExtraFields = decodeAIUserExtraFields(raw)
	return &out, nil
}

func (s *Store) ListAIUsers(ctx context.Context, adminUserID int64, search string, limit, offset int) ([]models.AIUser, int, error) {
	if adminUserID <= 0 {
		return nil, 0, fmt.Errorf("ListAIUsers: adminUserID required")
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	args := []any{adminUserID}
	where := `WHERE r.admin_user_id = $1`
	if strings.TrimSpace(search) != "" {
		args = append(args, "%"+strings.TrimSpace(search)+"%")
		idx := itoa(len(args))
		where += ` AND (
			r.retailer_code ILIKE $` + idx + `
			OR r.retailer_name ILIKE $` + idx + `
			OR r.whatsapp_number ILIKE $` + idx + `
			OR COALESCE(p.extra_fields::text, '') ILIKE $` + idx + `
		)`
	}

	var total int
	if err := s.DB.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM bc_retailers r
		LEFT JOIN bc_ai_user_profiles p
		  ON p.admin_user_id = r.admin_user_id AND p.retailer_id = r.id
		`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, limit, offset)
	q := `
		SELECT
		  COALESCE(p.id, 0),
		  r.id,
		  r.retailer_code,
		  COALESCE(NULLIF(p.display_name, ''), r.retailer_name),
		  r.whatsapp_number,
		  r.city,
		  r.state,
		  r.is_opted_out,
		  COALESCE(NULLIF(p.source, ''), 'retailer'),
		  COALESCE(p.extra_fields, '{}'::jsonb),
		  p.last_imported_at,
		  COALESCE(p.created_at, r.created_at),
		  GREATEST(r.updated_at, COALESCE(p.updated_at, r.updated_at))
		FROM bc_retailers r
		LEFT JOIN bc_ai_user_profiles p
		  ON p.admin_user_id = r.admin_user_id AND p.retailer_id = r.id
		` + where + `
		ORDER BY GREATEST(r.updated_at, COALESCE(p.updated_at, r.updated_at)) DESC, r.id DESC
		LIMIT $` + itoa(len(args)-1) + ` OFFSET $` + itoa(len(args))

	rows, err := s.DB.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := []models.AIUser{}
	for rows.Next() {
		var u models.AIUser
		var raw json.RawMessage
		if err := rows.Scan(
			&u.ID, &u.RetailerID, &u.RetailerCode, &u.Name, &u.Phone,
			&u.City, &u.State, &u.IsOptedOut, &u.Source, &raw,
			&u.LastImportedAt, &u.CreatedAt, &u.UpdatedAt,
		); err != nil {
			return nil, 0, err
		}
		u.ExtraFields = decodeAIUserExtraFields(raw)
		out = append(out, u)
	}
	return out, total, rows.Err()
}

func (s *Store) GetAIUserByRetailer(ctx context.Context, adminUserID, retailerID int64) (*models.AIUser, error) {
	if adminUserID <= 0 || retailerID <= 0 {
		return nil, nil
	}
	row := s.DB.QueryRow(ctx, `
		SELECT
		  COALESCE(p.id, 0),
		  r.id,
		  r.retailer_code,
		  COALESCE(NULLIF(p.display_name, ''), r.retailer_name),
		  r.whatsapp_number,
		  r.city,
		  r.state,
		  r.is_opted_out,
		  COALESCE(NULLIF(p.source, ''), 'retailer'),
		  COALESCE(p.extra_fields, '{}'::jsonb),
		  p.last_imported_at,
		  COALESCE(p.created_at, r.created_at),
		  GREATEST(r.updated_at, COALESCE(p.updated_at, r.updated_at))
		FROM bc_retailers r
		LEFT JOIN bc_ai_user_profiles p
		  ON p.admin_user_id = r.admin_user_id AND p.retailer_id = r.id
		WHERE r.admin_user_id = $1
		  AND r.id = $2
	`, adminUserID, retailerID)
	var u models.AIUser
	var raw json.RawMessage
	if err := row.Scan(
		&u.ID, &u.RetailerID, &u.RetailerCode, &u.Name, &u.Phone,
		&u.City, &u.State, &u.IsOptedOut, &u.Source, &raw,
		&u.LastImportedAt, &u.CreatedAt, &u.UpdatedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	u.ExtraFields = decodeAIUserExtraFields(raw)
	return &u, nil
}

func (s *Store) EnsureAIUserFollowupBatch(ctx context.Context, adminUserID, retailerID int64) (*models.AIUser, int64, error) {
	if adminUserID <= 0 {
		return nil, 0, fmt.Errorf("EnsureAIUserFollowupBatch: adminUserID required")
	}
	if retailerID <= 0 {
		return nil, 0, fmt.Errorf("retailer_id is required")
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var u models.AIUser
	var rawExtra json.RawMessage
	err = tx.QueryRow(ctx, `
		SELECT
		  COALESCE(p.id, 0),
		  r.id,
		  r.retailer_code,
		  COALESCE(NULLIF(p.display_name, ''), r.retailer_name),
		  r.whatsapp_number,
		  r.city,
		  r.state,
		  r.is_opted_out,
		  COALESCE(NULLIF(p.source, ''), 'retailer'),
		  COALESCE(p.extra_fields, '{}'::jsonb),
		  p.last_imported_at,
		  COALESCE(p.created_at, r.created_at),
		  GREATEST(r.updated_at, COALESCE(p.updated_at, r.updated_at))
		FROM bc_retailers r
		LEFT JOIN bc_ai_user_profiles p
		  ON p.admin_user_id = r.admin_user_id AND p.retailer_id = r.id
		WHERE r.admin_user_id = $1
		  AND r.id = $2
		FOR UPDATE OF r
	`, adminUserID, retailerID).Scan(
		&u.ID, &u.RetailerID, &u.RetailerCode, &u.Name, &u.Phone,
		&u.City, &u.State, &u.IsOptedOut, &u.Source, &rawExtra,
		&u.LastImportedAt, &u.CreatedAt, &u.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, 0, nil
	}
	if err != nil {
		return nil, 0, err
	}
	u.ExtraFields = decodeAIUserExtraFields(rawExtra)
	u.Name = strings.TrimSpace(u.Name)
	u.Phone = strings.TrimSpace(u.Phone)
	if u.Phone == "" {
		return nil, 0, fmt.Errorf("user has no phone number")
	}
	if digits := onlyDigits(u.Phone); len(digits) < 10 || len(digits) > 15 {
		return nil, 0, fmt.Errorf("user phone must contain 10-15 digits")
	}
	if u.Name == "" {
		u.Name = "Customer " + u.Phone
	}
	if u.IsOptedOut {
		return nil, 0, fmt.Errorf("this user is opted out")
	}

	var batchID int64
	err = tx.QueryRow(ctx, `
		SELECT batch_id
		  FROM bc_ai_user_followup_targets
		 WHERE admin_user_id = $1
		   AND retailer_id = $2
		 FOR UPDATE
	`, adminUserID, retailerID).Scan(&batchID)
	if err != nil && err != pgx.ErrNoRows {
		return nil, 0, err
	}
	if err == pgx.ErrNoRows {
		displayName := truncateRunes("AI follow-up: "+u.Name, 100)
		fileName := truncateRunes("ai-user-"+u.Phone+".csv", 180)
		notes := "AI Users single-recipient follow-up. Created automatically so the existing follow-up control room can manage this phone."
		if err := tx.QueryRow(ctx, `
			INSERT INTO bc_upload_batches
				(file_name, file_path, file_size_bytes, mime_type,
				 total_rows, valid_rows, invalid_rows, status,
				 uploaded_by, approved_by, approved_at, notes, display_name)
			VALUES ($1, $2, 0, 'application/x-ai-user',
			        1, 1, 0, 'approved',
			        $3, $3, now(), $4, $5)
			RETURNING id
		`, fileName, fmt.Sprintf("ai-users://retailers/%d", retailerID), adminUserID, notes, displayName).Scan(&batchID); err != nil {
			return nil, 0, err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO bc_ai_user_followup_targets
				(admin_user_id, retailer_id, batch_id, phone)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (admin_user_id, retailer_id) DO UPDATE SET
				batch_id = EXCLUDED.batch_id,
				phone = EXCLUDED.phone
		`, adminUserID, retailerID, batchID, u.Phone); err != nil {
			return nil, 0, err
		}
	}

	rawRow, _ := json.Marshal(map[string]any{
		"source":       "ai_users",
		"retailer_id":  retailerID,
		"name":         u.Name,
		"phone":        u.Phone,
		"extra_fields": u.ExtraFields,
	})
	tag, err := tx.Exec(ctx, `
		UPDATE bc_billing_records
		   SET admin_user_id = $2,
		       retailer_code = $3,
		       retailer_name = $4,
		       whatsapp_number = $5,
		       raw_row = $6::jsonb,
		       is_valid = TRUE,
		       validation_errors = '[]'::jsonb,
		       retailer_id = $7
		 WHERE batch_id = $1
		   AND row_number = 1
	`, batchID, adminUserID, u.RetailerCode, u.Name, u.Phone, string(rawRow), retailerID)
	if err != nil {
		return nil, 0, err
	}
	if tag.RowsAffected() == 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO bc_billing_records
				(batch_id, admin_user_id, row_number, retailer_code, retailer_name,
				 whatsapp_number, raw_row, is_valid, validation_errors, retailer_id)
			VALUES ($1, $2, 1, $3, $4, $5, $6::jsonb, TRUE, '[]'::jsonb, $7)
		`, batchID, adminUserID, u.RetailerCode, u.Name, u.Phone, string(rawRow), retailerID); err != nil {
			return nil, 0, err
		}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE bc_upload_batches
		   SET total_rows = 1,
		       valid_rows = 1,
		       invalid_rows = 0,
		       status = 'approved',
		       approved_by = COALESCE(approved_by, $2),
		       approved_at = COALESCE(approved_at, now()),
		       display_name = $3
		 WHERE id = $1
	`, batchID, adminUserID, truncateRunes("AI follow-up: "+u.Name, 100)); err != nil {
		return nil, 0, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE bc_ai_user_followup_targets
		   SET phone = $3
		 WHERE admin_user_id = $1
		   AND retailer_id = $2
	`, adminUserID, retailerID, u.Phone); err != nil {
		return nil, 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, 0, err
	}
	return &u, batchID, nil
}

func (s *Store) SetAIUserFollowupRecipient(ctx context.Context, adminUserID, retailerID, recipientID int64) error {
	if adminUserID <= 0 || retailerID <= 0 || recipientID <= 0 {
		return nil
	}
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_ai_user_followup_targets
		   SET batch_ai_recipient_id = $3
		 WHERE admin_user_id = $1
		   AND retailer_id = $2
	`, adminUserID, retailerID, recipientID)
	return err
}

func (s *Store) FindFollowupEnrollmentForBatchPhone(ctx context.Context, adminID, batchID int64, phone string) (int64, string, error) {
	phone = strings.TrimSpace(phone)
	if adminID <= 0 || batchID <= 0 || phone == "" {
		return 0, "", nil
	}
	var id int64
	var status string
	err := s.DB.QueryRow(ctx, `
		SELECT e.id, e.status
		  FROM bc_crm_sequence_enrollments e
		  JOIN bc_crm_leads l
		    ON l.id = e.lead_id
		   AND l.admin_user_id = e.admin_user_id
		  JOIN bc_crm_sequences seq
		    ON seq.id = e.sequence_id
		   AND seq.admin_user_id = e.admin_user_id
		 WHERE e.admin_user_id = $1
		   AND l.phone = $2
		   AND e.source_batch_id = $3
		   AND e.mode IN ('ai_followup', 'agentic_followup')
		   AND seq.trigger_event = 'smart_followup'
		   AND e.status IN ('active', 'paused')
		 ORDER BY e.created_at DESC, e.id DESC
		 LIMIT 1
	`, adminID, phone, batchID).Scan(&id, &status)
	if err == pgx.ErrNoRows {
		return 0, "", nil
	}
	if err != nil {
		return 0, "", err
	}
	return id, status, nil
}

func cleanAIUserExtraFields(in map[string]string) map[string]string {
	out := make(map[string]string)
	for k, v := range in {
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if k == "" || v == "" {
			continue
		}
		if len(k) > 80 {
			k = k[:80]
		}
		if len(v) > 500 {
			v = v[:500]
		}
		out[k] = v
	}
	return out
}

func truncateRunes(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

func decodeAIUserExtraFields(raw json.RawMessage) map[string]string {
	out := map[string]string{}
	if len(raw) == 0 {
		return out
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return out
	}
	for k, v := range m {
		switch x := v.(type) {
		case string:
			out[k] = x
		case float64, bool:
			out[k] = fmt.Sprint(x)
		default:
			if b, err := json.Marshal(x); err == nil {
				out[k] = string(b)
			}
		}
	}
	return out
}
