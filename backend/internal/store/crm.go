package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/whatsyitc/backend/internal/audit"
	"github.com/whatsyitc/backend/internal/models"
)

func strPtr(s string) *string { return &s }

func (s *Store) EnsureDefaultCRMPipeline(ctx context.Context, adminID int64) error {
	var exists bool
	if err := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM bc_crm_pipelines WHERE admin_user_id=$1)`, adminID).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	id, err := s.CreateCRMPipeline(ctx, adminID, "Sales pipeline", "sales", true)
	if err != nil {
		return err
	}
	return s.ReplaceCRMPipelineStages(ctx, adminID, id, defaultCRMStages("sales"))
}

func (s *Store) ListCRMPipelines(ctx context.Context, adminID int64) ([]models.CRMPipeline, error) {
	if err := s.EnsureDefaultCRMPipeline(ctx, adminID); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(ctx, `
		SELECT id, name, is_default, created_at
		FROM bc_crm_pipelines
		WHERE admin_user_id=$1
		ORDER BY is_default DESC, created_at ASC
	`, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.CRMPipeline{}
	for rows.Next() {
		var p models.CRMPipeline
		if err := rows.Scan(&p.ID, &p.Name, &p.IsDefault, &p.CreatedAt); err != nil {
			return nil, err
		}
		p.Stages, err = s.ListCRMPipelineStages(ctx, adminID, p.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) GetCRMPipeline(ctx context.Context, adminID, id int64) (*models.CRMPipeline, error) {
	var p models.CRMPipeline
	err := s.DB.QueryRow(ctx, `
		SELECT id, name, is_default, created_at
		FROM bc_crm_pipelines
		WHERE id=$1 AND admin_user_id=$2
	`, id, adminID).Scan(&p.ID, &p.Name, &p.IsDefault, &p.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.Stages, err = s.ListCRMPipelineStages(ctx, adminID, p.ID)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Store) CreateCRMPipeline(ctx context.Context, adminID int64, name, template string, isDefault bool) (int64, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Sales pipeline"
	}
	var id int64
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_crm_pipelines (admin_user_id, name, is_default)
		VALUES ($1, $2, $3)
		RETURNING id
	`, adminID, name, isDefault).Scan(&id)
	if err != nil {
		return 0, err
	}
	if !isDefault {
		if err := s.ReplaceCRMPipelineStages(ctx, adminID, id, defaultCRMStages(template)); err != nil {
			return 0, err
		}
	}
	return id, nil
}

func (s *Store) UpdateCRMPipeline(ctx context.Context, adminID, id int64, name string) (bool, error) {
	ct, err := s.DB.Exec(ctx, `UPDATE bc_crm_pipelines SET name=$3, updated_at=now() WHERE id=$1 AND admin_user_id=$2`, id, adminID, strings.TrimSpace(name))
	return ct.RowsAffected() > 0, err
}

func (s *Store) DeleteCRMPipeline(ctx context.Context, adminID, id int64) (bool, error) {
	ct, err := s.DB.Exec(ctx, `DELETE FROM bc_crm_pipelines WHERE id=$1 AND admin_user_id=$2 AND is_default=FALSE`, id, adminID)
	return ct.RowsAffected() > 0, err
}

func (s *Store) ListCRMPipelineStages(ctx context.Context, adminID, pipelineID int64) ([]models.CRMPipelineStage, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT st.id, st.name, st.color, st.position, st.automations,
		       COUNT(d.id)::int AS deal_count
		FROM bc_crm_pipeline_stages st
		LEFT JOIN bc_crm_deals d ON d.stage_id = st.id AND d.admin_user_id = $1
		WHERE st.admin_user_id=$1 AND st.pipeline_id=$2
		GROUP BY st.id
		ORDER BY st.position ASC, st.id ASC
	`, adminID, pipelineID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.CRMPipelineStage{}
	for rows.Next() {
		var st models.CRMPipelineStage
		var automations []byte
		if err := rows.Scan(&st.ID, &st.Name, &st.Color, &st.Position, &automations, &st.DealCount); err != nil {
			return nil, err
		}
		st.Automations = jsonObjectMap(automations)
		out = append(out, st)
	}
	return out, rows.Err()
}

func (s *Store) ReplaceCRMPipelineStages(ctx context.Context, adminID, pipelineID int64, stages []models.CRMPipelineStage) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM bc_crm_pipeline_stages WHERE admin_user_id=$1 AND pipeline_id=$2`, adminID, pipelineID); err != nil {
		return err
	}
	for i, st := range stages {
		pos := st.Position
		if pos <= 0 {
			pos = i + 1
		}
		color := strings.TrimSpace(st.Color)
		if color == "" {
			color = "#94a3b8"
		}
		name := strings.TrimSpace(st.Name)
		if name == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO bc_crm_pipeline_stages
				(admin_user_id, pipeline_id, name, color, position, automations)
			VALUES ($1,$2,$3,$4,$5,$6::jsonb)
		`, adminID, pipelineID, name, color, pos, jsonObjectString(st.Automations)); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) ListCRMLeads(ctx context.Context, adminID int64, status, search string, scoreMin, limit, offset int) ([]models.CRMLead, int, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	where := []string{"l.admin_user_id=$1"}
	args := []any{adminID}
	next := 2
	if status != "" {
		where = append(where, fmt.Sprintf("l.status=$%d", next))
		args = append(args, status)
		next++
	}
	if scoreMin > 0 {
		where = append(where, fmt.Sprintf("l.score >= $%d", next))
		args = append(args, scoreMin)
		next++
	}
	if strings.TrimSpace(search) != "" {
		where = append(where, fmt.Sprintf("(l.name ILIKE $%d OR l.phone ILIKE $%d OR l.email ILIKE $%d)", next, next, next))
		args = append(args, "%"+strings.TrimSpace(search)+"%")
		next++
	}
	whereSQL := strings.Join(where, " AND ")
	var total int
	if err := s.DB.QueryRow(ctx, "SELECT COUNT(*) FROM bc_crm_leads l WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	listArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.DB.Query(ctx, fmt.Sprintf(`
		SELECT l.id, l.name, l.phone, l.email, l.source, l.status, l.score,
		       l.interest, l.budget, l.timeline, l.location, l.notes,
		       l.owner_user_id, l.tags, l.conversation_id, l.created_at, l.updated_at,
		       (SELECT COUNT(*)::int FROM bc_crm_lead_facts f WHERE f.lead_id=l.id),
		       (SELECT COUNT(*)::int FROM bc_crm_deals d WHERE d.lead_id=l.id)
		FROM bc_crm_leads l
		WHERE %s
		ORDER BY l.updated_at DESC, l.id DESC
		LIMIT $%d OFFSET $%d
	`, whereSQL, next, next+1), listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items, err := scanCRMLeads(rows)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (s *Store) GetCRMLead(ctx context.Context, adminID, id int64, includeFacts bool) (*models.CRMLead, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT l.id, l.name, l.phone, l.email, l.source, l.status, l.score,
		       l.interest, l.budget, l.timeline, l.location, l.notes,
		       l.owner_user_id, l.tags, l.conversation_id, l.created_at, l.updated_at,
		       (SELECT COUNT(*)::int FROM bc_crm_lead_facts f WHERE f.lead_id=l.id),
		       (SELECT COUNT(*)::int FROM bc_crm_deals d WHERE d.lead_id=l.id)
		FROM bc_crm_leads l
		WHERE l.id=$1 AND l.admin_user_id=$2
	`, id, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanCRMLeads(rows)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	lead := &items[0]
	if includeFacts {
		lead.Facts, err = s.ListCRMLeadFacts(ctx, adminID, id)
		if err != nil {
			return nil, err
		}
	}
	return lead, nil
}

func (s *Store) CreateCRMLead(ctx context.Context, adminID int64, lead *models.CRMLead) (int64, error) {
	lead.Phone = strings.TrimSpace(lead.Phone)
	lead.Name = strings.TrimSpace(lead.Name)
	if lead.Source == "" {
		lead.Source = "manual"
	}
	if lead.Status == "" {
		lead.Status = "new"
	}
	if lead.Tags == nil {
		lead.Tags = []string{}
	}
	var id int64
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_crm_leads
			(admin_user_id, name, phone, email, source, status, score,
			 interest, budget, timeline, location, notes, owner_user_id, tags, conversation_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		ON CONFLICT (admin_user_id, phone) DO UPDATE SET
			name = COALESCE(NULLIF(EXCLUDED.name, ''), bc_crm_leads.name),
			email = COALESCE(NULLIF(EXCLUDED.email, ''), bc_crm_leads.email),
			updated_at = now()
		RETURNING id
	`, adminID, lead.Name, lead.Phone, lead.Email, lead.Source, lead.Status, lead.Score,
		lead.Interest, lead.Budget, lead.Timeline, lead.Location, lead.Notes,
		lead.OwnerUserID, lead.Tags, lead.ConversationID).Scan(&id)
	if err != nil {
		return 0, err
	}
	_, _ = s.AddCRMLeadActivity(ctx, adminID, id, "lead_created", "Lead created", adminID, nil)
	return id, nil
}

func (s *Store) SaveCRMLead(ctx context.Context, adminID int64, lead *models.CRMLead) (bool, error) {
	ct, err := s.DB.Exec(ctx, `
		UPDATE bc_crm_leads
		SET name=$3, phone=$4, email=$5, source=$6, status=$7, score=$8,
		    interest=$9, budget=$10, timeline=$11, location=$12, notes=$13,
		    owner_user_id=$14, tags=$15, conversation_id=$16, updated_at=now()
		WHERE id=$1 AND admin_user_id=$2
	`, lead.ID, adminID, lead.Name, lead.Phone, lead.Email, lead.Source, lead.Status, lead.Score,
		lead.Interest, lead.Budget, lead.Timeline, lead.Location, lead.Notes,
		lead.OwnerUserID, lead.Tags, lead.ConversationID)
	return ct.RowsAffected() > 0, err
}

func (s *Store) DeleteCRMLead(ctx context.Context, adminID, id int64) (bool, error) {
	ct, err := s.DB.Exec(ctx, `DELETE FROM bc_crm_leads WHERE id=$1 AND admin_user_id=$2`, id, adminID)
	return ct.RowsAffected() > 0, err
}

func (s *Store) ListCRMLeadFacts(ctx context.Context, adminID, leadID int64) ([]models.CRMLeadFact, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT fact_key, fact_value, source, confidence, updated_at
		FROM bc_crm_lead_facts
		WHERE admin_user_id=$1 AND lead_id=$2
		ORDER BY fact_key
	`, adminID, leadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.CRMLeadFact{}
	for rows.Next() {
		var f models.CRMLeadFact
		if err := rows.Scan(&f.FactKey, &f.FactValue, &f.Source, &f.Confidence, &f.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func scanCRMLeads(rows pgx.Rows) ([]models.CRMLead, error) {
	out := []models.CRMLead{}
	for rows.Next() {
		var l models.CRMLead
		if err := rows.Scan(&l.ID, &l.Name, &l.Phone, &l.Email, &l.Source, &l.Status, &l.Score,
			&l.Interest, &l.Budget, &l.Timeline, &l.Location, &l.Notes,
			&l.OwnerUserID, &l.Tags, &l.ConversationID, &l.CreatedAt, &l.UpdatedAt,
			&l.FactCount, &l.DealCount); err != nil {
			return nil, err
		}
		if l.Tags == nil {
			l.Tags = []string{}
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *Store) ListCRMLeadActivities(ctx context.Context, adminID, leadID int64, limit, offset int) ([]models.CRMLeadActivity, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.DB.Query(ctx, `
		SELECT id, type, content, user_id, metadata, created_at
		FROM bc_crm_lead_activities
		WHERE admin_user_id=$1 AND lead_id=$2
		ORDER BY created_at DESC, id DESC
		LIMIT $3 OFFSET $4
	`, adminID, leadID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.CRMLeadActivity{}
	for rows.Next() {
		var a models.CRMLeadActivity
		var metadata []byte
		if err := rows.Scan(&a.ID, &a.Type, &a.Content, &a.UserID, &metadata, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.Metadata = jsonObjectMap(metadata)
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) AddCRMLeadActivity(ctx context.Context, adminID, leadID int64, typ, content string, userID int64, metadata map[string]any) (int64, error) {
	var user any
	if userID > 0 {
		user = userID
	}
	var id int64
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_crm_lead_activities
			(admin_user_id, lead_id, type, content, user_id, metadata)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb)
		RETURNING id
	`, adminID, leadID, strings.TrimSpace(typ), strings.TrimSpace(content), user, jsonObjectString(metadata)).Scan(&id)
	return id, err
}

func (s *Store) ListCRMTasks(ctx context.Context, adminID, leadID int64) ([]models.CRMTask, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT id, title, description, due_at, status, assignee_id, created_at, completed_at
		FROM bc_crm_tasks
		WHERE admin_user_id=$1 AND lead_id=$2
		ORDER BY COALESCE(due_at, created_at) ASC
	`, adminID, leadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.CRMTask{}
	for rows.Next() {
		var t models.CRMTask
		if err := rows.Scan(&t.ID, &t.Title, &t.Description, &t.DueAt, &t.Status, &t.AssigneeID, &t.CreatedAt, &t.CompletedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) AddCRMTask(ctx context.Context, adminID, leadID int64, title, desc string, dueAt *time.Time) (int64, error) {
	var id int64
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_crm_tasks (admin_user_id, lead_id, title, description, due_at)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id
	`, adminID, leadID, strings.TrimSpace(title), strings.TrimSpace(desc), dueAt).Scan(&id)
	return id, err
}

func (s *Store) UpdateCRMTaskStatus(ctx context.Context, adminID, leadID, taskID int64, status string) (bool, error) {
	var completed any
	if status == "done" {
		completed = time.Now()
	}
	ct, err := s.DB.Exec(ctx, `
		UPDATE bc_crm_tasks
		SET status=$4, completed_at=$5
		WHERE id=$1 AND admin_user_id=$2 AND lead_id=$3
	`, taskID, adminID, leadID, status, completed)
	return ct.RowsAffected() > 0, err
}

func (s *Store) ListCRMDealsByLead(ctx context.Context, adminID, leadID int64) ([]models.CRMDeal, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT d.id, d.admin_user_id, d.lead_id, d.pipeline_id, d.stage_id, d.name,
		       d.value, d.currency, d.probability, d.expected_close_date, d.owner_user_id,
		       d.created_at, d.updated_at, p.name, st.name
		FROM bc_crm_deals d
		JOIN bc_crm_pipelines p ON p.id=d.pipeline_id
		JOIN bc_crm_pipeline_stages st ON st.id=d.stage_id
		WHERE d.admin_user_id=$1 AND d.lead_id=$2
		ORDER BY d.updated_at DESC
	`, adminID, leadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCRMDeals(rows)
}

func (s *Store) ListCRMDealsByPipeline(ctx context.Context, adminID, pipelineID int64) ([]models.CRMDealListItem, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT d.id, d.admin_user_id, d.lead_id, d.pipeline_id, d.stage_id, d.name,
		       d.value, d.currency, d.probability, d.expected_close_date, d.owner_user_id,
		       d.created_at, d.updated_at, p.name, st.name,
		       COALESCE(NULLIF(l.name, ''), l.phone), l.phone, l.score,
		       GREATEST(0, EXTRACT(EPOCH FROM (now() - d.updated_at)))::bigint
		FROM bc_crm_deals d
		JOIN bc_crm_leads l ON l.id=d.lead_id AND l.admin_user_id=d.admin_user_id
		JOIN bc_crm_pipelines p ON p.id=d.pipeline_id AND p.admin_user_id=d.admin_user_id
		JOIN bc_crm_pipeline_stages st ON st.id=d.stage_id AND st.pipeline_id=d.pipeline_id
		WHERE d.admin_user_id=$1 AND d.pipeline_id=$2
		ORDER BY st.position ASC, d.updated_at DESC
	`, adminID, pipelineID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []models.CRMDealListItem{}
	for rows.Next() {
		var item models.CRMDealListItem
		if err := rows.Scan(&item.ID, &item.BusinessID, &item.LeadID, &item.PipelineID, &item.StageID, &item.Name,
			&item.Value, &item.Currency, &item.Probability, &item.ExpectedCloseDate, &item.OwnerUserID,
			&item.CreatedAt, &item.UpdatedAt, &item.PipelineName, &item.StageName,
			&item.LeadName, &item.LeadPhone, &item.LeadScore, &item.AgeSeconds); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) CreateCRMDeal(ctx context.Context, adminID int64, d *models.CRMDeal) (int64, error) {
	var id int64
	if d.Currency == "" {
		d.Currency = "INR"
	}
	if d.Probability == 0 {
		d.Probability = 10
	}
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_crm_deals
			(admin_user_id, lead_id, pipeline_id, stage_id, name, value, currency,
			 probability, expected_close_date, owner_user_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING id
	`, adminID, d.LeadID, d.PipelineID, d.StageID, d.Name, d.Value, d.Currency,
		d.Probability, d.ExpectedCloseDate, d.OwnerUserID).Scan(&id)
	return id, err
}

func (s *Store) GetCRMDeal(ctx context.Context, adminID, id int64) (*models.CRMDeal, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT d.id, d.admin_user_id, d.lead_id, d.pipeline_id, d.stage_id, d.name,
		       d.value, d.currency, d.probability, d.expected_close_date, d.owner_user_id,
		       d.created_at, d.updated_at, p.name, st.name
		FROM bc_crm_deals d
		JOIN bc_crm_pipelines p ON p.id=d.pipeline_id
		JOIN bc_crm_pipeline_stages st ON st.id=d.stage_id
		WHERE d.admin_user_id=$1 AND d.id=$2
	`, adminID, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanCRMDeals(rows)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return &items[0], nil
}

func (s *Store) MoveCRMDealStage(ctx context.Context, adminID, dealID, stageID int64) (*models.CRMDeal, error) {
	// Phase 5: load the current stage + pipeline so we can write a
	// stage_change activity row, flip lead.status on Won/Lost, and fire
	// on_stage_entered automations. The pre-Phase-5 one-liner is
	// superseded by this richer path.
	var (
		leadID    int64
		fromStage int64
	)
	if err := s.DB.QueryRow(ctx, `
		SELECT lead_id, stage_id FROM bc_crm_deals WHERE id=$1 AND admin_user_id=$2
	`, dealID, adminID).Scan(&leadID, &fromStage); err != nil {
		return nil, err
	}

	// Verify destination stage belongs to this admin (defense in depth).
	var stageAdmin int64
	var stageName string
	if err := s.DB.QueryRow(ctx, `
		SELECT p.admin_user_id, s.name
		FROM bc_crm_pipeline_stages s
		JOIN bc_crm_pipelines p ON p.id = s.pipeline_id
		WHERE s.id = $1
	`, stageID).Scan(&stageAdmin, &stageName); err != nil {
		return nil, err
	}
	if stageAdmin != adminID {
		return nil, fmt.Errorf("stage not owned by admin")
	}

	// No-op if already in this stage.
	if fromStage == stageID {
		return s.GetCRMDeal(ctx, adminID, dealID)
	}

	// Update + write activity row.
	ct, err := s.DB.Exec(ctx,
		`UPDATE bc_crm_deals SET stage_id=$3, updated_at=now() WHERE id=$1 AND admin_user_id=$2`,
		dealID, adminID, stageID)
	if err != nil || ct.RowsAffected() == 0 {
		return nil, err
	}
	_, _ = s.AddCRMLeadActivity(ctx, adminID, leadID, "stage_change",
		fmt.Sprintf("Deal moved to %s", stageName), adminID,
		map[string]any{"deal_id": dealID, "from": fromStage, "to": stageID, "to_name": stageName},
	)

	// Flip lead.status to 'converted'/'lost' on Won/Lost destinations.
	switch strings.ToLower(strings.TrimSpace(stageName)) {
	case "won":
		_, _ = s.DB.Exec(ctx, `
			UPDATE bc_crm_leads SET status = 'converted', updated_at = now()
			WHERE id = $1 AND admin_user_id = $2
			  AND status NOT IN ('converted', 'lost')
		`, leadID, adminID)
		_, _ = s.AddCRMLeadActivity(ctx, adminID, leadID, "lead_status_change",
			"Lead marked as converted (deal won)", adminID,
			map[string]any{"status": "converted", "reason": "deal won"},
		)
	case "lost":
		_, _ = s.DB.Exec(ctx, `
			UPDATE bc_crm_leads SET status = 'lost', updated_at = now()
			WHERE id = $1 AND admin_user_id = $2
			  AND status NOT IN ('converted', 'lost')
		`, leadID, adminID)
		_, _ = s.AddCRMLeadActivity(ctx, adminID, leadID, "lead_status_change",
			"Lead marked as lost", adminID,
			map[string]any{"status": "lost", "reason": "deal lost"},
		)
	}

	// Phase 7: cascade-pause every active ai_followup enrollment
	// for this lead on terminal stages. Pausing (not cancelling)
	// keeps the row visible in the Sequences runs panel + the lead's
	// activity timeline so the admin can audit it later.
	switch strings.ToLower(strings.TrimSpace(stageName)) {
	case "won", "lost":
		_, _ = s.cascadePauseFollowups(ctx, adminID, leadID, stageName)
	}

	// Fire on_stage_entered automations (auto-enroll in sequences).
	var autoBytes []byte
	if err := s.DB.QueryRow(ctx,
		`SELECT automations FROM bc_crm_pipeline_stages WHERE id = $1`, stageID,
	).Scan(&autoBytes); err == nil && len(autoBytes) > 0 {
		fireStageAutomations(ctx, s, adminID, leadID, stageID, autoBytes)
	}

	return s.GetCRMDeal(ctx, adminID, dealID)
}

// fireStageAutomations parses a stage's automations JSONB and enrolls
// the lead in any referenced sequences. Idempotent: skips leads
// already actively enrolled in the same sequence.
//
// Schema (a stage's automations JSONB):
//
//	{
//	  "on_stage_entered": {
//	    "enroll_sequences": [{"sequence_id": 3}, {"sequence_id": 7}]
//	  }
//	}
//
// Each enrollment is created with status='active' and next_run_at =
// now() + step[0].delay_minutes. An activity row of type
// 'sequence_auto_enrolled' is written so the lead detail timeline
// reflects the auto-enrollment.
func fireStageAutomations(ctx context.Context, s *Store, adminID, leadID, stageID int64, automationsJSON []byte) {
	var auto struct {
		OnStageEntered struct {
			EnrollSequences []struct {
				SequenceID int64 `json:"sequence_id"`
			} `json:"enroll_sequences"`
		} `json:"on_stage_entered"`
	}
	if err := json.Unmarshal(automationsJSON, &auto); err != nil {
		log.Printf("[crm.deals] automations: bad json for stage %d: %v", stageID, err)
		return
	}
	if len(auto.OnStageEntered.EnrollSequences) == 0 {
		return
	}

	for _, ref := range auto.OnStageEntered.EnrollSequences {
		if ref.SequenceID == 0 {
			continue
		}
		// Verify the sequence belongs to this admin + is enabled.
		var seqEnabled bool
		err := s.DB.QueryRow(ctx, `
			SELECT enabled FROM bc_crm_sequences
			WHERE id = $1 AND admin_user_id = $2
		`, ref.SequenceID, adminID).Scan(&seqEnabled)
		if err != nil {
			if err != pgx.ErrNoRows {
				log.Printf("[crm.deals] automations: lookup seq %d: %v", ref.SequenceID, err)
			}
			continue
		}
		if !seqEnabled {
			continue
		}
		// Skip if the lead is already actively enrolled in this sequence.
		var existing int
		_ = s.DB.QueryRow(ctx, `
			SELECT COUNT(*) FROM bc_crm_sequence_enrollments
			WHERE sequence_id = $1 AND lead_id = $2 AND status = 'active'
		`, ref.SequenceID, leadID).Scan(&existing)
		if existing > 0 {
			continue
		}
		// Look up the first step's delay to seed next_run_at.
		var firstDelay int
		_ = s.DB.QueryRow(ctx, `
			SELECT COALESCE(delay_minutes, 0) FROM bc_crm_sequence_steps
			WHERE sequence_id = $1 ORDER BY position ASC LIMIT 1
		`, ref.SequenceID).Scan(&firstDelay)

		var enrollmentID int64
		err = s.DB.QueryRow(ctx, `
			INSERT INTO bc_crm_sequence_enrollments
				(admin_user_id, sequence_id, lead_id, current_step, status, next_run_at)
			VALUES ($1, $2, $3, 0, 'active',
			        now() + ($4 || ' minutes')::interval)
			RETURNING id
		`, adminID, ref.SequenceID, leadID, firstDelay).Scan(&enrollmentID)
		if err != nil {
			log.Printf("[crm.deals] automations: insert enrollment seq=%d lead=%d: %v",
				ref.SequenceID, leadID, err)
			continue
		}
		_, _ = s.AddCRMLeadActivity(ctx, adminID, leadID, "sequence_auto_enrolled",
			fmt.Sprintf("Auto-enrolled in sequence #%d (from stage #%d)", ref.SequenceID, stageID),
			adminID,
			map[string]any{
				"sequence_id":   ref.SequenceID,
				"enrollment_id": enrollmentID,
				"trigger":       "on_stage_entered",
				"stage_id":      stageID,
			},
		)
	}
}

func (s *Store) UpdateCRMDeal(ctx context.Context, adminID int64, d *models.CRMDeal) (bool, error) {
	ct, err := s.DB.Exec(ctx, `
		UPDATE bc_crm_deals
		SET name=$3, value=$4, currency=$5, probability=$6,
		    expected_close_date=$7, owner_user_id=$8, updated_at=now()
		WHERE id=$1 AND admin_user_id=$2
	`, d.ID, adminID, d.Name, d.Value, d.Currency, d.Probability, d.ExpectedCloseDate, d.OwnerUserID)
	return ct.RowsAffected() > 0, err
}

func (s *Store) DeleteCRMDeal(ctx context.Context, adminID, id int64) (bool, error) {
	ct, err := s.DB.Exec(ctx, `DELETE FROM bc_crm_deals WHERE id=$1 AND admin_user_id=$2`, id, adminID)
	return ct.RowsAffected() > 0, err
}

func scanCRMDeals(rows pgx.Rows) ([]models.CRMDeal, error) {
	out := []models.CRMDeal{}
	for rows.Next() {
		var d models.CRMDeal
		if err := rows.Scan(&d.ID, &d.BusinessID, &d.LeadID, &d.PipelineID, &d.StageID, &d.Name,
			&d.Value, &d.Currency, &d.Probability, &d.ExpectedCloseDate, &d.OwnerUserID,
			&d.CreatedAt, &d.UpdatedAt, &d.PipelineName, &d.StageName); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func defaultCRMStages(template string) []models.CRMPipelineStage {
	switch strings.ToLower(strings.TrimSpace(template)) {
	case "support":
		return []models.CRMPipelineStage{{Name: "New", Color: "#38bdf8", Position: 1}, {Name: "Contacted", Color: "#a78bfa", Position: 2}, {Name: "Qualified", Color: "#10b981", Position: 3}, {Name: "Won", Color: "#22c55e", Position: 4}, {Name: "Lost", Color: "#ef4444", Position: 5}}
	case "blank":
		return []models.CRMPipelineStage{}
	default:
		return []models.CRMPipelineStage{{Name: "New", Color: "#38bdf8", Position: 1}, {Name: "Contacted", Color: "#a78bfa", Position: 2}, {Name: "Qualified", Color: "#10b981", Position: 3}, {Name: "Won", Color: "#22c55e", Position: 4}, {Name: "Lost", Color: "#ef4444", Position: 5}}
	}
}

func (s *Store) ListCRMSequences(ctx context.Context, adminID int64) ([]models.CRMSequence, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT s.id, s.name, s.trigger_event, s.trigger_config, s.enabled, s.created_at,
		       (SELECT COUNT(*)::int FROM bc_crm_sequence_steps st WHERE st.sequence_id=s.id),
		       (SELECT COUNT(*)::int FROM bc_crm_sequence_enrollments e WHERE e.sequence_id=s.id)
		FROM bc_crm_sequences s
		WHERE s.admin_user_id=$1
		ORDER BY s.created_at DESC
	`, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.CRMSequence{}
	for rows.Next() {
		var seq models.CRMSequence
		var cfg []byte
		if err := rows.Scan(&seq.ID, &seq.Name, &seq.TriggerEvent, &cfg, &seq.Enabled, &seq.CreatedAt, &seq.StepCount, &seq.EnrollmentCount); err != nil {
			return nil, err
		}
		seq.TriggerConfig = jsonObjectMap(cfg)
		out = append(out, seq)
	}
	return out, rows.Err()
}

func (s *Store) CreateCRMSequence(ctx context.Context, adminID int64, seq *models.CRMSequence) (int64, error) {
	if strings.TrimSpace(seq.Name) == "" {
		return 0, fmt.Errorf("name is required")
	}
	if seq.TriggerEvent == "" {
		seq.TriggerEvent = "manual"
	}
	var id int64
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_crm_sequences (admin_user_id, name, trigger_event, trigger_config, enabled)
		VALUES ($1,$2,$3,$4::jsonb,$5)
		RETURNING id
	`, adminID, strings.TrimSpace(seq.Name), seq.TriggerEvent, jsonObjectString(seq.TriggerConfig), seq.Enabled).Scan(&id)
	return id, err
}

func (s *Store) GetCRMSequence(ctx context.Context, adminID, id int64) (*models.CRMSequence, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT s.id, s.name, s.trigger_event, s.trigger_config, s.enabled, s.created_at,
		       (SELECT COUNT(*)::int FROM bc_crm_sequence_steps st WHERE st.sequence_id=s.id),
		       (SELECT COUNT(*)::int FROM bc_crm_sequence_enrollments e WHERE e.sequence_id=s.id)
		FROM bc_crm_sequences s
		WHERE s.admin_user_id=$1 AND s.id=$2
	`, adminID, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []models.CRMSequence{}
	for rows.Next() {
		var seq models.CRMSequence
		var cfg []byte
		if err := rows.Scan(&seq.ID, &seq.Name, &seq.TriggerEvent, &cfg, &seq.Enabled, &seq.CreatedAt, &seq.StepCount, &seq.EnrollmentCount); err != nil {
			return nil, err
		}
		seq.TriggerConfig = jsonObjectMap(cfg)
		items = append(items, seq)
	}
	if len(items) == 0 {
		return nil, rows.Err()
	}
	return &items[0], rows.Err()
}

func (s *Store) SaveCRMSequence(ctx context.Context, adminID int64, seq *models.CRMSequence) (bool, error) {
	ct, err := s.DB.Exec(ctx, `
		UPDATE bc_crm_sequences
		SET name=$3, trigger_event=$4, trigger_config=$5::jsonb, enabled=$6, updated_at=now()
		WHERE id=$1 AND admin_user_id=$2
	`, seq.ID, adminID, seq.Name, seq.TriggerEvent, jsonObjectString(seq.TriggerConfig), seq.Enabled)
	return ct.RowsAffected() > 0, err
}

func (s *Store) DeleteCRMSequence(ctx context.Context, adminID, id int64) (bool, error) {
	ct, err := s.DB.Exec(ctx, `DELETE FROM bc_crm_sequences WHERE id=$1 AND admin_user_id=$2`, id, adminID)
	return ct.RowsAffected() > 0, err
}

func (s *Store) ListCRMSequenceSteps(ctx context.Context, adminID, sequenceID int64) ([]models.CRMSequenceStep, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT id, sequence_id, position, delay_minutes, message_template, condition
		FROM bc_crm_sequence_steps
		WHERE admin_user_id=$1 AND sequence_id=$2
		ORDER BY position ASC, id ASC
	`, adminID, sequenceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.CRMSequenceStep{}
	for rows.Next() {
		var st models.CRMSequenceStep
		var cond []byte
		if err := rows.Scan(&st.ID, &st.SequenceID, &st.Position, &st.DelayMinutes, &st.MessageTemplate, &cond); err != nil {
			return nil, err
		}
		st.Condition = jsonObjectMap(cond)
		out = append(out, st)
	}
	return out, rows.Err()
}

func (s *Store) ReplaceCRMSequenceSteps(ctx context.Context, adminID, sequenceID int64, steps []models.CRMSequenceStep) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM bc_crm_sequence_steps WHERE admin_user_id=$1 AND sequence_id=$2`, adminID, sequenceID); err != nil {
		return err
	}
	for i, st := range steps {
		pos := st.Position
		if pos <= 0 {
			pos = i + 1
		}
		if strings.TrimSpace(st.MessageTemplate) == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO bc_crm_sequence_steps
				(admin_user_id, sequence_id, position, delay_minutes, message_template, condition)
			VALUES ($1,$2,$3,$4,$5,$6::jsonb)
		`, adminID, sequenceID, pos, st.DelayMinutes, st.MessageTemplate, jsonObjectString(st.Condition)); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) EnrollCRMLeadInSequence(ctx context.Context, adminID, sequenceID, leadID int64) (int64, error) {
	// Phase 5: compute next_run_at from the first step's delay (or
	// now() if there are no steps / the first step has 0 delay). The
	// sequence worker reads (status='active' AND next_run_at <= now())
	// so this is what actually schedules the first send.
	var firstDelay int
	_ = s.DB.QueryRow(ctx, `
		SELECT COALESCE(delay_minutes, 0) FROM bc_crm_sequence_steps
		WHERE sequence_id = $1 ORDER BY position ASC LIMIT 1
	`, sequenceID).Scan(&firstDelay)

	var id int64
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_crm_sequence_enrollments
			(admin_user_id, sequence_id, lead_id, current_step, status, next_run_at)
		VALUES ($1, $2, $3, 0, 'active',
		        now() + ($4 || ' minutes')::interval)
		ON CONFLICT (sequence_id, lead_id) DO UPDATE
		  SET status = 'active',
		      current_step = 0,
		      next_run_at = EXCLUDED.next_run_at
		RETURNING id
	`, adminID, sequenceID, leadID, firstDelay).Scan(&id)
	return id, err
}

// CreateSmartFollowupSequence provisions a hidden bc_crm_sequences
// row + N bc_crm_sequence_steps rows for a per-lead smart follow-up.
//
// The sequence is tagged trigger_event='smart_followup' so the UI
// can hide it from the default sequences list (the user finds it
// under the "Smart follow-ups" tab instead).
//
// Steps carry the cadence / max / tone / goal / checkin / last_topic
// in their condition JSONB. The sequence worker reads condition when
// mode='ai_followup' so the orchestrator's GenerateFollowUp gets the
// right context per send.
//
// Returns (sequenceID, enrollmentID, error). The enrollment is
// created with mode='ai_followup' and next_run_at = now() so the
// worker picks it up on the next tick.
func (s *Store) CreateSmartFollowupSequence(
	ctx context.Context,
	adminID, leadID int64,
	leadName, leadPhone string,
	cadenceDays, maxMessages int,
	tone, goal string,
	checkinEnabled bool,
) (int64, int64, error) {
	if cadenceDays < 1 {
		cadenceDays = 1
	}
	if maxMessages < 1 {
		maxMessages = 1
	}
	if tone == "" {
		tone = "friendly"
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Sequence row. Name follows the convention "Follow-up: <lead>"
	// so admins can find it on the Smart follow-ups tab. We never
	// reuse a previous follow-up sequence for the same lead (the
	// handler decides whether to resume or restart an existing one).
	seqName := fmt.Sprintf("Follow-up: %s", strings.TrimSpace(leadName))
	if strings.TrimSpace(leadName) == "" {
		seqName = fmt.Sprintf("Follow-up: %s", leadPhone)
	}

	var seqID int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO bc_crm_sequences
			(admin_user_id, name, trigger_event, trigger_config, enabled)
		VALUES ($1, $2, 'smart_followup', '{}'::jsonb, TRUE)
		RETURNING id
	`, adminID, seqName).Scan(&seqID); err != nil {
		return 0, 0, err
	}

	// N steps. delay_minutes = cadenceDays * 24 * 60 * stepIndex.
	// Position is 1-indexed per the existing schema (the worker
	// translates via current_step + 1).
	cadenceMinutes := cadenceDays * 24 * 60
	condJSON, _ := json.Marshal(map[string]any{
		"goal":            goal,
		"tone":            tone,
		"max_messages":    maxMessages,
		"checkin_enabled": checkinEnabled,
		"last_topic":      "",
		"cadence_days":    cadenceDays,
	})
	for i := 1; i <= maxMessages; i++ {
		delayMin := cadenceMinutes * i
		if _, err := tx.Exec(ctx, `
			INSERT INTO bc_crm_sequence_steps
				(admin_user_id, sequence_id, position, delay_minutes, message_template, condition)
			VALUES ($1, $2, $3, $4, '', $5::jsonb)
		`, adminID, seqID, i, delayMin, string(condJSON)); err != nil {
			return 0, 0, err
		}
	}

	// Enrollment. mode='ai_followup' so the worker routes the body
	// through the orchestrator instead of rendering a template.
	// checkin_enabled on the enrollment row is what the webhook reads
	// after pause to decide whether to schedule the "still interested?"
	// follow-up message.
	var enrollID int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO bc_crm_sequence_enrollments
			(admin_user_id, sequence_id, lead_id, current_step, status,
			 next_run_at, mode, checkin_enabled)
		VALUES ($1, $2, $3, 0, 'active', now(), 'ai_followup', $4)
		RETURNING id
	`, adminID, seqID, leadID, checkinEnabled).Scan(&enrollID); err != nil {
		return 0, 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}

	audit.Log(ctx, s.DB, audit.Entry{
		Action:     "crm.sequence.created",
		EntityType: strPtr("crm_sequence"),
		EntityID:   &seqID,
		Metadata: map[string]any{
			"mode":            "ai_followup",
			"lead_id":         leadID,
			"cadence_days":    cadenceDays,
			"max_messages":    maxMessages,
			"checkin_enabled": checkinEnabled,
			"enrollment_id":   enrollID,
		},
	})
	_, _ = s.AddCRMLeadActivity(ctx, adminID, leadID, "sequence_auto_enrolled",
		fmt.Sprintf("Smart follow-up started: every %d days, up to %d messages", cadenceDays, maxMessages),
		adminID,
		map[string]any{
			"sequence_id":   seqID,
			"enrollment_id": enrollID,
			"trigger":       "manual",
			"mode":          "ai_followup",
		},
	)

	return seqID, enrollID, nil
}

// StartBatchAIFollowupSequence fans the existing
// CreateSmartFollowupSequence primitive out across every recipient
// in a batch that has AI follow-up enabled. The user calls this from
// /admin/ai/followups when they pick a behavior mode + cadence on
// the Enable AI modal.
//
// Per recipient we:
//  1. Find-or-create the bc_crm_leads row keyed by (admin_id, phone).
//  2. Call CreateSmartFollowupSequence with the admin's config —
//     this returns (sequenceID, enrollmentID).
//  3. Stamp the enrollment's mode based on the admin's choice:
//     - "default" → mode='ai_followup', no goal/tone stamped
//     - "custom"  → mode='ai_followup', goal/tone stamped on step
//     - "agentic" → mode='agentic_followup', no goal/tone
//
// We DON'T touch bc_batch_ai_recipients — the per-batch flag is
// flipped separately by the handler, and recipient status stays
// pending until the sequence worker picks up the first enrollment
// and sends the first follow-up (which then moves the recipient to
// 'active' via a side path we'll wire in a follow-up).
//
// Returns the list of new (sequenceID, enrollmentID) pairs in
// insertion order.
//
// excludePhones lists the WhatsApp numbers that the admin marked
// 'excluded' in the Enable-AI warning modal (or whose
// bc_batch_ai_recipients row is already ai_status='excluded' from
// a previous run). Recipients whose phone appears here are
// skipped — no lead upsert, no sequence, no enrollment. The
// caller is expected to have flipped their
// bc_batch_ai_recipients row to ai_status='excluded' BEFORE this
// function runs (see ExcludeRecipientsFromBatch) so the
// cross-batch inbox reflects the decision even if the row is
// skipped here.
//
// Recipients with r.AIStatus == "excluded" are also skipped
// defensively (covers the case where the handler forgot to pass
// the exclude list on a retry, or where legacy data already has
// the status set).
func (s *Store) StartBatchAIFollowupSequence(
	ctx context.Context,
	adminID, batchID int64,
	config models.BatchFollowupConfig,
	recipients []models.BatchAIRecipient,
	excludePhones []string,
	overridePhones []string,
) ([]int64, []int64, error) {
	// Defaults + clamping. The frontend also clamps, but we
	// re-clamp here so a malformed POST can't put the worker in a
	// bad state.
	cadenceDays := config.CadenceDays
	if cadenceDays < 1 {
		cadenceDays = 1
	}
	if cadenceDays > 30 {
		cadenceDays = 30
	}
	maxMessages := config.MaxMessages
	if maxMessages < 1 {
		maxMessages = 1
	}
	if maxMessages > 20 {
		maxMessages = 20
	}
	tone := strings.TrimSpace(config.Tone)
	if tone == "" {
		tone = "friendly"
	}
	behavior := strings.TrimSpace(config.Behavior)
	if behavior == "" {
		behavior = "default"
	}
	// Custom mode passes the admin's goal text through. Other
	// modes ignore it.
	goal := strings.TrimSpace(config.Goal)
	if behavior != "custom" {
		goal = ""
	}

	// Mode that goes onto bc_crm_sequence_enrollments.mode. The
	// CHECK constraint (added in migration 016) allows:
	//   'template' | 'ai_followup' | 'agentic_followup'
	// We never write 'template' from this path.
	enrollMode := "ai_followup"
	if behavior == "agentic" {
		enrollMode = "agentic_followup"
	}

	sequenceIDs := make([]int64, 0, len(recipients))
	enrollmentIDs := make([]int64, 0, len(recipients))

	// Build O(1) lookup for excluded phones. Trim + raw equality
	// (no normalization is done at insert into
	// bc_batch_ai_recipients).
	excluded := make(map[string]struct{}, len(excludePhones))
	for _, p := range excludePhones {
		excluded[strings.TrimSpace(p)] = struct{}{}
	}

	// Build O(1) lookup for takeover phones. The default conflict
	// behavior is skip-this-batch; phones in overridePhones first pause
	// older active follow-ups and then get a fresh current-batch enrollment.
	override := make(map[string]struct{}, len(overridePhones))
	for _, p := range overridePhones {
		trimmed := strings.TrimSpace(p)
		if trimmed == "" {
			continue
		}
		override[trimmed] = struct{}{}
	}

	for _, r := range recipients {
		// 0. Skip phones the admin excluded in the warning modal,
		//    and skip rows whose ai_status is already 'excluded'
		//    (defensive — handles legacy data + retry paths).
		if _, skip := excluded[r.WhatsappNumber]; skip {
			continue
		}
		if r.AIStatus == "excluded" {
			continue
		}
		// 0b. If this phone already has active AI follow-up, skip this
		//     batch by default. Explicit takeover pauses the older
		//     follow-up before creating the new current-batch one.
		if _, isOverride := override[r.WhatsappNumber]; isOverride {
			if err := s.PauseActiveFollowupConflictsForPhone(ctx, adminID, r.WhatsappNumber, batchID); err != nil {
				return sequenceIDs, enrollmentIDs, fmt.Errorf("override existing follow-up for %s: %w", r.WhatsappNumber, err)
			}
		} else {
			var hasActiveAI int
			err := s.DB.QueryRow(ctx, `
				SELECT count(*) FROM bc_crm_sequence_enrollments
				 WHERE lead_id = (
					   SELECT id FROM bc_crm_leads
					    WHERE admin_user_id = $1 AND phone = $2
				 )
				   AND status = 'active'
				   AND mode IN ('ai_followup', 'agentic_followup')
			`, adminID, r.WhatsappNumber).Scan(&hasActiveAI)
			if err != nil {
				return sequenceIDs, enrollmentIDs, fmt.Errorf("dup-check for %s: %w", r.WhatsappNumber, err)
			}
			if hasActiveAI > 0 {
				// Skip here. The existing enrollment keeps running on
				// whichever batch owns it.
				continue
			}
		}
		// 1. Find-or-create the lead by phone.
		leadName := ""
		if r.RetailerName != nil {
			leadName = *r.RetailerName
		}
		leadID, err := s.UpsertCRMLeadByPhone(ctx, adminID, leadName, r.WhatsappNumber)
		if err != nil {
			return sequenceIDs, enrollmentIDs, fmt.Errorf("upsert lead for %s: %w", r.WhatsappNumber, err)
		}
		// 2. Create the per-recipient follow-up sequence.
		seqID, enrollID, err := s.CreateSmartFollowupSequence(
			ctx, adminID, leadID, leadName, r.WhatsappNumber,
			cadenceDays, maxMessages, tone, goal, config.CheckinEnabled,
		)
		if err != nil {
			return sequenceIDs, enrollmentIDs, fmt.Errorf("create sequence for %s: %w", r.WhatsappNumber, err)
		}
		// 3. Stamp mode and source batch. The source link lets conflict
		// checks and the worker resolve the correct batch agent later.
		var sourceRecipientID *int64
		if r.ID > 0 {
			v := r.ID
			sourceRecipientID = &v
		}
		if _, err := s.DB.Exec(ctx, `
			UPDATE bc_crm_sequence_enrollments
			   SET mode = $1,
			       source_batch_id = $2,
			       source_batch_recipient_id = $3
			 WHERE id = $4
		`, enrollMode, batchID, sourceRecipientID, enrollID); err != nil {
			return sequenceIDs, enrollmentIDs, fmt.Errorf("stamp follow-up enrollment source: %w", err)
		}
		sequenceIDs = append(sequenceIDs, seqID)
		enrollmentIDs = append(enrollmentIDs, enrollID)
	}

	return sequenceIDs, enrollmentIDs, nil
}

// PauseActiveFollowupConflictsForPhone is the "take over" operation used by
// batch AI conflict resolution. It pauses older active AI follow-up
// enrollments for this phone before the caller creates a new enrollment on the
// current batch, so two agents do not send parallel scheduled messages.
func (s *Store) PauseActiveFollowupConflictsForPhone(ctx context.Context, adminID int64, phone string, currentBatchID int64) error {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return nil
	}

	rows, err := s.DB.Query(ctx, `
		UPDATE bc_crm_sequence_enrollments e
		   SET status = 'paused',
		       pause_reason = 'batch_agent_overridden',
		       paused_at = now(),
		       pause_detail = $4
		  FROM bc_crm_leads l
		 WHERE e.admin_user_id = $1
		   AND e.lead_id = l.id
		   AND l.admin_user_id = $1
		   AND l.phone = $2
		   AND e.status = 'active'
		   AND e.mode IN ('ai_followup', 'agentic_followup')
		   AND (e.source_batch_id IS NULL OR e.source_batch_id <> $3)
		RETURNING e.id, e.sequence_id, e.lead_id, e.source_batch_id
	`, adminID, phone, currentBatchID, fmt.Sprintf("paused because batch #%d took over this phone", currentBatchID))
	if err != nil {
		return err
	}
	defer rows.Close()

	type pausedEnrollment struct {
		id, seqID, leadID int64
		sourceBatchID     *int64
	}
	var paused []pausedEnrollment
	for rows.Next() {
		var p pausedEnrollment
		if err := rows.Scan(&p.id, &p.seqID, &p.leadID, &p.sourceBatchID); err != nil {
			return err
		}
		paused = append(paused, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(paused) == 0 {
		return nil
	}

	_, _ = s.DB.Exec(ctx, `
		UPDATE bc_batch_ai_recipients
		   SET ai_status = 'disabled',
		       last_event = $4,
		       last_event_at = now()
		 WHERE admin_user_id = $1
		   AND whatsapp_number = $2
		   AND batch_id <> $3
		   AND ai_status IN ('pending', 'active')
	`, adminID, phone, currentBatchID, fmt.Sprintf("AI follow-up moved to batch #%d", currentBatchID))

	for _, p := range paused {
		enrollID := p.id
		audit.Log(ctx, s.DB, audit.Entry{
			ActorID:    &adminID,
			Action:     "batch_ai_recipient.followup_overridden",
			EntityType: strPtr("crm_sequence_enrollment"),
			EntityID:   &enrollID,
			Metadata: map[string]any{
				"phone":             phone,
				"sequence_id":       p.seqID,
				"lead_id":           p.leadID,
				"source_batch_id":   p.sourceBatchID,
				"takeover_batch_id": currentBatchID,
			},
		})
		_, _ = s.AddCRMLeadActivity(ctx, adminID, p.leadID, "sequence_paused",
			fmt.Sprintf("Smart follow-up moved to batch #%d", currentBatchID),
			adminID,
			map[string]any{
				"reason":            "batch_agent_overridden",
				"sequence_id":       p.seqID,
				"enrollment_id":     p.id,
				"source_batch_id":   p.sourceBatchID,
				"takeover_batch_id": currentBatchID,
			},
		)
	}

	return nil
}

// UpsertCRMLeadByPhone is a small helper used by
// StartBatchAIFollowupSequence to find or create a CRM lead for a
// (admin, phone) pair. The lead's name is updated only if the
// existing row's name is empty — we never overwrite a name the
// admin has manually edited.
func (s *Store) UpsertCRMLeadByPhone(ctx context.Context, adminID int64, name, phone string) (int64, error) {
	var id int64
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_crm_leads
			(admin_user_id, name, phone, source, status)
		VALUES ($1, $2, $3, 'upload_batch', 'new')
		ON CONFLICT (admin_user_id, phone) DO UPDATE SET
			name = CASE
				WHEN bc_crm_leads.name IS NULL OR bc_crm_leads.name = ''
				THEN EXCLUDED.name
				ELSE bc_crm_leads.name
			END,
			updated_at = now()
		RETURNING id
	`, adminID, strings.TrimSpace(name), phone).Scan(&id)
	return id, err
}

// GetActiveFollowupEnrollment returns the active or paused smart
// follow-up enrollment for a lead (if any). Used by the dialog so
// the admin sees "Resume" / "Restart" / "Start" based on state.
//
// The returned struct lives in models.FollowupEnrollmentRow (with
// JSON tags) so the per-recipient workflow page can serialize it
// directly. Field names match the existing CRM struct fields.
func (s *Store) GetActiveFollowupEnrollment(ctx context.Context, adminID, leadID int64) (*models.FollowupEnrollmentRow, error) {
	row := s.DB.QueryRow(ctx, `
		SELECT e.id, e.sequence_id, e.status, e.current_step,
		       COALESCE(e.pause_reason, ''), e.checkin_enabled, e.next_run_at,
		       e.override_cadence_days, e.override_max_messages,
		       e.override_tone, e.override_goal,
		       COALESCE(e.pause_detail, ''), e.paused_at,
		       COALESCE(e.mode, ''),
		       COALESCE(e.next_message_body, ''),
		       COALESCE(e.next_message_prompt, ''),
		       COALESCE(e.next_message_source, ''),
		       e.next_message_context_message_id,
		       COALESCE(e.next_message_history_limit, 0),
		       e.next_message_generated_at,
		       e.next_message_updated_at
		FROM bc_crm_sequence_enrollments e
		JOIN bc_crm_sequences seq ON seq.id = e.sequence_id
		WHERE e.admin_user_id = $1
		  AND e.lead_id = $2
		  AND e.mode IN ('template', 'ai_followup', 'agentic_followup')
		  AND seq.trigger_event = 'smart_followup'
		  AND e.status IN ('active', 'paused')
		ORDER BY e.created_at DESC
		LIMIT 1
	`, adminID, leadID)
	out := &models.FollowupEnrollmentRow{}
	if err := row.Scan(&out.ID, &out.SequenceID, &out.Status, &out.CurrentStep,
		&out.PauseReason, &out.CheckinEnabled, &out.NextRunAt,
		&out.OverrideCadenceDays, &out.OverrideMaxMessages,
		&out.OverrideTone, &out.OverrideGoal,
		&out.PauseDetail, &out.PausedAt, &out.Mode,
		&out.NextMessageBody, &out.NextMessagePrompt, &out.NextMessageSource,
		&out.NextMessageContextMessageID, &out.NextMessageHistoryLimit,
		&out.NextMessageGeneratedAt, &out.NextMessageUpdatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	// Read cadence/max/tone from the first step's condition JSONB.
	var condRaw []byte
	_ = s.DB.QueryRow(ctx, `
		SELECT condition FROM bc_crm_sequence_steps
		WHERE sequence_id = $1 ORDER BY position ASC LIMIT 1
	`, out.SequenceID).Scan(&condRaw)
	if len(condRaw) > 0 {
		var cond map[string]any
		_ = json.Unmarshal(condRaw, &cond)
		if v, ok := cond["cadence_days"].(float64); ok {
			out.CadenceDays = int(v)
		}
		if v, ok := cond["max_messages"].(float64); ok {
			out.MaxMessages = int(v)
		}
		if v, ok := cond["tone"].(string); ok {
			out.Tone = v
		}
		if v, ok := cond["goal"].(string); ok {
			out.Goal = v
		}
	}
	if out.OverrideCadenceDays != nil {
		out.CadenceDays = *out.OverrideCadenceDays
	}
	if out.OverrideMaxMessages != nil {
		out.MaxMessages = *out.OverrideMaxMessages
	}
	if out.OverrideTone != nil && strings.TrimSpace(*out.OverrideTone) != "" {
		out.Tone = strings.TrimSpace(*out.OverrideTone)
	}
	if out.OverrideGoal != nil && strings.TrimSpace(*out.OverrideGoal) != "" {
		out.Goal = strings.TrimSpace(*out.OverrideGoal)
	}
	if strings.TrimSpace(out.NextMessageBody) != "" {
		var latest sql.NullInt64
		_ = s.DB.QueryRow(ctx, `
			SELECT MAX(m.id)
			FROM bc_ai_conversation_messages m
			JOIN bc_crm_leads l
			  ON l.admin_user_id = m.admin_user_id
			 AND m.conversation_key = 'phone:' || l.phone
			WHERE l.admin_user_id = $1 AND l.id = $2
		`, adminID, leadID).Scan(&latest)
		latestMessageID := int64PtrFromNull(latest)
		out.NextMessageStale = !sameOptionalInt64(out.NextMessageContextMessageID, latestMessageID)
	}
	return out, nil
}

func sameOptionalInt64(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// RestartFollowupEnrollment flips an existing ai_followup enrollment
// back to active. Used by the dialog's "Restart" path.
func (s *Store) RestartFollowupEnrollment(ctx context.Context, adminID, enrollmentID int64, cadenceDays int) error {
	if cadenceDays < 1 {
		cadenceDays = 1
	}
	cadenceMinutes := cadenceDays * 24 * 60
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_crm_sequence_enrollments
		SET status = 'active',
		    current_step = 0,
		    next_run_at = now() + ($3 || ' minutes')::interval,
		    pause_reason = NULL,
		    paused_at = NULL,
		    pause_detail = NULL
		WHERE id = $1 AND admin_user_id = $2
	`, enrollmentID, adminID, cadenceMinutes)
	return err
}

// PauseFollowupEnrollment flips the enrollment to paused. Used by
// the dialog's "Pause" path.
func (s *Store) PauseFollowupEnrollment(ctx context.Context, adminID, enrollmentID int64) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_crm_sequence_enrollments
		SET status = 'paused',
		    pause_reason = 'admin_paused',
		    paused_at = now(),
		    pause_detail = 'paused manually from follow-up dialog'
		WHERE id = $1 AND admin_user_id = $2
		  AND mode IN ('template', 'ai_followup', 'agentic_followup')
	`, enrollmentID, adminID)
	return err
}

// ResumeFollowupEnrollment flips a paused enrollment back to active and
// schedules the next run based on the step's cadence (overridden by the
// enrollment's override_cadence_days if set). Clears pause_reason / paused_at
// / pause_detail. Used by the per-recipient detail page's "Resume" button.
func (s *Store) ResumeFollowupEnrollment(ctx context.Context, adminID, enrollmentID int64) error {
	// Compute next_run_at using override_cadence_days when present, else
	// fall back to the sequence step's cadence_days.
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_crm_sequence_enrollments e
		SET status = 'active',
		    pause_reason = NULL,
		    paused_at = NULL,
		    pause_detail = NULL,
		    next_run_at = now() + (
		        CASE
		            WHEN e.override_cadence_days IS NOT NULL THEN
		                (e.override_cadence_days || ' days')::interval
		            ELSE
		                COALESCE(
		                    (
		                        SELECT ((step.condition->>'cadence_days')::int || ' days')::interval
		                        FROM bc_crm_sequence_steps step
		                        WHERE step.sequence_id = e.sequence_id
		                        ORDER BY step.position ASC LIMIT 1
		                    ),
		                    '1 day'::interval
		                )
		        END
		    )
		WHERE id = $1 AND admin_user_id = $2
		  AND mode IN ('template', 'ai_followup', 'agentic_followup')
	`, enrollmentID, adminID)
	return err
}

// UpdateEnrollmentOverrides merges per-enrollment override values. nil
// pointers mean "leave column unchanged". Cadence/max must be >= 1 if set.
// Returns the updated FollowupEnrollmentRow (with effective cadence/tone/etc
// after coalescing overrides over the step's condition JSONB).
func (s *Store) UpdateEnrollmentOverrides(
	ctx context.Context,
	adminID, enrollmentID int64,
	cadenceDays *int,
	maxMessages *int,
	tone *string,
	goal *string,
) (*models.FollowupEnrollmentRow, error) {
	// Coalesce pattern: COALESCE(NULLIF($n::text, ''), column) means
	// "if input is empty, keep the existing value". For nullable
	// columns we use a sentinel 'unset' string trick because pgx
	// can't distinguish nil from empty pointer on UPDATE params
	// without dynamic SQL.
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_crm_sequence_enrollments
		SET override_cadence_days = COALESCE($3, override_cadence_days),
		    override_max_messages = COALESCE($4, override_max_messages),
		    override_tone = COALESCE(NULLIF($5, ''), override_tone),
		    override_goal = COALESCE(NULLIF($6, ''), override_goal)
		WHERE id = $1 AND admin_user_id = $2
		  AND mode IN ('template', 'ai_followup', 'agentic_followup')
	`, enrollmentID, adminID, cadenceDays, maxMessages, tone, goal)
	if err != nil {
		return nil, err
	}
	// Re-fetch via the lead-id path. We need the lead_id first.
	var leadID int64
	if err := s.DB.QueryRow(ctx, `
		SELECT lead_id FROM bc_crm_sequence_enrollments WHERE id = $1
	`, enrollmentID).Scan(&leadID); err != nil {
		return nil, err
	}
	return s.GetActiveFollowupEnrollment(ctx, adminID, leadID)
}

// LatestConversationMessageID returns the raw latest message id for a phone.
// nil means the conversation has no persisted messages yet.
func (s *Store) LatestConversationMessageID(ctx context.Context, adminID int64, phone string) (*int64, error) {
	var id sql.NullInt64
	err := s.DB.QueryRow(ctx, `
		SELECT MAX(id)
		FROM bc_ai_conversation_messages
		WHERE admin_user_id = $1 AND conversation_key = $2
	`, adminID, "phone:"+strings.TrimSpace(phone)).Scan(&id)
	return int64PtrFromNull(id), err
}

func int64PtrFromNull(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	n := v.Int64
	return &n
}

// SaveEnrollmentNextMessage stores a one-time exact body for the next
// successful sequence step. The worker clears these columns when it advances.
func (s *Store) SaveEnrollmentNextMessage(
	ctx context.Context,
	adminID, enrollmentID int64,
	body, prompt, source string,
	contextMessageID *int64,
	historyLimit int,
	generatedAt *time.Time,
) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_crm_sequence_enrollments
		SET next_message_body = $3,
		    next_message_prompt = NULLIF($4, ''),
		    next_message_source = $5,
		    next_message_context_message_id = $6,
		    next_message_history_limit = $7,
		    next_message_generated_at = $8,
		    next_message_updated_at = now()
		WHERE id = $1 AND admin_user_id = $2
		  AND mode IN ('template', 'ai_followup', 'agentic_followup')
	`, enrollmentID, adminID, strings.TrimSpace(body), strings.TrimSpace(prompt),
		source, contextMessageID, historyLimit, generatedAt)
	return err
}

// ClearEnrollmentNextMessage returns the enrollment to live generation.
func (s *Store) ClearEnrollmentNextMessage(ctx context.Context, adminID, enrollmentID int64) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_crm_sequence_enrollments
		SET next_message_body = NULL,
		    next_message_prompt = NULL,
		    next_message_source = NULL,
		    next_message_context_message_id = NULL,
		    next_message_history_limit = NULL,
		    next_message_generated_at = NULL,
		    next_message_updated_at = NULL
		WHERE id = $1 AND admin_user_id = $2
	`, enrollmentID, adminID)
	return err
}

// SetEnrollmentMode updates the mode column. Validates the new value.
func (s *Store) SetEnrollmentMode(ctx context.Context, adminID, enrollmentID int64, mode string) (string, error) {
	var prev string
	err := s.DB.QueryRow(ctx, `
		WITH prev AS (
			SELECT mode
			FROM bc_crm_sequence_enrollments
			WHERE id = $1 AND admin_user_id = $2
		), upd AS (
			UPDATE bc_crm_sequence_enrollments
			SET mode = $3
			WHERE id = $1 AND admin_user_id = $2
			RETURNING id
		)
		SELECT COALESCE((SELECT mode FROM prev), '')
	`, enrollmentID, adminID, mode).Scan(&prev)
	if err != nil {
		return "", err
	}
	return prev, nil
}

// SendNextStepNow flips the enrollment back to active and stamps
// next_run_at = now() so the worker picks it up on the next tick.
// Also clears pause metadata. current_step is unchanged — the worker
// advances it after the send.
func (s *Store) SendNextStepNow(ctx context.Context, adminID, enrollmentID int64) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_crm_sequence_enrollments
		SET status = 'active',
		    pause_reason = NULL,
		    paused_at = NULL,
		    pause_detail = NULL,
		    next_run_at = now()
		WHERE id = $1 AND admin_user_id = $2
		  AND mode IN ('template', 'ai_followup', 'agentic_followup')
	`, enrollmentID, adminID)
	return err
}

// FindEnrollmentByBatchRecipient resolves the active ai_followup enrollment
// for a batch AI recipient by walking recipient -> phone -> lead -> enrollment.
// Returns nil if no enrollment exists.
func (s *Store) FindEnrollmentByBatchRecipient(ctx context.Context, adminID, recipientID int64) (*models.FollowupEnrollmentRow, error) {
	var phone string
	err := s.DB.QueryRow(ctx, `
		SELECT whatsapp_number FROM bc_batch_ai_recipients
		WHERE id = $1 AND admin_user_id = $2
	`, recipientID, adminID).Scan(&phone)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	var leadID int64
	err = s.DB.QueryRow(ctx, `
		SELECT id FROM bc_crm_leads
		WHERE admin_user_id = $1 AND phone = $2
		LIMIT 1
	`, adminID, phone).Scan(&leadID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return s.GetActiveFollowupEnrollment(ctx, adminID, leadID)
}

// RecipientAuditByEntity returns audit entries for a batch AI recipient.
// Used by the per-recipient History panel.
func (s *Store) RecipientAuditByEntity(ctx context.Context, adminID, recipientID int64, limit int) ([]models.AuditLog, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := s.DB.Query(ctx, `
		SELECT id, actor_id, actor_email, action, entity_type, entity_id,
		       metadata, ip_address, user_agent, created_at
		FROM bc_audit_logs
		WHERE (actor_id = $1 OR actor_id IS NULL)
		  AND entity_type = 'batch_ai_recipient'
		  AND entity_id = $2
		ORDER BY id DESC
		LIMIT $3
	`, adminID, recipientID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.AuditLog, 0)
	for rows.Next() {
		var a models.AuditLog
		if err := rows.Scan(&a.ID, &a.ActorID, &a.ActorEmail, &a.Action,
			&a.EntityType, &a.EntityID, &a.Metadata, &a.IPAddress,
			&a.UserAgent, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// CountFollowupsForExport is the row count behind the CSV export.
func (s *Store) CountFollowupsForExport(ctx context.Context, adminID int64, status, search string, batchID *int64) (int, error) {
	q := `SELECT COUNT(*) FROM bc_batch_ai_recipients WHERE admin_user_id = $1`
	args := []any{adminID}
	if status != "" && status != "all" {
		args = append(args, status)
		q += fmt.Sprintf(" AND ai_status = $%d", len(args))
	}
	if batchID != nil {
		args = append(args, *batchID)
		q += fmt.Sprintf(" AND batch_id = $%d", len(args))
	}
	if search != "" {
		args = append(args, "%"+search+"%")
		q += fmt.Sprintf(" AND (whatsapp_number ILIKE $%d OR retailer_name ILIKE $%d)", len(args), len(args))
	}
	var n int
	if err := s.DB.QueryRow(ctx, q, args...).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

// ExportFollowupsRows returns the rows for the CSV export. Each
// inner slice is one CSV record in the same column order as the
// header written by ExportFollowupsCSV in handlers/ai_batch.go.
func (s *Store) ExportFollowupsRows(ctx context.Context, adminID int64, status, search string, batchID *int64, limit int) ([][]string, error) {
	if limit <= 0 {
		limit = 5000
	}
	q := `SELECT id, batch_id, COALESCE(retailer_name, ''), whatsapp_number,
	             ai_status, COALESCE(last_event, ''),
	             COALESCE(to_char(last_event_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''),
	             COALESCE(to_char(last_message_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '')
	      FROM bc_batch_ai_recipients
	      WHERE admin_user_id = $1`
	args := []any{adminID}
	if status != "" && status != "all" {
		args = append(args, status)
		q += fmt.Sprintf(" AND ai_status = $%d", len(args))
	}
	if batchID != nil {
		args = append(args, *batchID)
		q += fmt.Sprintf(" AND batch_id = $%d", len(args))
	}
	if search != "" {
		args = append(args, "%"+search+"%")
		q += fmt.Sprintf(" AND (whatsapp_number ILIKE $%d OR retailer_name ILIKE $%d)", len(args), len(args))
	}
	args = append(args, limit)
	q += fmt.Sprintf(" ORDER BY id DESC LIMIT $%d", len(args))
	rows, err := s.DB.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([][]string, 0)
	for rows.Next() {
		var id, batchID int64
		var name, phone, aiStatus, lastEvent, lastEventAt, lastMessageAt string
		if err := rows.Scan(&id, &batchID, &name, &phone, &aiStatus, &lastEvent, &lastEventAt, &lastMessageAt); err != nil {
			return nil, err
		}
		out = append(out, []string{
			strconv.FormatInt(id, 10),
			strconv.FormatInt(batchID, 10),
			name,
			phone,
			aiStatus,
			lastEvent,
			lastEventAt,
			lastMessageAt,
		})
	}
	return out, rows.Err()
}

// cascadePauseFollowups is the Phase 7 helper called from
// MoveCRMDealStage on Won/Lost. Inline in the store layer because
// it's a one-call SQL + a couple of audit/activity rows; pulling
// out into worker.SequenceWorker would create a cycle.
func (s *Store) cascadePauseFollowups(ctx context.Context, adminID, leadID int64, stageName string) (int, error) {
	rows, err := s.DB.Query(ctx, `
		UPDATE bc_crm_sequence_enrollments
		SET status = 'paused',
		    pause_reason = 'terminal_stage',
		    paused_at = now(),
		    pause_detail = $3
		WHERE lead_id = $1 AND admin_user_id = $2
		  AND status = 'active' AND mode = 'ai_followup'
		RETURNING id, sequence_id
	`, leadID, adminID, "lead moved to "+stageName)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type paused struct{ id, seqID int64 }
	var out []paused
	for rows.Next() {
		var p paused
		if err := rows.Scan(&p.id, &p.seqID); err != nil {
			return len(out), err
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return len(out), err
	}
	for _, p := range out {
		audit.Log(ctx, s.DB, audit.Entry{
			Action:     "crm.sequence.paused",
			EntityType: strPtr("crm_sequence_enrollment"),
			EntityID:   &p.id,
			Metadata: map[string]any{
				"sequence_id": p.seqID, "lead_id": leadID,
				"reason": "terminal_stage", "stage": stageName,
			},
		})
	}
	if len(out) > 0 {
		_, _ = s.AddCRMLeadActivity(ctx, adminID, leadID, "sequence_paused",
			"Smart follow-up paused — lead is "+strings.ToLower(stageName),
			adminID,
			map[string]any{
				"reason":       "terminal_stage",
				"stage":        stageName,
				"paused_count": len(out),
			},
		)
	}
	return len(out), nil
}

func (s *Store) ListCRMSequenceEnrollments(ctx context.Context, adminID, sequenceID int64) ([]map[string]any, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT e.id, e.sequence_id, e.lead_id, e.status, e.created_at,
		       coalesce(l.name, ''), l.phone
		FROM bc_crm_sequence_enrollments e
		JOIN bc_crm_leads l ON l.id=e.lead_id
		WHERE e.admin_user_id=$1 AND e.sequence_id=$2
		ORDER BY e.created_at DESC
	`, adminID, sequenceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, seqID, leadID int64
		var status, name, phone string
		var created time.Time
		if err := rows.Scan(&id, &seqID, &leadID, &status, &created, &name, &phone); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "sequence_id": seqID, "lead_id": leadID, "status": status,
			"created_at": created, "lead_name": name, "lead_phone": phone,
		})
	}
	return out, rows.Err()
}

// ListCRMSequenceRuns returns the last 50 enrollments for a sequence
// with their lead row joined + the most recent 'needs_attention'
// activity (the failure reason when the enrollment is paused). Used
// by the sequence editor's "Runs" panel.
//
// Phase 5: enriches ListCRMSequenceEnrollments with current_step,
// next_run_at, completed_at, and the last_error column. The store
// returns a map shape so the wire DTO can evolve without breaking
// the handler.
func (s *Store) ListCRMSequenceRuns(ctx context.Context, adminID, sequenceID int64) ([]map[string]any, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT e.id, e.sequence_id, e.lead_id, e.status, e.current_step,
		       e.next_run_at, e.created_at, e.completed_at,
		       coalesce(l.name, ''), l.phone,
		       e.mode, e.pause_reason, e.paused_at, e.pause_detail, e.checkin_enabled,
		       (
		         SELECT a.content FROM bc_crm_lead_activities a
		         WHERE a.lead_id = e.lead_id AND a.type = 'needs_attention'
		         ORDER BY a.created_at DESC LIMIT 1
		       ) AS last_error
		FROM bc_crm_sequence_enrollments e
		JOIN bc_crm_leads l ON l.id = e.lead_id
		WHERE e.admin_user_id = $1 AND e.sequence_id = $2
		ORDER BY e.created_at DESC
		LIMIT 50
	`, adminID, sequenceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var (
			id, seqID, leadID, currentStep int64
			status, name, phone, mode      string
			pauseReason, pauseDetail       *string
			pausedAt                       *time.Time
			checkinEnabled                 bool
			nextRunAt, createdAt           time.Time
			completedAt                    *time.Time
			lastError                      *string
		)
		if err := rows.Scan(&id, &seqID, &leadID, &status, &currentStep,
			&nextRunAt, &createdAt, &completedAt,
			&name, &phone,
			&mode, &pauseReason, &pausedAt, &pauseDetail, &checkinEnabled,
			&lastError,
		); err != nil {
			return nil, err
		}
		row := map[string]any{
			"id": id, "sequence_id": seqID, "lead_id": leadID,
			"status": status, "current_step": currentStep,
			"next_run_at": nextRunAt, "created_at": createdAt,
			"lead_name": name, "lead_phone": phone,
			"mode": mode, "checkin_enabled": checkinEnabled,
		}
		if completedAt != nil {
			row["completed_at"] = *completedAt
		}
		if pauseReason != nil {
			row["pause_reason"] = *pauseReason
		}
		if pausedAt != nil {
			row["paused_at"] = *pausedAt
		}
		if pauseDetail != nil {
			row["pause_detail"] = *pauseDetail
		}
		if lastError != nil {
			row["last_error"] = *lastError
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *Store) ListCRMLeadConversations(ctx context.Context, adminID, leadID int64) ([]models.AIConversation, error) {
	lead, err := s.GetCRMLead(ctx, adminID, leadID, false)
	if err != nil || lead == nil {
		return nil, err
	}
	items, _, err := s.ListAIConversations(ctx, adminID, "", 500, 0)
	if err != nil {
		return nil, err
	}
	out := []models.AIConversation{}
	for _, c := range items {
		if c.LeadID != nil && *c.LeadID == leadID {
			out = append(out, c)
			continue
		}
		if onlyDigits(c.Phone) != "" && onlyDigits(c.Phone) == onlyDigits(lead.Phone) {
			out = append(out, c)
		}
	}
	return out, nil
}
