package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/whatsyitc/backend/internal/llm"
	"github.com/whatsyitc/backend/internal/middleware"
	"github.com/whatsyitc/backend/internal/models"
)

func (s *Server) ListAIWorkflows(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	if r.URL.Query().Get("refresh") != "false" {
		if _, err := s.Store.RefreshAIWorkflowQueue(r.Context(), uid, 2000); err != nil {
			writeErr(w, http.StatusInternalServerError, "refresh AI workflow states: "+err.Error())
			return
		}
	}
	state := r.URL.Query().Get("state")
	search := r.URL.Query().Get("search")
	limit := intParam(r, "limit", 100)
	offset := intParam(r, "offset", 0)
	var batchID *int64
	if raw := r.URL.Query().Get("batch_id"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n <= 0 {
			writeErr(w, http.StatusBadRequest, "bad batch_id")
			return
		}
		batchID = &n
	}
	out, err := s.Store.ListAIWorkflowStates(r.Context(), uid, state, batchID, search, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) GetBatchAIRecipientWorkflow(w http.ResponseWriter, r *http.Request) {
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
	if _, err := s.Store.RefreshAIWorkflowForPhone(r.Context(), uid, rec.WhatsappNumber); err != nil {
		writeErr(w, http.StatusInternalServerError, "refresh workflow: "+err.Error())
		return
	}
	state, err := s.Store.GetAIWorkflowStateForRecipient(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if state == nil {
		writeErr(w, http.StatusNotFound, "workflow state not found")
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) ListBatchAIRecipientDecisions(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	limit := intParam(r, "limit", 20)
	rec, err := s.Store.GetBatchAIRecipient(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rec == nil {
		writeErr(w, http.StatusNotFound, "recipient not found")
		return
	}
	logs, err := s.Store.ListAIDecisionLogsForRecipient(r.Context(), uid, id, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": logs,
		"total": len(logs),
	})
}

type aiWorkflowBriefReq struct {
	Prompt       string `json:"prompt"`
	HistoryLimit int    `json:"history_limit"`
}

type aiWorkflowBrief struct {
	RequiresReview  bool     `json:"requires_review"`
	Severity        string   `json:"severity"`
	PriorityScore   int      `json:"priority_score"`
	ReasonCode      string   `json:"reason_code"`
	ReasonLabel     string   `json:"reason_label"`
	ReasonDetail    string   `json:"reason_detail"`
	SuggestedAction string   `json:"suggested_action"`
	BuyerIntent     string   `json:"buyer_intent"`
	SuggestedReply  string   `json:"suggested_reply"`
	Labels          []string `json:"labels"`
}

func (s *Server) GenerateBatchAIRecipientWorkflowBrief(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req aiWorkflowBriefReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.HistoryLimit != 10 && req.HistoryLimit != 20 {
		req.HistoryLimit = 20
	}
	if len([]rune(req.Prompt)) > 1200 {
		writeErr(w, http.StatusBadRequest, "prompt must be 1200 characters or fewer")
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
	if _, err := s.Store.RefreshAIWorkflowForPhone(r.Context(), uid, rec.WhatsappNumber); err != nil {
		writeErr(w, http.StatusInternalServerError, "refresh workflow: "+err.Error())
		return
	}
	state, err := s.Store.GetAIWorkflowStateForRecipient(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if state == nil {
		writeErr(w, http.StatusNotFound, "workflow state not found")
		return
	}
	if s.LLM == nil || !s.LLM.Enabled() {
		writeErr(w, http.StatusServiceUnavailable, "Bedrock is not configured")
		return
	}
	bedrock, ok := s.LLM.Provider("bedrock")
	if !ok || bedrock == nil {
		writeErr(w, http.StatusServiceUnavailable, "Bedrock is not configured for workflow briefs")
		return
	}
	messages, err := s.Store.ListAIReviewRecentMessagesForPhone(r.Context(), uid, rec.WhatsappNumber, req.HistoryLimit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	decision := s.LLM.Router().Decide(llm.RoutingContext{
		BusinessTier:       "standard",
		QueryComplexity:    0.42,
		Intent:             "workflow_brief",
		ConversationLength: len(messages),
	})
	resp, err := bedrock.Chat(r.Context(), llm.ChatRequest{
		Model:       decision.Model,
		System:      buildAIWorkflowBriefSystemPrompt(),
		Messages:    []llm.Message{{Role: llm.RoleUser, Content: buildAIWorkflowBriefUserPrompt(state, messages, strings.TrimSpace(req.Prompt))}},
		Temperature: 0.22,
		MaxTokens:   750,
		BusinessID:  uid,
		Intent:      "workflow_brief",
	})
	if err != nil {
		writeErr(w, http.StatusBadGateway, "AI workflow brief failed: "+err.Error())
		return
	}
	brief := parseAIWorkflowBrief(resp.Text)
	model := resp.Model
	if model == "" {
		model = decision.Model
	}
	provider := resp.Provider
	if provider == "" {
		provider = decision.Provider
	}
	signal := models.AIHumanReviewSignal{
		RequiresReview:  brief.RequiresReview,
		Severity:        brief.Severity,
		PriorityScore:   brief.PriorityScore,
		ReasonCode:      brief.ReasonCode,
		ReasonLabel:     brief.ReasonLabel,
		ReasonDetail:    brief.ReasonDetail,
		SuggestedAction: brief.SuggestedAction,
		Labels:          brief.Labels,
		Summary:         brief.ReasonDetail,
		SuggestedReply:  brief.SuggestedReply,
		NextAction:      brief.SuggestedAction,
		Model:           model,
		Provider:        provider,
		Source:          "workflow_brief",
	}
	if _, err := s.Store.SaveAIWorkflowSignalForPhone(r.Context(), uid, rec.WhatsappNumber, signal); err != nil {
		writeErr(w, http.StatusInternalServerError, "save workflow brief: "+err.Error())
		return
	}
	saved, err := s.Store.GetAIWorkflowStateForRecipient(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if saved == nil {
		writeErr(w, http.StatusNotFound, "workflow state not found")
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func buildAIWorkflowBriefSystemPrompt() string {
	return strings.TrimSpace(`
You are the AI workflow brain for a WhatsApp sales agent.

Goal:
Turn one phone's recent conversation and current workflow state into a useful operator-facing decision.

Rules:
- Use only the supplied messages and workflow state.
- Do not invent prices, policies, stock, commitments, delivery dates, or payment details.
- Keep human review minimal. Set requires_review=true only for real stop-the-line cases: explicit human request, complaint/risk, payment/delivery problem, failed send, legal/safety issue, very low confidence, or AI cannot safely answer.
- For normal buyer replies, price questions, meeting interest, product questions, catalog interest, or warm leads, usually set requires_review=false and tell the operator AI can continue.
- Give a smart reason_detail with buyer intent, urgency, risk, evidence, and what AI should do next.
- suggested_action must be one clear next step.
- suggested_reply should be a short WhatsApp-ready draft only if useful.
- Return valid JSON only. No Markdown. No extra text.

JSON schema:
{
  "requires_review": false,
  "severity": "low|medium|high|critical",
  "priority_score": 0,
  "reason_code": "ai_handled|hot_lead|price_question|meeting_request|product_confusion|human_needed|human_requested|complaint|payment_issue|delivery_issue|low_confidence|send_failed|followup_scheduled|ai_review",
  "reason_label": "short label",
  "reason_detail": "2-4 short sentences with evidence and intelligent judgement",
  "suggested_action": "one next action; say whether AI can continue or human should take over",
  "buyer_intent": "short intent",
  "suggested_reply": "optional short WhatsApp reply draft",
  "labels": ["max 4 machine tags"]
}`)
}

func buildAIWorkflowBriefUserPrompt(state *models.AIWorkflowState, messages []models.AIConversationMessage, operatorPrompt string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Current workflow state:\n")
	fmt.Fprintf(&b, "- Phone: %s\n", state.Phone)
	fmt.Fprintf(&b, "- Retailer: %s\n", emptyAs(state.RetailerName, "unknown"))
	fmt.Fprintf(&b, "- Batch: %s", emptyAs(state.BatchName, "unknown"))
	if state.BatchID != nil {
		fmt.Fprintf(&b, " (#%d)", *state.BatchID)
	}
	b.WriteString("\n")
	fmt.Fprintf(&b, "- State: %s\n", state.State)
	fmt.Fprintf(&b, "- Current label: %s\n", state.StateLabel)
	fmt.Fprintf(&b, "- Current reason: %s\n", state.StateReason)
	fmt.Fprintf(&b, "- Current next action: %s\n", state.NextAction)
	fmt.Fprintf(&b, "- Risk: %s\n", state.RiskLevel)
	fmt.Fprintf(&b, "- Confidence: %d/100\n", state.ConfidenceScore)
	fmt.Fprintf(&b, "- Buyer intent: %s\n", state.BuyerIntent)
	if state.NextMessagePreview != "" {
		fmt.Fprintf(&b, "- Planned message: %s\n", state.NextMessagePreview)
	}
	if operatorPrompt != "" {
		fmt.Fprintf(&b, "- Operator extra instruction: %s\n", operatorPrompt)
	}
	b.WriteString("\nRecent messages, oldest to newest:\n")
	if len(messages) == 0 {
		b.WriteString("No stored messages are available. Improve the current workflow state using only the state fields.\n")
		return b.String()
	}
	for i, m := range messages {
		content := strings.TrimSpace(m.Content)
		if len([]rune(content)) > 900 {
			content = string([]rune(content)[:900]) + "..."
		}
		fmt.Fprintf(&b, "%d. [%s] %s: %s",
			i+1, m.CreatedAt.Format(time.RFC3339), reviewMessageRole(m.Role), content)
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

func parseAIWorkflowBrief(raw string) aiWorkflowBrief {
	clean := strings.TrimSpace(raw)
	var out aiWorkflowBrief
	if err := json.Unmarshal([]byte(clean), &out); err != nil {
		if start := strings.Index(clean, "{"); start >= 0 {
			if end := strings.LastIndex(clean, "}"); end > start {
				_ = json.Unmarshal([]byte(clean[start:end+1]), &out)
			}
		}
	}
	out.Severity = normalizeWorkflowBriefSeverity(out.Severity)
	out.PriorityScore = clampWorkflowBriefScore(out.PriorityScore)
	out.ReasonCode = compactHandlerText(out.ReasonCode, 80)
	out.ReasonLabel = compactHandlerText(out.ReasonLabel, 80)
	out.ReasonDetail = compactHandlerText(out.ReasonDetail, 700)
	out.SuggestedAction = compactHandlerText(out.SuggestedAction, 500)
	out.BuyerIntent = compactHandlerText(out.BuyerIntent, 120)
	out.SuggestedReply = compactHandlerText(out.SuggestedReply, 500)
	out.Labels = normalizeStringList(out.Labels, 4)
	if out.ReasonCode == "" {
		out.ReasonCode = "ai_review"
	}
	if out.ReasonLabel == "" {
		out.ReasonLabel = "AI workflow brief"
	}
	if out.ReasonDetail == "" {
		out.ReasonDetail = "Bedrock reviewed this phone and refreshed the workflow recommendation."
	}
	if out.SuggestedAction == "" {
		out.SuggestedAction = "Open the thread if you need full context; otherwise let AI continue unless risk increases."
	}
	return out
}

func normalizeWorkflowBriefSeverity(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "critical", "high", "medium", "low":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "medium"
	}
}

func clampWorkflowBriefScore(value int) int {
	if value <= 0 {
		return 72
	}
	if value > 100 {
		return 100
	}
	return value
}
