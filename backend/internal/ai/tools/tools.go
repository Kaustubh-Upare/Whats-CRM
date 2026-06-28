// Package tools holds the function-calling tools the AI agent loop
// exposes to the LLM. Each tool is a small struct with an Execute
// method that takes a parsed llm.ToolCall, runs its DB code, and
// returns a ToolResult the LLM can consume.
//
// Tools exposed in Phase 6 (text-only agent loop):
//
//   - capture_lead      — upsert bc_ai_leads + record captured facts
//   - qualify_lead      — compute a 0-100 score + flip lead status
//   - transfer_to_human — flip bc_ai_conversation_states.status = handed_off
//   - create_deal       — add a lead to a pipeline (bc_crm_deals)
//   - move_deal_stage   — advance/return a deal; flips lead status on Won/Lost
//   - add_to_sequence   — enroll a lead (bc_crm_sequence_enrollments)
//   - update_lead_status — flip lead.status
//
// Multi-tenant note: every tool uses admin_user_id (the live
// WhatsyITC/backend column). The legacy Backend/ used business_id
// for the same role.
package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/whatsyitc/backend/internal/llm"
)

// Tool is the interface every agent tool implements.
//
// Execute runs the tool's side effect and returns a JSON-serialisable
// result. The orchestrator forwards the result back to the LLM as a
// tool-role message; the LLM then continues reasoning with the
// concrete data.
//
// Errors from Execute should be the kind that the LLM can recover
// from (e.g. "lead_id missing"). Programming errors should panic.
type Tool interface {
	Name() string
	Definition(businessID int64) llm.ToolDef
	Execute(ctx context.Context, businessID int64, call llm.ToolCall) (ToolResult, error)
}

// ToolResult is what Execute returns. Content is the JSON object the
// LLM sees as the tool's reply; Summary is the short human-readable
// text we persist to bc_ai_conversation_messages for the inbox.
type ToolResult struct {
	Content string // JSON object as a string (so the LLM can consume it)
	Summary string // 1-line human description for the admin inbox
}

// Registry is the orchestrator's view of available tools. It maps a
// tool name to a Tool implementation + definition.
type Registry struct {
	pool  *pgxpool.Pool
	tools map[string]Tool
}

// NewRegistry builds the registry with all Phase 6 tools. New tools
// (Phase 7+) get registered here too.
func NewRegistry(pool *pgxpool.Pool) *Registry {
	r := &Registry{
		pool:  pool,
		tools: map[string]Tool{},
	}
	r.tools["capture_lead"] = &CaptureLead{pool: pool}
	r.tools["qualify_lead"] = &QualifyLead{pool: pool}
	r.tools["transfer_to_human"] = &TransferToHuman{pool: pool}
	r.tools["create_deal"] = &CreateDeal{pool: pool}
	r.tools["move_deal_stage"] = &MoveDealStage{pool: pool}
	r.tools["add_to_sequence"] = &AddToSequence{pool: pool}
	r.tools["update_lead_status"] = &UpdateLeadStatus{pool: pool}
	return r
}

// Get looks up a tool by name. Returns nil if absent.
func (r *Registry) Get(name string) Tool {
	if r == nil {
		return nil
	}
	return r.tools[name]
}

// Definitions returns the JSON tool definitions to send to the LLM.
// Each tool's Definition() method gets the admin_id so per-tenant
// fields (like qualification criteria) can be baked into the schema.
func (r *Registry) Definitions(adminID int64) []llm.ToolDef {
	out := make([]llm.ToolDef, 0, len(r.tools))
	for _, t := range r.tools {
		out = append(out, t.Definition(adminID))
	}
	return out
}

// ---------------------------------------------------------------------------
// capture_lead
// ---------------------------------------------------------------------------

// CaptureLead creates or updates a bc_ai_leads row + writes any
// captured facts (name, interest, budget, timeline, location) into
// bc_ai_lead_facts. The lead is owned by the phone number on the
// inbound message; if the same phone has messaged before, the
// existing lead is updated (not duplicated).
type CaptureLead struct{ pool *pgxpool.Pool }

func (t *CaptureLead) Name() string { return "capture_lead" }

func (t *CaptureLead) Definition(_ int64) llm.ToolDef {
	return llm.ToolDef{
		Name: "capture_lead",
		Description: "Capture or update a sales lead when the customer shares personal details or purchase intent. " +
			"All fields except phone are optional — supply only what's been stated.",
		JSONSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"phone":    {"type": "string", "description": "Customer's WhatsApp phone number in E.164 (with country code, no +)."},
				"name":     {"type": "string", "description": "Customer's name."},
				"email":    {"type": "string", "description": "Customer's email if shared."},
				"interest": {"type": "string", "description": "What they're interested in (product, service)."},
				"budget":   {"type": "string", "description": "Budget or price range if mentioned."},
				"timeline": {"type": "string", "description": "Purchase timeline if mentioned (e.g. 'next week', 'ASAP')."},
				"location": {"type": "string", "description": "City or area if mentioned."}
			},
			"required": ["phone"]
		}`),
	}
}

func (t *CaptureLead) Execute(ctx context.Context, adminID int64, call llm.ToolCall) (ToolResult, error) {
	var args struct {
		Phone    string `json:"phone"`
		Name     string `json:"name"`
		Email    string `json:"email"`
		Interest string `json:"interest"`
		Budget   string `json:"budget"`
		Timeline string `json:"timeline"`
		Location string `json:"location"`
	}
	if err := json.Unmarshal(call.Args, &args); err != nil {
		return ToolResult{}, fmt.Errorf("capture_lead: bad args: %w", err)
	}
	args.Phone = strings.TrimSpace(args.Phone)
	args.Name = strings.TrimSpace(args.Name)
	args.Email = strings.TrimSpace(args.Email)
	args.Interest = strings.TrimSpace(args.Interest)
	args.Budget = strings.TrimSpace(args.Budget)
	args.Timeline = strings.TrimSpace(args.Timeline)
	args.Location = strings.TrimSpace(args.Location)
	if args.Phone == "" {
		return ToolResult{}, fmt.Errorf("capture_lead: phone is required")
	}
	displayName := args.Name
	if displayName == "" {
		displayName = fallbackLeadName(args.Phone)
	}

	// Upsert lead (unique on admin_user_id + phone).
	var leadID int64
	err := t.pool.QueryRow(ctx, `
		INSERT INTO bc_ai_leads (admin_user_id, phone, name, email, interest, budget, timeline, location, source)
		VALUES ($1, $2, $9, COALESCE(NULLIF($4,''), ''), COALESCE(NULLIF($5,''), ''), COALESCE(NULLIF($6,''), ''), COALESCE(NULLIF($7,''), ''), COALESCE(NULLIF($8,''), ''), 'whatsapp_ai')
		ON CONFLICT (admin_user_id, phone) DO UPDATE
		  SET name = COALESCE(NULLIF($3, ''), bc_ai_leads.name),
		      email = COALESCE(NULLIF(EXCLUDED.email, ''), bc_ai_leads.email),
		      interest = COALESCE(NULLIF(EXCLUDED.interest, ''), bc_ai_leads.interest),
		      budget = COALESCE(NULLIF(EXCLUDED.budget, ''), bc_ai_leads.budget),
		      timeline = COALESCE(NULLIF(EXCLUDED.timeline, ''), bc_ai_leads.timeline),
		      location = COALESCE(NULLIF(EXCLUDED.location, ''), bc_ai_leads.location),
		      updated_at = now()
		RETURNING id
	`, adminID, args.Phone, args.Name, args.Email, args.Interest, args.Budget, args.Timeline, args.Location, displayName).Scan(&leadID)
	if err != nil {
		return ToolResult{}, fmt.Errorf("capture_lead: upsert lead: %w", err)
	}

	// Write each non-empty fact into bc_ai_lead_facts (idempotent — ON
	// CONFLICT updates the value).
	facts := map[string]string{
		"name":     args.Name,
		"email":    args.Email,
		"interest": args.Interest,
		"budget":   args.Budget,
		"timeline": args.Timeline,
		"location": args.Location,
	}
	for k, v := range facts {
		if v == "" {
			continue
		}
		_, err := t.pool.Exec(ctx, `
			INSERT INTO bc_ai_lead_facts (admin_user_id, phone, fact_key, fact_value, source, confidence)
			VALUES ($1, $2, $3, $4, 'ai_extracted', 0.9)
			ON CONFLICT (admin_user_id, phone, fact_key) DO UPDATE
			  SET fact_value = EXCLUDED.fact_value,
			      updated_at = now()
		`, adminID, args.Phone, k, v)
		if err != nil {
			return ToolResult{}, fmt.Errorf("capture_lead: write fact %s: %w", k, err)
		}
	}

	summary := fmt.Sprintf("Captured lead %s", args.Phone)
	if args.Name != "" {
		summary += fmt.Sprintf(" (%s)", args.Name)
	}
	content, _ := json.Marshal(map[string]any{
		"lead_id":  leadID,
		"name":     displayName,
		"phone":    args.Phone,
		"interest": args.Interest,
	})
	return ToolResult{Content: string(content), Summary: summary}, nil
}

func fallbackLeadName(phone string) string {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return "WhatsApp lead"
	}
	if len(phone) <= 4 {
		return "WhatsApp lead " + phone
	}
	return "WhatsApp lead " + phone[len(phone)-4:]
}

// ---------------------------------------------------------------------------
// qualify_lead
// ---------------------------------------------------------------------------

// QualifyLead reads the admin's default agent's
// qualification_criteria and
// scores the lead based on captured facts.
type QualifyLead struct{ pool *pgxpool.Pool }

func (t *QualifyLead) Name() string { return "qualify_lead" }

func (t *QualifyLead) Definition(_ int64) llm.ToolDef {
	return llm.ToolDef{
		Name: "qualify_lead",
		Description: "Score a lead 0-100 based on the configured qualification criteria and mark it qualified or unqualified. " +
			"Call this AFTER capture_lead has populated the lead facts.",
		JSONSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"lead_id": {"type": "integer", "description": "The lead_id returned by capture_lead."}
			},
			"required": ["lead_id"]
		}`),
	}
}

func (t *QualifyLead) Execute(ctx context.Context, adminID int64, call llm.ToolCall) (ToolResult, error) {
	var args struct {
		LeadID int64 `json:"lead_id"`
	}
	if err := json.Unmarshal(call.Args, &args); err != nil {
		return ToolResult{}, fmt.Errorf("qualify_lead: bad args: %w", err)
	}
	if args.LeadID <= 0 {
		return ToolResult{}, fmt.Errorf("qualify_lead: lead_id is required")
	}

	// Load qualification criteria from the admin's default agent. Phase 8
	// multi-agent: read from bc_ai_agents (the renamed + extended table) and
	// pick the global default so behavior matches what live chat uses.
	var criteriaJSON []byte
	if err := t.pool.QueryRow(ctx,
		`SELECT qualification_criteria FROM bc_ai_agents WHERE admin_user_id = $1 AND is_default = TRUE`,
		adminID,
	).Scan(&criteriaJSON); err != nil {
		return ToolResult{}, fmt.Errorf("qualify_lead: load criteria: %w", err)
	}
	var criteria map[string]any
	_ = json.Unmarshal(criteriaJSON, &criteria)

	// Load the lead's phone (facts are keyed on phone, not lead_id).
	var phone string
	if err := t.pool.QueryRow(ctx,
		`SELECT phone FROM bc_ai_leads WHERE id = $1 AND admin_user_id = $2`,
		args.LeadID, adminID,
	).Scan(&phone); err != nil {
		return ToolResult{}, fmt.Errorf("qualify_lead: load lead: %w", err)
	}

	// Load facts.
	facts := map[string]string{}
	rows, err := t.pool.Query(ctx,
		`SELECT fact_key, fact_value FROM bc_ai_lead_facts WHERE admin_user_id = $1 AND phone = $2`,
		adminID, phone,
	)
	if err != nil {
		return ToolResult{}, fmt.Errorf("qualify_lead: load facts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		_ = rows.Scan(&k, &v)
		facts[k] = v
	}

	// Score: each rule fires if its fact is present AND the rule
	// doesn't specify a numeric threshold (or the fact exceeds it).
	score := 0
	reasons := []string{}
	if v, ok := criteria["qualified_budget_min"]; ok {
		if budget, has := facts["budget"]; has {
			if numericGTE(budget, asFloat(v)) {
				score += 40
				reasons = append(reasons, fmt.Sprintf("budget %s meets minimum", budget))
			}
		}
	}
	if v, ok := criteria["qualified_timeline_max_days"]; ok {
		if timeline, has := facts["timeline"]; has {
			if timelineMentionsDays(timeline, asFloat(v)) {
				score += 30
				reasons = append(reasons, fmt.Sprintf("timeline %s within %v days", timeline, v))
			}
		}
	}
	if v, ok := criteria["require_location"]; ok {
		if asBool(v) {
			if _, has := facts["location"]; has {
				score += 10
				reasons = append(reasons, "location provided")
			}
		}
	}
	if v, ok := criteria["require_name"]; ok {
		if asBool(v) {
			if _, has := facts["name"]; has {
				score += 10
				reasons = append(reasons, "name provided")
			}
		}
	}
	if v, ok := criteria["require_email"]; ok {
		if asBool(v) {
			if _, has := facts["email"]; has {
				score += 10
				reasons = append(reasons, "email provided")
			}
		}
	}
	if score > 100 {
		score = 100
	}
	if score < 0 {
		score = 0
	}

	status := "unqualified"
	if score >= 70 {
		status = "qualified"
	}

	_, err = t.pool.Exec(ctx, `
		UPDATE bc_ai_leads SET score = $1, status = $2, updated_at = now()
		WHERE id = $3 AND admin_user_id = $4
	`, score, status, args.LeadID, adminID)
	if err != nil {
		return ToolResult{}, fmt.Errorf("qualify_lead: update lead: %w", err)
	}

	content, _ := json.Marshal(map[string]any{
		"lead_id": args.LeadID,
		"score":   score,
		"status":  status,
		"reasons": reasons,
	})
	return ToolResult{
		Content: string(content),
		Summary: fmt.Sprintf("Lead %d scored %d (%s)", args.LeadID, score, status),
	}, nil
}

// ---------------------------------------------------------------------------
// transfer_to_human
// ---------------------------------------------------------------------------

// TransferToHuman marks the conversation as handed_off so the AI
// loop skips future messages from this phone until a human re-enables
// it.
type TransferToHuman struct{ pool *pgxpool.Pool }

func (t *TransferToHuman) Name() string { return "transfer_to_human" }

func (t *TransferToHuman) Definition(_ int64) llm.ToolDef {
	return llm.ToolDef{
		Name: "transfer_to_human",
		Description: "Hand the conversation off to a human team member. Use when the customer asks for a human, " +
			"is upset beyond what you can resolve, or the topic is outside your scope.",
		JSONSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"conversation_id": {"type": "integer", "description": "ID of the conversation being handed off."},
				"reason":          {"type": "string", "description": "Why the handoff is happening (1 line)."}
			},
			"required": ["conversation_id", "reason"]
		}`),
	}
}

func (t *TransferToHuman) Execute(ctx context.Context, adminID int64, call llm.ToolCall) (ToolResult, error) {
	var args struct {
		ConversationID int64  `json:"conversation_id"`
		Reason         string `json:"reason"`
	}
	if err := json.Unmarshal(call.Args, &args); err != nil {
		return ToolResult{}, fmt.Errorf("transfer_to_human: bad args: %w", err)
	}
	if args.ConversationID <= 0 {
		return ToolResult{}, fmt.Errorf("transfer_to_human: conversation_id required")
	}
	if args.Reason == "" {
		args.Reason = "customer_requested"
	}

	var convKey string
	err := t.pool.QueryRow(ctx, `
		UPDATE bc_ai_conversation_states
		SET status = 'handed_off',
		    handoff_reason = $1,
		    handed_off_at = now(),
		    last_message_at = now(),
		    updated_at = now()
		WHERE id = $2 AND admin_user_id = $3
		RETURNING conversation_key
	`, args.Reason, args.ConversationID, adminID).Scan(&convKey)
	if err == pgx.ErrNoRows {
		return ToolResult{}, fmt.Errorf("transfer_to_human: conversation not found")
	}
	if err != nil {
		return ToolResult{}, fmt.Errorf("transfer_to_human: update conv: %w", err)
	}

	_, err = t.pool.Exec(ctx, `
		INSERT INTO bc_ai_handoffs (conversation_key, admin_user_id, from_actor, to_actor, reason)
		VALUES ($1, $2, 'ai', 'human', $3)
	`, convKey, adminID, args.Reason)
	if err != nil {
		return ToolResult{}, fmt.Errorf("transfer_to_human: insert handoff: %w", err)
	}

	content, _ := json.Marshal(map[string]any{
		"conversation_id": args.ConversationID,
		"status":          "handed_off",
		"reason":          args.Reason,
	})
	return ToolResult{
		Content: string(content),
		Summary: fmt.Sprintf("Handed off (reason: %s)", args.Reason),
	}, nil
}

// ---------------------------------------------------------------------------
// create_deal — add a lead to a pipeline.
// ---------------------------------------------------------------------------

type CreateDeal struct{ pool *pgxpool.Pool }

func (t *CreateDeal) Name() string { return "create_deal" }

func (t *CreateDeal) Definition(_ int64) llm.ToolDef {
	return llm.ToolDef{
		Name:        "create_deal",
		Description: "Add a lead to a sales pipeline as a deal. The deal starts in the given stage (usually 'New').",
		JSONSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"lead_id":     {"type": "integer", "description": "The lead_id returned by capture_lead."},
				"pipeline_id": {"type": "integer", "description": "Pipeline to add the deal to. Use the default pipeline (id 1) unless the customer has set up more."},
				"stage_id":    {"type": "integer", "description": "Starting stage, e.g. 'New'. Get stage IDs from GET /api/crm/pipelines."},
				"name":        {"type": "string", "description": "Optional display name. Defaults to '<lead name> · <interest>' or phone."},
				"value":       {"type": "number", "description": "Optional deal value in the customer's currency."}
			},
			"required": ["lead_id", "pipeline_id", "stage_id"]
		}`),
	}
}

func (t *CreateDeal) Execute(ctx context.Context, adminID int64, call llm.ToolCall) (ToolResult, error) {
	var args struct {
		LeadID     int64   `json:"lead_id"`
		PipelineID int64   `json:"pipeline_id"`
		StageID    int64   `json:"stage_id"`
		Name       string  `json:"name"`
		Value      float64 `json:"value"`
	}
	if err := json.Unmarshal(call.Args, &args); err != nil {
		return ToolResult{}, fmt.Errorf("create_deal: bad args: %w", err)
	}
	if args.LeadID == 0 || args.PipelineID == 0 || args.StageID == 0 {
		return ToolResult{}, fmt.Errorf("create_deal: lead_id, pipeline_id, stage_id are required")
	}

	if args.Name == "" {
		_ = t.pool.QueryRow(ctx,
			`SELECT COALESCE(NULLIF(name, ''), phone) FROM bc_ai_leads WHERE id = $1 AND admin_user_id = $2`,
			args.LeadID, adminID,
		).Scan(&args.Name)
	}

	var id int64
	var valuePtr *float64
	if args.Value > 0 {
		valuePtr = &args.Value
	}
	err := t.pool.QueryRow(ctx, `
		INSERT INTO bc_crm_deals (admin_user_id, lead_id, pipeline_id, stage_id, name, value, currency, probability)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, 'INR', 50)
		RETURNING id
	`, adminID, args.LeadID, args.PipelineID, args.StageID, args.Name, valuePtr).Scan(&id)
	if err != nil {
		return ToolResult{}, fmt.Errorf("create_deal: %w", err)
	}

	_, _ = t.pool.Exec(ctx, `
		INSERT INTO bc_crm_lead_activities (admin_user_id, lead_id, type, content, metadata)
		VALUES ($1, $2, 'stage_change', $3, $4::jsonb)
	`, adminID, args.LeadID,
		"Deal created in stage #"+itoaLL(args.StageID),
		fmt.Sprintf(`{"deal_id":%d,"to":%d,"reason":"created","ai":true}`, id, args.StageID),
	)

	content, _ := json.Marshal(map[string]any{
		"deal_id":     id,
		"lead_id":     args.LeadID,
		"pipeline_id": args.PipelineID,
		"stage_id":    args.StageID,
	})
	return ToolResult{
		Content: string(content),
		Summary: fmt.Sprintf("Created deal #%d for lead %d", id, args.LeadID),
	}, nil
}

// ---------------------------------------------------------------------------
// move_deal_stage
// ---------------------------------------------------------------------------

// MoveDealStage moves a deal to a different stage. Idempotent: no-op
// when target stage == current. Flips lead.status to 'converted' /
// 'lost' when the destination stage is named "Won" / "Lost" (case
// insensitive). On success, writes a 'stage_change' activity row.
type MoveDealStage struct{ pool *pgxpool.Pool }

func (t *MoveDealStage) Name() string { return "move_deal_stage" }

func (t *MoveDealStage) Definition(_ int64) llm.ToolDef {
	return llm.ToolDef{
		Name:        "move_deal_stage",
		Description: "Move a deal to a different stage in its pipeline. Updates lead status automatically when the destination is named 'Won' or 'Lost'.",
		JSONSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"deal_id": {"type": "integer", "description": "The deal to move."},
				"stage_id": {"type": "integer", "description": "The destination stage. Get IDs from GET /api/crm/pipelines."},
				"reason":  {"type": "string", "description": "Why the move is happening (1 line)."}
			},
			"required": ["deal_id", "stage_id"]
		}`),
	}
}

func (t *MoveDealStage) Execute(ctx context.Context, adminID int64, call llm.ToolCall) (ToolResult, error) {
	var args struct {
		DealID  int64  `json:"deal_id"`
		StageID int64  `json:"stage_id"`
		Reason  string `json:"reason"`
	}
	if err := json.Unmarshal(call.Args, &args); err != nil {
		return ToolResult{}, fmt.Errorf("move_deal_stage: bad args: %w", err)
	}
	if args.DealID == 0 || args.StageID == 0 {
		return ToolResult{}, fmt.Errorf("move_deal_stage: deal_id and stage_id are required")
	}

	// Load + verify ownership.
	var (
		leadID    int64
		fromStage int64
	)
	err := t.pool.QueryRow(ctx, `
		SELECT lead_id, stage_id FROM bc_crm_deals WHERE id = $1 AND admin_user_id = $2
	`, args.DealID, adminID).Scan(&leadID, &fromStage)
	if err == pgx.ErrNoRows {
		return ToolResult{}, fmt.Errorf("move_deal_stage: not found")
	}
	if err != nil {
		return ToolResult{}, err
	}

	// Verify destination stage belongs to a pipeline owned by this admin.
	var stageAdmin int64
	var stageName string
	if err := t.pool.QueryRow(ctx, `
		SELECT p.admin_user_id, s.name
		FROM bc_crm_pipeline_stages s
		JOIN bc_crm_pipelines p ON p.id = s.pipeline_id
		WHERE s.id = $1
	`, args.StageID).Scan(&stageAdmin, &stageName); err != nil {
		return ToolResult{}, err
	}
	if stageAdmin != adminID {
		return ToolResult{}, fmt.Errorf("move_deal_stage: stage not owned by admin")
	}

	// Idempotent: no-op when same stage.
	if fromStage != args.StageID {
		_, err = t.pool.Exec(ctx,
			`UPDATE bc_crm_deals SET stage_id = $1, updated_at = now() WHERE id = $2 AND admin_user_id = $3`,
			args.StageID, args.DealID, adminID)
		if err != nil {
			return ToolResult{}, err
		}

		meta := map[string]any{
			"deal_id": args.DealID,
			"from":    fromStage,
			"to":      args.StageID,
			"reason":  args.Reason,
			"ai":      true,
		}
		metaJSON, _ := json.Marshal(meta)
		_, _ = t.pool.Exec(ctx, `
			INSERT INTO bc_crm_lead_activities (admin_user_id, lead_id, type, content, metadata)
			VALUES ($1, $2, 'stage_change', $3, $4::jsonb)
		`, adminID, leadID,
			"Deal moved to "+stageName,
			metaJSON,
		)

		// Flip lead.status on Won/Lost.
		switch strings.ToLower(strings.TrimSpace(stageName)) {
		case "won":
			_, _ = t.pool.Exec(ctx, `
				UPDATE bc_ai_leads SET status = 'converted', updated_at = now()
				WHERE id = $1 AND admin_user_id = $2 AND status NOT IN ('converted', 'lost')
			`, leadID, adminID)
			_, _ = t.pool.Exec(ctx, `
				INSERT INTO bc_crm_lead_activities (admin_user_id, lead_id, type, content, metadata)
				VALUES ($1, $2, 'lead_status_change', 'Lead marked as converted (deal won)', $3::jsonb)
			`, adminID, leadID, []byte(`{"status":"converted","reason":"deal won","ai":true}`))
		case "lost":
			_, _ = t.pool.Exec(ctx, `
				UPDATE bc_ai_leads SET status = 'lost', updated_at = now()
				WHERE id = $1 AND admin_user_id = $2 AND status NOT IN ('converted', 'lost')
			`, leadID, adminID)
			_, _ = t.pool.Exec(ctx, `
				INSERT INTO bc_crm_lead_activities (admin_user_id, lead_id, type, content, metadata)
				VALUES ($1, $2, 'lead_status_change', 'Lead marked as lost', $3::jsonb)
			`, adminID, leadID, []byte(`{"status":"lost","reason":"deal lost","ai":true}`))
		}
	}

	// Return updated deal.
	var updated struct {
		ID, LeadID, PipelineID, StageID int64
		Name                            string
	}
	_ = t.pool.QueryRow(ctx, `
		SELECT id, lead_id, pipeline_id, stage_id, COALESCE(name, '')
		FROM bc_crm_deals WHERE id = $1
	`, args.DealID).Scan(&updated.ID, &updated.LeadID, &updated.PipelineID, &updated.StageID, &updated.Name)

	content, _ := json.Marshal(updated)
	return ToolResult{
		Content: string(content),
		Summary: fmt.Sprintf("Moved deal #%d to stage #%d", args.DealID, args.StageID),
	}, nil
}

// ---------------------------------------------------------------------------
// add_to_sequence
// ---------------------------------------------------------------------------

type AddToSequence struct{ pool *pgxpool.Pool }

func (t *AddToSequence) Name() string { return "add_to_sequence" }

func (t *AddToSequence) Definition(_ int64) llm.ToolDef {
	return llm.ToolDef{
		Name:        "add_to_sequence",
		Description: "Enroll a lead in a follow-up sequence. The first message is scheduled based on the sequence's step 1 delay_minutes (or sent immediately if 0).",
		JSONSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"lead_id":     {"type": "integer", "description": "The lead to enroll."},
				"sequence_id": {"type": "integer", "description": "The sequence to enroll them in."}
			},
			"required": ["lead_id", "sequence_id"]
		}`),
	}
}

func (t *AddToSequence) Execute(ctx context.Context, adminID int64, call llm.ToolCall) (ToolResult, error) {
	var args struct {
		LeadID     int64 `json:"lead_id"`
		SequenceID int64 `json:"sequence_id"`
	}
	if err := json.Unmarshal(call.Args, &args); err != nil {
		return ToolResult{}, fmt.Errorf("add_to_sequence: bad args: %w", err)
	}
	if args.LeadID == 0 || args.SequenceID == 0 {
		return ToolResult{}, fmt.Errorf("add_to_sequence: lead_id and sequence_id are required")
	}

	// Verify both rows belong to this admin.
	var leadOwner, seqOwner int64
	if err := t.pool.QueryRow(ctx,
		`SELECT admin_user_id FROM bc_ai_leads WHERE id = $1`, args.LeadID,
	).Scan(&leadOwner); err != nil {
		return ToolResult{}, err
	}
	if leadOwner != adminID {
		return ToolResult{}, fmt.Errorf("add_to_sequence: not your lead")
	}
	if err := t.pool.QueryRow(ctx,
		`SELECT admin_user_id FROM bc_crm_sequences WHERE id = $1`, args.SequenceID,
	).Scan(&seqOwner); err != nil {
		return ToolResult{}, err
	}
	if seqOwner != adminID {
		return ToolResult{}, fmt.Errorf("add_to_sequence: not your sequence")
	}

	// next_run_at = now + step[0].delay_minutes.
	var firstDelay int
	_ = t.pool.QueryRow(ctx, `
		SELECT COALESCE(delay_minutes, 0) FROM bc_crm_sequence_steps
		WHERE sequence_id = $1 ORDER BY position ASC LIMIT 1
	`, args.SequenceID).Scan(&firstDelay)

	var enrollmentID int64
	err := t.pool.QueryRow(ctx, `
		INSERT INTO bc_crm_sequence_enrollments
			(admin_user_id, sequence_id, lead_id, current_step, status, next_run_at)
		VALUES ($1, $2, $3, 0, 'active',
		        now() + ($4 || ' minutes')::interval)
		RETURNING id
	`, adminID, args.SequenceID, args.LeadID, firstDelay).Scan(&enrollmentID)
	if err != nil {
		return ToolResult{}, fmt.Errorf("add_to_sequence: %w", err)
	}

	content, _ := json.Marshal(map[string]any{
		"enrollment_id": enrollmentID,
		"lead_id":       args.LeadID,
		"sequence_id":   args.SequenceID,
		"first_delay":   firstDelay,
	})
	return ToolResult{
		Content: string(content),
		Summary: fmt.Sprintf("Enrolled lead #%d in sequence #%d", args.LeadID, args.SequenceID),
	}, nil
}

// ---------------------------------------------------------------------------
// update_lead_status
// ---------------------------------------------------------------------------

type UpdateLeadStatus struct{ pool *pgxpool.Pool }

func (t *UpdateLeadStatus) Name() string { return "update_lead_status" }

func (t *UpdateLeadStatus) Definition(_ int64) llm.ToolDef {
	return llm.ToolDef{
		Name:        "update_lead_status",
		Description: "Set a lead's status. One of: new, contacted, qualified, unqualified, converted, lost.",
		JSONSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"lead_id": {"type": "integer", "description": "The lead to update."},
				"status":  {"type": "string", "enum": ["new","contacted","qualified","unqualified","converted","lost"]},
				"reason":  {"type": "string", "description": "Why (1 line)."}
			},
			"required": ["lead_id", "status"]
		}`),
	}
}

func (t *UpdateLeadStatus) Execute(ctx context.Context, adminID int64, call llm.ToolCall) (ToolResult, error) {
	var args struct {
		LeadID int64  `json:"lead_id"`
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	if err := json.Unmarshal(call.Args, &args); err != nil {
		return ToolResult{}, fmt.Errorf("update_lead_status: bad args: %w", err)
	}
	switch args.Status {
	case "new", "contacted", "qualified", "unqualified", "converted", "lost":
	default:
		return ToolResult{}, fmt.Errorf("update_lead_status: invalid status %q", args.Status)
	}
	if args.LeadID == 0 {
		return ToolResult{}, fmt.Errorf("update_lead_status: lead_id is required")
	}

	ct, err := t.pool.Exec(ctx, `
		UPDATE bc_ai_leads SET status = $1, updated_at = now()
		WHERE id = $2 AND admin_user_id = $3
	`, args.Status, args.LeadID, adminID)
	if err != nil {
		return ToolResult{}, err
	}
	if ct.RowsAffected() == 0 {
		return ToolResult{}, fmt.Errorf("update_lead_status: not found")
	}
	_, _ = t.pool.Exec(ctx, `
		INSERT INTO bc_crm_lead_activities (admin_user_id, lead_id, type, content, metadata)
		VALUES ($1, $2, 'lead_status_change', $3, $4::jsonb)
	`, adminID, args.LeadID,
		"Lead status set to "+args.Status,
		fmt.Sprintf(`{"status":%q,"reason":%q,"ai":true}`, args.Status, args.Reason),
	)

	content, _ := json.Marshal(map[string]any{
		"lead_id": args.LeadID,
		"status":  args.Status,
	})
	return ToolResult{
		Content: string(content),
		Summary: fmt.Sprintf("Lead #%d → %s", args.LeadID, args.Status),
	}, nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// itoaLL is a tiny int64->string helper (no strconv import needed).
func itoaLL(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	digits := []byte{}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	if neg {
		digits = append([]byte{'-'}, digits...)
	}
	return string(digits)
}

// asFloat parses a number or numeric string as float64.
func asFloat(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case float32:
		return float64(x)
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case string:
		f, _ := strconv.ParseFloat(x, 64)
		return f
	}
	return 0
}

func asBool(v any) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	if s, ok := v.(string); ok {
		return s == "true" || s == "1" || s == "yes"
	}
	return false
}

// numericGTE compares "5000", "5k", "5,000", "5000 INR" against a
// minimum. Returns true when the parsed number >= min.
func numericGTE(s string, min float64) bool {
	cleaned := s
	for _, c := range []string{",", " ", "INR", "Rs.", "Rs", "₹"} {
		cleaned = strings.ReplaceAll(cleaned, c, "")
	}
	if strings.HasSuffix(cleaned, "k") {
		cleaned = strings.TrimSuffix(cleaned, "k")
		f, err := strconv.ParseFloat(cleaned, 64)
		if err == nil {
			return f*1000 >= min
		}
	}
	f, err := strconv.ParseFloat(cleaned, 64)
	if err != nil {
		return false
	}
	return f >= min
}

// timelineMentionsDays is a very loose heuristic: parses the first
// integer from the string and checks it's <= maxDays. "next week"
// doesn't match (no number); "in 3 days" matches.
func timelineMentionsDays(s string, maxDays float64) bool {
	cleaned := strings.ReplaceAll(s, ",", "")
	fields := strings.Fields(cleaned)
	for _, f := range fields {
		n, err := strconv.ParseFloat(f, 64)
		if err == nil {
			return n <= maxDays
		}
	}
	return false
}

// Compile-time guard that all 7 tools implement Tool.
var (
	_ Tool = (*CaptureLead)(nil)
	_ Tool = (*QualifyLead)(nil)
	_ Tool = (*TransferToHuman)(nil)
	_ Tool = (*CreateDeal)(nil)
	_ Tool = (*MoveDealStage)(nil)
	_ Tool = (*AddToSequence)(nil)
	_ Tool = (*UpdateLeadStatus)(nil)
)
