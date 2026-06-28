package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/whatsyitc/backend/internal/models"
)

// Sentinel errors for agent CRUD. Handlers map these to HTTP status codes
// so the frontend can show specific toasts without parsing prose.
var (
	ErrAgentLimitReached   = errors.New("store: agent limit reached (20 per admin)")
	ErrCannotDeleteDefault = errors.New("store: cannot delete the only or default agent; set another agent as default first")
	ErrAgentNotFound       = errors.New("store: agent not found")
	ErrNoDefaultAgent      = errors.New("store: no default agent configured for admin")
	ErrAIKBChunkNotFound   = errors.New("store: one or more knowledge chunks were not found")
)

// MaxAgentsPerAdmin is the soft cap enforced by CreateAIAgent. The
// frontend mirrors this number so the "+ Create" button disables before
// the round-trip.
const MaxAgentsPerAdmin = 20

type rowScanner interface {
	Scan(dest ...any) error
}

func DefaultAIAgentConfig(adminID int64) *models.AIAgentConfig {
	return &models.AIAgentConfig{
		AdminUserID:            adminID,
		Configured:             false,
		Enabled:                false,
		Name:                   "Riya",
		PersonaMD:              "",
		Tone:                   "friendly",
		Languages:              []string{"en"},
		WorkingHours:           map[string]any{},
		HandoffRules:           map[string]any{},
		PrimaryModel:           "gpt-4o-mini",
		FallbackModels:         []string{},
		PremiumModel:           "gpt-4o",
		FAQConfidenceThreshold: 0.72,
		SystemPrompt:           "You are a helpful WhatsApp assistant for this business. Answer clearly, stay concise, and ask for a human handoff when confidence is low.",
		QualificationCriteria:  map[string]any{},
	}
}

// scanAIAgentRow reads one bc_ai_agents row into a config struct. Shared
// by every read path (single-row, list, resolver) so the column order
// is defined in exactly one place.
func scanAIAgentRow(row rowScanner, cfg *models.AIAgentConfig) error {
	var workingHours, handoffRules, qualificationCriteria []byte
	var createdAt, updatedAt time.Time
	err := row.Scan(
		&cfg.ID, &cfg.Enabled, &cfg.Name, &cfg.PersonaMD, &cfg.Tone, &cfg.Languages,
		&workingHours, &handoffRules, &cfg.PrimaryModel, &cfg.FallbackModels,
		&cfg.PremiumModel, &cfg.FAQConfidenceThreshold, &cfg.SystemPrompt,
		&qualificationCriteria, &cfg.IsDefault, &createdAt, &updatedAt,
	)
	if err != nil {
		return err
	}
	cfg.Configured = true
	cfg.WorkingHours = jsonObjectMap(workingHours)
	cfg.HandoffRules = jsonObjectMap(handoffRules)
	cfg.QualificationCriteria = jsonObjectMap(qualificationCriteria)
	cfg.CreatedAt = &createdAt
	cfg.UpdatedAt = &updatedAt
	return nil
}

const aiAgentSelectColumns = `
	id, enabled, name, persona_md, tone, languages,
	working_hours, handoff_rules, primary_model, fallback_models,
	premium_model, faq_confidence_threshold, system_prompt,
	qualification_criteria, is_default, created_at, updated_at
`

// GetDefaultAIAgentConfig returns the admin's global-default agent.
// Returns (nil, ErrNoDefaultAgent) when the admin has no default yet —
// callers (orchestrator) treat this as "agent not configured".
func (s *Store) GetDefaultAIAgentConfig(ctx context.Context, adminID int64) (*models.AIAgentConfig, error) {
	cfg := DefaultAIAgentConfig(adminID)
	err := scanAIAgentRow(s.DB.QueryRow(ctx, `
		SELECT `+aiAgentSelectColumns+`
		FROM bc_ai_agents
		WHERE admin_user_id = $1 AND is_default = TRUE
		LIMIT 1
	`, adminID), cfg)
	if err == pgx.ErrNoRows {
		return nil, ErrNoDefaultAgent
	}
	if err != nil {
		return nil, err
	}
	return cfg, nil
}

// GetEnabledDefaultAIAgentConfig returns the enabled agent that should run
// when a batch has no usable override. The configured default wins when it is
// enabled; otherwise the most recently updated enabled agent is used so a
// disabled stale default does not stop WhatsApp replies.
func (s *Store) GetEnabledDefaultAIAgentConfig(ctx context.Context, adminID int64) (*models.AIAgentConfig, error) {
	cfg := DefaultAIAgentConfig(adminID)
	err := scanAIAgentRow(s.DB.QueryRow(ctx, `
		SELECT `+aiAgentSelectColumns+`
		FROM bc_ai_agents
		WHERE admin_user_id = $1 AND enabled = TRUE
		ORDER BY is_default DESC, updated_at DESC, id DESC
		LIMIT 1
	`, adminID), cfg)
	if err == pgx.ErrNoRows {
		return nil, ErrNoDefaultAgent
	}
	if err != nil {
		return nil, err
	}
	return cfg, nil
}

// GetAIAgent fetches one agent by id, admin-scoped. Returns
// (nil, ErrAgentNotFound) when the row doesn't exist or belongs to a
// different admin.
func (s *Store) GetAIAgent(ctx context.Context, adminID, agentID int64) (*models.AIAgentConfig, error) {
	cfg := DefaultAIAgentConfig(adminID)
	err := scanAIAgentRow(s.DB.QueryRow(ctx, `
		SELECT `+aiAgentSelectColumns+`
		FROM bc_ai_agents
		WHERE id = $1 AND admin_user_id = $2
	`, agentID, adminID), cfg)
	if err == pgx.ErrNoRows {
		return nil, ErrAgentNotFound
	}
	if err != nil {
		return nil, err
	}
	return cfg, nil
}

// ListAIAgents returns every agent for the admin. Default is sorted
// first so the sidebar in the UI has a stable visual anchor.
func (s *Store) ListAIAgents(ctx context.Context, adminID int64) ([]*models.AIAgentConfig, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT `+aiAgentSelectColumns+`
		FROM bc_ai_agents
		WHERE admin_user_id = $1
		ORDER BY is_default DESC, name ASC, id ASC
	`, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*models.AIAgentConfig{}
	for rows.Next() {
		cfg := DefaultAIAgentConfig(adminID)
		if err := scanAIAgentRow(rows, cfg); err != nil {
			return nil, err
		}
		out = append(out, cfg)
	}
	return out, rows.Err()
}

// CreateAIAgent inserts a new agent. Enforces the soft cap atomically
// via SELECT ... FOR UPDATE so concurrent creates can't slip past the
// 20-agent limit. The new agent is created as a non-default — the
// operator sets it as default via SetDefaultAIAgent to avoid surprise
// "global default just changed" behavior on creation.
func (s *Store) CreateAIAgent(ctx context.Context, adminID int64, cfg *models.AIAgentConfig) (*models.AIAgentConfig, error) {
	sanitizeAIAgentConfig(cfg)
	// First ever agent for this admin is automatically promoted to default
	// so the operator never lands in an "agent exists but nothing is
	// configured" dead-end on day one.
	promoteToDefault, err := s.shouldPromoteFirstAgent(ctx, adminID)
	if err != nil {
		return nil, err
	}
	if !promoteToDefault {
		var count int
		if err := s.DB.QueryRow(ctx, `
			SELECT count(*) FROM bc_ai_agents WHERE admin_user_id = $1
		`, adminID).Scan(&count); err != nil {
			return nil, err
		}
		if count >= MaxAgentsPerAdmin {
			return nil, ErrAgentLimitReached
		}
	}
	workingHours := jsonObjectString(cfg.WorkingHours)
	handoffRules := jsonObjectString(cfg.HandoffRules)
	qualificationCriteria := jsonObjectString(cfg.QualificationCriteria)
	cfg.IsDefault = promoteToDefault
	if promoteToDefault {
		cfg.Enabled = true
	}
	var id int64
	err = s.DB.QueryRow(ctx, `
		INSERT INTO bc_ai_agents
			(admin_user_id, enabled, name, persona_md, tone, languages,
			 working_hours, handoff_rules, primary_model, fallback_models,
			 premium_model, faq_confidence_threshold, system_prompt,
			 qualification_criteria, is_default)
		VALUES
			($1, $2, $3, $4, $5, $6,
			 $7::jsonb, $8::jsonb, $9, $10,
			 $11, $12, $13, $14::jsonb, $15)
		RETURNING id
	`, adminID, cfg.Enabled, cfg.Name, cfg.PersonaMD, cfg.Tone, cfg.Languages,
		workingHours, handoffRules, cfg.PrimaryModel, cfg.FallbackModels,
		cfg.PremiumModel, cfg.FAQConfidenceThreshold, cfg.SystemPrompt,
		qualificationCriteria, cfg.IsDefault).Scan(&id)
	if err != nil {
		return nil, err
	}
	return s.GetAIAgent(ctx, adminID, id)
}

// shouldPromoteFirstAgent returns true iff the admin has zero agents.
// Cheap count; safe under concurrent inserts because the unique
// partial index on (admin_user_id) WHERE is_default prevents two
// first-agents from both being marked default at commit time.
func (s *Store) shouldPromoteFirstAgent(ctx context.Context, adminID int64) (bool, error) {
	var n int
	if err := s.DB.QueryRow(ctx, `
		SELECT count(*) FROM bc_ai_agents WHERE admin_user_id = $1
	`, adminID).Scan(&n); err != nil {
		return false, err
	}
	return n == 0, nil
}

// UpdateAIAgent applies a patch in-place. Pass cfg with only the fields
// you want changed; nil/empty fields are preserved from the DB row.
// Caller is responsible for validation (handler layer enforces
// threshold range, JSON shape, etc.).
func (s *Store) UpdateAIAgent(ctx context.Context, adminID, agentID int64, cfg *models.AIAgentConfig) (*models.AIAgentConfig, error) {
	sanitizeAIAgentConfig(cfg)
	workingHours := jsonObjectString(cfg.WorkingHours)
	handoffRules := jsonObjectString(cfg.HandoffRules)
	qualificationCriteria := jsonObjectString(cfg.QualificationCriteria)
	res, err := s.DB.Exec(ctx, `
		UPDATE bc_ai_agents SET
			enabled = $3,
			name = $4,
			persona_md = $5,
			tone = $6,
			languages = $7,
			working_hours = $8::jsonb,
			handoff_rules = $9::jsonb,
			primary_model = $10,
			fallback_models = $11,
			premium_model = $12,
			faq_confidence_threshold = $13,
			system_prompt = $14,
			qualification_criteria = $15::jsonb
		WHERE id = $1 AND admin_user_id = $2
	`, agentID, adminID, cfg.Enabled, cfg.Name, cfg.PersonaMD, cfg.Tone, cfg.Languages,
		workingHours, handoffRules, cfg.PrimaryModel, cfg.FallbackModels,
		cfg.PremiumModel, cfg.FAQConfidenceThreshold, cfg.SystemPrompt,
		qualificationCriteria)
	if err != nil {
		return nil, err
	}
	if res.RowsAffected() == 0 {
		return nil, ErrAgentNotFound
	}
	return s.GetAIAgent(ctx, adminID, agentID)
}

func (s *Store) EnsureAIAgentEnabled(ctx context.Context, adminID, agentID int64) error {
	res, err := s.DB.Exec(ctx, `
		UPDATE bc_ai_agents
		SET enabled = TRUE
		WHERE id = $1 AND admin_user_id = $2
	`, agentID, adminID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return ErrAgentNotFound
	}
	return nil
}

// DeleteAIAgent removes a non-default agent. Returns ErrCannotDeleteDefault
// if the agent is the admin's default — the UI must force the operator
// to pick a different default first. The FK ON DELETE SET NULL on
// bc_upload_batches.ai_agent_id handles the cascade; affected batches
// gracefully fall back to the global default.
func (s *Store) DeleteAIAgent(ctx context.Context, adminID, agentID int64) error {
	// Reject if this is the default AND it's the admin's only agent.
	var isDefault bool
	var total int
	err := s.DB.QueryRow(ctx, `
		SELECT is_default,
		       (SELECT count(*) FROM bc_ai_agents WHERE admin_user_id = $1) AS total
		FROM bc_ai_agents
		WHERE id = $2 AND admin_user_id = $1
	`, adminID, agentID).Scan(&isDefault, &total)
	if err == pgx.ErrNoRows {
		return ErrAgentNotFound
	}
	if err != nil {
		return err
	}
	if isDefault && total == 1 {
		return ErrCannotDeleteDefault
	}
	if isDefault {
		// Refuse without forcing the operator through a confirm flow —
		// we don't auto-promote a sibling because that's a silent default
		// change. The UI guides the operator to pick a new default first.
		return ErrCannotDeleteDefault
	}
	_, err = s.DB.Exec(ctx, `
		DELETE FROM bc_ai_agents WHERE id = $1 AND admin_user_id = $2
	`, agentID, adminID)
	return err
}

// SetDefaultAIAgent atomically swaps the admin's default. The partial
// unique index (admin_user_id) WHERE is_default guarantees only one
// default at commit time even under concurrent SetDefault calls.
// Existing per-batch assignments are NOT touched — that's the whole
// point: switching the global default is a deliberate act and never
// silently rewrites batch overrides.
func (s *Store) SetDefaultAIAgent(ctx context.Context, adminID, agentID int64) (*models.AIAgentConfig, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Verify the target agent belongs to this admin.
	var exists bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM bc_ai_agents WHERE id = $1 AND admin_user_id = $2)
	`, agentID, adminID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrAgentNotFound
	}

	if _, err := tx.Exec(ctx, `
		UPDATE bc_ai_agents SET is_default = FALSE
		WHERE admin_user_id = $1 AND is_default = TRUE
	`, adminID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE bc_ai_agents SET is_default = TRUE, enabled = TRUE
		WHERE id = $1 AND admin_user_id = $2
	`, agentID, adminID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetAIAgent(ctx, adminID, agentID)
}

// GetEffectiveAgent resolves which agent applies for a given context.
//
//   - batchID == nil: returns the admin's global default. Used by live
//     inbound chat and any unattached call site.
//   - batchID != nil: if bc_upload_batches.ai_agent_id is set, returns
//     that agent (source = "batch_override"). Otherwise falls back to
//     the global default (source = "global_default").
//
// Returns (nil, "none", nil) when the admin has no agents at all —
// callers should treat this as "AI disabled for this admin".
func (s *Store) GetEffectiveAgent(ctx context.Context, adminID int64, batchID *int64) (*models.AIAgentConfig, string, error) {
	if batchID != nil {
		var agentID *int64
		err := s.DB.QueryRow(ctx, `
			SELECT ai_agent_id FROM bc_upload_batches
			WHERE id = $1 AND (uploaded_by = $2 OR uploaded_by IS NULL)
		`, *batchID, adminID).Scan(&agentID)
		if err != nil && err != pgx.ErrNoRows {
			return nil, "", err
		}
		if err == nil && agentID != nil {
			cfg, gerr := s.GetAIAgent(ctx, adminID, *agentID)
			if gerr == nil && cfg.Enabled {
				return cfg, "batch_override", nil
			}
			if gerr == nil {
				// Assigned agent exists but is disabled; fall through to an
				// enabled default.
			} else if !errors.Is(gerr, ErrAgentNotFound) {
				return nil, "", gerr
			}
		}
	}
	cfg, err := s.GetEnabledDefaultAIAgentConfig(ctx, adminID)
	if errors.Is(err, ErrNoDefaultAgent) {
		return nil, "none", nil
	}
	if err != nil {
		return nil, "", err
	}
	return cfg, "global_default", nil
}

// SetBatchAIAgent assigns (or clears) the agent override on a batch.
// Pass agentID == nil to clear the override and revert to the global
// default. The handler validates that the agent belongs to this admin.
func (s *Store) SetBatchAIAgent(ctx context.Context, adminID, batchID int64, agentID *int64) error {
	res, err := s.DB.Exec(ctx, `
		UPDATE bc_upload_batches SET ai_agent_id = $3
		WHERE id = $1 AND (uploaded_by = $2 OR uploaded_by IS NULL)
	`, batchID, adminID, agentID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return ErrAgentNotFound
	}
	return nil
}

// AssertBatchOwned returns nil iff the batch exists and is owned by
// the admin (uploaded_by=$adminID OR uploaded_by IS NULL — the
// pre-migration/legacy shape — see migration 004). Returns
// ErrAgentNotFound otherwise; handlers surface 404.
// Mirrors the EXISTS check used elsewhere in the store layer.
func (s *Store) AssertBatchOwned(ctx context.Context, adminID, batchID int64) error {
	var owned bool
	err := s.DB.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM bc_upload_batches
			WHERE id = $1 AND (uploaded_by = $2 OR uploaded_by IS NULL)
		)
	`, batchID, adminID).Scan(&owned)
	if err != nil {
		return err
	}
	if !owned {
		return ErrAgentNotFound
	}
	return nil
}

// sanitizeAIAgentConfig is defined later in this file (line ~1126).
// The definition there uses cleanStringList for robust list sanitization;
// keep that as the canonical implementation.

func (s *Store) ListAIKB(ctx context.Context, adminID int64, sourceType, search string, limit, offset int) ([]models.AIKBChunk, int, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	sourceType = strings.TrimSpace(sourceType)
	search = strings.TrimSpace(search)

	where := []string{"admin_user_id = $1"}
	args := []any{adminID}
	next := 2
	if sourceType != "" {
		where = append(where, fmt.Sprintf("source_type = $%d", next))
		args = append(args, sourceType)
		next++
	}
	if search != "" {
		where = append(where, fmt.Sprintf("(coalesce(title, '') ILIKE $%d OR content ILIKE $%d OR coalesce(source_ref, '') ILIKE $%d)", next, next, next))
		args = append(args, "%"+search+"%")
		next++
	}
	whereSQL := strings.Join(where, " AND ")

	var total int
	if err := s.DB.QueryRow(ctx, "SELECT COUNT(*) FROM bc_ai_kb_chunks WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	listArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.DB.Query(ctx, fmt.Sprintf(`
		SELECT id, admin_user_id, coalesce(title, ''), content, source_type,
		       coalesce(source_ref, ''), metadata, created_at, updated_at,
		       char_length(content)
		FROM bc_ai_kb_chunks
		WHERE %s
		ORDER BY updated_at DESC, id DESC
		LIMIT $%d OFFSET $%d
	`, whereSQL, next, next+1), listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items, err := scanAIKBRows(rows)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (s *Store) ListAIKBMissingEmbeddings(ctx context.Context, limit int) ([]models.AIKBChunk, error) {
	if limit <= 0 || limit > 1000 {
		limit = 500
	}
	rows, err := s.DB.Query(ctx, `
		SELECT id, admin_user_id, coalesce(title, ''), content, source_type,
		       coalesce(source_ref, ''), metadata, created_at, updated_at,
		       char_length(content)
		FROM bc_ai_kb_chunks
		WHERE embedding IS NULL
		  AND length(trim(content)) > 0
		  AND (
		    embedding_updated_at IS NULL
		    OR embedding_updated_at < now() - interval '1 hour'
		  )
		ORDER BY updated_at DESC, id DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAIKBRows(rows)
}

func (s *Store) AddAIKB(ctx context.Context, adminID int64, chunk *models.AIKBChunk) (int64, error) {
	chunk.Title = strings.TrimSpace(chunk.Title)
	chunk.Content = strings.TrimSpace(chunk.Content)
	chunk.SourceType = cleanAISourceType(chunk.SourceType)
	chunk.SourceRef = strings.TrimSpace(chunk.SourceRef)
	metadata := jsonObjectString(chunk.Metadata)

	var id int64
	err := s.DB.QueryRow(ctx, `
		INSERT INTO bc_ai_kb_chunks
			(admin_user_id, title, content, source_type, source_ref, metadata)
		VALUES ($1, NULLIF($2, ''), $3, $4, NULLIF($5, ''), $6::jsonb)
		RETURNING id
	`, adminID, chunk.Title, chunk.Content, chunk.SourceType, chunk.SourceRef, metadata).Scan(&id)
	return id, err
}

func (s *Store) UpdateAIKB(ctx context.Context, adminID, id int64, title, content string) (*models.AIKBChunk, error) {
	row := s.DB.QueryRow(ctx, `
		UPDATE bc_ai_kb_chunks
		SET title = NULLIF($3, ''),
		    content = $4,
		    embedding = NULL,
		    embedding_model = NULL,
		    embedding_updated_at = NULL,
		    embedding_error = NULL,
		    updated_at = now()
		WHERE id = $1 AND admin_user_id = $2
		RETURNING id, admin_user_id, coalesce(title, ''), content, source_type,
		          coalesce(source_ref, ''), metadata, created_at, updated_at,
		          char_length(content)
	`, id, adminID, strings.TrimSpace(title), strings.TrimSpace(content))
	chunk, err := scanAIKBRow(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return chunk, err
}

func (s *Store) SetAIKBEmbedding(ctx context.Context, adminID, id int64, model string, vector []float32) error {
	if len(vector) == 0 {
		return nil
	}
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_ai_kb_chunks
		SET embedding = $3::vector,
		    embedding_model = NULLIF($4, ''),
		    embedding_updated_at = now(),
		    embedding_error = NULL
		WHERE id = $1 AND admin_user_id = $2
	`, id, adminID, pgVectorLiteral(vector), strings.TrimSpace(model))
	return err
}

func (s *Store) MarkAIKBEmbeddingError(ctx context.Context, adminID, id int64, message string) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_ai_kb_chunks
		SET embedding_error = NULLIF($3, ''),
		    embedding_updated_at = now()
		WHERE id = $1 AND admin_user_id = $2
	`, id, adminID, truncateStoreString(strings.TrimSpace(message), 1000))
	return err
}

func (s *Store) DeleteAIKB(ctx context.Context, adminID, id int64) (bool, error) {
	ct, err := s.DB.Exec(ctx, `
		DELETE FROM bc_ai_kb_chunks
		WHERE id = $1 AND admin_user_id = $2
	`, id, adminID)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() > 0, nil
}

func (s *Store) GetAIAgentKnowledgeScope(ctx context.Context, adminID, agentID int64) (*models.AIAgentKnowledgeScope, error) {
	if _, err := s.GetAIAgent(ctx, adminID, agentID); err != nil {
		return nil, err
	}

	var total int
	if err := s.DB.QueryRow(ctx, `
		SELECT count(*) FROM bc_ai_kb_chunks WHERE admin_user_id = $1
	`, adminID).Scan(&total); err != nil {
		return nil, err
	}

	rows, err := s.DB.Query(ctx, `
		SELECT k.id, k.admin_user_id, coalesce(k.title, ''), k.content, k.source_type,
		       coalesce(k.source_ref, ''), k.metadata, k.created_at, k.updated_at,
		       char_length(k.content)
		FROM bc_ai_agent_kb_chunks ak
		JOIN bc_ai_kb_chunks k
		  ON k.id = ak.kb_chunk_id
		 AND k.admin_user_id = $1
		WHERE ak.admin_user_id = $1
		  AND ak.agent_id = $2
		ORDER BY k.updated_at DESC, k.id DESC
	`, adminID, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	chunks, err := scanAIKBRows(rows)
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(chunks))
	for _, c := range chunks {
		ids = append(ids, c.ID)
	}
	mode := "all"
	if len(ids) > 0 {
		mode = "selected"
	}
	return &models.AIAgentKnowledgeScope{
		AgentID:     agentID,
		Mode:        mode,
		SelectedIDs: ids,
		Chunks:      chunks,
		TotalKB:     total,
	}, nil
}

func (s *Store) SetAIAgentKnowledgeScope(ctx context.Context, adminID, agentID int64, chunkIDs []int64) (*models.AIAgentKnowledgeScope, error) {
	if _, err := s.GetAIAgent(ctx, adminID, agentID); err != nil {
		return nil, err
	}

	clean := cleanInt64IDs(chunkIDs)
	if len(clean) > 0 {
		var found int
		if err := s.DB.QueryRow(ctx, `
			SELECT count(*) FROM bc_ai_kb_chunks
			WHERE admin_user_id = $1 AND id = ANY($2)
		`, adminID, clean).Scan(&found); err != nil {
			return nil, err
		}
		if found != len(clean) {
			return nil, ErrAIKBChunkNotFound
		}
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		DELETE FROM bc_ai_agent_kb_chunks
		WHERE admin_user_id = $1 AND agent_id = $2
	`, adminID, agentID); err != nil {
		return nil, err
	}

	for _, chunkID := range clean {
		if _, err := tx.Exec(ctx, `
			INSERT INTO bc_ai_agent_kb_chunks (admin_user_id, agent_id, kb_chunk_id)
			VALUES ($1, $2, $3)
			ON CONFLICT (agent_id, kb_chunk_id) DO NOTHING
		`, adminID, agentID, chunkID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetAIAgentKnowledgeScope(ctx, adminID, agentID)
}

const aiKBImportJobSelectColumns = `
	id, admin_user_id, status, source_type, source_name, source_chars,
	max_chunks, total_sections, processed_sections, created_count,
	created_ids, titles, warnings, coalesce(error, ''), metadata,
	started_at, completed_at, created_at, updated_at
`

func scanAIKBImportJob(row rowScanner) (*models.AIKBImportJob, error) {
	var job models.AIKBImportJob
	var titlesRaw, warningsRaw, metadataRaw []byte
	err := row.Scan(
		&job.ID, &job.AdminUserID, &job.Status, &job.SourceType, &job.SourceName, &job.SourceChars,
		&job.MaxChunks, &job.TotalSections, &job.ProcessedSections, &job.CreatedCount,
		&job.CreatedIDs, &titlesRaw, &warningsRaw, &job.Error, &metadataRaw,
		&job.StartedAt, &job.CompletedAt, &job.CreatedAt, &job.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if job.CreatedIDs == nil {
		job.CreatedIDs = []int64{}
	}
	job.Titles = jsonStringList(titlesRaw)
	job.Warnings = jsonStringList(warningsRaw)
	job.Metadata = jsonObjectMap(metadataRaw)
	return &job, nil
}

func (s *Store) CreateAIKBImportJob(ctx context.Context, adminID int64, text, sourceName string, maxChunks int, metadata map[string]any) (*models.AIKBImportJob, error) {
	sourceName = strings.TrimSpace(sourceName)
	if len(sourceName) > 140 {
		sourceName = sourceName[:140]
	}
	if maxChunks <= 0 {
		maxChunks = 250
	}
	if maxChunks > 1000 {
		maxChunks = 1000
	}
	sourceChars := len([]rune(text))
	return scanAIKBImportJob(s.DB.QueryRow(ctx, `
		INSERT INTO bc_ai_kb_import_jobs
			(admin_user_id, status, source_type, source_name, source_chars,
			 input_text, max_chunks, metadata)
		VALUES ($1, 'queued', 'text', $2, $3, $4, $5, $6::jsonb)
		RETURNING `+aiKBImportJobSelectColumns+`
	`, adminID, sourceName, sourceChars, text, maxChunks, jsonObjectString(metadata)))
}

func (s *Store) GetAIKBImportJob(ctx context.Context, adminID, jobID int64) (*models.AIKBImportJob, error) {
	job, err := scanAIKBImportJob(s.DB.QueryRow(ctx, `
		SELECT `+aiKBImportJobSelectColumns+`
		FROM bc_ai_kb_import_jobs
		WHERE id = $1 AND admin_user_id = $2
	`, jobID, adminID))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return job, err
}

func (s *Store) StartAIKBImportJob(ctx context.Context, adminID, jobID int64, totalSections int) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_ai_kb_import_jobs
		SET status = 'running',
		    total_sections = $3,
		    processed_sections = 0,
		    started_at = coalesce(started_at, now()),
		    updated_at = now()
		WHERE id = $1 AND admin_user_id = $2
	`, jobID, adminID, totalSections)
	return err
}

func (s *Store) UpdateAIKBImportProgress(ctx context.Context, adminID, jobID int64, processedSections, createdCount int, createdIDs []int64, titles, warnings []string) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_ai_kb_import_jobs
		SET processed_sections = $3,
		    created_count = $4,
		    created_ids = $5,
		    titles = $6::jsonb,
		    warnings = $7::jsonb,
		    updated_at = now()
		WHERE id = $1 AND admin_user_id = $2
	`, jobID, adminID, processedSections, createdCount, createdIDs, jsonStringListString(titles), jsonStringListString(warnings))
	return err
}

func (s *Store) CompleteAIKBImportJob(ctx context.Context, adminID, jobID int64, processedSections, createdCount int, createdIDs []int64, titles, warnings []string) error {
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_ai_kb_import_jobs
		SET status = 'completed',
		    processed_sections = $3,
		    created_count = $4,
		    created_ids = $5,
		    titles = $6::jsonb,
		    warnings = $7::jsonb,
		    input_text = NULL,
		    error = NULL,
		    completed_at = now(),
		    updated_at = now()
		WHERE id = $1 AND admin_user_id = $2
	`, jobID, adminID, processedSections, createdCount, createdIDs, jsonStringListString(titles), jsonStringListString(warnings))
	return err
}

func (s *Store) FailAIKBImportJob(ctx context.Context, adminID, jobID int64, message string, warnings []string) error {
	message = strings.TrimSpace(message)
	if len(message) > 1200 {
		message = message[:1200]
	}
	_, err := s.DB.Exec(ctx, `
		UPDATE bc_ai_kb_import_jobs
		SET status = 'failed',
		    error = NULLIF($3, ''),
		    warnings = $4::jsonb,
		    input_text = NULL,
		    completed_at = now(),
		    updated_at = now()
		WHERE id = $1 AND admin_user_id = $2
	`, jobID, adminID, message, jsonStringListString(warnings))
	return err
}

func (s *Store) SearchAIKB(ctx context.Context, adminID int64, query string, topK int) ([]models.AIRetrievedChunk, error) {
	return s.SearchAIKBForAgent(ctx, adminID, nil, query, topK)
}

func (s *Store) SearchAIKBForAgent(ctx context.Context, adminID int64, agentID *int64, query string, topK int) ([]models.AIRetrievedChunk, error) {
	terms := tokenizeAIQuery(query)
	if len(terms) == 0 {
		return []models.AIRetrievedChunk{}, nil
	}
	if topK <= 0 || topK > 20 {
		topK = 5
	}

	var agentArg any
	if agentID != nil && *agentID > 0 {
		agentArg = *agentID
	}
	rows, err := s.DB.Query(ctx, `
		SELECT id, coalesce(title, ''), content, source_type,
		       coalesce(source_ref, ''), updated_at
		FROM bc_ai_kb_chunks
		WHERE admin_user_id = $1
		  AND (
		    $2::bigint IS NULL
		    OR NOT EXISTS (
		      SELECT 1 FROM bc_ai_agent_kb_chunks scope
		      WHERE scope.admin_user_id = $1 AND scope.agent_id = $2
		    )
		    OR EXISTS (
		      SELECT 1 FROM bc_ai_agent_kb_chunks scope
		      WHERE scope.admin_user_id = $1
		        AND scope.agent_id = $2
		        AND scope.kb_chunk_id = bc_ai_kb_chunks.id
		    )
		  )
		ORDER BY updated_at DESC, id DESC
		LIMIT 500
	`, adminID, agentArg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type scored struct {
		chunk     models.AIRetrievedChunk
		updatedAt time.Time
	}
	out := []scored{}
	for rows.Next() {
		var c models.AIRetrievedChunk
		var updatedAt time.Time
		if err := rows.Scan(&c.ID, &c.Title, &c.Content, &c.SourceType, &c.SourceRef, &updatedAt); err != nil {
			return nil, err
		}
		keyword := keywordScore(terms, c.Title, c.SourceRef, c.Content)
		if keyword <= 0 {
			continue
		}
		c.KeywordSim = keyword
		c.VectorSim = 0
		c.FinalScore = keyword
		out = append(out, scored{chunk: c, updatedAt: updatedAt})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].chunk.FinalScore == out[j].chunk.FinalScore {
			return out[i].updatedAt.After(out[j].updatedAt)
		}
		return out[i].chunk.FinalScore > out[j].chunk.FinalScore
	})
	if len(out) > topK {
		out = out[:topK]
	}

	chunks := make([]models.AIRetrievedChunk, 0, len(out))
	for _, item := range out {
		chunks = append(chunks, item.chunk)
	}
	return chunks, nil
}

type aiConversationState struct {
	ID              int64
	AdminUserID     int64
	ConversationKey string
	Phone           string
	RetailerID      *int64
	Status          string
	HandedOffAt     *time.Time
	HandoffReason   string
	Summary         string
	LeadID          *int64
	LeadName        string
	StartedAt       time.Time
	UpdatedAt       time.Time
}

type aiConversationRaw struct {
	ConversationKey string
	RetailerID      *int64
	Phone           string
	LeadName        string
	AIHandledCount  int
	StartedAt       time.Time
	LastMessageAt   time.Time
	LastPreview     string
}

func (s *Store) ListAIConversations(ctx context.Context, adminID int64, status string, limit, offset int) ([]models.AIConversation, int, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	status = strings.TrimSpace(status)

	raws, err := s.listAIConversationRaw(ctx, adminID)
	if err != nil {
		return nil, 0, err
	}

	items := make([]models.AIConversation, 0, len(raws))
	for _, raw := range raws {
		st, err := s.ensureAIConversationState(ctx, adminID, raw)
		if err != nil {
			return nil, 0, err
		}
		conv, err := s.aiConversationFromStateAndRaw(ctx, st, &raw)
		if err != nil {
			return nil, 0, err
		}
		if status != "" && conv.Status != status {
			continue
		}
		items = append(items, *conv)
	}

	sort.SliceStable(items, func(i, j int) bool {
		return items[i].LastMessageAt.After(items[j].LastMessageAt)
	})
	total := len(items)
	if offset >= len(items) {
		return []models.AIConversation{}, total, nil
	}
	end := offset + limit
	if end > len(items) {
		end = len(items)
	}
	return items[offset:end], total, nil
}

func (s *Store) GetAIConversation(ctx context.Context, adminID, id int64) (*models.AIConversation, error) {
	st, err := s.getAIConversationState(ctx, adminID, id)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return nil, nil
	}
	raw, err := s.aiConversationRawForState(ctx, st)
	if err != nil {
		return nil, err
	}
	return s.aiConversationFromStateAndRaw(ctx, st, raw)
}

func (s *Store) ListAIConversationMessages(ctx context.Context, adminID, id int64) ([]models.AIConversationMessage, error) {
	st, err := s.getAIConversationState(ctx, adminID, id)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return nil, nil
	}

	out := []models.AIConversationMessage{}
	var thread []models.ThreadMessage
	if strings.TrimSpace(st.Phone) != "" {
		thread, err = s.ListConversationMessagesByPhone(ctx, adminID, st.Phone, 1000, 0)
	} else if st.RetailerID != nil {
		thread, err = s.ListConversationMessages(ctx, adminID, *st.RetailerID, 1000, 0)
	}
	if err != nil {
		return nil, err
	}
	for _, m := range thread {
		role := "assistant"
		idSuffix := int64(2)
		if m.Direction == "inbound" {
			role = "user"
			idSuffix = 1
		}
		msg := models.AIConversationMessage{
			ID:        m.ID*10 + idSuffix,
			Role:      role,
			Content:   m.Body,
			IsVoice:   false,
			CreatedAt: m.OccurredAt,
		}
		if role == "assistant" {
			msg.Provider = "whatsapp"
			if m.TemplateName != "" {
				msg.ModelUsed = "template"
				msg.ToolSummary = m.TemplateName
			}
		}
		out = append(out, msg)
	}

	local, err := s.listLocalAIConversationMessages(ctx, adminID, st.ConversationKey)
	if err != nil {
		return nil, err
	}
	out = append(out, local...)

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return dedupeAIConversationMessages(out), nil
}

func (s *Store) SetAIConversationStatus(ctx context.Context, adminID, id int64, status, reason string) (*models.AIConversation, error) {
	status = strings.TrimSpace(status)
	if status == "" {
		status = "active"
	}
	reason = strings.TrimSpace(reason)
	var handedOffAt any
	var handoffReason any
	if status == "handed_off" {
		handedOffAt = time.Now()
		if reason == "" {
			reason = "manual takeover"
		}
		handoffReason = reason
	}
	row := s.DB.QueryRow(ctx, `
		UPDATE bc_ai_conversation_states
		SET status = $3,
		    handed_off_at = $4,
		    handoff_reason = $5,
		    updated_at = now()
		WHERE id = $1 AND admin_user_id = $2
		RETURNING id, admin_user_id, conversation_key, phone, retailer_id, status,
		          handed_off_at, coalesce(handoff_reason, ''), coalesce(summary, ''),
		          lead_id, coalesce(lead_name, ''), started_at, updated_at
	`, id, adminID, status, handedOffAt, handoffReason)
	st, err := scanAIConversationState(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	raw, err := s.aiConversationRawForState(ctx, st)
	if err != nil {
		return nil, err
	}
	return s.aiConversationFromStateAndRaw(ctx, st, raw)
}

func (s *Store) AddAIConversationHumanMessage(ctx context.Context, adminID, id int64, content string) (*models.AIConversationMessage, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, fmt.Errorf("content is required")
	}
	st, err := s.getAIConversationState(ctx, adminID, id)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return nil, nil
	}
	if st.Status != "handed_off" {
		return nil, fmt.Errorf("conversation must be handed off before sending a human reply")
	}

	row := s.DB.QueryRow(ctx, `
		INSERT INTO bc_ai_conversation_messages
			(admin_user_id, conversation_key, phone, role, content, provider, send_status)
		VALUES ($1, $2, $3, 'human', $4, 'whatsapp', 'pending')
		RETURNING id, role, content, coalesce(model_used, ''), coalesce(provider, ''),
		          coalesce(provider_msg_id, ''), coalesce(send_status, ''), coalesce(send_error, ''),
		          coalesce(tokens_in, 0), coalesce(tokens_out, 0), coalesce(cost_usd, 0),
		          coalesce(latency_ms, 0), is_voice, coalesce(tool_summary, ''), sent_at, created_at
	`, adminID, st.ConversationKey, st.Phone, content)
	msg, err := scanLocalAIConversationMessage(row)
	if err != nil {
		return nil, err
	}
	return msg, nil
}

func (s *Store) MarkAIConversationHumanMessageSendResult(ctx context.Context, adminID, messageID int64, sent bool, providerMsgID, sendError string) (*models.AIConversationMessage, error) {
	if messageID <= 3 || (messageID-3)%10 != 0 {
		return nil, fmt.Errorf("bad message id")
	}
	rawID := (messageID - 3) / 10
	status := "failed"
	if sent {
		status = "sent"
		sendError = ""
	}
	row := s.DB.QueryRow(ctx, `
		UPDATE bc_ai_conversation_messages
		SET provider = 'whatsapp',
		    provider_msg_id = NULLIF($3, ''),
		    send_status = $4,
		    send_error = NULLIF($5, ''),
		    sent_at = CASE WHEN $4 = 'sent' THEN COALESCE(sent_at, now()) ELSE sent_at END
		WHERE id = $1 AND admin_user_id = $2 AND role = 'human'
		RETURNING id, role, content, coalesce(model_used, ''), coalesce(provider, ''),
		          coalesce(provider_msg_id, ''), coalesce(send_status, ''), coalesce(send_error, ''),
		          coalesce(tokens_in, 0), coalesce(tokens_out, 0), coalesce(cost_usd, 0),
		          coalesce(latency_ms, 0), is_voice, coalesce(tool_summary, ''), sent_at, created_at
	`, rawID, adminID, strings.TrimSpace(providerMsgID), status, strings.TrimSpace(sendError))
	msg, err := scanLocalAIConversationMessage(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return msg, err
}

func (s *Store) listAIConversationRaw(ctx context.Context, adminID int64) ([]aiConversationRaw, error) {
	rows, err := s.DB.Query(ctx, `
		WITH source_rows AS (
			SELECT
				j.to_number AS phone,
				j.retailer_id,
				CASE WHEN j.status <> 'received' THEN 1 ELSE 0 END::int AS ai_count,
				COALESCE(j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.queued_at, j.created_at) AS occurred_at
			FROM bc_message_jobs j
			WHERE j.admin_user_id = $1
			  AND trim(COALESCE(j.to_number, '')) <> ''

			UNION ALL

			SELECT
				st.phone,
				st.retailer_id,
				0::int AS ai_count,
				COALESCE(st.last_message_at, st.updated_at, st.started_at) AS occurred_at
			FROM bc_ai_conversation_states st
			WHERE st.admin_user_id = $1
			  AND trim(COALESCE(st.phone, '')) <> ''

			UNION ALL

			SELECT
				m.phone,
				NULL::bigint AS retailer_id,
				CASE WHEN m.role IN ('assistant', 'human') THEN 1 ELSE 0 END::int AS ai_count,
				m.created_at AS occurred_at
			FROM bc_ai_conversation_messages m
			WHERE m.admin_user_id = $1
			  AND trim(COALESCE(m.phone, '')) <> ''
		),
		grouped AS (
			SELECT
				phone AS to_number,
				MAX(retailer_id) FILTER (WHERE retailer_id IS NOT NULL) AS retailer_id,
				SUM(ai_count)::int AS ai_count,
				MIN(occurred_at) AS started_at,
				MAX(occurred_at) AS last_at
			FROM source_rows
			GROUP BY phone
		)
		SELECT
			'phone:' || grouped.to_number AS conversation_key,
			grouped.retailer_id,
			grouped.to_number,
			COALESCE(r.retailer_name, ''),
			grouped.ai_count,
			grouped.started_at,
			grouped.last_at
		FROM grouped
		LEFT JOIN bc_retailers r ON r.id = grouped.retailer_id
		ORDER BY grouped.last_at DESC
		LIMIT 500
	`, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []aiConversationRaw{}
	for rows.Next() {
		var raw aiConversationRaw
		if err := rows.Scan(&raw.ConversationKey, &raw.RetailerID, &raw.Phone, &raw.LeadName, &raw.AIHandledCount, &raw.StartedAt, &raw.LastMessageAt); err != nil {
			return nil, err
		}
		if err := s.fillAIConversationPreview(ctx, adminID, &raw); err != nil {
			return nil, err
		}
		out = append(out, raw)
	}
	return out, rows.Err()
}

func (s *Store) fillAIConversationPreview(ctx context.Context, adminID int64, raw *aiConversationRaw) error {
	var (
		j       *models.MessageJob
		inbound *inboundPreview
		err     error
	)
	if strings.TrimSpace(raw.Phone) != "" {
		j, err = s.latestJobForPhone(ctx, adminID, raw.Phone)
		inbound, _ = s.latestInboundForPhone(ctx, adminID, raw.Phone)
	} else if raw.RetailerID != nil {
		j, err = s.latestJobForRetailer(ctx, adminID, *raw.RetailerID)
		inbound, _ = s.latestInboundForRetailer(ctx, adminID, *raw.RetailerID)
	}
	if err != nil {
		return err
	}
	if j != nil {
		raw.LastPreview = previewFromParams(j)
		raw.LastMessageAt = jobMessageTime(j)
	}
	if inbound != nil && (j == nil || !inbound.OccurredAt.Before(raw.LastMessageAt)) {
		raw.LastPreview = trimPreview(inbound.Body)
		raw.LastMessageAt = inbound.OccurredAt
	}
	return nil
}

func (s *Store) ensureAIConversationState(ctx context.Context, adminID int64, raw aiConversationRaw) (*aiConversationState, error) {
	var leadID any
	var retailerID any
	if raw.RetailerID != nil {
		leadID = *raw.RetailerID
		retailerID = *raw.RetailerID
	}
	row := s.DB.QueryRow(ctx, `
		INSERT INTO bc_ai_conversation_states
			(admin_user_id, conversation_key, phone, retailer_id, lead_id, lead_name, started_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, now())
		ON CONFLICT (admin_user_id, conversation_key) DO UPDATE SET
			phone = EXCLUDED.phone,
			retailer_id = EXCLUDED.retailer_id,
			lead_id = EXCLUDED.lead_id,
			lead_name = COALESCE(EXCLUDED.lead_name, bc_ai_conversation_states.lead_name),
			updated_at = now()
		RETURNING id, admin_user_id, conversation_key, phone, retailer_id, status,
		          handed_off_at, coalesce(handoff_reason, ''), coalesce(summary, ''),
		          lead_id, coalesce(lead_name, ''), started_at, updated_at
	`, adminID, raw.ConversationKey, raw.Phone, retailerID, leadID, raw.LeadName, raw.StartedAt)
	return scanAIConversationState(row)
}

func (s *Store) getAIConversationState(ctx context.Context, adminID, id int64) (*aiConversationState, error) {
	row := s.DB.QueryRow(ctx, `
		SELECT id, admin_user_id, conversation_key, phone, retailer_id, status,
		       handed_off_at, coalesce(handoff_reason, ''), coalesce(summary, ''),
		       lead_id, coalesce(lead_name, ''), started_at, updated_at
		FROM bc_ai_conversation_states
		WHERE id = $1 AND admin_user_id = $2
	`, id, adminID)
	st, err := scanAIConversationState(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return st, err
}

func scanAIConversationState(row rowScanner) (*aiConversationState, error) {
	var st aiConversationState
	err := row.Scan(
		&st.ID, &st.AdminUserID, &st.ConversationKey, &st.Phone, &st.RetailerID,
		&st.Status, &st.HandedOffAt, &st.HandoffReason, &st.Summary,
		&st.LeadID, &st.LeadName, &st.StartedAt, &st.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &st, nil
}

func (s *Store) aiConversationRawForState(ctx context.Context, st *aiConversationState) (*aiConversationRaw, error) {
	phone := strings.TrimSpace(st.Phone)
	if phone == "" {
		return nil, nil
	}

	row := s.DB.QueryRow(ctx, `
		WITH source_rows AS (
			SELECT
				j.to_number AS phone,
				j.retailer_id,
				CASE WHEN j.status <> 'received' THEN 1 ELSE 0 END::int AS ai_count,
				COALESCE(j.sent_at, j.delivered_at, j.read_at, j.failed_at, j.queued_at, j.created_at) AS occurred_at
			FROM bc_message_jobs j
			WHERE j.admin_user_id = $1
			  AND j.to_number = $2

			UNION ALL

			SELECT
				st.phone,
				st.retailer_id,
				0::int AS ai_count,
				COALESCE(st.last_message_at, st.updated_at, st.started_at) AS occurred_at
			FROM bc_ai_conversation_states st
			WHERE st.admin_user_id = $1
			  AND st.phone = $2

			UNION ALL

			SELECT
				m.phone,
				NULL::bigint AS retailer_id,
				CASE WHEN m.role IN ('assistant', 'human') THEN 1 ELSE 0 END::int AS ai_count,
				m.created_at AS occurred_at
			FROM bc_ai_conversation_messages m
			WHERE m.admin_user_id = $1
			  AND m.phone = $2
		),
		grouped AS (
			SELECT
				phone AS to_number,
				MAX(retailer_id) FILTER (WHERE retailer_id IS NOT NULL) AS retailer_id,
				SUM(ai_count)::int AS ai_count,
				MIN(occurred_at) AS started_at,
				MAX(occurred_at) AS last_at
			FROM source_rows
			GROUP BY phone
		)
		SELECT
			'phone:' || grouped.to_number AS conversation_key,
			grouped.retailer_id,
			grouped.to_number,
			COALESCE(r.retailer_name, ''),
			grouped.ai_count,
			grouped.started_at,
			grouped.last_at
		FROM grouped
		LEFT JOIN bc_retailers r ON r.id = grouped.retailer_id
	`, st.AdminUserID, phone)

	var raw aiConversationRaw
	if err := row.Scan(&raw.ConversationKey, &raw.RetailerID, &raw.Phone, &raw.LeadName, &raw.AIHandledCount, &raw.StartedAt, &raw.LastMessageAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if err := s.fillAIConversationPreview(ctx, st.AdminUserID, &raw); err != nil {
		return nil, err
	}
	return &raw, nil
}

func (s *Store) aiConversationFromStateAndRaw(ctx context.Context, st *aiConversationState, raw *aiConversationRaw) (*models.AIConversation, error) {
	conv := &models.AIConversation{
		ID:            st.ID,
		Phone:         st.Phone,
		Status:        st.Status,
		HandedOffAt:   st.HandedOffAt,
		HandoffReason: st.HandoffReason,
		StartedAt:     st.StartedAt,
		LastMessageAt: st.StartedAt,
		Summary:       st.Summary,
		LeadID:        st.LeadID,
		LeadName:      st.LeadName,
	}
	if raw != nil {
		conv.Phone = raw.Phone
		conv.AIHandledCount = raw.AIHandledCount
		conv.LastMessageAt = raw.LastMessageAt
		conv.LastMessagePreview = raw.LastPreview
		if raw.StartedAt.Before(conv.StartedAt) {
			conv.StartedAt = raw.StartedAt
		}
		if conv.LeadName == "" {
			conv.LeadName = raw.LeadName
		}
	}

	humanCount, localPreview, localAt, err := s.aiConversationLocalStats(ctx, st.AdminUserID, st.ConversationKey)
	if err != nil {
		return nil, err
	}
	conv.HumanHandledCount = humanCount
	if localAt != nil && localAt.After(conv.LastMessageAt) {
		conv.LastMessageAt = *localAt
		conv.LastMessagePreview = localPreview
	}
	return conv, nil
}

func (s *Store) aiConversationLocalStats(ctx context.Context, adminID int64, key string) (int, string, *time.Time, error) {
	var humanCount int
	var latestPreview string
	var latestAt *time.Time
	err := s.DB.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE role = 'human')::int,
			COALESCE((SELECT content
			          FROM bc_ai_conversation_messages
			          WHERE admin_user_id = $1 AND conversation_key = $2
			          ORDER BY created_at DESC, id DESC
			          LIMIT 1), ''),
			(SELECT created_at
			 FROM bc_ai_conversation_messages
			 WHERE admin_user_id = $1 AND conversation_key = $2
			 ORDER BY created_at DESC, id DESC
			 LIMIT 1)
		FROM bc_ai_conversation_messages
		WHERE admin_user_id = $1 AND conversation_key = $2
	`, adminID, key).Scan(&humanCount, &latestPreview, &latestAt)
	if err != nil {
		return 0, "", nil, err
	}
	return humanCount, trimPreview(latestPreview), latestAt, nil
}

func (s *Store) listLocalAIConversationMessages(ctx context.Context, adminID int64, key string) ([]models.AIConversationMessage, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT id, role, content, coalesce(model_used, ''), coalesce(provider, ''),
		       coalesce(provider_msg_id, ''), coalesce(send_status, ''), coalesce(send_error, ''),
		       coalesce(tokens_in, 0), coalesce(tokens_out, 0), coalesce(cost_usd, 0),
		       coalesce(latency_ms, 0), is_voice, coalesce(tool_summary, ''), sent_at, created_at
		FROM bc_ai_conversation_messages
		WHERE admin_user_id = $1 AND conversation_key = $2
		ORDER BY created_at ASC, id ASC
	`, adminID, key)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []models.AIConversationMessage{}
	for rows.Next() {
		m, err := scanLocalAIConversationMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

func dedupeAIConversationMessages(items []models.AIConversationMessage) []models.AIConversationMessage {
	if len(items) < 2 {
		return items
	}
	out := make([]models.AIConversationMessage, 0, len(items))
	for _, item := range items {
		duplicate := false
		content := strings.TrimSpace(item.Content)
		for i := len(out) - 1; i >= 0; i-- {
			prev := out[i]
			if item.CreatedAt.Sub(prev.CreatedAt) > 10*time.Second {
				break
			}
			if prev.Role == item.Role && strings.TrimSpace(prev.Content) == content {
				duplicate = true
				break
			}
		}
		if !duplicate {
			out = append(out, item)
		}
	}
	return out
}

func scanLocalAIConversationMessage(row rowScanner) (*models.AIConversationMessage, error) {
	var m models.AIConversationMessage
	err := row.Scan(
		&m.ID, &m.Role, &m.Content, &m.ModelUsed, &m.Provider, &m.ProviderMsgID,
		&m.SendStatus, &m.SendError, &m.TokensIn, &m.TokensOut, &m.CostUSD,
		&m.LatencyMS, &m.IsVoice, &m.ToolSummary, &m.SentAt, &m.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	m.ID = m.ID*10 + 3
	return &m, nil
}

func scanAIKBRows(rows pgx.Rows) ([]models.AIKBChunk, error) {
	out := []models.AIKBChunk{}
	for rows.Next() {
		chunk, err := scanAIKBRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *chunk)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func scanAIKBRow(row rowScanner) (*models.AIKBChunk, error) {
	var c models.AIKBChunk
	var metadata []byte
	err := row.Scan(
		&c.ID, &c.AdminUserID, &c.Title, &c.Content, &c.SourceType,
		&c.SourceRef, &metadata, &c.CreatedAt, &c.UpdatedAt, &c.ContentSize,
	)
	if err != nil {
		return nil, err
	}
	c.Metadata = jsonObjectMap(metadata)
	return &c, nil
}

func sanitizeAIAgentConfig(cfg *models.AIAgentConfig) {
	cfg.Name = strings.TrimSpace(cfg.Name)
	if cfg.Name == "" {
		cfg.Name = "Riya"
	}
	cfg.Tone = strings.TrimSpace(cfg.Tone)
	if cfg.Tone == "" {
		cfg.Tone = "friendly"
	}
	cfg.Languages = cleanStringList(cfg.Languages, []string{"en"})
	cfg.FallbackModels = cleanStringList(cfg.FallbackModels, []string{})
	cfg.PrimaryModel = strings.TrimSpace(cfg.PrimaryModel)
	if cfg.PrimaryModel == "" {
		cfg.PrimaryModel = "gpt-4o-mini"
	}
	cfg.PremiumModel = strings.TrimSpace(cfg.PremiumModel)
	if cfg.PremiumModel == "" {
		cfg.PremiumModel = "gpt-4o"
	}
	if cfg.FAQConfidenceThreshold < 0 {
		cfg.FAQConfidenceThreshold = 0
	}
	if cfg.FAQConfidenceThreshold > 1 {
		cfg.FAQConfidenceThreshold = 1
	}
	cfg.SystemPrompt = strings.TrimSpace(cfg.SystemPrompt)
	if cfg.SystemPrompt == "" {
		cfg.SystemPrompt = "You are a helpful WhatsApp assistant for this business. Answer clearly, stay concise, and ask for a human handoff when confidence is low."
	}
	if cfg.WorkingHours == nil {
		cfg.WorkingHours = map[string]any{}
	}
	if cfg.HandoffRules == nil {
		cfg.HandoffRules = map[string]any{}
	}
	if cfg.QualificationCriteria == nil {
		cfg.QualificationCriteria = map[string]any{}
	}
}

func cleanStringList(in []string, fallback []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	if len(out) == 0 {
		return append([]string{}, fallback...)
	}
	return out
}

func cleanInt64IDs(in []int64) []int64 {
	out := []int64{}
	seen := map[int64]bool{}
	for _, id := range in {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func cleanAISourceType(sourceType string) string {
	sourceType = strings.ToLower(strings.TrimSpace(sourceType))
	if sourceType == "" {
		return "manual"
	}
	return sourceType
}

func jsonObjectMap(raw []byte) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil || out == nil {
		return map[string]any{}
	}
	return out
}

func jsonObjectString(v map[string]any) string {
	if len(v) == 0 {
		return "{}"
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}

func jsonStringList(raw []byte) []string {
	if len(raw) == 0 {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil || out == nil {
		return []string{}
	}
	return out
}

func jsonStringListString(v []string) string {
	if len(v) == 0 {
		return "[]"
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func tokenizeAIQuery(query string) []string {
	parts := strings.FieldsFunc(strings.ToLower(query), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	terms := []string{}
	seen := map[string]bool{}
	add := func(p string) {
		p = strings.TrimSpace(strings.ToLower(p))
		if len([]rune(p)) < 2 || aiQueryStopWords[p] || seen[p] {
			return
		}
		seen[p] = true
		terms = append(terms, p)
	}
	for _, p := range parts {
		add(p)
	}
	q := strings.ToLower(query)
	if strings.Contains(q, "kind") || strings.Contains(q, "what do you") || strings.Contains(q, "what all") ||
		strings.Contains(q, "sell") || strings.Contains(q, "carry") || strings.Contains(q, "available") ||
		strings.Contains(q, "product") || strings.Contains(q, "category") {
		for _, term := range []string{"product", "products", "category", "categories", "carry"} {
			add(term)
		}
	}
	if strings.Contains(q, "sweet") || strings.Contains(q, "mithai") {
		for _, term := range []string{"sweet", "sweets", "mithai"} {
			add(term)
		}
	}
	return terms
}

var aiQueryStopWords = map[string]bool{
	"a": true, "an": true, "and": true, "are": true, "as": true, "at": true,
	"be": true, "but": true, "by": true, "can": true, "do": true, "for": true,
	"from": true, "have": true, "hello": true, "hey": true, "hi": true, "i": true,
	"in": true, "is": true, "it": true, "me": true, "of": true, "on": true,
	"or": true, "our": true, "please": true, "saw": true, "the": true, "this": true,
	"to": true, "u": true, "we": true, "what": true, "whats": true, "with": true,
	"you": true, "your": true,
}

func keywordScore(terms []string, title, sourceRef, content string) float64 {
	hay := strings.ToLower(title + " " + sourceRef + " " + content)
	titleHay := strings.ToLower(title + " " + sourceRef)
	matches := 0
	titleMatches := 0
	for _, term := range terms {
		if strings.Contains(hay, term) {
			matches++
		}
		if strings.Contains(titleHay, term) {
			titleMatches++
		}
	}
	if matches == 0 {
		return 0
	}
	base := float64(matches) / float64(len(terms))
	titleBoost := 0.15 * (float64(titleMatches) / float64(len(terms)))
	return math.Min(1, base+titleBoost)
}

func pgVectorLiteral(v []float32) string {
	var b strings.Builder
	b.Grow(2 + len(v)*12)
	b.WriteByte('[')
	for i, x := range v {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, "%g", x)
	}
	b.WriteByte(']')
	return b.String()
}

func truncateStoreString(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[:max]
}
