package handlers

import (
	"context"
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

type aiHumanReviewContext struct {
	Agent       *models.AIAgentConfig
	AgentSource string
	Knowledge   []models.AIRetrievedChunk
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
	llmProvider, providerName, modelName, providerErr := s.pickHumanReviewProvider()
	if providerErr != "" {
		saved, _ := s.Store.SaveAIHumanReviewAdvice(r.Context(), uid, id, "", "", "", "", "", providerErr)
		if saved != nil {
			writeJSON(w, http.StatusServiceUnavailable, saved)
			return
		}
		writeErr(w, http.StatusServiceUnavailable, providerErr)
		return
	}

	messages, err := s.Store.ListAIReviewRecentMessagesForPhone(r.Context(), uid, item.Phone, req.HistoryLimit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	reviewCtx := s.buildHumanReviewContext(r.Context(), uid, item, messages)
	resp, err := llmProvider.Chat(r.Context(), llm.ChatRequest{
		Model:       modelName,
		System:      buildAIHumanReviewSystemPrompt(),
		Messages:    []llm.Message{{Role: llm.RoleUser, Content: buildAIHumanReviewUserPrompt(item, messages, reviewCtx, strings.TrimSpace(req.Prompt))}},
		Temperature: 0.22,
		MaxTokens:   1050,
		BusinessID:  uid,
		Intent:      "human_review_advice",
	})
	if err != nil {
		saved, _ := s.Store.SaveAIHumanReviewAdvice(r.Context(), uid, id, "", "", "", modelName, providerName, err.Error())
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
		model = modelName
	}
	respProvider := resp.Provider
	if respProvider == "" {
		respProvider = providerName
	}
	saved, err := s.Store.SaveAIHumanReviewAdvice(
		r.Context(), uid, id,
		advice.Summary,
		advice.SuggestedReply,
		advice.NextAction,
		model,
		respProvider,
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
			"phone":          item.Phone,
			"batch_id":       item.BatchID,
			"history_limit":  req.HistoryLimit,
			"model":          model,
			"provider":       respProvider,
			"agent_source":   reviewCtx.AgentSource,
			"knowledge_hits": len(reviewCtx.Knowledge),
		},
	})
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) pickHumanReviewProvider() (llm.Provider, string, string, string) {
	if s.LLM == nil {
		return nil, "", "", "AI help is not configured"
	}
	if openaiProvider, ok := s.LLM.Provider("openai"); ok && openaiProvider != nil {
		return openaiProvider, "openai", "", ""
	}
	if bedrockProvider, ok := s.LLM.Provider("bedrock"); ok && bedrockProvider != nil {
		decision := s.LLM.Router().Decide(llm.RoutingContext{
			BusinessTier:    "standard",
			QueryComplexity: 0.45,
			Intent:          "human_review_advice",
		})
		return bedrockProvider, "bedrock", decision.Model, ""
	}
	return nil, "", "", "AI help needs OpenAI or Bedrock configured"
}

func (s *Server) buildHumanReviewContext(ctx context.Context, adminID int64, item *models.AIHumanReviewItem, messages []models.AIConversationMessage) aiHumanReviewContext {
	var out aiHumanReviewContext
	var batchID *int64
	if item != nil {
		batchID = item.BatchID
	}
	agent, source, err := s.Store.GetEffectiveAgent(ctx, adminID, batchID)
	if err == nil {
		out.Agent = agent
		out.AgentSource = source
	}
	if out.AgentSource == "" {
		out.AgentSource = "none"
	}

	query := buildHumanReviewKnowledgeQuery(item, messages)
	if query == "" {
		return out
	}
	var agentID *int64
	if out.Agent != nil && out.Agent.ID > 0 {
		id := out.Agent.ID
		agentID = &id
	}
	if chunks, err := s.searchAIKnowledge(ctx, adminID, agentID, query, 6); err == nil {
		out.Knowledge = chunks
	}
	return out
}

func buildHumanReviewKnowledgeQuery(item *models.AIHumanReviewItem, messages []models.AIConversationMessage) string {
	parts := []string{}
	if item != nil {
		parts = append(parts, item.ReasonLabel, item.ReasonDetail, item.SuggestedAction, item.LastMessagePreview)
	}
	for i := len(messages) - 1; i >= 0 && len(parts) < 10; i-- {
		role := strings.ToLower(strings.TrimSpace(messages[i].Role))
		if role == "tool" {
			continue
		}
		parts = append(parts, messages[i].Content)
	}
	return compactHandlerText(strings.Join(parts, "\n"), 2200)
}

func buildAIHumanReviewSystemPrompt() string {
	return strings.TrimSpace(`
You are the AI sales supervisor inside WhatsyITC. You help a human operator understand one WhatsApp buyer conversation and decide the best next move.

Rules:
- Use only the supplied review signal, assigned agent, knowledge hits, and messages.
- Do not invent prices, policies, product availability, promises, or order status.
- Respect the assigned agent persona and selected knowledge scope.
- If knowledge hits contain useful facts, ground the reply in those facts and mention which knowledge was used in summary/reasons.
- If knowledge is missing, do not bluff. Ask a short clarifying question or tell the operator what info is missing.
- Human review should stay minimal. Let AI continue when the buyer is normal, warm, asking basic price/product questions, or giving a simple scheduling response.
- Keep human involvement only for high-value intent, complaint/anger, explicit human request, failed sends, payment/order risk, unsafe uncertainty, or sensitive negotiation.
- suggested_reply must be ready to send on WhatsApp: short, warm, natural, specific, with at most one tasteful emoji.
- next_action must be operational: "Send this as human", "Let AI continue", "Call buyer", "Ask for quantity", "Check stock/pricing first", etc.
- The summary must be dense and valuable: buyer intent, urgency, risk, evidence, and whether AI can safely continue in 2-4 short sentences.
- reasons should be evidence bullets tied to messages or knowledge hits, not generic advice.
- Return valid JSON only. No Markdown. No extra text.

JSON schema:
{
  "summary": "2-4 short sentences explaining buyer intent, urgency, risk, and evidence",
  "suggested_reply": "short message the human can send, or empty string",
  "next_action": "one concrete action for the operator, including whether AI can continue or human should reply",
  "reasons": ["max 3 evidence-based reasons"]
}`)
}

func buildAIHumanReviewUserPrompt(item *models.AIHumanReviewItem, messages []models.AIConversationMessage, reviewCtx aiHumanReviewContext, operatorPrompt string) string {
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
	b.WriteString("\nAssigned AI agent:\n")
	if reviewCtx.Agent == nil {
		b.WriteString("No agent is resolved. Use the review signal and messages only.\n")
	} else {
		fmt.Fprintf(&b, "- Name: %s\n", emptyAs(reviewCtx.Agent.Name, "AI agent"))
		fmt.Fprintf(&b, "- Source: %s\n", emptyAs(reviewCtx.AgentSource, "unknown"))
		fmt.Fprintf(&b, "- Enabled: %t\n", reviewCtx.Agent.Enabled)
		fmt.Fprintf(&b, "- Tone: %s\n", emptyAs(reviewCtx.Agent.Tone, "natural"))
		if strings.TrimSpace(reviewCtx.Agent.PersonaMD) != "" {
			fmt.Fprintf(&b, "- Persona: %s\n", compactHandlerText(reviewCtx.Agent.PersonaMD, 900))
		}
		if strings.TrimSpace(reviewCtx.Agent.SystemPrompt) != "" {
			fmt.Fprintf(&b, "- Agent rules: %s\n", compactHandlerText(reviewCtx.Agent.SystemPrompt, 1100))
		}
		if len(reviewCtx.Agent.Languages) > 0 {
			fmt.Fprintf(&b, "- Languages: %s\n", strings.Join(reviewCtx.Agent.Languages, ", "))
		}
		if len(reviewCtx.Agent.HandoffRules) > 0 {
			fmt.Fprintf(&b, "- Handoff rules: %s\n", compactHandlerText(formatCompactJSON(reviewCtx.Agent.HandoffRules), 700))
		}
		if len(reviewCtx.Agent.QualificationCriteria) > 0 {
			fmt.Fprintf(&b, "- Qualification criteria: %s\n", compactHandlerText(formatCompactJSON(reviewCtx.Agent.QualificationCriteria), 700))
		}
	}
	b.WriteString("\nRelevant knowledge hits for this buyer:\n")
	if len(reviewCtx.Knowledge) == 0 {
		b.WriteString("No matching knowledge chunks were retrieved for this review. Do not invent missing facts.\n")
	} else {
		for i, c := range reviewCtx.Knowledge {
			content := compactHandlerText(c.Content, 750)
			title := emptyAs(c.Title, emptyAs(c.SourceRef, fmt.Sprintf("Knowledge #%d", c.ID)))
			fmt.Fprintf(&b, "[%d] %s (score %.2f): %s\n", i+1, title, c.FinalScore, content)
		}
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
	if len(out.Reasons) > 0 {
		evidence := "Evidence: " + strings.Join(out.Reasons, "; ")
		if out.Summary == "" {
			out.Summary = compactHandlerText(evidence, 1200)
		} else if !strings.Contains(strings.ToLower(out.Summary), "evidence:") {
			out.Summary = compactHandlerText(out.Summary+" "+evidence, 1200)
		}
	}
	if out.Summary == "" {
		out.Summary = compactHandlerText(clean, 700)
	}
	if out.NextAction == "" {
		out.NextAction = "Review the latest message and respond manually if the buyer is waiting."
	}
	return out
}

func formatCompactJSON(value any) string {
	b, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(b)
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
