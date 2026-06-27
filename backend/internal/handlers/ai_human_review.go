package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/whatsyitc/backend/internal/audit"
	"github.com/whatsyitc/backend/internal/llm"
	"github.com/whatsyitc/backend/internal/middleware"
	"github.com/whatsyitc/backend/internal/models"
)

// ListAIHumanReview returns the phone-level operator queue. The refresh is
// deterministic and cheap: no LLM call is made here.
func (s *Server) ListAIHumanReview(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	if r.URL.Query().Get("refresh") != "false" {
		if _, err := s.Store.RefreshAIHumanReviewQueue(r.Context(), uid, 2000); err != nil {
			writeErr(w, http.StatusInternalServerError, "refresh human review queue: "+err.Error())
			return
		}
	}
	status := r.URL.Query().Get("status")
	reason := r.URL.Query().Get("reason")
	severity := r.URL.Query().Get("severity")
	search := r.URL.Query().Get("search")
	limit := intParam(r, "limit", 100)
	offset := intParam(r, "offset", 0)

	out, err := s.Store.ListAIHumanReviewItems(r.Context(), uid, status, reason, severity, search, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) GetAIHumanReview(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	item, err := s.Store.GetAIHumanReviewItem(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if item == nil {
		writeErr(w, http.StatusNotFound, "review item not found")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) ResolveAIHumanReview(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	item, err := s.Store.ResolveAIHumanReviewItem(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if item == nil {
		writeErr(w, http.StatusNotFound, "review item not found")
		return
	}
	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID:    &uid,
		ActorEmail: &email,
		Action:     "ai.human_review.resolved",
		EntityType: strPtr("ai_human_review_item"),
		EntityID:   &id,
		Metadata: map[string]any{
			"phone":       item.Phone,
			"batch_id":    item.BatchID,
			"reason_code": item.ReasonCode,
		},
	})
	writeJSON(w, http.StatusOK, item)
}

type aiHumanReviewHelpReq struct {
	Prompt       string `json:"prompt"`
	HistoryLimit int    `json:"history_limit"`
}

type aiHumanReviewAdvice struct {
	Summary        string   `json:"summary"`
	SuggestedReply string   `json:"suggested_reply"`
	NextAction     string   `json:"next_action"`
	Reasons        []string `json:"reasons"`
}

// GenerateAIHumanReviewHelp spends LLM tokens only when the operator clicks
// for help. The generated advice is cached on the review item.
func (s *Server) GenerateAIHumanReviewHelp(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req aiHumanReviewHelpReq
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

	item, err := s.Store.GetAIHumanReviewItem(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if item == nil {
		writeErr(w, http.StatusNotFound, "review item not found")
		return
	}
	if s.LLM == nil || !s.LLM.Enabled() {
		saved, _ := s.Store.SaveAIHumanReviewAdvice(r.Context(), uid, id, "", "", "", "", "", "Bedrock/LLM is not configured")
		if saved != nil {
			writeJSON(w, http.StatusServiceUnavailable, saved)
			return
		}
		writeErr(w, http.StatusServiceUnavailable, "Bedrock/LLM is not configured")
		return
	}

	messages, err := s.Store.ListAIReviewRecentMessagesForPhone(r.Context(), uid, item.Phone, req.HistoryLimit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	decision := s.LLM.Router().Decide(llm.RoutingContext{
		BusinessTier:       "standard",
		QueryComplexity:    0.45,
		Intent:             "human_review_advice",
		ConversationLength: len(messages),
	})
	resp, err := s.LLM.Chat(r.Context(), llm.ChatRequest{
		Model:       decision.Model,
		System:      buildAIHumanReviewSystemPrompt(),
		Messages:    []llm.Message{{Role: llm.RoleUser, Content: buildAIHumanReviewUserPrompt(item, messages, strings.TrimSpace(req.Prompt))}},
		Temperature: 0.25,
		MaxTokens:   650,
		BusinessID:  uid,
		Intent:      "human_review_advice",
	})
	if err != nil {
		saved, _ := s.Store.SaveAIHumanReviewAdvice(r.Context(), uid, id, "", "", "", decision.Model, decision.Provider, err.Error())
		if saved != nil {
			writeJSON(w, http.StatusBadGateway, saved)
			return
		}
		writeErr(w, http.StatusBadGateway, "AI help failed: "+err.Error())
		return
	}

	advice := parseAIHumanReviewAdvice(resp.Text)
	model := resp.Model
	if model == "" {
		model = decision.Model
	}
	provider := resp.Provider
	if provider == "" {
		provider = decision.Provider
	}
	saved, err := s.Store.SaveAIHumanReviewAdvice(
		r.Context(), uid, id,
		advice.Summary,
		advice.SuggestedReply,
		advice.NextAction,
		model,
		provider,
		"",
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "save AI help: "+err.Error())
		return
	}
	if saved == nil {
		writeErr(w, http.StatusNotFound, "review item not found")
		return
	}
	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID:    &uid,
		ActorEmail: &email,
		Action:     "ai.human_review.ai_help",
		EntityType: strPtr("ai_human_review_item"),
		EntityID:   &id,
		Metadata: map[string]any{
			"phone":         item.Phone,
			"batch_id":      item.BatchID,
			"history_limit": req.HistoryLimit,
			"model":         model,
			"provider":      provider,
		},
	})
	writeJSON(w, http.StatusOK, saved)
}

func buildAIHumanReviewSystemPrompt() string {
	return strings.TrimSpace(`
You are a senior WhatsApp sales/support copilot helping a human operator review one urgent AI follow-up conversation.

Rules:
- Use only the supplied review signal and messages.
- Do not invent prices, policies, product availability, promises, or order status.
- Be practical: tell the operator what matters, what to do next, and draft a short WhatsApp reply only when there is enough context.
- If the operator should not reply yet, say that clearly in next_action and leave suggested_reply empty.
- Keep suggested_reply friendly, concise, and ready to send on WhatsApp.
- Return valid JSON only. No Markdown. No extra text.

JSON schema:
{
  "summary": "1-2 short sentences explaining what is happening",
  "suggested_reply": "short message the human can send, or empty string",
  "next_action": "one concrete action for the operator",
  "reasons": ["max 3 short reasons"]
}`)
}

func buildAIHumanReviewUserPrompt(item *models.AIHumanReviewItem, messages []models.AIConversationMessage, operatorPrompt string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Review item:\n")
	fmt.Fprintf(&b, "- Phone: %s\n", item.Phone)
	fmt.Fprintf(&b, "- Retailer: %s\n", emptyAs(item.RetailerName, "unknown"))
	fmt.Fprintf(&b, "- Batch: %s", emptyAs(item.BatchName, "unknown"))
	if item.BatchID != nil {
		fmt.Fprintf(&b, " (#%d)", *item.BatchID)
	}
	b.WriteString("\n")
	fmt.Fprintf(&b, "- Severity: %s (%d/100)\n", item.Severity, item.PriorityScore)
	fmt.Fprintf(&b, "- Reason: %s - %s\n", item.ReasonLabel, item.ReasonDetail)
	fmt.Fprintf(&b, "- Current suggested action: %s\n", item.SuggestedAction)
	if operatorPrompt != "" {
		fmt.Fprintf(&b, "- Operator extra instruction: %s\n", operatorPrompt)
	}
	b.WriteString("\nRecent messages, oldest to newest:\n")
	if len(messages) == 0 {
		b.WriteString("No stored AI conversation messages are available. Use the review signal only.\n")
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

func parseAIHumanReviewAdvice(raw string) aiHumanReviewAdvice {
	clean := strings.TrimSpace(raw)
	var out aiHumanReviewAdvice
	if err := json.Unmarshal([]byte(clean), &out); err != nil {
		if start := strings.Index(clean, "{"); start >= 0 {
			if end := strings.LastIndex(clean, "}"); end > start {
				_ = json.Unmarshal([]byte(clean[start:end+1]), &out)
			}
		}
	}
	out.Summary = compactHandlerText(out.Summary, 1200)
	out.SuggestedReply = compactHandlerText(out.SuggestedReply, 1600)
	out.NextAction = compactHandlerText(out.NextAction, 500)
	out.Reasons = normalizeStringList(out.Reasons, 3)
	if out.Summary == "" {
		out.Summary = compactHandlerText(clean, 700)
	}
	if out.NextAction == "" {
		out.NextAction = "Review the latest message and respond manually if the buyer is waiting."
	}
	return out
}

func reviewMessageRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "user":
		return "buyer"
	case "assistant":
		return "ai"
	case "human":
		return "human"
	case "tool":
		return "tool"
	default:
		if strings.TrimSpace(role) == "" {
			return "unknown"
		}
		return strings.TrimSpace(role)
	}
}

func compactHandlerText(value string, maxLen int) string {
	clean := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if maxLen <= 0 || len([]rune(clean)) <= maxLen {
		return clean
	}
	runes := []rune(clean)
	return strings.TrimSpace(string(runes[:maxLen-1])) + "..."
}

func emptyAs(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}
