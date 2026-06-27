package handlers

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/whatsyitc/backend/internal/audit"
	"github.com/whatsyitc/backend/internal/llm"
	"github.com/whatsyitc/backend/internal/middleware"
	"github.com/whatsyitc/backend/internal/models"
	"github.com/whatsyitc/backend/internal/store"
)

// GetBatchAIFollowup returns the per-batch AI follow-up flag and the
// rolled-up recipient list with per-phone AI status. Used by the
// "AI agent activity" panel on the Upload page.
//
// Admin-scoped: a cross-tenant batch id returns 404 (the store helper
// treats "not owned" as "no rows").
func (s *Server) GetBatchAIFollowup(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	batch, err := s.Store.GetBatch(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if batch == nil {
		writeErr(w, http.StatusNotFound, "batch not found")
		return
	}
	recipients, err := s.Store.ListBatchAIRecipients(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	byStatus := map[string]int{}
	for _, rec := range recipients {
		byStatus[rec.AIStatus]++
	}
	writeJSON(w, http.StatusOK, models.BatchAIFollowup{
		BatchID:            batch.ID,
		BatchStatus:        batch.Status,
		Enabled:            batch.AIFollowupEnabled,
		EnabledAt:          batch.AIFollowupEnabledAt,
		Recipients:         recipients,
		RecipientsTotal:    len(recipients),
		RecipientsByStatus: byStatus,
	})
}

type putBatchAIFollowupReq struct {
	Enabled *bool `json:"enabled"`
}

// PutBatchAIFollowup toggles the per-batch AI follow-up flag. On
// enable, the store back-fills bc_batch_ai_recipients with one row per
// valid recipient; on disable, any rows that haven't seen real agent
// activity yet are marked 'disabled' (history of already-active
// conversations is preserved).
//
// The store helper is admin-scoped — a cross-tenant batch id returns
// 404 here as well.
func (s *Server) PutBatchAIFollowup(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req putBatchAIFollowupReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if req.Enabled == nil {
		writeErr(w, http.StatusBadRequest, "enabled is required")
		return
	}
	res, err := s.Store.SetBatchAIFollowup(r.Context(), uid, id, *req.Enabled)
	if err != nil {
		// The flag still flipped to true, but the back-fill found
		// zero valid WhatsApp numbers. Surface a 422 with a clear
		// message + the current batch state so the UI can decide
		// whether to roll back the optimistic toggle.
		if errors.Is(err, store.ErrNoRecipientsToTrack) {
			batch, _ := s.Store.GetBatch(r.Context(), uid, id)
			recipients, _ := s.Store.ListBatchAIRecipients(r.Context(), uid, id)
			byStatus := map[string]int{}
			for _, rec := range recipients {
				byStatus[rec.AIStatus]++
			}
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"error":                 "no_valid_recipients",
				"message":               "AI follow-up was enabled, but this batch has no valid WhatsApp numbers to track. The flag is on but the agent will not see any recipients for this batch.",
				"recipients_backfilled": res.RecipientsBackfilled,
				"followup": models.BatchAIFollowup{
					BatchID:            batch.ID,
					BatchStatus:        batch.Status,
					Enabled:            batch.AIFollowupEnabled,
					EnabledAt:          batch.AIFollowupEnabledAt,
					Recipients:         recipients,
					RecipientsTotal:    len(recipients),
					RecipientsByStatus: byStatus,
				},
			})
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if res == nil || res.Batch == nil {
		writeErr(w, http.StatusNotFound, "batch not found")
		return
	}
	batch := res.Batch
	// Audit log — this is an admin-controlled change that affects
	// who the AI agent will (or will not) auto-reply to.
	if _, err := s.Store.RefreshAIHumanReviewQueue(r.Context(), uid, 2000); err != nil {
		log.Printf("[ai-followup] refresh human review after toggle batch=%d admin=%d: %v", id, uid, err)
	}

	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch.ai_followup.toggled", EntityType: strPtr("upload_batch"),
		EntityID: &batch.ID,
		Metadata: map[string]any{
			"enabled":               batch.AIFollowupEnabled,
			"batch_id":              batch.ID,
			"batch_status":          batch.Status,
			"recipients_backfilled": res.RecipientsBackfilled,
		},
	})
	// Return the same shape as GET so the frontend can update state
	// in a single round-trip.
	recipients, err := s.Store.ListBatchAIRecipients(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	byStatus := map[string]int{}
	for _, rec := range recipients {
		byStatus[rec.AIStatus]++
	}
	writeJSON(w, http.StatusOK, models.BatchAIFollowup{
		BatchID:            batch.ID,
		BatchStatus:        batch.Status,
		Enabled:            batch.AIFollowupEnabled,
		EnabledAt:          batch.AIFollowupEnabledAt,
		Recipients:         recipients,
		RecipientsTotal:    len(recipients),
		RecipientsByStatus: byStatus,
	})
}

// ListBatchAIFollowups is the cross-batch operator queue used by the
// /admin/ai/followups sidebar page. It returns the union of every
// bc_batch_ai_recipients row owned by the caller, with optional
// filters on status, batch_id, and a free-text search over retailer
// name / phone.
//
// Response shape mirrors the existing ListAIConversations endpoint:
//
//	{ "items": [...BatchAIRecipient], "total": N }
//
// Admin-scoped: the underlying store helper pins admin_user_id on
// every query, so cross-tenant rows are never returned.
func (s *Server) ListBatchAIFollowups(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	status := r.URL.Query().Get("status")
	search := r.URL.Query().Get("search")
	limit := intParam(r, "limit", 100)
	offset := intParam(r, "offset", 0)

	var batchID int64
	if v := r.URL.Query().Get("batch_id"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			writeErr(w, http.StatusBadRequest, "bad batch_id")
			return
		}
		batchID = n
	}

	items, total, err := s.Store.ListBatchAIRecipientsAll(r.Context(), uid, status, batchID, search, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items,
		"total": total,
	})
}

type batchAICRMSummaryResponse struct {
	ID                int64                    `json:"id,omitempty"`
	BatchID           int64                    `json:"batch_id,omitempty"`
	Summary           string                   `json:"summary"`
	Mood              string                   `json:"mood"`
	BuyerIntent       string                   `json:"buyer_intent"`
	ActionRequired    bool                     `json:"action_required"`
	ActionReason      string                   `json:"action_reason"`
	PriorityScore     int                      `json:"priority_score"`
	RecommendedAction string                   `json:"recommended_action"`
	WhatHappened      []string                 `json:"what_happened"`
	Risks             []string                 `json:"risks"`
	NextActions       []string                 `json:"next_actions"`
	WarmLeads         []models.BatchAIWarmLead `json:"warm_leads"`
	Labels            []string                 `json:"labels"`
	HistoryLimit      int                      `json:"history_limit"`
	HistoryUsed       int                      `json:"history_used"`
	GeneratedAt       time.Time                `json:"generated_at"`
	LastAnalyzedAt    time.Time                `json:"last_analyzed_at"`
	LastMessageAt     *time.Time               `json:"last_message_at,omitempty"`
	Model             string                   `json:"model"`
	Provider          string                   `json:"provider"`
	GenerationError   string                   `json:"generation_error,omitempty"`
}

// ListBatchAICRMInsights returns the saved summary/action intelligence
// for the AI follow-up CRM overview. It intentionally does not call the
// LLM; the frontend can trigger controlled refreshes for missing/stale
// batches while this endpoint remains fast.
func (s *Server) ListBatchAICRMInsights(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	limit := intParam(r, "limit", 200)
	items, err := s.Store.ListBatchAIInsights(r.Context(), uid, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items,
		"total": len(items),
	})
}

// GenerateBatchAICRMSummary summarizes the most recent 10 or 20 real
// WhatsApp/AI conversation messages for one batch. The LLM registry
// prefers Bedrock when configured, so this endpoint uses Bedrock without
// the handler knowing provider-specific auth details. Successful runs are
// saved in bc_batch_ai_insights so the AI CRM overview can reuse them.
func (s *Server) GenerateBatchAICRMSummary(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	batchID, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	historyLimit := intParam(r, "history_limit", 20)
	if historyLimit != 10 && historyLimit != 20 {
		historyLimit = 20
	}

	batch, err := s.Store.GetBatch(r.Context(), uid, batchID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	batchFileName := fmt.Sprintf("Batch #%d", batchID)
	if batch != nil && strings.TrimSpace(batch.FileName) != "" {
		batchFileName = strings.TrimSpace(batch.FileName)
	}

	recipients, err := s.Store.ListBatchAIRecipients(r.Context(), uid, batchID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if batch == nil && len(recipients) == 0 {
		writeErr(w, http.StatusNotFound, "batch not found or no AI follow-up recipients")
		return
	}
	messages, err := s.Store.ListBatchAIRecentMessages(r.Context(), uid, batchID, historyLimit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	var lastMessageAt *time.Time
	if len(messages) > 0 {
		t := messages[len(messages)-1].CreatedAt
		lastMessageAt = &t
	}
	if len(messages) == 0 {
		summary := batchAICRMSummaryResponse{
			BatchID:           batchID,
			Summary:           "No conversation messages are available for this batch yet.",
			Mood:              "quiet",
			BuyerIntent:       "unknown",
			WhatHappened:      []string{"AI is tracking the batch, but no recent WhatsApp conversation messages were found."},
			Risks:             []string{"There is not enough chat history to judge buyer intent."},
			NextActions:       []string{"Send or wait for the first buyer message, then generate the summary again."},
			WarmLeads:         []models.BatchAIWarmLead{},
			Labels:            []string{"no_chat_history"},
			HistoryLimit:      historyLimit,
			HistoryUsed:       0,
			GeneratedAt:       time.Now().UTC(),
			LastAnalyzedAt:    time.Now().UTC(),
			LastMessageAt:     nil,
			Model:             "local-empty",
			Provider:          "local",
			ActionRequired:    false,
			PriorityScore:     20,
			RecommendedAction: "Wait for the first buyer reply or verify that the first AI touch is scheduled.",
		}
		applyBatchAICRMSignals(&summary, recipients)
		if saved, err := s.Store.UpsertBatchAIInsight(r.Context(), batchAIInsightModel(uid, batchID, summary)); err == nil && saved != nil {
			summary = batchAICRMSummaryFromModel(saved)
		}
		writeJSON(w, http.StatusOK, summary)
		return
	}
	if s.LLM == nil || !s.LLM.Enabled() {
		_ = s.Store.MarkBatchAIInsightError(r.Context(), uid, batchID, "Bedrock/LLM is not configured")
		writeErr(w, http.StatusServiceUnavailable, "Bedrock/LLM is not configured")
		return
	}

	var batchIDPtr *int64 = &batchID
	agent, source, err := s.Store.GetEffectiveAgent(r.Context(), uid, batchIDPtr)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	agentName := "No agent"
	if agent != nil && strings.TrimSpace(agent.Name) != "" {
		agentName = strings.TrimSpace(agent.Name)
	}

	decision := s.LLM.Router().Decide(llm.RoutingContext{
		BusinessTier:       "standard",
		QueryComplexity:    0.62,
		Intent:             "batch_crm_summary",
		ConversationLength: len(messages),
	})
	resp, err := s.LLM.Chat(r.Context(), llm.ChatRequest{
		Model:       decision.Model,
		System:      buildBatchAICRMSummarySystemPrompt(),
		Messages:    []llm.Message{{Role: llm.RoleUser, Content: buildBatchAICRMSummaryUserPrompt(batchID, batchFileName, agentName, source, recipients, messages)}},
		Temperature: 0.2,
		MaxTokens:   850,
		BusinessID:  uid,
		Intent:      "batch_crm_summary",
	})
	if err != nil {
		_ = s.Store.MarkBatchAIInsightError(r.Context(), uid, batchID, err.Error())
		writeErr(w, http.StatusBadGateway, "Bedrock summary failed: "+err.Error())
		return
	}

	summary := parseBatchAICRMSummary(resp.Text)
	summary.BatchID = batchID
	summary.HistoryLimit = historyLimit
	summary.HistoryUsed = len(messages)
	summary.GeneratedAt = time.Now().UTC()
	summary.LastAnalyzedAt = summary.GeneratedAt
	summary.LastMessageAt = lastMessageAt
	summary.Model = resp.Model
	if summary.Model == "" {
		summary.Model = decision.Model
	}
	summary.Provider = resp.Provider
	if summary.Provider == "" {
		summary.Provider = decision.Provider
	}
	applyBatchAICRMSignals(&summary, recipients)
	if saved, err := s.Store.UpsertBatchAIInsight(r.Context(), batchAIInsightModel(uid, batchID, summary)); err == nil && saved != nil {
		summary = batchAICRMSummaryFromModel(saved)
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, "save AI summary: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func buildBatchAICRMSummarySystemPrompt() string {
	return strings.TrimSpace(`
You are a senior CRM analyst for WhatsApp AI follow-ups.

You will receive batch metadata, recipient status counts, and the most recent real conversation messages from one uploaded batch. Produce a short, practical summary for an admin who needs to decide what to do next.

Rules:
- Use only the supplied messages and metadata. Do not invent products, prices, commitments, names, or outcomes.
- Distinguish buyer/customer messages from AI/human business replies.
- Prefer operational clarity over long explanation.
- Mention buyer intent only when it is visible in the messages; otherwise say "unknown" or "low signal".
- Highlight hot leads, risks, failed sends, handoffs, objections, and next actions.
- Set action_required=true when the operator should do something now: buyer replied, send failed, human handoff, complaint, strong purchase intent, pricing/order question, or the batch is blocked.
- Return valid JSON only. No Markdown. No extra text.

JSON schema:
{
  "summary": "2-3 short sentences max",
  "mood": "quiet | warm | urgent | blocked | mixed",
  "buyer_intent": "short phrase",
  "action_required": true,
  "action_reason": "why the operator should act now, or empty string",
  "priority_score": 0,
  "recommended_action": "one concrete next action",
  "what_happened": ["max 4 concise bullets"],
  "risks": ["max 4 concise bullets"],
  "next_actions": ["max 4 concise bullets"],
  "warm_leads": [
    {"phone": "phone number", "name": "retailer name or empty", "reason": "why this is warm or important"}
  ],
  "labels": ["max 5 snake_case labels such as hot_lead, price_question, complaint, human_needed, send_failed, no_reply"]
}`)
}

func buildBatchAICRMSummaryUserPrompt(
	batchID int64,
	fileName string,
	agentName string,
	agentSource string,
	recipients []models.BatchAIRecipient,
	messages []store.BatchAIRecentMessage,
) string {
	counts := map[string]int{}
	for _, r := range recipients {
		counts[r.AIStatus]++
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Batch ID: %d\n", batchID)
	fmt.Fprintf(&b, "File: %s\n", strings.TrimSpace(fileName))
	fmt.Fprintf(&b, "Resolved AI agent: %s (%s)\n", strings.TrimSpace(agentName), strings.TrimSpace(agentSource))
	fmt.Fprintf(&b, "Tracked recipients: %d\n", len(recipients))
	fmt.Fprintf(&b, "Recipient status counts: pending=%d active=%d handed_off=%d failed=%d opted_out=%d excluded=%d disabled=%d\n\n",
		counts["pending"], counts["active"], counts["handed_off"], counts["failed"], counts["opted_out"], counts["excluded"], counts["disabled"])
	fmt.Fprintf(&b, "Recent conversation messages, oldest to newest. These are the ONLY facts you may use:\n")
	for i, m := range messages {
		name := strings.TrimSpace(m.RetailerName)
		if name == "" {
			name = "Unknown retailer"
		}
		role := crmSummaryRoleLabel(m.Role)
		content := strings.TrimSpace(m.Content)
		if len([]rune(content)) > 900 {
			content = string([]rune(content)[:900]) + "..."
		}
		fmt.Fprintf(&b, "%d. [%s] %s %s (%s, status=%s): %s",
			i+1, m.CreatedAt.Format(time.RFC3339), name, m.Phone, role, m.AIStatus, content)
		if strings.TrimSpace(m.SendStatus) != "" && strings.TrimSpace(m.SendStatus) != "stored" {
			fmt.Fprintf(&b, " [send_status=%s]", strings.TrimSpace(m.SendStatus))
		}
		if strings.TrimSpace(m.SendError) != "" {
			fmt.Fprintf(&b, " [send_error=%s]", strings.TrimSpace(m.SendError))
		}
		b.WriteString("\n")
	}
	return b.String()
}

func crmSummaryRoleLabel(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "user":
		return "buyer"
	case "assistant":
		return "ai"
	case "human":
		return "human"
	case "system":
		return "system"
	case "tool":
		return "tool"
	default:
		if strings.TrimSpace(role) == "" {
			return "unknown"
		}
		return strings.TrimSpace(role)
	}
}

func parseBatchAICRMSummary(raw string) batchAICRMSummaryResponse {
	clean := strings.TrimSpace(raw)
	var out batchAICRMSummaryResponse
	if err := json.Unmarshal([]byte(clean), &out); err != nil {
		if start := strings.Index(clean, "{"); start >= 0 {
			if end := strings.LastIndex(clean, "}"); end > start {
				_ = json.Unmarshal([]byte(clean[start:end+1]), &out)
			}
		}
	}
	if strings.TrimSpace(out.Summary) == "" {
		out.Summary = fallbackSummaryText(clean)
	}
	out.Mood = normalizeShortField(out.Mood, "mixed")
	out.BuyerIntent = normalizeShortField(out.BuyerIntent, "unknown")
	out.ActionReason = normalizeShortField(out.ActionReason, "")
	out.RecommendedAction = normalizeShortField(out.RecommendedAction, "")
	if out.PriorityScore < 0 {
		out.PriorityScore = 0
	}
	if out.PriorityScore > 100 {
		out.PriorityScore = 100
	}
	out.WhatHappened = normalizeStringList(out.WhatHappened, 4)
	out.Risks = normalizeStringList(out.Risks, 4)
	out.NextActions = normalizeStringList(out.NextActions, 4)
	out.WarmLeads = normalizeWarmLeads(out.WarmLeads, 5)
	out.Labels = normalizeLabels(out.Labels, 5)
	if len(out.WhatHappened) == 0 {
		out.WhatHappened = []string{"Bedrock generated a summary from the recent batch conversation feed."}
	}
	if len(out.Risks) == 0 {
		out.Risks = []string{"No specific risk was visible in the supplied message window."}
	}
	if len(out.NextActions) == 0 {
		out.NextActions = []string{"Review the warmest replies and continue monitoring the batch."}
	}
	if out.RecommendedAction == "" && len(out.NextActions) > 0 {
		out.RecommendedAction = out.NextActions[0]
	}
	return out
}

func normalizeShortField(v, fallback string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return fallback
	}
	if len([]rune(v)) > 140 {
		return string([]rune(v)[:140])
	}
	return v
}

func normalizeStringList(items []string, max int) []string {
	out := []string{}
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if len([]rune(item)) > 220 {
			item = string([]rune(item)[:220])
		}
		out = append(out, item)
		if len(out) >= max {
			break
		}
	}
	return out
}

func normalizeWarmLeads(items []models.BatchAIWarmLead, max int) []models.BatchAIWarmLead {
	out := []models.BatchAIWarmLead{}
	for _, item := range items {
		item.Phone = strings.TrimSpace(item.Phone)
		item.Name = strings.TrimSpace(item.Name)
		item.Reason = strings.TrimSpace(item.Reason)
		if item.Phone == "" && item.Name == "" && item.Reason == "" {
			continue
		}
		if len([]rune(item.Reason)) > 180 {
			item.Reason = string([]rune(item.Reason)[:180])
		}
		out = append(out, item)
		if len(out) >= max {
			break
		}
	}
	if out == nil {
		return []models.BatchAIWarmLead{}
	}
	return out
}

func normalizeLabels(items []string, max int) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, item := range items {
		item = strings.ToLower(strings.TrimSpace(item))
		item = strings.NewReplacer(" ", "_", "-", "_", "/", "_").Replace(item)
		item = strings.Trim(item, "_")
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		out = append(out, item)
		if len(out) >= max {
			break
		}
	}
	if out == nil {
		return []string{}
	}
	return out
}

func fallbackSummaryText(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "Bedrock returned an empty summary. Try again after more conversation messages are available."
	}
	if len([]rune(raw)) > 500 {
		return string([]rune(raw)[:500])
	}
	return raw
}

func applyBatchAICRMSignals(summary *batchAICRMSummaryResponse, recipients []models.BatchAIRecipient) {
	if summary == nil {
		return
	}
	failed := 0
	handedOff := 0
	inbound := 0
	waitingFirstTouch := 0
	active := 0
	for _, r := range recipients {
		switch strings.TrimSpace(r.AIStatus) {
		case "failed":
			failed++
		case "handed_off":
			handedOff++
		case "active":
			active++
		}
		if r.LastMessageDirection == "in" {
			inbound++
		}
		if r.AIStatus == "pending" && strings.TrimSpace(r.LastMessagePreview) == "" {
			waitingFirstTouch++
		}
	}

	addLabel := func(label string) {
		label = strings.TrimSpace(label)
		if label == "" {
			return
		}
		for _, existing := range summary.Labels {
			if existing == label {
				return
			}
		}
		if len(summary.Labels) < 5 {
			summary.Labels = append(summary.Labels, label)
		}
	}
	setAction := func(score int, reason, action, label string) {
		if score > summary.PriorityScore || !summary.ActionRequired {
			summary.ActionRequired = true
			summary.PriorityScore = score
			summary.ActionReason = reason
			summary.RecommendedAction = action
		}
		addLabel(label)
	}

	if failed > 0 {
		setAction(96, fmt.Sprintf("%d send failure%s need review", failed, pluralSuffix(failed)), "Open failed timelines, fix the send reason, then retry only affected phones.", "send_failed")
	}
	if handedOff > 0 {
		setAction(92, fmt.Sprintf("%d human handoff%s need a reply", handedOff, pluralSuffix(handedOff)), "Reply to human handoffs from the inbox before the batch sends more automation.", "human_needed")
	}
	if inbound > 0 {
		setAction(84, fmt.Sprintf("%d buyer repl%s should be handled", inbound, replySuffix(inbound)), "Open buyer replies first; these are the warmest leads in this batch.", "buyer_replied")
		addLabel("hot_lead")
	}
	if len(summary.WarmLeads) > 0 {
		setAction(maxInt(summary.PriorityScore, 80), "Bedrock found warm leads in recent messages", "Review the warm leads and reply before the next cadence touch.", "hot_lead")
	}
	if !summary.ActionRequired && waitingFirstTouch > 0 && active == 0 {
		setAction(46, fmt.Sprintf("%d phone%s still need the first AI touch", waitingFirstTouch, pluralSuffix(waitingFirstTouch)), "Verify the first message/cadence so the batch starts cleanly.", "first_touch_due")
	}
	if !summary.ActionRequired {
		if summary.PriorityScore == 0 {
			summary.PriorityScore = 25
		}
		if summary.RecommendedAction == "" {
			summary.RecommendedAction = "Keep monitoring this batch until a buyer replies or a send fails."
		}
		addLabel("monitor")
	}
	if summary.ActionRequired && summary.ActionReason == "" {
		summary.ActionReason = "Recent batch activity needs operator review"
	}
	if summary.RecommendedAction == "" && len(summary.NextActions) > 0 {
		summary.RecommendedAction = summary.NextActions[0]
	}
	if summary.ActionRequired && len(summary.NextActions) < 4 && summary.RecommendedAction != "" {
		already := false
		for _, action := range summary.NextActions {
			if action == summary.RecommendedAction {
				already = true
				break
			}
		}
		if !already {
			summary.NextActions = append([]string{summary.RecommendedAction}, summary.NextActions...)
			summary.NextActions = normalizeStringList(summary.NextActions, 4)
		}
	}
	summary.Labels = normalizeLabels(summary.Labels, 5)
}

func batchAIInsightModel(adminUserID, batchID int64, summary batchAICRMSummaryResponse) *models.BatchAIInsight {
	return &models.BatchAIInsight{
		ID:                summary.ID,
		AdminUserID:       adminUserID,
		BatchID:           batchID,
		Summary:           summary.Summary,
		Mood:              summary.Mood,
		BuyerIntent:       summary.BuyerIntent,
		ActionRequired:    summary.ActionRequired,
		ActionReason:      summary.ActionReason,
		PriorityScore:     summary.PriorityScore,
		RecommendedAction: summary.RecommendedAction,
		WhatHappened:      summary.WhatHappened,
		Risks:             summary.Risks,
		NextActions:       summary.NextActions,
		WarmLeads:         summary.WarmLeads,
		Labels:            summary.Labels,
		HistoryLimit:      summary.HistoryLimit,
		HistoryUsed:       summary.HistoryUsed,
		Model:             summary.Model,
		Provider:          summary.Provider,
		LastMessageAt:     summary.LastMessageAt,
		LastAnalyzedAt:    summary.LastAnalyzedAt,
		GeneratedAt:       summary.GeneratedAt,
		GenerationError:   summary.GenerationError,
	}
}

func batchAICRMSummaryFromModel(in *models.BatchAIInsight) batchAICRMSummaryResponse {
	if in == nil {
		return batchAICRMSummaryResponse{}
	}
	return batchAICRMSummaryResponse{
		ID:                in.ID,
		BatchID:           in.BatchID,
		Summary:           in.Summary,
		Mood:              in.Mood,
		BuyerIntent:       in.BuyerIntent,
		ActionRequired:    in.ActionRequired,
		ActionReason:      in.ActionReason,
		PriorityScore:     in.PriorityScore,
		RecommendedAction: in.RecommendedAction,
		WhatHappened:      in.WhatHappened,
		Risks:             in.Risks,
		NextActions:       in.NextActions,
		WarmLeads:         in.WarmLeads,
		Labels:            in.Labels,
		HistoryLimit:      in.HistoryLimit,
		HistoryUsed:       in.HistoryUsed,
		GeneratedAt:       in.GeneratedAt,
		LastAnalyzedAt:    in.LastAnalyzedAt,
		LastMessageAt:     in.LastMessageAt,
		Model:             in.Model,
		Provider:          in.Provider,
		GenerationError:   in.GenerationError,
	}
}

func pluralSuffix(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func replySuffix(n int) string {
	if n == 1 {
		return "y"
	}
	return "ies"
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// PreflightBatchAIFollowupDuplicates is the read-only "are there
// phones in this batch that already have an active AI follow-up
// elsewhere?" check used by the Enable-AI warning modal BEFORE the
// admin commits to the sequence-start.
//
// Route: POST /api/batches/{id}/ai-followup/duplicates
// Body:   empty
// Response: { duplicates: [BatchAIFollowupDuplicate, ...], total: N, fresh_count: M }
//
// Admin-scoped — a cross-tenant batch id returns 404 (the store
// helper treats "not owned" as "no rows").
//
// Phase 9: adds fresh_count so the conflict modal can render
// "N conflicts · M fresh enrollments" in one round-trip. fresh_count
// is the count of recipient rows whose ai_status is neither
// 'excluded' nor 'opted_out' — the rows the new sequence WILL touch
// unless the operator excludes or overrides them.
func (s *Server) PreflightBatchAIFollowupDuplicates(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	batch, err := s.Store.GetBatch(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if batch == nil {
		writeErr(w, http.StatusNotFound, "batch not found")
		return
	}
	dups, err := s.Store.FindActiveFollowupDuplicatesForBatch(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// fresh_count = valid phones that will actually be considered by
	// the new sequence. Count from billing records so preflight works
	// before SetBatchAIFollowup has created bc_batch_ai_recipients.
	freshCount := 0
	freshCount, err = s.Store.CountEligibleBatchAIPhones(r.Context(), uid, id)
	if err == nil {
		// ok
	} else {
		log.Printf("[preflight] count eligible phones for batch %d: %v (recipient fallback)", id, err)
		recipients, lerr := s.Store.ListBatchAIRecipients(r.Context(), uid, id)
		if lerr == nil {
			for _, rcp := range recipients {
				if rcp.AIStatus != "excluded" && rcp.AIStatus != "opted_out" {
					freshCount++
				}
			}
		}
	}
	if freshCount >= len(dups) {
		freshCount -= len(dups)
	} else {
		freshCount = 0
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"duplicates":  dups,
		"total":       len(dups),
		"fresh_count": freshCount,
	})
}

// startBatchAIFollowupSequenceReq is the wire shape for
// POST /api/batches/{id}/ai-followup/sequence. The flat
// BatchFollowupConfig fields are accepted alongside the optional
// exclude_phones list (Phase 7.5) and the override_phones list
// (Phase 9 — multi-agent + duplicate resolution).
//
// override_phones: phones where the operator wants this batch to take
// over. The store pauses older active AI follow-ups for those phones
// before creating the new current-batch enrollment.
type startBatchAIFollowupSequenceReq struct {
	models.BatchFollowupConfig
	ExcludePhones  []string `json:"exclude_phones"`
	OverridePhones []string `json:"override_phones"`
}

// StartBatchAIFollowupSequence is the action behind the "Enable AI"
// modal on /admin/ai/followups. It:
//  1. Flips the per-batch flag to true (back-fills
//     bc_batch_ai_recipients if not already there).
//  2. Applies the admin's exclude_phones list — marks the chosen
//     recipient rows ai_status='excluded' and un-excludes any
//     previously-excluded phones the admin un-checked on a
//     re-run (the warning modal's "un-check to re-include" flow).
//  3. Creates one bc_crm_sequence_enrollments row per valid
//     recipient in the batch (skipping excluded ones), using
//     the admin's chosen behavior + cadence + tone + goal +
//     checkin_enabled.
//
// Response: { batch_id, enrollment_ids: [int], sequence_ids: [int],
// count: N, excluded_count: M }
func (s *Server) StartBatchAIFollowupSequence(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req startBatchAIFollowupSequenceReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	cfg := req.BatchFollowupConfig
	excludePhones := req.ExcludePhones
	// Behaviour must be one of three known modes.
	switch cfg.Behavior {
	case "default", "custom", "agentic":
		// ok
	default:
		writeErr(w, http.StatusBadRequest, "behavior must be 'default', 'custom', or 'agentic'")
		return
	}

	// 1. Flip the per-batch flag (idempotent — re-running the modal
	//    is safe; the back-fill is a no-op on conflict).
	flagRes, err := s.Store.SetBatchAIFollowup(r.Context(), uid, id, true)
	if err != nil {
		if errors.Is(err, store.ErrNoRecipientsToTrack) {
			// No valid WhatsApp numbers in the file. Surface 422
			// the same way the per-batch toggle does.
			batch, _ := s.Store.GetBatch(r.Context(), uid, id)
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"error":   "no_valid_recipients",
				"message": "AI follow-up was enabled, but this batch has no valid WhatsApp numbers to track. The flag is on but the agent will not see any recipients for this batch.",
				"batch":   batch,
			})
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if flagRes == nil || flagRes.Batch == nil {
		writeErr(w, http.StatusNotFound, "batch not found")
		return
	}
	// 2. Apply the exclude list — mark the chosen phones
	//    ai_status='excluded' so the cross-batch inbox reflects
	//    the choice even when the row is skipped below.
	excludedIDs, err := s.Store.ExcludeRecipientsFromBatch(r.Context(), uid, id, excludePhones)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "exclude recipients: "+err.Error())
		return
	}
	_ = excludedIDs // currently only used for the audit metadata below

	// 2b. Diff against current state — un-exclude any phones
	//     that were previously 'excluded' but are NOT in the new
	//     exclude list. This is how un-checking a box on a
	//     re-run clears the prior exclusion.
	currentExcluded, err := s.Store.ListExcludedPhonesForBatch(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list excluded: "+err.Error())
		return
	}
	excludeSet := make(map[string]struct{}, len(excludePhones))
	for _, p := range excludePhones {
		excludeSet[strings.TrimSpace(p)] = struct{}{}
	}
	var toReset []string
	for _, p := range currentExcluded {
		if _, keep := excludeSet[strings.TrimSpace(p)]; !keep {
			toReset = append(toReset, p)
		}
	}
	if err := s.Store.ResetExcludedRecipients(r.Context(), uid, id, toReset); err != nil {
		writeErr(w, http.StatusInternalServerError, "reset excluded: "+err.Error())
		return
	}

	// 3. Re-list recipients and build the final skip-set. The set
	//    is the union of the body field AND any ai_status='excluded'
	//    rows (defensive — covers the case where ResetExcludedRecipients
	//    somehow missed a row, or where the row was excluded by a
	//    prior run before this field existed).
	recipients, err := s.Store.ListBatchAIRecipients(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list recipients: "+err.Error())
		return
	}
	if len(recipients) == 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":   "no_valid_recipients",
			"message": "AI follow-up is enabled, but this batch has no valid WhatsApp numbers to track.",
		})
		return
	}
	finalExcludes := make(map[string]struct{}, len(excludePhones))
	for _, p := range excludePhones {
		finalExcludes[strings.TrimSpace(p)] = struct{}{}
	}
	for _, r := range recipients {
		if r.AIStatus == "excluded" {
			finalExcludes[r.WhatsappNumber] = struct{}{}
		}
	}
	excludeList := make([]string, 0, len(finalExcludes))
	for p := range finalExcludes {
		excludeList = append(excludeList, p)
	}

	// Phase 9 — dedupe override_phones against exclude_phones so a
	// phone in both lists is treated as excluded (the exclude is
	// the stronger signal). Also trim every entry.
	overrideList := make([]string, 0, len(req.OverridePhones))
	seenOverride := make(map[string]struct{}, len(req.OverridePhones))
	for _, p := range req.OverridePhones {
		trimmed := strings.TrimSpace(p)
		if trimmed == "" {
			continue
		}
		if _, dup := seenOverride[trimmed]; dup {
			continue
		}
		if _, excluded := finalExcludes[trimmed]; excluded {
			continue
		}
		seenOverride[trimmed] = struct{}{}
		overrideList = append(overrideList, trimmed)
	}

	seqIDs, enrollIDs, err := s.Store.StartBatchAIFollowupSequence(
		r.Context(), uid, id, cfg, recipients, excludeList, overrideList,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Audit log — one row per logical action (not one per phone).
	if _, err := s.Store.RefreshAIHumanReviewQueue(r.Context(), uid, 2000); err != nil {
		log.Printf("[ai-followup] refresh human review after sequence start batch=%d admin=%d: %v", id, uid, err)
	}

	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch.ai_followup.sequence_started", EntityType: strPtr("upload_batch"),
		EntityID: &id,
		Metadata: map[string]any{
			"behavior":         cfg.Behavior,
			"cadence_days":     cfg.CadenceDays,
			"max_messages":     cfg.MaxMessages,
			"tone":             cfg.Tone,
			"goal_set":         cfg.Goal != "" && cfg.Behavior == "custom",
			"checkin_enabled":  cfg.CheckinEnabled,
			"enrollment_count": len(enrollIDs),
			"sequence_count":   len(seqIDs),
			"excluded_count":   len(excludePhones),
			"excluded_phones":  excludePhones,
			"override_count":   len(overrideList),
			"override_phones":  overrideList,
		},
	})

	writeJSON(w, http.StatusOK, models.StartBatchFollowupResult{
		BatchID:       id,
		EnrollmentIDs: enrollIDs,
		SequenceIDs:   seqIDs,
		Count:         len(enrollIDs),
		ExcludedCount: len(excludePhones),
	})
}

// batchAIRecipientDetailResp is the wire shape returned by
// GET /api/batch-ai-recipients/{id}. Combines the recipient row with
// the resolved follow-up enrollment + linked conversation + linked
// lead so the per-recipient workflow page can render in one
// round-trip. Each follow-on field is nullable because the recipient
// may not have been enrolled yet (pending row) and may not yet have
// a conversation (first message hasn't arrived).
type batchAIRecipientDetailResp struct {
	Recipient    models.BatchAIRecipient       `json:"recipient"`
	Followup     *models.FollowupEnrollmentRow `json:"followup,omitempty"`
	Conversation *models.AIConversation        `json:"conversation,omitempty"`
	Lead         *models.CRMLead               `json:"lead,omitempty"`
	Batch        *models.UploadBatch           `json:"batch,omitempty"`
}

// GetBatchAIRecipient is the per-recipient detail endpoint behind
// the workflow page at /admin/ai/followups/:recipientId.
//
// It loads the recipient, then fans out to existing store helpers to
// resolve the linked conversation, lead, batch, and active follow-up
// enrollment (if any). All lookups are admin-scoped — cross-tenant
// recipient IDs return 404 with no leakage.
//
// We intentionally don't use a single big JOIN here because the four
// downstream rows live in three different tables (bc_crm_leads,
// bc_crm_sequence_enrollments, bc_ai_conversations, bc_upload_batches)
// and a cross-table JOIN would force us to denormalize the follow-up
// cadence/tone from the first step's condition JSONB in SQL. The
// store helpers already encapsulate that logic correctly.
func (s *Server) GetBatchAIRecipient(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	rec, err := s.Store.GetBatchAIRecipient(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rec == nil {
		writeErr(w, http.StatusNotFound, "recipient not found")
		return
	}
	resp := batchAIRecipientDetailResp{Recipient: *rec}

	// Conversation — load by id if the recipient has one. We pass the
	// admin scope on every lookup so a row that belongs to another
	// tenant returns nil silently (handled by writing null to JSON).
	if rec.ConversationID != nil {
		if conv, _ := s.Store.GetAIConversation(r.Context(), uid, *rec.ConversationID); conv != nil {
			resp.Conversation = conv
		}
	}

	// Lead — resolve by retailer_id (the CRM lead row was created
	// when the AI follow-up sequence was provisioned). If the retailer
	// row exists but no CRM lead was created yet, leave the field nil.
	if rec.RetailerID != nil {
		// Try to find the lead by (admin_user_id, phone) — the
		// UpsertCRMLeadByPhone helper creates one with
		// source='upload_batch' on every AI follow-up sequence start.
		// We can't look it up by id because retailer_id maps to
		// bc_retailers.id, not bc_crm_leads.id.
		var leadID int64
		err := s.Store.DB.QueryRow(r.Context(), `
			SELECT id FROM bc_crm_leads
			 WHERE admin_user_id = $1 AND phone = $2
			 LIMIT 1
		`, uid, rec.WhatsappNumber).Scan(&leadID)
		if err == nil {
			if lead, _ := s.Store.GetCRMLead(r.Context(), uid, leadID, false); lead != nil {
				resp.Lead = lead
			}
			// Active AI follow-up enrollment for that lead (if any).
			if fe, _ := s.Store.GetActiveFollowupEnrollment(r.Context(), uid, leadID); fe != nil {
				resp.Followup = fe
			}
		}
	}

	// Batch — pull just the header (we don't need jobs/errors here).
	if b, _ := s.Store.GetBatch(r.Context(), uid, rec.BatchID); b != nil {
		resp.Batch = b
	}

	writeJSON(w, http.StatusOK, resp)
}

// batchAIRecipientStatusReq is the body for both Exclude and Include.
// We deliberately keep the request shape identical to keep the
// frontend side trivial.
type batchAIRecipientStatusReq struct {
	// Reserved for future "exclude_reason" / "include_note" — kept
	// as an open struct so we can extend without a breaking change.
}

// setBatchAIRecipientStatus is the shared body for ExcludeRecipient
// and IncludeRecipient — both just flip ai_status. The handler-side
// difference is which audit action we log and which target status we
// set.
func (s *Server) setBatchAIRecipientStatus(w http.ResponseWriter, r *http.Request, recipientID int64, targetStatus, action string) {
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	// Load the recipient first so we can audit-log the phone + batch
	// id (more useful than just the recipient id in the audit list).
	rec, err := s.Store.GetBatchAIRecipient(r.Context(), uid, recipientID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rec == nil {
		writeErr(w, http.StatusNotFound, "recipient not found")
		return
	}
	ok, err := s.Store.SetBatchAIRecipientStatus(r.Context(), uid, recipientID, targetStatus)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		// Should be unreachable (the Get above would have 404'd),
		// but treat as 404 anyway.
		writeErr(w, http.StatusNotFound, "recipient not found")
		return
	}
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: action, EntityType: strPtr("batch_ai_recipient"),
		EntityID: &recipientID,
		Metadata: map[string]any{
			"phone":       rec.WhatsappNumber,
			"batch_id":    rec.BatchID,
			"new_status":  targetStatus,
			"prev_status": rec.AIStatus,
		},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "ai_status": targetStatus})
}

// ExcludeRecipient marks the recipient ai_status='excluded'. The
// cross-batch queue hides the row (filter: status != excluded) and
// the per-batch panel still shows it with a "Excluded" badge. The
// follow-up sequence worker will still pick up the enrollment if
// one already exists — Exclude only affects future state tracking,
// not active enrollments (call Pause via the CRM endpoint for that).
func (s *Server) ExcludeRecipient(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req batchAIRecipientStatusReq
	_ = decodeJSON(r, &req) // body is empty today; tolerant of absent JSON
	s.setBatchAIRecipientStatus(w, r, id, "excluded", "batch_ai_recipient.excluded")
}

// IncludeRecipient reverses ExcludeRecipient — flips ai_status back
// to 'pending'. Used when the admin un-excludes a row after seeing
// the warning modal in the Enable-AI flow.
func (s *Server) IncludeRecipient(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req batchAIRecipientStatusReq
	_ = decodeJSON(r, &req)
	s.setBatchAIRecipientStatus(w, r, id, "pending", "batch_ai_recipient.included")
}

// ============================================================================
// Per-recipient intervention handlers
// ============================================================================
//
// These power the operator controls on the per-recipient detail page
// (/admin/ai/followups/:recipientId): pause/resume the follow-up
// sequence, edit cadence/tone/goal/max_messages, send the next step
// manually, switch modes, and surface the audit history scoped to one
// recipient. All endpoints are admin-scoped via GetBatchAIRecipient's
// pre-check; the response shape mirrors the existing status-mutation
// handlers so the frontend can keep its react-query wiring uniform.

// resolveBatchAIEnrollmentForRecipient walks recipient -> phone -> lead
// -> enrollment and returns the active ai_followup enrollment. Returns
// a 404 error if no recipient, no lead, or no active enrollment. The
// returned enrollment's ID is what the caller mutates.
func (s *Server) resolveBatchAIEnrollmentForRecipient(w http.ResponseWriter, r *http.Request, recipientID int64) (*models.FollowupEnrollmentRow, error) {
	uid := middleware.UserID(r)
	rec, err := s.Store.GetBatchAIRecipient(r.Context(), uid, recipientID)
	if err != nil {
		return nil, err
	}
	if rec == nil {
		writeErr(w, http.StatusNotFound, "recipient not found")
		return nil, errors.New("not found")
	}
	enr, err := s.Store.FindEnrollmentByBatchRecipient(r.Context(), uid, recipientID)
	if err != nil {
		return nil, err
	}
	if enr == nil {
		writeErr(w, http.StatusNotFound, "no active follow-up enrollment for this recipient")
		return nil, errors.New("not found")
	}
	return enr, nil
}

type pauseFollowupReq struct {
	Reason string `json:"reason"`
	Detail string `json:"detail"`
}

// PauseFollowup handles POST /api/batch-ai-recipients/:id/pause. Flips
// the active ai_followup enrollment to paused with the supplied
// reason/detail. Idempotent — pausing an already-paused enrollment is
// a no-op that returns ok.
func (s *Server) PauseFollowup(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req pauseFollowupReq
	_ = decodeJSON(r, &req)
	if req.Reason == "" {
		req.Reason = "admin_paused"
	}
	if req.Detail == "" {
		req.Detail = "paused manually from per-recipient detail page"
	}
	enr, err := s.resolveBatchAIEnrollmentForRecipient(w, r, id)
	if err != nil {
		return
	}
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	if err := s.Store.PauseFollowupEnrollment(r.Context(), uid, enr.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch_ai_recipient.followup_paused", EntityType: strPtr("batch_ai_recipient"),
		EntityID: &id,
		Metadata: map[string]any{
			"enrollment_id": enr.ID,
			"sequence_id":   enr.SequenceID,
			"pause_reason":  req.Reason,
			"pause_detail":  req.Detail,
			"prev_status":   enr.Status,
		},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "enrollment_id": enr.ID, "status": "paused"})
}

// ResumeFollowup handles POST /api/batch-ai-recipients/:id/resume. The
// reverse of PauseFollowup: clears pause metadata, flips status to
// active, and stamps next_run_at based on the override or step cadence.
func (s *Server) ResumeFollowup(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	enr, err := s.resolveBatchAIEnrollmentForRecipient(w, r, id)
	if err != nil {
		return
	}
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	if err := s.Store.ResumeFollowupEnrollment(r.Context(), uid, enr.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch_ai_recipient.followup_resumed", EntityType: strPtr("batch_ai_recipient"),
		EntityID: &id,
		Metadata: map[string]any{
			"enrollment_id": enr.ID,
			"sequence_id":   enr.SequenceID,
			"prev_status":   enr.Status,
		},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "enrollment_id": enr.ID, "status": "active"})
}

// SendNextFollowupStep handles POST /api/batch-ai-recipients/:id/send-next.
// Clears pause metadata and stamps next_run_at = now() so the worker
// picks the enrollment up on its next tick. Used by both "send now"
// and "retry after send_failed" buttons on the detail page.
func (s *Server) SendNextFollowupStep(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	// Refuse if the recipient is excluded — the worker would skip
	// it anyway, but rejecting up-front is a clearer UX signal.
	uid := middleware.UserID(r)
	rec, err := s.Store.GetBatchAIRecipient(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rec == nil {
		writeErr(w, http.StatusNotFound, "recipient not found")
		return
	}
	if rec.AIStatus == "excluded" {
		writeErr(w, http.StatusConflict, "recipient is excluded; include it again first")
		return
	}
	enr, err := s.resolveBatchAIEnrollmentForRecipient(w, r, id)
	if err != nil {
		return
	}
	if strings.TrimSpace(enr.NextMessageBody) != "" && enr.NextMessageStale {
		writeErr(w, http.StatusConflict, "saved next message is based on older chat history; regenerate it before sending")
		return
	}
	if err := s.Store.SendNextStepNow(r.Context(), uid, enr.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	email := middleware.Email(r)
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch_ai_recipient.step_advanced", EntityType: strPtr("batch_ai_recipient"),
		EntityID: &id,
		Metadata: map[string]any{
			"enrollment_id": enr.ID,
			"sequence_id":   enr.SequenceID,
			"from_step":     enr.CurrentStep,
			"trigger":       "manual",
		},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "enrollment_id": enr.ID})
}

type updatePlanReq struct {
	CadenceDays *int    `json:"cadence_days"`
	MaxMessages *int    `json:"max_messages"`
	Tone        *string `json:"tone"`
	Goal        *string `json:"goal"`
}

// UpdateFollowupPlan handles PUT /api/batch-ai-recipients/:id/plan.
// Updates per-enrollment override columns. nil means "leave column
// unchanged". Validates cadence_days and max_messages >= 1.
func (s *Server) UpdateFollowupPlan(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req updatePlanReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.CadenceDays != nil && *req.CadenceDays < 1 {
		writeErr(w, http.StatusBadRequest, "cadence_days must be >= 1")
		return
	}
	if req.MaxMessages != nil && *req.MaxMessages < 1 {
		writeErr(w, http.StatusBadRequest, "max_messages must be >= 1")
		return
	}
	if req.Tone != nil {
		switch *req.Tone {
		case "friendly", "professional", "casual", "urgent":
		default:
			writeErr(w, http.StatusBadRequest, "tone must be one of friendly/professional/casual/urgent")
			return
		}
	}
	enr, err := s.resolveBatchAIEnrollmentForRecipient(w, r, id)
	if err != nil {
		return
	}
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	prev := map[string]any{
		"cadence_days": enr.CadenceDays,
		"max_messages": enr.MaxMessages,
		"tone":         enr.Tone,
		"goal":         enr.Goal,
	}
	updated, err := s.Store.UpdateEnrollmentOverrides(r.Context(), uid, enr.ID,
		req.CadenceDays, req.MaxMessages, req.Tone, req.Goal)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch_ai_recipient.plan_updated", EntityType: strPtr("batch_ai_recipient"),
		EntityID: &id,
		Metadata: map[string]any{
			"enrollment_id": enr.ID,
			"sequence_id":   enr.SequenceID,
			"prev":          prev,
			"new": map[string]any{
				"cadence_days": updated.CadenceDays,
				"max_messages": updated.MaxMessages,
				"tone":         updated.Tone,
				"goal":         updated.Goal,
			},
		},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, updated)
}

type generateNextMessageReq struct {
	Prompt       string `json:"prompt"`
	HistoryLimit int    `json:"history_limit"`
}

// GenerateNextFollowupMessage creates a preview from current conversation
// history. It does not save or send the result.
func (s *Server) GenerateNextFollowupMessage(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	if s.Orch == nil {
		writeErr(w, http.StatusServiceUnavailable, "AI follow-up generator is not configured")
		return
	}
	var req generateNextMessageReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.HistoryLimit != 10 && req.HistoryLimit != 20 {
		req.HistoryLimit = 20
	}
	if len([]rune(req.Prompt)) > 2000 {
		writeErr(w, http.StatusBadRequest, "prompt must be 2000 characters or fewer")
		return
	}

	uid := middleware.UserID(r)
	rec, err := s.Store.GetBatchAIRecipient(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rec == nil {
		writeErr(w, http.StatusNotFound, "recipient not found")
		return
	}
	enr, err := s.resolveBatchAIEnrollmentForRecipient(w, r, id)
	if err != nil {
		return
	}

	instruction := strings.TrimSpace(req.Prompt)
	if strings.TrimSpace(enr.Goal) != "" {
		if instruction == "" {
			instruction = strings.TrimSpace(enr.Goal)
		} else {
			instruction = "Current objective: " + strings.TrimSpace(enr.Goal) +
				"\nOperator direction for this message: " + instruction
		}
	}
	if instruction == "" {
		instruction = "Re-engage this customer naturally and move the conversation toward one clear next step."
	}

	// Resolve the batch id from the recipient so the preview uses the
	// same agent the worker would actually use on the next tick.
	// rec is a bc_batch_ai_recipients row; it carries batch_id directly.
	var batchIDPtr *int64
	if rec.BatchID > 0 {
		v := rec.BatchID
		batchIDPtr = &v
	}
	draft, err := s.Orch.GenerateFollowUpDraft(
		r.Context(), uid, batchIDPtr, rec.WhatsappNumber, instruction,
		rec.LastMessagePreview, enr.Tone, req.HistoryLimit,
	)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"message":            draft.Body,
		"prompt":             strings.TrimSpace(req.Prompt),
		"history_limit":      req.HistoryLimit,
		"history_used":       draft.HistoryUsed,
		"context_message_id": draft.ContextMessageID,
		"generated_at":       draft.GeneratedAt,
		"model":              draft.Model,
		"provider":           draft.Provider,
	})
}

type saveNextMessageReq struct {
	Message          string     `json:"message"`
	Prompt           string     `json:"prompt"`
	Source           string     `json:"source"`
	ContextMessageID *int64     `json:"context_message_id"`
	HistoryLimit     int        `json:"history_limit"`
	GeneratedAt      *time.Time `json:"generated_at"`
}

// SaveNextFollowupMessage reserves an exact, one-time body for the next
// successful sequence step. It rejects a preview generated from stale chat.
func (s *Server) SaveNextFollowupMessage(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req saveNextMessageReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" {
		writeErr(w, http.StatusBadRequest, "message is required")
		return
	}
	if len([]rune(req.Message)) > 1600 {
		writeErr(w, http.StatusBadRequest, "message must be 1600 characters or fewer")
		return
	}
	if req.Source != "ai" && req.Source != "manual" {
		req.Source = "manual"
	}
	if req.HistoryLimit != 10 && req.HistoryLimit != 20 {
		req.HistoryLimit = 20
	}

	uid := middleware.UserID(r)
	rec, err := s.Store.GetBatchAIRecipient(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rec == nil {
		writeErr(w, http.StatusNotFound, "recipient not found")
		return
	}
	enr, err := s.resolveBatchAIEnrollmentForRecipient(w, r, id)
	if err != nil {
		return
	}
	latestID, err := s.Store.LatestConversationMessageID(r.Context(), uid, rec.WhatsappNumber)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if req.ContextMessageID == nil && req.Source == "manual" {
		req.ContextMessageID = latestID
	}
	if !sameMessageContext(req.ContextMessageID, latestID) {
		writeErr(w, http.StatusConflict, "conversation changed while editing; generate the message again from the latest chat")
		return
	}
	if err := s.Store.SaveEnrollmentNextMessage(
		r.Context(), uid, enr.ID, req.Message, req.Prompt, req.Source,
		req.ContextMessageID, req.HistoryLimit, req.GeneratedAt,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	email := middleware.Email(r)
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch_ai_recipient.next_message_saved", EntityType: strPtr("batch_ai_recipient"),
		EntityID: &id,
		Metadata: map[string]any{
			"enrollment_id":      enr.ID,
			"sequence_id":        enr.SequenceID,
			"source":             req.Source,
			"history_limit":      req.HistoryLimit,
			"context_message_id": latestID,
			"message_preview":    compactFollowupPreview(req.Message),
		},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ClearNextFollowupMessage discards the one-time override. The worker will
// return to live AI generation (or the configured template) for the next step.
func (s *Server) ClearNextFollowupMessage(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	enr, err := s.resolveBatchAIEnrollmentForRecipient(w, r, id)
	if err != nil {
		return
	}
	uid := middleware.UserID(r)
	if err := s.Store.ClearEnrollmentNextMessage(r.Context(), uid, enr.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	email := middleware.Email(r)
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch_ai_recipient.next_message_cleared", EntityType: strPtr("batch_ai_recipient"),
		EntityID: &id,
		Metadata: map[string]any{
			"enrollment_id": enr.ID,
			"sequence_id":   enr.SequenceID,
		},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func sameMessageContext(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func compactFollowupPreview(s string) string {
	runes := []rune(strings.TrimSpace(s))
	if len(runes) <= 180 {
		return string(runes)
	}
	return strings.TrimSpace(string(runes[:180]))
}

type setModeReq struct {
	Mode string `json:"mode"`
}

// SetFollowupMode handles POST /api/batch-ai-recipients/:id/mode.
// Switches the enrollment between 'template' / 'ai_followup' /
// 'agentic_followup'. The change applies on the next worker tick;
// the in-flight current_step is preserved.
func (s *Server) SetFollowupMode(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req setModeReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	switch req.Mode {
	case "template", "ai_followup", "agentic_followup":
	default:
		writeErr(w, http.StatusBadRequest, "mode must be template/ai_followup/agentic_followup")
		return
	}
	enr, err := s.resolveBatchAIEnrollmentForRecipient(w, r, id)
	if err != nil {
		return
	}
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	prev, err := s.Store.SetEnrollmentMode(r.Context(), uid, enr.ID, req.Mode)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch_ai_recipient.mode_changed", EntityType: strPtr("batch_ai_recipient"),
		EntityID: &id,
		Metadata: map[string]any{
			"enrollment_id": enr.ID,
			"sequence_id":   enr.SequenceID,
			"from":          prev,
			"to":            req.Mode,
		},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "from": prev, "to": req.Mode})
}

// RecipientAuditLog handles GET /api/batch-ai-recipients/:id/audit.
// Returns audit entries for the recipient, ordered newest first.
// Powers the History card on the per-recipient detail page.
func (s *Server) RecipientAuditLog(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	limit := intParam(r, "limit", 50)
	uid := middleware.UserID(r)
	logs, err := s.Store.RecipientAuditByEntity(r.Context(), uid, id, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

// ExportFollowupsCSV handles GET /api/ai/followups/export. Streams
// the same filters as the list endpoint as a CSV download. Caps the
// row count at 5000 to avoid OOM on huge workspaces.
func (s *Server) ExportFollowupsCSV(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	q := r.URL.Query()
	status := q.Get("status")
	search := q.Get("search")
	var batchID *int64
	if v := q.Get("batch_id"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			batchID = &n
		}
	}
	total, err := s.Store.CountFollowupsForExport(r.Context(), uid, status, search, batchID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if total > 5000 {
		total = 5000
	}
	filename := fmt.Sprintf("ai-followups-%s.csv", time.Now().UTC().Format("2006-01-02"))
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{
		"recipient_id", "batch_id", "retailer_name", "phone",
		"ai_status", "last_event", "last_event_at", "last_message_at",
	})
	rows, err := s.Store.ExportFollowupsRows(r.Context(), uid, status, search, batchID, total)
	if err != nil {
		// Headers already sent — best-effort log only.
		return
	}
	for _, row := range rows {
		_ = cw.Write(row)
	}
	cw.Flush()
	email := middleware.Email(r)
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch_ai_recipient.exported", EntityType: strPtr("batch_ai_recipient"),
		Metadata: map[string]any{
			"status":    status,
			"search":    search,
			"batch_id":  batchID,
			"row_count": len(rows),
		},
		IPAddress: &ip, UserAgent: &ua,
	})
}

// ============================================================================
// Per-batch agent assignment (Phase 8 — multi-agent + per-batch override)
// ============================================================================

// GetBatchAIAgent returns the resolved agent for a batch plus the source
// discriminator ("batch_override" | "global_default" | "none") so the
// frontend can render the "(overrides default)" / "(using global
// default)" pill without a second round-trip.
//
// Route: GET /api/batches/{id}/agent
// Response: { agent: AIAgentConfig | null, source: string }
func (s *Server) GetBatchAIAgent(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	batchID, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	// Verify the batch exists and is owned by this admin. The store
	// helper treats a missing batch as ErrAgentNotFound; we surface 404.
	if err := s.Store.AssertBatchOwned(r.Context(), uid, batchID); err != nil {
		writeErr(w, http.StatusNotFound, "batch not found")
		return
	}
	bid := batchID
	cfg, source, err := s.Store.GetEffectiveAgent(r.Context(), uid, &bid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, models.EffectiveAIAgent{Agent: cfg, Source: source})
}

// putBatchAIAgentReq is the wire shape for the per-batch override.
// agent_id == null clears the override and reverts to the global default.
type putBatchAIAgentReq struct {
	AgentID *int64 `json:"agent_id"`
}

// PutBatchAIAgent assigns (or clears) the agent override on a batch.
// Existing assignments on other batches are untouched — that is the
// whole point: changing one batch's agent never ripples to siblings.
// Switching the global default via /api/ai/agents/{id}/default also
// does NOT overwrite this row.
//
// Route: PUT /api/batches/{id}/agent
// Body:   { agent_id: number | null }
func (s *Server) PutBatchAIAgent(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	batchID, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req putBatchAIAgentReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if err := s.Store.AssertBatchOwned(r.Context(), uid, batchID); err != nil {
		writeErr(w, http.StatusNotFound, "batch not found")
		return
	}
	// If assigning (not clearing), verify the agent belongs to this admin.
	if req.AgentID != nil {
		if _, err := s.Store.GetAIAgent(r.Context(), uid, *req.AgentID); err != nil {
			if errors.Is(err, store.ErrAgentNotFound) {
				writeErr(w, http.StatusBadRequest, "agent not found")
				return
			}
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if err := s.Store.SetBatchAIAgent(r.Context(), uid, batchID, req.AgentID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	bid := batchID
	eff, source, err := s.Store.GetEffectiveAgent(r.Context(), uid, &bid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	var newID *int64
	if eff != nil {
		v := eff.ID
		newID = &v
	}
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch.ai_agent.assigned", EntityType: strPtr("upload_batch"),
		EntityID: &batchID,
		Metadata: map[string]any{
			"prev_agent_id": req.AgentID,
			"new_agent_id":  newID,
			"source":        source,
		},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, models.EffectiveAIAgent{Agent: eff, Source: source})
}
