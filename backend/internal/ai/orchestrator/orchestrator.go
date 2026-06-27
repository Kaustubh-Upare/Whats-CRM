// Package orchestrator is the WhatsApp agent loop for WhatsyITC. It
// glues together the agent config, retrieval, LLM, tools, and outbound
// WhatsApp Cloud API into one self-contained HandleInbound call.
//
// Phase 6 surface:
//
//   - HandleInbound: the text path. Single-flight per phone (Meta
//     retries can fire while we're processing). Runs retrieval +
//     prompt build + tool-call loop + outbound send + metrics.
//
//   - Voice/image/hand-off are wired through the existing
//     handlers/ai_conversations.go (Phase 2/3 surface) — the
//     orchestrator is text-only.
//
//   - Phase 6 schema: every SQL uses admin_user_id (the live
//     WhatsyITC/backend multi-tenant column). The legacy Backend/
//     used business_id with the same role.
package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/whatsyitc/backend/internal/ai/retrieval"
	"github.com/whatsyitc/backend/internal/ai/tools"
	"github.com/whatsyitc/backend/internal/llm"
	"github.com/whatsyitc/backend/internal/models"
)

// Orchestrator is the per-business agent loop. Construct one at
// startup; HandleInbound is safe for concurrent calls.
type Orchestrator struct {
	pool        *pgxpool.Pool
	llm         *llm.Registry
	retriever   *retrieval.Retriever
	registry    *tools.Registry
	sender      Sender
	senderFor   SenderFactory
	humanReview HumanReviewSignalSaver
	maxIters    int
	historyLen  int

	flights sync.Map // phone string -> *sync.Mutex
}

// Sender is the subset of whatsapp.Client the orchestrator uses.
// Kept as an interface so tests can stub it.
type Sender interface {
	SendText(ctx context.Context, to, body string) error
}

// SenderFactory resolves the outbound sender for the admin that owns a
// conversation. This keeps multi-tenant WhatsApp credentials out of the
// long-lived orchestrator instance.
type SenderFactory func(ctx context.Context, adminID int64) (Sender, error)

// HumanReviewSignalSaver persists the internal review signal produced during
// an existing LLM call. The store implements this; the orchestrator depends on
// the tiny interface to avoid a package cycle.
type HumanReviewSignalSaver interface {
	SaveAIHumanReviewSignalForPhone(ctx context.Context, adminUserID int64, phone string, signal models.AIHumanReviewSignal) (int, error)
}

// New builds an Orchestrator with sensible defaults. pass nil sender
// to disable outbound (used in tests and in "no WhatsApp creds" mode
// where the webhook accepts messages but the agent doesn't reply).
func New(pool *pgxpool.Pool, l *llm.Registry, ret *retrieval.Retriever, reg *tools.Registry, sender Sender, senderFor ...SenderFactory) *Orchestrator {
	var factory SenderFactory
	if len(senderFor) > 0 {
		factory = senderFor[0]
	}
	return &Orchestrator{
		pool:       pool,
		llm:        l,
		retriever:  ret,
		registry:   reg,
		sender:     sender,
		senderFor:  factory,
		maxIters:   3,
		historyLen: 20,
	}
}

// SetHumanReviewSignalSaver lets the live agent update the phone-level Human
// Review queue using the same LLM pass that produced a customer reply.
func (o *Orchestrator) SetHumanReviewSignalSaver(s HumanReviewSignalSaver) {
	o.humanReview = s
}

// HandleInbound is the single entry point called by the webhook
// handler for text messages. It runs the full agent loop and returns
// once the reply has been sent (or attempted). Errors are logged,
// not returned — the webhook always 200s Meta.
func (o *Orchestrator) HandleInbound(ctx context.Context, adminID int64, phone, text string) {
	// Single-flight per phone.
	v, _ := o.flights.LoadOrStore(phone, &sync.Mutex{})
	mu := v.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()
	defer o.flights.Delete(phone)

	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	// 1. Conversation.
	convID, convKey, err := o.upsertConversation(ctx, adminID, phone)
	if err != nil {
		slog.Error("orchestrator: upsert conversation", "err", err)
		return
	}
	convStatus, err := o.getConversationStatus(ctx, adminID, convID)
	if err != nil {
		slog.Error("orchestrator: read status", "err", err)
		return
	}

	// Load previous history before saving this inbound message; the
	// LLM request appends the current user text explicitly below.
	history, err := o.loadHistory(ctx, adminID, convKey)
	if err != nil {
		slog.Error("orchestrator: load history", "err", err)
	}

	// Persist the inbound message for the inbox/audit trail.
	if err := o.persistMessage(ctx, adminID, convID, convKey, phone, llm.RoleUser, text, nil); err != nil {
		slog.Error("orchestrator: persist user", "err", err)
	}
	if err := o.bumpCounters(ctx, adminID, convID, "user", text); err != nil {
		slog.Error("orchestrator: bump counters", "err", err)
	}

	// 2. Skip if conversation is handed off.
	if convStatus == "handed_off" {
		slog.Info("orchestrator: conversation handed off, skipping", "conv", convID, "phone", phone)
		return
	}

	// 3. Disabled-agent guard (global).
	enabled, err := o.agentEnabled(ctx, adminID, nil)
	if err != nil {
		slog.Error("orchestrator: read agent enabled", "err", err)
		return
	}
	if !enabled {
		slog.Info("orchestrator: agent disabled, skipping", "conv", convID)
		return
	}

	// 3a. Per-batch disable guard. If this phone has an explicit
	// 'disabled' row in bc_batch_ai_recipients (admin toggled AI off
	// for the batch after the conversation started), respect that
	// and skip. A row in any other ai_status (pending, active,
	// handed_off, opted_out, failed) does NOT block the reply —
	// those carry legitimate conversation state and the global flag
	// already controls whether the agent runs at all.
	//
	// A missing row (no toggle at all) returns false, so the legacy
	// behaviour is preserved for batches that pre-date the per-batch
	// toggle.
	if disabled, derr := o.batchAIDisabledForPhone(ctx, adminID, phone); derr != nil {
		slog.Warn("orchestrator: read per-batch disable, continuing", "err", derr)
	} else if disabled {
		slog.Info("orchestrator: per-batch AI disabled for phone, skipping", "conv", convID, "phone", phone)
		return
	}

	// 4. No LLM configured → graceful skip.
	if !o.llm.Enabled() {
		slog.Info("orchestrator: no LLM configured, skipping", "conv", convID)
		return
	}

	// 6. Load the active agent before retrieval so agent-specific
	// knowledge scopes are honored.
	cfg, err := o.loadAgentConfig(ctx, adminID, nil)
	if err != nil {
		slog.Error("orchestrator: load agent config", "err", err)
		return
	}

	// 7. Retrieve KB chunks.
	var chunks []retrieval.RetrievedChunk
	if o.retriever != nil {
		chunks, err = o.retriever.RetrieveForAgent(ctx, adminID, cfg.ID, text)
		if err != nil {
			slog.Warn("orchestrator: retrieval failed, continuing", "err", err)
		}
	}

	// 8. Build messages + system prompt + tool definitions.
	system := withInlineHumanReviewInstructions(
		BuildSystemPrompt(cfg, history, chunks, convID),
		"Live inbound WhatsApp reply. If the AI can fully answer safely, set requires_review=false. If a human should inspect this phone, set requires_review=true with the reason and next action.",
	)
	toolDefs := o.registry.Definitions(adminID)

	// 9. Decide route.
	topConfidence := topSim(chunks)
	routing := o.llm.Router().Decide(llm.RoutingContext{
		BusinessTier:        "standard",
		RetrievalConfidence: topConfidence,
		HasExactKBMatch:     topConfidence >= cfg.FAQConfidenceThresh && hasKeywordHit(chunks),
		Intent:              classifyIntent(text),
		ConversationLength:  len(history),
	})

	// 10. Tool-call loop.
	messages := append([]llm.Message(nil), historyForLLM(history, chunks)...)
	messages = append(messages, llm.Message{Role: llm.RoleUser, Content: text})

	var finalText string
	var finalModel string
	var finalProvider string
	var finalUsage llm.Usage
	var finalLatencyMs int
	var finalChunks []int64
	var finalReview *models.AIHumanReviewSignal

	for iter := 0; iter < o.maxIters; iter++ {
		started := time.Now()
		resp, err := o.llm.Chat(ctx, llm.ChatRequest{
			Model:       routing.Model,
			System:      system,
			Messages:    messages,
			Tools:       toolDefs,
			Temperature: 0.3,
			MaxTokens:   512,
			BusinessID:  adminID,
			Intent:      classifyIntent(text),
		})
		latencyMs := int(time.Since(started) / time.Millisecond)
		if err != nil {
			slog.Error("orchestrator: llm call", "err", err, "iter", iter)
			finalText = "I'm having trouble right now. Let me connect you with the team."
			finalModel = routing.Model
			break
		}

		// If tool calls present, execute + persist + loop.
		if len(resp.ToolCalls) > 0 {
			for _, tc := range resp.ToolCalls {
				t := o.registry.Get(tc.Name)
				if t == nil {
					slog.Warn("orchestrator: unknown tool", "name", tc.Name)
					continue
				}
				toolRes, terr := t.Execute(ctx, adminID, tc)
				if terr != nil {
					slog.Warn("orchestrator: tool error", "name", tc.Name, "err", terr)
				}
				o.persistTool(ctx, adminID, convID, convKey, phone, tc.Name, string(tc.Args), toolRes.Summary, toolRes.Content, terr)
				messages = append(messages, llm.Message{
					Role:    llm.RoleAssistant,
					Content: "",
					Tags:    map[string]any{"tool_call": tc},
				})
				messages = append(messages, llm.Message{
					Role:    llm.RoleTool,
					Name:    tc.Name,
					ToolID:  tc.ID,
					Content: toolRes.Content,
				})
			}
			o.persistAssistantToolOnly(ctx, adminID, convID, convKey, phone, resp.Text, resp.ToolCalls, resp.Model, resp.Usage, latencyMs)
			continue
		}

		replyText, reviewSignal := parseInlineHumanReviewOutput(resp.Text)
		finalText = replyText
		finalReview = reviewSignal
		finalModel = resp.Model
		finalProvider = resp.Provider
		finalUsage = resp.Usage
		finalLatencyMs = latencyMs
		for _, c := range chunks {
			finalChunks = append(finalChunks, c.ID)
		}
		break
	}

	if finalText == "" {
		finalText = "(no response)"
	}

	o.saveInlineHumanReviewSignal(ctx, adminID, phone, finalReview, finalText, finalModel, firstNonEmpty(finalProvider, routing.Provider), "inbound_reply")

	assistantMsgID, err := o.persistAssistant(ctx, adminID, convID, convKey, phone, finalText, finalModel, finalUsage, finalLatencyMs, finalChunks)
	if err != nil {
		slog.Error("orchestrator: persist assistant", "err", err)
	}
	_ = o.bumpCounters(ctx, adminID, convID, "assistant", finalText)
	o.recordLLMMetric(ctx, adminID, convKey, finalModel, finalUsage, finalLatencyMs, routing, topConfidence, len(finalChunks))

	if err := o.send(ctx, adminID, phone, finalText); err != nil {
		slog.Error("orchestrator: send whatsapp", "err", err)
		_ = o.markAssistantSendFailed(ctx, adminID, assistantMsgID, err)
		_ = o.markWhatsAppCredentialError(ctx, adminID, err)
		o.saveInlineHumanReviewSignal(ctx, adminID, phone, &models.AIHumanReviewSignal{
			RequiresReview:  true,
			Severity:        "critical",
			PriorityScore:   98,
			ReasonCode:      "send_failed",
			ReasonLabel:     "Send failed",
			ReasonDetail:    compactError(err.Error()),
			SuggestedAction: "Fix the WhatsApp sender/token issue, then retry or answer this phone manually.",
			Labels:          []string{"send_failed", "delivery_blocked"},
			Summary:         "AI generated a reply, but WhatsApp delivery failed.",
			NextAction:      "Check credentials and retry from the timeline.",
		}, finalText, finalModel, firstNonEmpty(finalProvider, routing.Provider), "send_failed")
	} else {
		_ = o.markAssistantSendSent(ctx, adminID, assistantMsgID)
	}
}

// ---------------------------------------------------------------------------
// Conversation persistence helpers
// ---------------------------------------------------------------------------

func (o *Orchestrator) upsertConversation(ctx context.Context, adminID int64, phone string) (int64, string, error) {
	key := conversationKey(phone)
	var id int64
	err := o.pool.QueryRow(ctx, `
		INSERT INTO bc_ai_conversation_states
			(admin_user_id, conversation_key, phone, started_at, updated_at, last_message_at)
		VALUES ($1, $2, $3, now(), now(), now())
		ON CONFLICT (admin_user_id, conversation_key) DO UPDATE
		  SET phone = EXCLUDED.phone,
		      updated_at = now(),
		      last_message_at = now()
		RETURNING id
	`, adminID, key, phone).Scan(&id)
	return id, key, err
}

func (o *Orchestrator) getConversationStatus(ctx context.Context, adminID int64, convID int64) (string, error) {
	var s string
	err := o.pool.QueryRow(ctx, `SELECT status FROM bc_ai_conversation_states WHERE id = $1 AND admin_user_id = $2`, convID, adminID).Scan(&s)
	return s, err
}

func (o *Orchestrator) agentEnabled(ctx context.Context, adminID int64, batchID *int64) (bool, error) {
	row, _, err := o.ResolveAgentForCall(ctx, adminID, batchID)
	if err != nil {
		return false, err
	}
	if row.ID == 0 {
		// No agents at all — treat as disabled so the live chat path
		// doesn't try to render a reply with a zero-valued persona.
		return false, nil
	}
	var enabled bool
	if err := o.pool.QueryRow(ctx, `SELECT enabled FROM bc_ai_agents WHERE id = $1`, row.ID).Scan(&enabled); err != nil {
		return false, err
	}
	return enabled, nil
}

// batchAIDisabledForPhone returns true iff there is at least one
// bc_batch_ai_recipients row for (adminID, phone) with
// ai_status = 'disabled'. Used by HandleInbound to honor an
// admin's per-batch "off" decision without requiring them to also
// disable the global agent.
//
// The check is intentionally soft: a missing row (no toggle at all)
// returns false, so the legacy behaviour is preserved for batches
// that pre-date the per-batch toggle.
func (o *Orchestrator) batchAIDisabledForPhone(ctx context.Context, adminID int64, phone string) (bool, error) {
	var found bool
	err := o.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM bc_batch_ai_recipients
			 WHERE admin_user_id = $1
			   AND whatsapp_number = $2
			   AND ai_status = 'disabled'
		)
	`, adminID, phone).Scan(&found)
	if err != nil {
		return false, err
	}
	return found, nil
}

// agentConfigRow is the slim shape the prompt builder needs from
// bc_ai_agents. Keep this stable — BuildSystemPrompt and the follow-up
// prompt builders depend on it.
type agentConfigRow struct {
	ID                  int64
	Name                string
	PersonaMd           string
	Tone                string
	SystemPrompt        string
	FAQConfidenceThresh float64
}

// ResolveAgentForCall picks the agent that should be used for an LLM
// call in the given context.
//
//   - batchID == nil: returns the admin's global default. Used by the
//     live inbound chat path (no batch context available).
//   - batchID != nil: returns the agent assigned to that batch when
//     one is set (source = "batch_override"), otherwise the global
//     default (source = "global_default").
//
// Returns (zeroRow, "none", nil) when the admin has no agents at all.
// Callers should treat "none" as "AI disabled" and short-circuit.
func (o *Orchestrator) ResolveAgentForCall(ctx context.Context, adminID int64, batchID *int64) (agentConfigRow, string, error) {
	// First: if a batch context is supplied and it has an explicit
	// override, load that agent. The override survives changes to the
	// global default — that's the whole point of per-batch assignment.
	if batchID != nil {
		var agentID *int64
		err := o.pool.QueryRow(ctx, `
			SELECT ai_agent_id FROM bc_upload_batches
			WHERE id = $1 AND (uploaded_by = $2 OR uploaded_by IS NULL)
		`, *batchID, adminID).Scan(&agentID)
		if err != nil && err != pgx.ErrNoRows {
			return agentConfigRow{}, "", err
		}
		if err == nil && agentID != nil {
			var row agentConfigRow
			scanErr := o.pool.QueryRow(ctx, `
				SELECT name, persona_md, tone, system_prompt, faq_confidence_threshold
				FROM bc_ai_agents WHERE id = $1 AND admin_user_id = $2
			`, *agentID, adminID).Scan(&row.Name, &row.PersonaMd, &row.Tone, &row.SystemPrompt, &row.FAQConfidenceThresh)
			if scanErr == nil {
				row.ID = *agentID
				return row, "batch_override", nil
			}
			if scanErr != pgx.ErrNoRows {
				return agentConfigRow{}, "", scanErr
			}
			// Assigned agent was deleted — fall through to default.
		}
	}
	// No batch override: use the admin's global default.
	var row agentConfigRow
	err := o.pool.QueryRow(ctx, `
		SELECT id, name, persona_md, tone, system_prompt, faq_confidence_threshold
		FROM bc_ai_agents
		WHERE admin_user_id = $1 AND is_default = TRUE
		LIMIT 1
	`, adminID).Scan(&row.ID, &row.Name, &row.PersonaMd, &row.Tone, &row.SystemPrompt, &row.FAQConfidenceThresh)
	if err == pgx.ErrNoRows {
		return agentConfigRow{}, "none", nil
	}
	if err != nil {
		return agentConfigRow{}, "", err
	}
	return row, "global_default", nil
}

func (o *Orchestrator) loadAgentConfig(ctx context.Context, adminID int64, batchID *int64) (agentConfigRow, error) {
	row, _, err := o.ResolveAgentForCall(ctx, adminID, batchID)
	if err != nil {
		return agentConfigRow{}, err
	}
	if row.ID == 0 {
		// No agents configured yet — return a sane default so prompts
		// still build and the test playground renders.
		return agentConfigRow{
			Name:                "Assistant",
			Tone:                "friendly",
			SystemPrompt:        "You are a helpful WhatsApp assistant.",
			FAQConfidenceThresh: 0.92,
		}, nil
	}
	return row, nil
}

func (o *Orchestrator) loadHistory(ctx context.Context, adminID int64, convKey string) ([]llm.Message, error) {
	rows, err := o.pool.Query(ctx, `
		SELECT role, content FROM (
			SELECT role, content, created_at FROM bc_ai_conversation_messages
			WHERE admin_user_id = $1 AND conversation_key = $2 AND role IN ('user', 'assistant')
			ORDER BY created_at DESC LIMIT $3
		) recent ORDER BY created_at ASC
	`, adminID, convKey, o.historyLen)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []llm.Message{}
	for rows.Next() {
		var role, content string
		_ = rows.Scan(&role, &content)
		// Skip empty assistant messages (they were tool-call-only turns).
		if role == "assistant" && content == "" {
			continue
		}
		out = append(out, llm.Message{
			Role:    llm.Role(role),
			Content: content,
		})
	}
	return out, nil
}

func (o *Orchestrator) persistMessage(ctx context.Context, adminID, convID int64, convKey, phone string, role llm.Role, content string, meta json.RawMessage) error {
	_, err := o.pool.Exec(ctx, `
		INSERT INTO bc_ai_conversation_messages
			(admin_user_id, conversation_key, conversation_id, phone, role, content, tool_calls)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, adminID, convKey, convID, phone, string(role), content, meta)
	return err
}

func (o *Orchestrator) persistTool(ctx context.Context, adminID, convID int64, convKey, phone, name, args, summary, content string, runErr error) {
	meta := map[string]any{
		"tool_name": name,
		"args":      args,
		"summary":   summary,
		"result":    content,
	}
	if runErr != nil {
		meta["error"] = runErr.Error()
	}
	raw, _ := json.Marshal(meta)
	_, _ = o.pool.Exec(ctx, `
		INSERT INTO bc_ai_conversation_messages
			(admin_user_id, conversation_key, conversation_id, phone, role, content, tool_calls, tool_summary)
		VALUES ($1, $2, $3, $4, 'tool', $5, $6, $7)
	`, adminID, convKey, convID, phone, summary, raw, summary)
}

func (o *Orchestrator) persistAssistantToolOnly(ctx context.Context, adminID, convID int64, convKey, phone, content string, calls []llm.ToolCall, model string, usage llm.Usage, latencyMs int) {
	meta := map[string]any{
		"tool_calls": calls,
		"model":      model,
		"usage":      usage,
		"latency_ms": latencyMs,
	}
	raw, _ := json.Marshal(meta)
	_, _ = o.pool.Exec(ctx, `
		INSERT INTO bc_ai_conversation_messages
			(admin_user_id, conversation_key, conversation_id, phone, role, content, model_used, tokens_in, tokens_out, latency_ms, tool_calls)
		VALUES ($1, $2, $3, $4, 'assistant', $5, $6, $7, $8, $9, $10)
	`, adminID, convKey, convID, phone, content, model, usage.InputTokens, usage.OutputTokens, latencyMs, raw)
}

func (o *Orchestrator) persistAssistant(ctx context.Context, adminID, convID int64, convKey, phone, content, model string, usage llm.Usage, latencyMs int, chunkIDs []int64) (int64, error) {
	cost := llm.CostFor(model, usage)
	var id int64
	err := o.pool.QueryRow(ctx, `
		INSERT INTO bc_ai_conversation_messages
			(admin_user_id, conversation_key, conversation_id, phone, role, content, model_used, tokens_in, tokens_out, cost_usd, latency_ms, retrieved_chunk_ids)
		VALUES ($1, $2, $3, $4, 'assistant', $5, $6, $7, $8, $9, $10, $11)
		RETURNING id
	`, adminID, convKey, convID, phone, content, model, usage.InputTokens, usage.OutputTokens, cost, latencyMs, chunkIDs).Scan(&id)
	return id, err
}

func (o *Orchestrator) bumpCounters(ctx context.Context, adminID int64, convID int64, role, preview string) error {
	col := "ai_handled_count"
	direction := "outbound"
	if role == "human" || role == "tool" {
		col = "human_handled_count"
	}
	if role == "user" {
		direction = "inbound"
	}
	_, err := o.pool.Exec(ctx, `
		UPDATE bc_ai_conversation_states
		SET `+col+` = `+col+` + 1,
		    last_message_at = now(),
		    last_message_preview = $3,
		    last_message_role = $4,
		    last_message_direction = $5,
		    updated_at = now()
		WHERE id = $1 AND admin_user_id = $2
	`, convID, adminID, compactPreview(preview), role, direction)
	return err
}

func (o *Orchestrator) recordLLMMetric(ctx context.Context, adminID int64, convKey, model string, usage llm.Usage, latencyMs int, decision llm.RoutingDecision, confidence float64, retrievedChunks int) {
	if model == "" {
		return
	}
	cost := llm.CostFor(model, usage)
	_, _ = o.pool.Exec(ctx, `
		INSERT INTO bc_ai_llm_metrics
			(admin_user_id, conversation_key, provider, model, input_tokens, output_tokens, cost_usd, latency_ms, intent, confidence, retrieved_chunks)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, adminID, convKey, decision.Provider, model, usage.InputTokens, usage.OutputTokens, cost, latencyMs, decision.Reason, confidence, retrievedChunks)
}

func (o *Orchestrator) saveInlineHumanReviewSignal(ctx context.Context, adminID int64, phone string, signal *models.AIHumanReviewSignal, customerReply, model, provider, sourceLabel string) {
	if o.humanReview == nil || signal == nil || adminID <= 0 || strings.TrimSpace(phone) == "" {
		return
	}
	sig := *signal
	sig.Model = strings.TrimSpace(model)
	sig.Provider = strings.TrimSpace(provider)
	sig.Source = "llm_inline"
	if strings.TrimSpace(sourceLabel) != "" {
		sig.Labels = append(sig.Labels, strings.TrimSpace(sourceLabel))
	}
	if sig.RequiresReview && strings.TrimSpace(sig.SuggestedReply) == "" {
		sig.SuggestedReply = strings.TrimSpace(customerReply)
	}
	if _, err := o.humanReview.SaveAIHumanReviewSignalForPhone(ctx, adminID, phone, sig); err != nil {
		slog.Warn("orchestrator: save human review signal", "phone", phone, "source", sourceLabel, "err", err)
	}
}

func (o *Orchestrator) markAssistantSendFailed(ctx context.Context, adminID, msgID int64, sendErr error) error {
	if msgID <= 0 || sendErr == nil {
		return nil
	}
	_, err := o.pool.Exec(ctx, `
		UPDATE bc_ai_conversation_messages
		SET send_status = 'failed',
		    send_error = $3
		WHERE id = $1 AND admin_user_id = $2 AND role = 'assistant'
	`, msgID, adminID, compactError(sendErr.Error()))
	return err
}

func (o *Orchestrator) markAssistantSendSent(ctx context.Context, adminID, msgID int64) error {
	if msgID <= 0 {
		return nil
	}
	_, err := o.pool.Exec(ctx, `
		UPDATE bc_ai_conversation_messages
		SET send_status = 'sent',
		    send_error = NULL,
		    sent_at = COALESCE(sent_at, now())
		WHERE id = $1 AND admin_user_id = $2 AND role = 'assistant'
	`, msgID, adminID)
	return err
}

func (o *Orchestrator) markWhatsAppCredentialError(ctx context.Context, adminID int64, sendErr error) error {
	if adminID <= 0 || sendErr == nil {
		return nil
	}
	_, err := o.pool.Exec(ctx, `
		UPDATE bc_whatsapp_credentials
		SET is_verified = false,
		    verified_at = NULL,
		    last_error = $2,
		    updated_at = now()
		WHERE admin_user_id = $1 AND removed_at IS NULL
	`, adminID, compactError(sendErr.Error()))
	return err
}

func conversationKey(phone string) string {
	return "phone:" + strings.TrimSpace(phone)
}

func compactPreview(s string) string {
	s = strings.TrimSpace(s)
	runes := []rune(s)
	if len(runes) <= 240 {
		return s
	}
	return strings.TrimSpace(string(runes[:240]))
}

func compactError(s string) string {
	s = strings.TrimSpace(s)
	runes := []rune(s)
	if len(runes) <= 1000 {
		return s
	}
	return strings.TrimSpace(string(runes[:1000]))
}

// send is a thin wrapper around Sender so we can add retries later.
func (o *Orchestrator) send(ctx context.Context, adminID int64, phone, text string) error {
	if o.senderFor != nil {
		sender, err := o.senderFor(ctx, adminID)
		if err != nil {
			return err
		}
		if sender == nil {
			return nil
		}
		return sender.SendText(ctx, phone, text)
	}
	if o.sender == nil {
		return nil
	}
	return o.sender.SendText(ctx, phone, text)
}

// topSim returns the strongest retrieval confidence. In Bedrock-only
// deployments retrieval is keyword-only, so FinalScore is the useful
// signal and VectorSim remains zero.
func topSim(chunks []retrieval.RetrievedChunk) float64 {
	top := 0.0
	for _, c := range chunks {
		score := c.FinalScore
		if c.VectorSim > score {
			score = c.VectorSim
		}
		if score > top {
			top = score
		}
	}
	return top
}

// hasKeywordHit returns true when at least one retrieved chunk has a
// non-trivial keyword overlap. Used by the router's exact-match
// heuristic.
func hasKeywordHit(chunks []retrieval.RetrievedChunk) bool {
	for _, c := range chunks {
		if c.KeywordSim >= 0.1 {
			return true
		}
	}
	return false
}

// classifyIntent is a small rule-based classifier — used by the
// router. Same shape as the legacy code; if you change one, change
// both.
func classifyIntent(msg string) string {
	m := strings.ToLower(strings.TrimSpace(msg))
	switch {
	case strings.Contains(m, "price") || strings.Contains(m, "cost") || strings.Contains(m, "kitna") || strings.Contains(m, "kya"):
		return "pricing"
	case strings.Contains(m, "buy") || strings.Contains(m, "order") || strings.Contains(m, "purchase"):
		return "purchase"
	case strings.Contains(m, "refund") || strings.Contains(m, "return") || strings.Contains(m, "complaint"):
		return "objection"
	case strings.Contains(m, "human") || strings.Contains(m, "agent") || strings.Contains(m, "call me") || strings.Contains(m, "person"):
		return "handoff_request"
	default:
		return "general"
	}
}

func historyForLLM(history []llm.Message, chunks []retrieval.RetrievedChunk) []llm.Message {
	if len(chunks) > 0 {
		return nil
	}
	return history
}

// Compile-time guard.
var _ = fmt.Sprintf
var _ = json.Marshal
