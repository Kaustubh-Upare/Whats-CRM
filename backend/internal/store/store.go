// Package store is the data access layer for the billingcomm service.
// All SQL lives here; handlers stay thin.
package store

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/whatsyitc/backend/internal/models"
)

type Store struct{ DB *pgxpool.Pool }

func New(db *pgxpool.Pool) *Store { return &Store{DB: db} }

// ---------- admin users ----------

func (s *Store) GetAdminByEmail(ctx context.Context, email string) (*models.AdminUser, error) {
	var u models.AdminUser
	err := s.DB.QueryRow(ctx, `
		SELECT id, email, password_hash, name, role, is_active, created_at, last_login_at
		FROM bc_admin_users WHERE email = $1
	`, email).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.IsActive, &u.CreatedAt, &u.LastLoginAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Store) CreateAdmin(ctx context.Context, email, hash, name, role string) (*models.AdminUser, error) {
	var u models.AdminUser
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_admin_users (email, password_hash, name, role)
		VALUES ($1,$2,$3,$4)
		RETURNING id, email, password_hash, name, role, is_active, created_at, last_login_at
	`, email, hash, name, role).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.IsActive, &u.CreatedAt, &u.LastLoginAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Store) TouchAdminLogin(ctx context.Context, id int64) error {
	_, err := s.DB.Exec(ctx, `UPDATE bc_admin_users SET last_login_at=now() WHERE id=$1`, id)
	return err
}

// ---------- retailers ----------

func (s *Store) UpsertRetailer(ctx context.Context, code, name, phone, city, state string) (int64, error) {
	var id int64
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_retailers (retailer_code, retailer_name, whatsapp_number, city, state)
		VALUES ($1,$2,$3, NULLIF($4,''), NULLIF($5,''))
		ON CONFLICT (retailer_code) DO UPDATE
		  SET retailer_name = EXCLUDED.retailer_name,
		      whatsapp_number = EXCLUDED.whatsapp_number,
		      city = COALESCE(EXCLUDED.city, bc_retailers.city),
		      state = COALESCE(EXCLUDED.state, bc_retailers.state),
		      updated_at = now()
		RETURNING id
	`, code, name, phone, city, state).Scan(&id)
	return id, err
}

func (s *Store) ListRetailers(ctx context.Context, search string, limit, offset int) ([]models.Retailer, int, error) {
	args := []any{}
	where := ""
	if search != "" {
		where = `WHERE retailer_code ILIKE $1 OR retailer_name ILIKE $1 OR whatsapp_number ILIKE $1`
		args = append(args, "%"+search+"%")
	}
	var total int
	if err := s.DB.QueryRow(ctx, "SELECT COUNT(*) FROM bc_retailers "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, limit, offset)
	q := `SELECT id, retailer_code, retailer_name, whatsapp_number, city, state,
	             is_opted_out, opted_out_at, opted_out_reason, created_at, updated_at
	      FROM bc_retailers ` + where + ` ORDER BY id DESC LIMIT $` + itoa(len(args)-1) + ` OFFSET $` + itoa(len(args))
	rows, err := s.DB.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []models.Retailer{}
	for rows.Next() {
		var r models.Retailer
		if err := rows.Scan(&r.ID, &r.RetailerCode, &r.RetailerName, &r.WhatsappNumber,
			&r.City, &r.State, &r.IsOptedOut, &r.OptedOutAt, &r.OptedOutReason, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, nil
}

func (s *Store) GetRetailer(ctx context.Context, id int64) (*models.Retailer, error) {
	var r models.Retailer
	err := s.DB.QueryRow(ctx, `
		SELECT id, retailer_code, retailer_name, whatsapp_number, city, state,
		       is_opted_out, opted_out_at, opted_out_reason, created_at, updated_at
		FROM bc_retailers WHERE id=$1
	`, id).Scan(&r.ID, &r.RetailerCode, &r.RetailerName, &r.WhatsappNumber,
		&r.City, &r.State, &r.IsOptedOut, &r.OptedOutAt, &r.OptedOutReason, &r.CreatedAt, &r.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Store) SetOptOut(ctx context.Context, id int64, optOut bool, reason string) error {
	if optOut {
		_, err := s.DB.Exec(ctx, `UPDATE bc_retailers SET is_opted_out=TRUE, opted_out_at=now(), opted_out_reason=NULLIF($2,''), updated_at=now() WHERE id=$1`, id, reason)
		return err
	}
	_, err := s.DB.Exec(ctx, `UPDATE bc_retailers SET is_opted_out=FALSE, opted_out_at=NULL, opted_out_reason=NULL, updated_at=now() WHERE id=$1`, id)
	return err
}

// ---------- batches ----------

func (s *Store) CreateBatch(ctx context.Context, b *models.UploadBatch) (int64, error) {
	return s.insertReturningID(ctx, `
		INSERT INTO bc_upload_batches (file_name, file_path, file_size_bytes, mime_type, uploaded_by, notes)
		VALUES ($1,$2,$3,$4,$5,$6)
	`, b.FileName, b.FilePath, b.FileSizeBytes, b.MimeType, b.UploadedBy, b.Notes)
}

func (s *Store) UpdateBatchCounts(ctx context.Context, id int64, total, valid, invalid int) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_upload_batches SET total_rows=$2, valid_rows=$3, invalid_rows=$4,
		  status = CASE WHEN status='uploaded' THEN 'validated' ELSE status END
		WHERE id=$1
	`, id, total, valid, invalid)
	return err
}

func (s *Store) SetBatchStatus(ctx context.Context, id int64, status string) error {
	q := `UPDATE bc_upload_batches SET status=$2`
	args := []any{id, status}
	if status == "approved" {
		q += `, approved_at=now()`
	}
	if status == "sending" {
		q += `, started_at=now()`
	}
	if status == "completed" {
		q += `, completed_at=now()`
	}
	q += ` WHERE id=$1`
	args = []any{id, status}
	if status == "approved" {
		q = `UPDATE bc_upload_batches SET status=$2, approved_at=now() WHERE id=$1`
	} else if status == "sending" {
		q = `UPDATE bc_upload_batches SET status=$2, started_at=now() WHERE id=$1`
	} else if status == "completed" {
		q = `UPDATE bc_upload_batches SET status=$2, completed_at=now() WHERE id=$1`
	} else {
		q = `UPDATE bc_upload_batches SET status=$2 WHERE id=$1`
	}
	_, err := s.DB.Exec(ctx, q, args...)
	return err
}

func (s *Store) ApproveBatch(ctx context.Context, batchID, approverID int64) error {
	_, err := s.DB.Exec(ctx, `UPDATE bc_upload_batches SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1`, batchID, approverID)
	return err
}

func (s *Store) GetBatch(ctx context.Context, id int64) (*models.UploadBatch, error) {
	var b models.UploadBatch
	err := s.DB.QueryRow(ctx, `
		SELECT id, file_name, file_path, file_size_bytes, mime_type,
		       total_rows, valid_rows, invalid_rows, status,
		       uploaded_by, approved_by, approved_at, started_at, completed_at, notes, created_at
		FROM bc_upload_batches WHERE id=$1
	`, id).Scan(&b.ID, &b.FileName, &b.FilePath, &b.FileSizeBytes, &b.MimeType,
		&b.TotalRows, &b.ValidRows, &b.InvalidRows, &b.Status,
		&b.UploadedBy, &b.ApprovedBy, &b.ApprovedAt, &b.StartedAt, &b.CompletedAt, &b.Notes, &b.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

func (s *Store) ListBatches(ctx context.Context, limit, offset int) ([]models.UploadBatch, int, error) {
	var total int
	if err := s.DB.QueryRow(ctx, `SELECT COUNT(*) FROM bc_upload_batches`).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.DB.Query(ctx, `
		SELECT id, file_name, file_path, file_size_bytes, mime_type,
		       total_rows, valid_rows, invalid_rows, status,
		       uploaded_by, approved_by, approved_at, started_at, completed_at, notes, created_at
		FROM bc_upload_batches ORDER BY id DESC LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []models.UploadBatch{}
	for rows.Next() {
		var b models.UploadBatch
		if err := rows.Scan(&b.ID, &b.FileName, &b.FilePath, &b.FileSizeBytes, &b.MimeType,
			&b.TotalRows, &b.ValidRows, &b.InvalidRows, &b.Status,
			&b.UploadedBy, &b.ApprovedBy, &b.ApprovedAt, &b.StartedAt, &b.CompletedAt, &b.Notes, &b.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, b)
	}
	return out, total, nil
}

// ---------- billing records ----------

func (s *Store) InsertBillingRecord(ctx context.Context, r *models.BillingRecord) (int64, error) {
	return s.insertReturningID(ctx, `
		INSERT INTO bc_billing_records
		  (batch_id, row_number, retailer_code, retailer_name, whatsapp_number,
		   invoice_number, billing_amount, due_date, payment_link, language,
		   raw_row, is_valid, validation_errors, retailer_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
	`,
		r.BatchID, r.RowNumber, r.RetailerCode, r.RetailerName, r.WhatsappNumber,
		r.InvoiceNumber, r.BillingAmount, r.DueDate, r.PaymentLink, r.Language,
		r.RawRow, r.IsValid, errorsJSON(r.ValidationErrors), r.RetailerID)
}

func (s *Store) ListBillingRecords(ctx context.Context, batchID int64, validOnly bool) ([]models.BillingRecord, error) {
	q := `SELECT id, batch_id, row_number, retailer_code, retailer_name, whatsapp_number,
	             invoice_number, billing_amount, due_date, payment_link, language,
	             raw_row, is_valid, validation_errors, retailer_id, message_job_id, created_at
	      FROM bc_billing_records WHERE batch_id=$1`
	args := []any{batchID}
	if validOnly {
		q += ` AND is_valid=TRUE`
	}
	q += ` ORDER BY row_number ASC`
	rows, err := s.DB.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.BillingRecord{}
	for rows.Next() {
		var (
			r        models.BillingRecord
			errsJSON []byte
		)
		if err := rows.Scan(&r.ID, &r.BatchID, &r.RowNumber, &r.RetailerCode, &r.RetailerName,
			&r.WhatsappNumber, &r.InvoiceNumber, &r.BillingAmount, &r.DueDate, &r.PaymentLink,
			&r.Language, &r.RawRow, &r.IsValid, &errsJSON, &r.RetailerID,
			&r.MessageJobID, &r.CreatedAt); err != nil {
			return nil, err
		}
		if len(errsJSON) > 0 {
			_ = json.Unmarshal(errsJSON, &r.ValidationErrors)
		}
		out = append(out, r)
	}
	return out, nil
}

func (s *Store) ListInvalidBillingRecords(ctx context.Context, batchID int64) ([]models.BillingRecord, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT id, batch_id, row_number, retailer_code, retailer_name, whatsapp_number,
		       invoice_number, billing_amount, due_date, payment_link, language,
		       raw_row, is_valid, validation_errors, retailer_id, message_job_id, created_at
		FROM bc_billing_records WHERE batch_id=$1 AND is_valid=FALSE
		ORDER BY row_number ASC
	`, batchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.BillingRecord{}
	for rows.Next() {
		var (
			r        models.BillingRecord
			errsJSON []byte
		)
		if err := rows.Scan(&r.ID, &r.BatchID, &r.RowNumber, &r.RetailerCode, &r.RetailerName,
			&r.WhatsappNumber, &r.InvoiceNumber, &r.BillingAmount, &r.DueDate, &r.PaymentLink,
			&r.Language, &r.RawRow, &r.IsValid, &errsJSON, &r.RetailerID,
			&r.MessageJobID, &r.CreatedAt); err != nil {
			return nil, err
		}
		if len(errsJSON) > 0 {
			_ = json.Unmarshal(errsJSON, &r.ValidationErrors)
		}
		out = append(out, r)
	}
	return out, nil
}

// ---------- message jobs ----------

func (s *Store) CreateMessageJob(ctx context.Context, j *models.MessageJob) (int64, error) {
	return s.insertReturningID(ctx, `
		INSERT INTO bc_message_jobs
		  (batch_id, billing_record_id, retailer_id, to_number,
		   template_name, language_code, template_params, max_attempts)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
	`, j.BatchID, j.BillingRecordID, j.RetailerID, j.ToNumber,
		j.TemplateName, j.LanguageCode, j.TemplateParams, j.MaxAttempts)
}

func (s *Store) SetBillingRecordJob(ctx context.Context, billingID, jobID int64) error {
	_, err := s.DB.Exec(ctx, `UPDATE bc_billing_records SET message_job_id=$2 WHERE id=$1`, billingID, jobID)
	return err
}

func (s *Store) ListJobsByBatch(ctx context.Context, batchID int64) ([]models.MessageWithContext, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT j.id, j.batch_id, j.billing_record_id, j.retailer_id, j.to_number,
		       j.template_name, j.language_code, j.template_params, j.status,
		       j.attempts, j.max_attempts, j.last_error, j.provider_msg_id,
		       j.queued_at, j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.created_at,
		       r.retailer_name, br.invoice_number, br.billing_amount
		FROM bc_message_jobs j
		LEFT JOIN bc_retailers r ON r.id = j.retailer_id
		LEFT JOIN bc_billing_records br ON br.id = j.billing_record_id
		WHERE j.batch_id=$1 ORDER BY j.id ASC
	`, batchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.MessageWithContext{}
	for rows.Next() {
		var m models.MessageWithContext
		if err := rows.Scan(&m.ID, &m.BatchID, &m.BillingRecordID, &m.RetailerID, &m.ToNumber,
			&m.TemplateName, &m.LanguageCode, &m.TemplateParams, &m.Status,
			&m.Attempts, &m.MaxAttempts, &m.LastError, &m.ProviderMsgID,
			&m.QueuedAt, &m.SentAt, &m.DeliveredAt, &m.ReadAt, &m.FailedAt, &m.CreatedAt,
			&m.RetailerName, &m.InvoiceNumber, &m.Amount); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

func (s *Store) ListMessages(ctx context.Context, status, search string, limit, offset int) ([]models.MessageWithContext, int, error) {
	where := "WHERE 1=1"
	args := []any{}
	if status != "" {
		args = append(args, status)
		where += " AND j.status=$" + itoa(len(args))
	}
	if search != "" {
		args = append(args, "%"+search+"%")
		where += " AND (r.retailer_name ILIKE $" + itoa(len(args)) + " OR j.to_number ILIKE $" + itoa(len(args)) + ")"
	}
	var total int
	if err := s.DB.QueryRow(ctx, "SELECT COUNT(*) FROM bc_message_jobs j LEFT JOIN bc_retailers r ON r.id=j.retailer_id "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, limit, offset)
	q := `
		SELECT j.id, j.batch_id, j.billing_record_id, j.retailer_id, j.to_number,
		       j.template_name, j.language_code, j.template_params, j.status,
		       j.attempts, j.max_attempts, j.last_error, j.provider_msg_id,
		       j.queued_at, j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.created_at,
		       r.retailer_name, br.invoice_number, br.billing_amount
		FROM bc_message_jobs j
		LEFT JOIN bc_retailers r ON r.id = j.retailer_id
		LEFT JOIN bc_billing_records br ON br.id = j.billing_record_id
		` + where + ` ORDER BY j.id DESC LIMIT $` + itoa(len(args)-1) + ` OFFSET $` + itoa(len(args))
	rows, err := s.DB.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []models.MessageWithContext{}
	for rows.Next() {
		var m models.MessageWithContext
		if err := rows.Scan(&m.ID, &m.BatchID, &m.BillingRecordID, &m.RetailerID, &m.ToNumber,
			&m.TemplateName, &m.LanguageCode, &m.TemplateParams, &m.Status,
			&m.Attempts, &m.MaxAttempts, &m.LastError, &m.ProviderMsgID,
			&m.QueuedAt, &m.SentAt, &m.DeliveredAt, &m.ReadAt, &m.FailedAt, &m.CreatedAt,
			&m.RetailerName, &m.InvoiceNumber, &m.Amount); err != nil {
			return nil, 0, err
		}
		out = append(out, m)
	}
	return out, total, nil
}

func (s *Store) GetMessage(ctx context.Context, id int64) (*models.MessageWithContext, []models.StatusEvent, error) {
	var m models.MessageWithContext
	err := s.DB.QueryRow(ctx, `
		SELECT j.id, j.batch_id, j.billing_record_id, j.retailer_id, j.to_number,
		       j.template_name, j.language_code, j.template_params, j.status,
		       j.attempts, j.max_attempts, j.last_error, j.provider_msg_id,
		       j.queued_at, j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.created_at,
		       r.retailer_name, br.invoice_number, br.billing_amount
		FROM bc_message_jobs j
		LEFT JOIN bc_retailers r ON r.id = j.retailer_id
		LEFT JOIN bc_billing_records br ON br.id = j.billing_record_id
		WHERE j.id=$1
	`, id).Scan(&m.ID, &m.BatchID, &m.BillingRecordID, &m.RetailerID, &m.ToNumber,
		&m.TemplateName, &m.LanguageCode, &m.TemplateParams, &m.Status,
		&m.Attempts, &m.MaxAttempts, &m.LastError, &m.ProviderMsgID,
		&m.QueuedAt, &m.SentAt, &m.DeliveredAt, &m.ReadAt, &m.FailedAt, &m.CreatedAt,
		&m.RetailerName, &m.InvoiceNumber, &m.Amount)
	if err == pgx.ErrNoRows {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	rows, err := s.DB.Query(ctx, `
		SELECT id, message_job_id, provider_msg_id, status, reason_code, reason_text, raw_payload, occurred_at
		FROM bc_message_status_events WHERE message_job_id=$1 ORDER BY occurred_at ASC
	`, id)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	evs := []models.StatusEvent{}
	for rows.Next() {
		var e models.StatusEvent
		if err := rows.Scan(&e.ID, &e.MessageJobID, &e.ProviderMsgID, &e.Status, &e.ReasonCode, &e.ReasonText, &e.RawPayload, &e.OccurredAt); err != nil {
			return nil, nil, err
		}
		evs = append(evs, e)
	}
	return &m, evs, nil
}

func (s *Store) MarkJobStatus(ctx context.Context, id int64, status string, providerMsgID, lastErr *string) error {
	col := ""
	switch status {
	case "sending":
		col = ""
	case "sent":
		col = ", sent_at=now()"
	case "delivered":
		col = ", delivered_at=COALESCE(delivered_at, now())"
	case "read":
		col = ", read_at=COALESCE(read_at, now())"
	case "failed":
		col = ", failed_at=now()"
	}
	q := `UPDATE bc_message_jobs SET status=$2, provider_msg_id=COALESCE($3, provider_msg_id), last_error=$4, attempts=attempts+1` + col + ` WHERE id=$1`
	_, err := s.DB.Exec(ctx, q, id, status, providerMsgID, lastErr)
	return err
}

func (s *Store) InsertStatusEvent(ctx context.Context, jobID int64, providerMsgID, status, reasonCode, reasonText *string, raw []byte) error {
	_, err := s.DB.Exec(ctx, `
		INSERT INTO bc_message_status_events (message_job_id, provider_msg_id, status, reason_code, reason_text, raw_payload)
		VALUES ($1,$2,$3,$4,$5,$6)
	`, jobID, providerMsgID, status, reasonCode, reasonText, raw)
	return err
}

// ResetJobForRetry flips a failed (or stuck) job back to queued so the worker
// will pick it up again. Reuses the existing bc_message_jobs row so the
// audit trail and status-events timeline are preserved.
//
// Status guard:
//   - queued / failed / sending -> reset to queued, attempts++, last_error=NULL
//   - sent / delivered / read    -> 400 (no double-send)
//   - anything else              -> 400
func (s *Store) ResetJobForRetry(ctx context.Context, id int64) (*models.MessageJob, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var status string
	if err := tx.QueryRow(ctx,
		`SELECT status FROM bc_message_jobs WHERE id=$1 FOR UPDATE`, id,
	).Scan(&status); err != nil {
		return nil, err
	}
	switch status {
	case "queued", "failed", "sending":
		// ok
	case "sent", "delivered", "read":
		return nil, fmt.Errorf("cannot resend: already %s", status)
	default:
		return nil, fmt.Errorf("cannot resend: invalid status %q", status)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE bc_message_jobs
		SET status='queued', last_error=NULL, attempts=attempts+1, failed_at=NULL
		WHERE id=$1
	`, id); err != nil {
		return nil, err
	}

	var j models.MessageJob
	if err := tx.QueryRow(ctx, `
		SELECT id, batch_id, billing_record_id, retailer_id, to_number,
		       template_name, language_code, template_params, status,
		       attempts, max_attempts, last_error, provider_msg_id,
		       queued_at, sent_at, delivered_at, read_at, failed_at, created_at
		FROM bc_message_jobs WHERE id=$1
	`, id).Scan(&j.ID, &j.BatchID, &j.BillingRecordID, &j.RetailerID, &j.ToNumber,
		&j.TemplateName, &j.LanguageCode, &j.TemplateParams, &j.Status,
		&j.Attempts, &j.MaxAttempts, &j.LastError, &j.ProviderMsgID,
		&j.QueuedAt, &j.SentAt, &j.DeliveredAt, &j.ReadAt, &j.FailedAt, &j.CreatedAt,
	); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &j, nil
}

// ResetManyFailedForRetry bulk-resets all failed jobs. When batchID > 0,
// only resets within that batch; otherwise all failed jobs globally.
func (s *Store) ResetManyFailedForRetry(ctx context.Context, batchID int64) ([]models.MessageJob, error) {
	where := "status='failed'"
	args := []any{}
	if batchID > 0 {
		where += " AND batch_id=$1"
		args = append(args, batchID)
	}
	rows, err := s.DB.Query(ctx, `SELECT id FROM bc_message_jobs WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()

	out := []models.MessageJob{}
	for _, id := range ids {
		j, err := s.ResetJobForRetry(ctx, id)
		if err != nil {
			continue
		}
		out = append(out, *j)
	}
	return out, nil
}

func (s *Store) FindJobByProviderMsgID(ctx context.Context, provID string) (*models.MessageJob, error) {
	var j models.MessageJob
	err := s.DB.QueryRow(ctx, `
		SELECT id, batch_id, billing_record_id, retailer_id, to_number, template_name, language_code,
		       template_params, status, attempts, max_attempts, last_error, provider_msg_id,
		       queued_at, sent_at, delivered_at, read_at, failed_at, created_at
		FROM bc_message_jobs WHERE provider_msg_id=$1
	`, provID).Scan(&j.ID, &j.BatchID, &j.BillingRecordID, &j.RetailerID, &j.ToNumber, &j.TemplateName, &j.LanguageCode,
		&j.TemplateParams, &j.Status, &j.Attempts, &j.MaxAttempts, &j.LastError, &j.ProviderMsgID,
		&j.QueuedAt, &j.SentAt, &j.DeliveredAt, &j.ReadAt, &j.FailedAt, &j.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

// ---------- retailer history ----------

func (s *Store) RetailerHistory(ctx context.Context, retailerID int64, limit int) ([]models.MessageWithContext, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT j.id, j.batch_id, j.billing_record_id, j.retailer_id, j.to_number,
		       j.template_name, j.language_code, j.template_params, j.status,
		       j.attempts, j.max_attempts, j.last_error, j.provider_msg_id,
		       j.queued_at, j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.created_at,
		       r.retailer_name, br.invoice_number, br.billing_amount
		FROM bc_message_jobs j
		LEFT JOIN bc_retailers r ON r.id = j.retailer_id
		LEFT JOIN bc_billing_records br ON br.id = j.billing_record_id
		WHERE j.retailer_id=$1 ORDER BY j.id DESC LIMIT $2
	`, retailerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.MessageWithContext{}
	for rows.Next() {
		var m models.MessageWithContext
		if err := rows.Scan(&m.ID, &m.BatchID, &m.BillingRecordID, &m.RetailerID, &m.ToNumber,
			&m.TemplateName, &m.LanguageCode, &m.TemplateParams, &m.Status,
			&m.Attempts, &m.MaxAttempts, &m.LastError, &m.ProviderMsgID,
			&m.QueuedAt, &m.SentAt, &m.DeliveredAt, &m.ReadAt, &m.FailedAt, &m.CreatedAt,
			&m.RetailerName, &m.InvoiceNumber, &m.Amount); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

// ---------- templates ----------

func (s *Store) ListTemplates(ctx context.Context) ([]models.Template, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT id, name, language_code, category, body, variable_count, sample_payload, is_active, created_at
		FROM bc_templates ORDER BY id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Template{}
	for rows.Next() {
		var t models.Template
		if err := rows.Scan(&t.ID, &t.Name, &t.LanguageCode, &t.Category, &t.Body, &t.VariableCount, &t.SamplePayload, &t.IsActive, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

func (s *Store) CreateTemplate(ctx context.Context, t *models.Template) (int64, error) {
	return s.insertReturningID(ctx, `
		INSERT INTO bc_templates (name, language_code, category, body, variable_count, sample_payload, is_active)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
	`, t.Name, t.LanguageCode, t.Category, t.Body, t.VariableCount, t.SamplePayload, t.IsActive)
}

func (s *Store) GetActiveTemplate(ctx context.Context, name, lang string) (*models.Template, error) {
	var t models.Template
	err := s.DB.QueryRow(ctx, `
		SELECT id, name, language_code, category, body, variable_count, sample_payload, is_active, created_at
		FROM bc_templates WHERE name=$1 AND language_code=$2 AND is_active=TRUE
	`, name, lang).Scan(&t.ID, &t.Name, &t.LanguageCode, &t.Category, &t.Body, &t.VariableCount, &t.SamplePayload, &t.IsActive, &t.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// GetTemplateByID fetches a single template row regardless of is_active.
// Used by the editor and the preview endpoint.
func (s *Store) GetTemplateByID(ctx context.Context, id int64) (*models.Template, error) {
	var t models.Template
	err := s.DB.QueryRow(ctx, `
		SELECT id, name, language_code, category, body, variable_count, sample_payload, is_active, created_at
		FROM bc_templates WHERE id=$1
	`, id).Scan(&t.ID, &t.Name, &t.LanguageCode, &t.Category, &t.Body, &t.VariableCount, &t.SamplePayload, &t.IsActive, &t.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// UpdateTemplate updates the editable fields of a template.
// name/language_code are unique together (uq_bc_templates_name_lang), so the
// caller is responsible for not colliding with another row. Empty name/lang
// is rejected here as a defensive guard.
//
// Only updates body / category / sample_payload / is_active. The unique pair
// (name, language_code) is treated as the template's stable identity — if the
// editor wants to rename it, they should create a new template instead. This
// keeps the audit trail and avoids cascading breaks in already-approved
// message_jobs rows that reference the old (name, language_code).
func (s *Store) UpdateTemplate(ctx context.Context, t *models.Template) error {
	if t == nil || t.ID == 0 {
		return fmt.Errorf("update template: id required")
	}
	if strings.TrimSpace(t.Name) == "" || strings.TrimSpace(t.LanguageCode) == "" {
		return fmt.Errorf("update template: name and language_code required")
	}
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_templates
		SET name=$1, language_code=$2, category=$3, body=$4,
		    variable_count=$5, sample_payload=$6, is_active=$7
		WHERE id=$8
	`, t.Name, t.LanguageCode, t.Category, t.Body, t.VariableCount, t.SamplePayload, t.IsActive, t.ID)
	return err
}

// SetTemplateActive toggles is_active for one template row.
func (s *Store) SetTemplateActive(ctx context.Context, id int64, active bool) error {
	_, err := s.DB.Exec(ctx, `UPDATE bc_templates SET is_active=$1 WHERE id=$2`, active, id)
	return err
}

// DeleteTemplate hard-deletes a template. Message jobs already created from
// this template keep their denormalised template_name/language_code so
// historical messages still render in /chats.
func (s *Store) DeleteTemplate(ctx context.Context, id int64) error {
	_, err := s.DB.Exec(ctx, `DELETE FROM bc_templates WHERE id=$1`, id)
	return err
}

// ---------- dashboard ----------

func (s *Store) KPIs(ctx context.Context) (models.DashboardKPI, error) {
	var k models.DashboardKPI
	err := s.DB.QueryRow(ctx, `
		SELECT
		  (SELECT COUNT(*) FROM bc_retailers),
		  (SELECT COUNT(*) FROM bc_retailers WHERE is_opted_out=TRUE)
	`).Scan(&k.TotalRetailers, &k.OptedOutRetailers)
	if err != nil {
		return k, err
	}
	rows, err := s.DB.Query(ctx, `
		SELECT status, COUNT(*) FROM bc_message_jobs
		WHERE created_at::date = CURRENT_DATE GROUP BY status
	`)
	if err != nil {
		return k, err
	}
	defer rows.Close()
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			return k, err
		}
		k.MessagesToday += n
		switch st {
		case "delivered", "read":
			k.DeliveredToday += n
			if st == "read" {
				k.ReadToday += n
			}
		case "failed":
			k.FailedToday += n
		}
	}
	if k.MessagesToday > 0 {
		k.DeliveryRateToday = float64(k.DeliveredToday) / float64(k.MessagesToday) * 100
		k.ReadRateToday = float64(k.ReadToday) / float64(k.MessagesToday) * 100
	}
	return k, nil
}

func (s *Store) DailyTrend(ctx context.Context, days int) ([]models.DailyTrendPoint, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT to_char(d.day,'YYYY-MM-DD') AS d,
		       COUNT(*) FILTER (WHERE j.status IN ('sent','delivered','read')) AS sent,
		       COUNT(*) FILTER (WHERE j.status IN ('delivered','read')) AS delivered,
		       COUNT(*) FILTER (WHERE j.status='read') AS read,
		       COUNT(*) FILTER (WHERE j.status='failed') AS failed
		FROM generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, INTERVAL '1 day') AS d(day)
		LEFT JOIN bc_message_jobs j ON j.created_at::date = d.day
		GROUP BY d.day ORDER BY d.day ASC
	`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.DailyTrendPoint{}
	for rows.Next() {
		var p models.DailyTrendPoint
		if err := rows.Scan(&p.Date, &p.Sent, &p.Delivered, &p.Read, &p.Failed); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

// ---------- reports ----------

func (s *Store) ReportSummary(ctx context.Context, from, to time.Time) (map[string]int, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT status, COUNT(*) FROM bc_message_jobs
		WHERE created_at BETWEEN $1 AND $2 GROUP BY status
	`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{
		"sent": 0, "delivered": 0, "read": 0, "failed": 0, "queued": 0, "sending": 0,
	}
	for rows.Next() {
		var s string
		var n int
		if err := rows.Scan(&s, &n); err != nil {
			return nil, err
		}
		out[s] = n
	}
	return out, nil
}

// ReportsTrend returns one bucket per day in [from, to] (zero-filled), with
// per-day counts for sent / delivered / read / failed. Drives the
// /api/reports/trend chart so the Reports page can render any window, not
// just the last 7 days like /api/dashboard/trend.
//
// "sent" is derived from `created_at` (every queued job has one), matching
// the Reports.tsx definition of sent = queued+sending+sent+delivered+read.
// "delivered" / "read" / "failed" use their respective *_at timestamps so an
// event that happened on a later day still lands on the day it occurred.
func (s *Store) ReportsTrend(ctx context.Context, from, to time.Time) ([]models.DailyTrendPoint, error) {
	// Upper bound for the SQL: include the whole `to` day.
	// Lower bound is the start of `from`. The handler already validated
	// from <= to + 366d cap.
	rows, err := s.DB.Query(ctx, `
		WITH days AS (
			SELECT generate_series(
				date_trunc('day', $1::timestamptz),
				date_trunc('day', $2::timestamptz),
				interval '1 day'
			) AS day
		),
		buckets AS (
			SELECT
				date_trunc('day', created_at)::date  AS d,
				COUNT(*) FILTER (WHERE created_at   IS NOT NULL) AS sent,
				COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered,
				COUNT(*) FILTER (WHERE read_at      IS NOT NULL) AS read,
				COUNT(*) FILTER (WHERE failed_at    IS NOT NULL) AS failed
			FROM bc_message_jobs
			WHERE created_at >= $1::timestamptz
			  AND created_at <  ($2::timestamptz + interval '1 day')
			GROUP BY 1
		)
		SELECT
			to_char(days.day, 'YYYY-MM-DD') AS date,
			COALESCE(b.sent,      0)::int,
			COALESCE(b.delivered, 0)::int,
			COALESCE(b.read,      0)::int,
			COALESCE(b.failed,    0)::int
		FROM days
		LEFT JOIN buckets b ON b.d = days.day
		ORDER BY days.day
	`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.DailyTrendPoint{}
	for rows.Next() {
		var p models.DailyTrendPoint
		if err := rows.Scan(&p.Date, &p.Sent, &p.Delivered, &p.Read, &p.Failed); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

// ---------- audit ----------

func (s *Store) RecentAudit(ctx context.Context, limit int) ([]models.AuditLog, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT id, actor_id, actor_email, action, entity_type, entity_id, metadata, ip_address, user_agent, created_at
		FROM bc_audit_logs ORDER BY id DESC LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.AuditLog{}
	for rows.Next() {
		var a models.AuditLog
		if err := rows.Scan(&a.ID, &a.ActorID, &a.ActorEmail, &a.Action, &a.EntityType, &a.EntityID, &a.Metadata, &a.IPAddress, &a.UserAgent, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

// ---------- helpers ----------

func (s *Store) insertReturningID(ctx context.Context, q string, args ...any) (int64, error) {
	q = q + " RETURNING id"
	var id int64
	if err := s.DB.QueryRow(ctx, q, args...).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

func errorsJSON(errs []models.ValidationError) []byte {
	if len(errs) == 0 {
		return nil
	}
	b, _ := json.Marshal(errs)
	return b
}

func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	digits := []byte{}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}

// previewFromParams renders a short human-readable preview from a job's
// stored template_params. Used for the conversation-list row.
func previewFromParams(j *models.MessageJob) string {
	if len(j.TemplateParams) == 0 {
		return j.TemplateName
	}
	var params []string
	if err := json.Unmarshal(j.TemplateParams, &params); err != nil {
		return j.TemplateName
	}
	parts := make([]string, 0, len(params))
	for _, p := range params {
		if strings.TrimSpace(p) == "" {
			continue
		}
		parts = append(parts, p)
	}
	body := strings.Join(parts, " ")
	if len(body) > 80 {
		body = body[:77] + "…"
	}
	return body
}

// ---------- conversations (chat view) ----------

// ListConversations groups bc_message_jobs by retailer_id (with a phone-only
// fallback for unlinked messages) and returns one row per group, newest first.
func (s *Store) ListConversations(ctx context.Context, search string, limit, offset int) ([]models.Conversation, int, error) {
	where := `WHERE 1=1`
	args := []any{}
	if search != "" {
		args = append(args, "%"+search+"%")
		idx := itoa(len(args))
		where += ` AND (r.retailer_name ILIKE $` + idx + ` OR j.to_number ILIKE $` + idx + `)`
	}

	var total int
	if err := s.DB.QueryRow(ctx, `
		SELECT COUNT(*) FROM (
			SELECT 1
			FROM bc_message_jobs j
			LEFT JOIN bc_retailers r ON r.id = j.retailer_id
			`+where+`
			GROUP BY COALESCE(j.retailer_id, -j.id), j.to_number
		) t
	`, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, limit, offset)
	limitIdx := itoa(len(args) - 1)
	offsetIdx := itoa(len(args))
	rows, err := s.DB.Query(ctx, `
		SELECT
			j.retailer_id,
			j.to_number,
			COALESCE(r.retailer_name, '(unknown)'),
			MAX(COALESCE(j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.queued_at, j.created_at)) AS last_at,
			COUNT(*)::int AS cnt,
			BOOL_OR(j.status = 'failed') AS has_failed
		FROM bc_message_jobs j
		LEFT JOIN bc_retailers r ON r.id = j.retailer_id
		`+where+`
		GROUP BY j.retailer_id, j.to_number, r.retailer_name
		ORDER BY last_at DESC
		LIMIT $`+limitIdx+` OFFSET $`+offsetIdx+`
	`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := []models.Conversation{}
	for rows.Next() {
		var c models.Conversation
		if err := rows.Scan(&c.RetailerID, &c.Phone, &c.RetailerName, &c.LastMessageAt, &c.MessageCount, &c.HasFailed); err != nil {
			return nil, 0, err
		}
		out = append(out, c)
	}

	// Fill last_preview, last_status, last_direction from the latest job per conversation.
	for i := range out {
		c := &out[i]
		var (
			j   *models.MessageJob
			err error
		)
		if c.RetailerID != nil {
			j, err = s.latestJobForRetailer(ctx, *c.RetailerID)
		} else {
			j, err = s.latestJobForPhone(ctx, c.Phone)
		}
		if err != nil || j == nil {
			continue
		}

		// If the most recent job is an orphan (status='received'), the actual
		// user-visible preview is the latest inbound message body, not the
		// empty template_name on the job row.
		if j.Status == "received" {
			c.LastStatus = "received"
			c.LastDirection = "inbound"
			body, _ := s.latestInboundBody(ctx, j.ID)
			c.LastPreview = body
			continue
		}

		c.LastStatus = j.Status
		c.LastDirection = "outbound"
		c.LastPreview = previewFromParams(j)
	}
	return out, total, nil
}

// latestInboundBody returns the body of the most recent received status event
// for a job (used to populate the conversation-list preview for inbound).
func (s *Store) latestInboundBody(ctx context.Context, jobID int64) (string, error) {
	var body *string
	err := s.DB.QueryRow(ctx, `
		SELECT reason_text FROM bc_message_status_events
		WHERE message_job_id = $1 AND status = 'received'
		ORDER BY occurred_at DESC LIMIT 1
	`, jobID).Scan(&body)
	if err != nil || body == nil {
		return "", err
	}
	text := *body
	if len(text) > 80 {
		text = text[:77] + "…"
	}
	return text, nil
}

func (s *Store) latestJobForRetailer(ctx context.Context, retailerID int64) (*models.MessageJob, error) {
	var j models.MessageJob
	err := s.DB.QueryRow(ctx, `
		SELECT id, batch_id, billing_record_id, retailer_id, to_number,
		       template_name, language_code, template_params, status,
		       attempts, max_attempts, last_error, provider_msg_id,
		       queued_at, sent_at, delivered_at, read_at, failed_at, created_at
		FROM bc_message_jobs
		WHERE retailer_id=$1
		ORDER BY COALESCE(sent_at, delivered_at, read_at, failed_at, queued_at, created_at) DESC
		LIMIT 1`, retailerID,
	).Scan(&j.ID, &j.BatchID, &j.BillingRecordID, &j.RetailerID, &j.ToNumber,
		&j.TemplateName, &j.LanguageCode, &j.TemplateParams, &j.Status,
		&j.Attempts, &j.MaxAttempts, &j.LastError, &j.ProviderMsgID,
		&j.QueuedAt, &j.SentAt, &j.DeliveredAt, &j.ReadAt, &j.FailedAt, &j.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &j, err
}

func (s *Store) latestJobForPhone(ctx context.Context, phone string) (*models.MessageJob, error) {
	var j models.MessageJob
	err := s.DB.QueryRow(ctx, `
		SELECT id, batch_id, billing_record_id, retailer_id, to_number,
		       template_name, language_code, template_params, status,
		       attempts, max_attempts, last_error, provider_msg_id,
		       queued_at, sent_at, delivered_at, read_at, failed_at, created_at
		FROM bc_message_jobs
		WHERE retailer_id IS NULL AND to_number=$1
		ORDER BY COALESCE(sent_at, delivered_at, read_at, failed_at, queued_at, created_at) DESC
		LIMIT 1`, phone,
	).Scan(&j.ID, &j.BatchID, &j.BillingRecordID, &j.RetailerID, &j.ToNumber,
		&j.TemplateName, &j.LanguageCode, &j.TemplateParams, &j.Status,
		&j.Attempts, &j.MaxAttempts, &j.LastError, &j.ProviderMsgID,
		&j.QueuedAt, &j.SentAt, &j.DeliveredAt, &j.ReadAt, &j.FailedAt, &j.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &j, err
}

// ListConversationMessages returns the merged outbound + inbound thread for
// one retailer, oldest first. Inbound is sourced from bc_message_status_events
// where status='received'. Outbound is sourced from bc_message_jobs.
//
// The bubble body is rendered by substituting the job's stored
// template_params into the template body — i.e. exactly what was sent to
// Meta, so the chat preview matches what the retailer sees on their phone.
func (s *Store) ListConversationMessages(ctx context.Context, retailerID int64, limit, offset int) ([]models.ThreadMessage, error) {
	outRows, err := s.DB.Query(ctx, `
		SELECT j.id, j.template_name, j.language_code, j.status,
		       j.last_error, j.provider_msg_id, j.billing_record_id,
		       j.template_params,
		       COALESCE(j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.queued_at, j.created_at) AS occurred_at,
		       br.invoice_number, br.billing_amount, t.body AS template_body
		FROM bc_message_jobs j
		LEFT JOIN bc_billing_records br ON br.id = j.billing_record_id
		LEFT JOIN bc_templates t ON t.name = j.template_name AND t.language_code = j.language_code
		WHERE j.retailer_id = $1
		  AND j.status <> 'received'   -- exclude orphan inbound-only rows;
		                                -- they surface via the inbound list below
		  AND j.batch_id <> 0          -- batch_id=0 means synthetic (no real batch)
		ORDER BY occurred_at ASC
	`, retailerID)
	if err != nil {
		return nil, err
	}
	defer outRows.Close()

	out := []models.ThreadMessage{}
	for outRows.Next() {
		var (
			id           int64
			tplName      string
			lang         string
			status       string
			lastErr      *string
			provID       *string
			brID         *int64
			tplParams    []byte
			occurredAt   time.Time
			inv          *string
			amount       *float64
			templateBody *string
		)
		if err := outRows.Scan(&id, &tplName, &lang, &status, &lastErr, &provID, &brID,
			&tplParams, &occurredAt, &inv, &amount, &templateBody); err != nil {
			return nil, err
		}

		// Render the bubble body: substitute stored params into the template body.
		// This produces exactly the message the retailer received on their phone.
		body := renderOutboundBody(templateBody, tplParams, inv, amount, occurredAt)

		out = append(out, models.ThreadMessage{
			ID:            id,
			Direction:     "outbound",
			Body:          body,
			Status:        status,
			OccurredAt:    occurredAt,
			TemplateName:  tplName,
			LanguageCode:  lang,
			LastError:     lastErr,
			ProviderMsgID: provID,
			InvoiceNumber: inv,
			Amount:        amount,
			MessageJobID:  id,
		})
	}

	// Fetch inbound (status events with status='received') for jobs belonging
	// to this retailer.
	inRows, err := s.DB.Query(ctx, `
		SELECT e.id, e.message_job_id, COALESCE(e.reason_text, '') AS body,
		       e.status, e.occurred_at, e.provider_msg_id
		FROM bc_message_status_events e
		JOIN bc_message_jobs j ON j.id = e.message_job_id
		WHERE j.retailer_id = $1 AND e.status = 'received'
		ORDER BY e.occurred_at ASC
	`, retailerID)
	if err != nil {
		return nil, err
	}
	defer inRows.Close()

	for inRows.Next() {
		var (
			id        int64
			msgJobID  int64
			body      string
			status    string
			occurred  time.Time
			provID    *string
		)
		if err := inRows.Scan(&id, &msgJobID, &body, &status, &occurred, &provID); err != nil {
			return nil, err
		}
		out = append(out, models.ThreadMessage{
			ID:            id,
			Direction:     "inbound",
			Body:          body,
			Status:        status,
			OccurredAt:    occurred,
			ProviderMsgID: provID,
			MessageJobID:  msgJobID,
		})
	}

	// CRITICAL: merge the two lists chronologically. Each SELECT is ordered
	// ASC by occurred_at, but they're returned as two separate result sets —
	// if we just concatenate, all outbounds come first, then all inbounds,
	// which is the wrong chat-thread order. Sort the combined slice by
	// OccurredAt ASC so the chat renders oldest-at-top, newest-at-bottom
	// (standard WhatsApp-style), interleaved by direction.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].OccurredAt.Equal(out[j].OccurredAt) {
			// Stable tiebreak: outbounds before inbounds at the same
			// timestamp (so a billing summary that was sent and replied to
			// in the same second shows the answer bubble below the question).
			if out[i].Direction != out[j].Direction {
				return out[i].Direction == "outbound"
			}
			return out[i].ID < out[j].ID
		}
		return out[i].OccurredAt.Before(out[j].OccurredAt)
	})

	if offset >= len(out) {
		return []models.ThreadMessage{}, nil
	}
	end := offset + limit
	if end > len(out) {
		end = len(out)
	}
	return out[offset:end], nil
}

// substituteDefaults is the same default {{N}} mapping used by the worker
// when sending, so the chat preview shows what was actually delivered.
func substituteDefaults(body string, invoice *string, amount *float64, occurredAt time.Time) string {
	inv := ""
	if invoice != nil {
		inv = *invoice
	}
	amt := ""
	if amount != nil {
		amt = fmt.Sprintf("%.2f", *amount)
	}
	date := occurredAt.Format("2006-01-02")
	// Default mapping (matches handlers/helpers.go buildTemplateParams):
	// {{1}}=name, {{2}}=period, {{3}}=invoice, {{4}}=amount, {{5}}=due, {{6}}=contact
	name := ""
	period := date
	due := date
	contact := "support@itc.example"

	repls := []struct{ old, new string }{
		{"{{1}}", name},
		{"{{2}}", period},
		{"{{3}}", inv},
		{"{{4}}", amt},
		{"{{5}}", due},
		{"{{6}}", contact},
	}
	for _, r := range repls {
		body = strings.ReplaceAll(body, r.old, r.new)
	}
	return body
}

// renderOutboundBody produces the bubble text for an outbound message —
// exactly what was sent to Meta (and what the retailer sees on their phone).
//
// Inputs (in priority order):
//   1. templateBody (from bc_templates) + tplParams (from bc_message_jobs.template_params)
//      -> substituted like Meta's renderer does. Newlines preserved.
//   2. templateBody exists but params missing: substituteDefaults
//   3. params only: composeFromParams (matches worker's plain-text fallback)
//   4. last resort: dump invoice/amount if available.
func renderOutboundBody(templateBody *string, tplParams []byte, invoice *string, amount *float64, occurredAt time.Time) string {
	var params []string
	if len(tplParams) > 0 {
		_ = json.Unmarshal(tplParams, &params)
	}

	// 1) Best case: real template body + real params from this job.
	if templateBody != nil && *templateBody != "" && len(params) > 0 {
		body := *templateBody
		for i, p := range params {
			body = strings.ReplaceAll(body, fmt.Sprintf("{{%d}}", i+1), p)
		}
		return body
	}

	// 2) Template body exists but no stored params (e.g. retried / older jobs).
	if templateBody != nil && *templateBody != "" {
		return substituteDefaults(*templateBody, invoice, amount, occurredAt)
	}

	// 3) No template body. Compose from the params the way the worker's
	//    composeTextBody does, so the bubble matches what was actually sent.
	if len(params) > 0 {
		return composeFromParams(params)
	}

	// 4) Nothing at all — show something sensible so the row isn't blank.
	if invoice != nil || amount != nil {
		parts := []string{}
		if invoice != nil {
			parts = append(parts, "Invoice: "+*invoice)
		}
		if amount != nil {
			parts = append(parts, fmt.Sprintf("Amount: INR %.2f", *amount))
		}
		return strings.Join(parts, "\n")
	}

	return "Message sent."
}

// composeFromParams mirrors worker.composeTextBody — used when the template
// body isn't seeded but the params are. Keeps the bubble matching what
// WHATS_FORCE_TEXT would have sent.
func composeFromParams(params []string) string {
	parts := make([]string, 0, len(params))
	for _, p := range params {
		if strings.TrimSpace(p) == "" {
			continue
		}
		parts = append(parts, p)
	}
	if len(parts) == 0 {
		return "Hello from WhatsyITC."
	}
	switch {
	case len(parts) >= 6:
		return fmt.Sprintf(
			"Hello %s, your billing summary for %s.\n\nInvoice: %s\nAmount: INR %s\nDue Date: %s\n\nFor billing queries, contact %s.",
			parts[0], parts[1], parts[2], parts[3], parts[4], parts[5],
		)
	case len(parts) >= 2:
		return "Hello " + parts[0] + ",\n\n" + strings.Join(parts[1:], "\n")
	default:
		return strings.Join(parts, "\n")
	}
}

// ConversationStorer is the surface the handlers depend on. Defined here so
// the conversations handlers can compile against the interface and we get a
// compile-time error if a method is missing.
type ConversationStorer interface {
	ListConversations(ctx context.Context, search string, limit, offset int) ([]models.Conversation, int, error)
	ListConversationMessages(ctx context.Context, retailerID int64, limit, offset int) ([]models.ThreadMessage, error)
	ListConversationMessagesByPhone(ctx context.Context, phone string, limit, offset int) ([]models.ThreadMessage, error)
}

// ListConversationMessagesByPhone is the phone-only fallback for unlinked
// conversations (messages whose retailer_id is NULL). Same shape as the
// retailer-id version, but filtered by to_number instead.
func (s *Store) ListConversationMessagesByPhone(ctx context.Context, phone string, limit, offset int) ([]models.ThreadMessage, error) {
	outRows, err := s.DB.Query(ctx, `
		SELECT j.id, j.template_name, j.language_code, j.status,
		       j.last_error, j.provider_msg_id, j.billing_record_id,
		       j.template_params,
		       COALESCE(j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.queued_at, j.created_at) AS occurred_at,
		       br.invoice_number, br.billing_amount, t.body AS template_body
		FROM bc_message_jobs j
		LEFT JOIN bc_billing_records br ON br.id = j.billing_record_id
		LEFT JOIN bc_templates t ON t.name = j.template_name AND t.language_code = j.language_code
		WHERE j.retailer_id IS NULL AND j.to_number = $1
		  AND j.status <> 'received'
		  AND j.batch_id <> 0
		ORDER BY occurred_at ASC
	`, phone)
	if err != nil {
		return nil, err
	}
	defer outRows.Close()

	out := []models.ThreadMessage{}
	for outRows.Next() {
		var (
			id           int64
			tplName      string
			lang         string
			status       string
			lastErr      *string
			provID       *string
			brID         *int64
			tplParams    []byte
			occurredAt   time.Time
			inv          *string
			amount       *float64
			templateBody *string
		)
		if err := outRows.Scan(&id, &tplName, &lang, &status, &lastErr, &provID, &brID,
			&tplParams, &occurredAt, &inv, &amount, &templateBody); err != nil {
			return nil, err
		}
		body := renderOutboundBody(templateBody, tplParams, inv, amount, occurredAt)
		out = append(out, models.ThreadMessage{
			ID:            id,
			Direction:     "outbound",
			Body:          body,
			Status:        status,
			OccurredAt:    occurredAt,
			TemplateName:  tplName,
			LanguageCode:  lang,
			LastError:     lastErr,
			ProviderMsgID: provID,
			InvoiceNumber: inv,
			Amount:        amount,
			MessageJobID:  id,
		})
	}

	inRows, err := s.DB.Query(ctx, `
		SELECT e.id, e.message_job_id, COALESCE(e.reason_text, '') AS body,
		       e.status, e.occurred_at, e.provider_msg_id
		FROM bc_message_status_events e
		JOIN bc_message_jobs j ON j.id = e.message_job_id
		WHERE j.retailer_id IS NULL AND j.to_number = $1 AND e.status = 'received'
		ORDER BY e.occurred_at ASC
	`, phone)
	if err != nil {
		return nil, err
	}
	defer inRows.Close()

	for inRows.Next() {
		var (
			id       int64
			msgJobID int64
			body     string
			status   string
			occurred time.Time
			provID   *string
		)
		if err := inRows.Scan(&id, &msgJobID, &body, &status, &occurred, &provID); err != nil {
			return nil, err
		}
		out = append(out, models.ThreadMessage{
			ID:            id,
			Direction:     "inbound",
			Body:          body,
			Status:        status,
			OccurredAt:    occurred,
			ProviderMsgID: provID,
			MessageJobID:  msgJobID,
		})
	}

	// CRITICAL: merge outbound + inbound chronologically. Without this, the
	// chat thread shows all outbounds at the top and all inbounds at the
	// bottom regardless of when they actually happened.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].OccurredAt.Equal(out[j].OccurredAt) {
			if out[i].Direction != out[j].Direction {
				return out[i].Direction == "outbound"
			}
			return out[i].ID < out[j].ID
		}
		return out[i].OccurredAt.Before(out[j].OccurredAt)
	})

	if offset >= len(out) {
		return []models.ThreadMessage{}, nil
	}
	end := offset + limit
	if end > len(out) {
		end = len(out)
	}
	return out[offset:end], nil
}

// CreateOrphanInboundJob persists an inbound text message from a retailer
// that has no prior outbound on our side. We materialize it as a tiny
// bc_message_jobs row with status='received' so the chat thread exists.
//
//   - timestamp can be a unix-seconds string from Meta, or empty (we use now()).
//   - The job's billing_record_id and provider_msg_id are NULL — it never
//     went outbound, and isn't tied to a billing record.
//   - If a retailer with that phone already exists, retailer_id is linked.
//   - Otherwise we create a new bc_retailers row so the conversation has a
//     stable identity.
func (s *Store) CreateOrphanInboundJob(ctx context.Context, phone, body, timestamp string) (int64, error) {
	occurredAt := time.Now()
	if ts, err := strconv.ParseInt(timestamp, 10, 64); err == nil && ts > 0 {
		occurredAt = time.Unix(ts, 0)
	}

	// Resolve retailer: if the phone already exists, link to it; otherwise
// create a placeholder retailer. We use INSERT ... ON CONFLICT DO NOTHING
// (relying on the unique index on whatsapp_number) and then read back the
// id by phone. retailer_code has its own unique constraint, so we generate
// one with a UUID to avoid collisions across multiple orphan inserts.
	var retailerID int64
	_, err := s.DB.Exec(ctx, `
		INSERT INTO bc_retailers (retailer_code, whatsapp_number, retailer_name, is_opted_out)
		VALUES ('orphan-' || md5(random()::text), $1, '(unknown)', FALSE)
		ON CONFLICT (whatsapp_number) DO NOTHING
	`, phone)
	if err != nil {
		return 0, err
	}
	err = s.DB.QueryRow(ctx, `SELECT id FROM bc_retailers WHERE whatsapp_number=$1`, phone).Scan(&retailerID)
	if err != nil {
		return 0, err
	}

	// bc_message_jobs.batch_id and bc_billing_records.batch_id are FKs to
	// bc_upload_batches — ensure a synthetic "orphan-inbound" batch exists
	// so those FKs are satisfied. We pick a fixed, well-known id and use
	// ON CONFLICT DO NOTHING via the primary key.
	//
	// IMPORTANT: bc_upload_batches has NOT NULL columns file_name, file_path,
	// file_size_bytes, mime_type. All four must be supplied or the INSERT
	// fails silently (because of ON CONFLICT DO NOTHING), leaving no row for
	// the FK to reference.
	const orphanBatchID int64 = -1
	_, err = s.DB.Exec(ctx, `
		INSERT INTO bc_upload_batches
			(id, file_name, file_path, file_size_bytes, mime_type,
			 uploaded_by, total_rows, valid_rows, status, notes)
		VALUES ($1, 'orphan-inbound', '', 0, 'system/x-orphan',
			1, 0, 0, 'system', 'synthetic batch for inbound-only messages')
		ON CONFLICT (id) DO NOTHING
	`, orphanBatchID)
	if err != nil {
		return 0, err
	}
	batchID := orphanBatchID

	// bc_message_jobs.billing_record_id is NOT NULL — create a synthetic
	// bc_billing_records row so the foreign key is satisfied.
	var billingRecordID int64
	err = s.DB.QueryRow(ctx, `
		INSERT INTO bc_billing_records
			(batch_id, row_number, retailer_id, whatsapp_number, is_valid, validation_errors, raw_row)
		VALUES ($1, 0, $2, $3, TRUE, '[]'::jsonb, '{}'::jsonb)
		RETURNING id
	`, batchID, retailerID, phone).Scan(&billingRecordID)
	if err != nil {
		return 0, err
	}

	var jobID int64
	err = s.DB.QueryRow(ctx, `
		INSERT INTO bc_message_jobs
			(batch_id, billing_record_id, retailer_id, to_number,
			 template_name, language_code, status, attempts, max_attempts, queued_at)
		VALUES ($1, $2, $3, $4, '', '', 'received', 0, 1, $5)
		RETURNING id
	`, batchID, billingRecordID, retailerID, phone, occurredAt).Scan(&jobID)
	if err != nil {
		return 0, err
	}

	receivedStatus := "received"
	_ = s.InsertStatusEvent(ctx, jobID, nil, &receivedStatus, nil, &body, []byte(`{"source":"orphan-inbound"}`))

	return jobID, nil
}

// UpdateRetailerNameByPhone upgrades the placeholder retailer name (which
// CreateOrphanInboundJob sets to "(unknown)") to the contact's display name
// that Meta provides in the same webhook payload.
//
// Only acts if the existing name is "(unknown)" so we don't overwrite a
// name the admin has already set manually.
func (s *Store) UpdateRetailerNameByPhone(ctx context.Context, phone, name string) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_retailers
		SET retailer_name = $2
		WHERE whatsapp_number = $1 AND retailer_name = '(unknown)'
	`, phone, name)
	return err
}

// ---------- webhook log ----------

type WebhookLog struct {
	ID             int64           `json:"id"`
	ReceivedAt     time.Time       `json:"received_at"`
	SourceIP       *string         `json:"source_ip,omitempty"`
	UserAgent      *string         `json:"user_agent,omitempty"`
	EventKind      string          `json:"event_kind"`
	Payload        json.RawMessage `json:"payload"`
	ParsedMessages int             `json:"parsed_messages"`
	ParsedStatuses int             `json:"parsed_statuses"`
	ParseError     *string         `json:"parse_error,omitempty"`
}

// InsertWebhookLog records a single inbound webhook payload for audit / UI feed.
func (s *Store) InsertWebhookLog(ctx context.Context, ip, ua, kind string, payload []byte, msgCount, statusCount int, parseErr *string) (int64, error) {
	var id int64
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_webhook_logs
			(source_ip, user_agent, event_kind, payload, parsed_messages, parsed_statuses, parse_error)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING id
	`, ip, ua, kind, payload, msgCount, statusCount, parseErr).Scan(&id)
	return id, err
}

// ListWebhookLogs returns the most recent webhook log entries, newest first.
func (s *Store) ListWebhookLogs(ctx context.Context, limit int) ([]WebhookLog, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.DB.Query(ctx, `
		SELECT id, received_at, source_ip, user_agent, event_kind,
		       payload, parsed_messages, parsed_statuses, parse_error
		FROM bc_webhook_logs
		ORDER BY received_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WebhookLog{}
	for rows.Next() {
		var l WebhookLog
		if err := rows.Scan(&l.ID, &l.ReceivedAt, &l.SourceIP, &l.UserAgent, &l.EventKind,
			&l.Payload, &l.ParsedMessages, &l.ParsedStatuses, &l.ParseError); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, nil
}
