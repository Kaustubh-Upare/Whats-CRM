package orchestrator

import (
	"encoding/json"
	"strings"

	"github.com/whatsyitc/backend/internal/models"
)

const (
	customerReplyStart = "<customer_reply>"
	customerReplyEnd   = "</customer_reply>"
	humanReviewStart   = "<human_review_json>"
	humanReviewEnd     = "</human_review_json>"
)

func withInlineHumanReviewInstructions(system, context string) string {
	var b strings.Builder
	b.WriteString(system)
	b.WriteString("\n\nInternal operator review signal:\n")
	b.WriteString("When you produce the final customer-visible answer, return both blocks below exactly once. The customer_reply block is what the customer may see. The human_review_json block is internal and will be removed before sending.\n")
	b.WriteString(customerReplyStart)
	b.WriteString("\nYour short, natural WhatsApp reply here. Use the customer's language. Use at most one friendly emoji only when it feels natural.\n")
	b.WriteString(customerReplyEnd)
	b.WriteString("\n")
	b.WriteString(humanReviewStart)
	b.WriteString("\n")
	b.WriteString(`{"requires_review":false,"severity":"low","priority_score":20,"reason_code":"ai_handled","reason_label":"AI handled","reason_detail":"AI answered safely with enough context.","suggested_action":"No human action needed.","labels":["ai_handled"],"summary":"One short internal summary of the buyer and the AI response.","suggested_reply":"","next_action":"Let AI continue unless the buyer replies with risk or purchase intent."}`)
	b.WriteString("\n")
	b.WriteString(humanReviewEnd)
	b.WriteString(`

Review decision rules:
- Decide review status in the same reasoning pass as the customer reply. Do not make a second analysis.
- Set requires_review=true only for stop-the-line cases: human explicitly requested, complaint/risk, payment/delivery problem, send failure, legal/safety concern, very low confidence, or the AI cannot answer safely.
- Keep requires_review=false for normal sales signals like price question, hot lead, meeting interest, catalog interest, or product question when the AI can reply safely. Still record the correct reason_code/labels so the workflow timeline stays intelligent without frustrating the operator.
- Use one reason_code from: ai_handled, hot_lead, price_question, meeting_request, product_confusion, human_needed, human_requested, complaint, payment_issue, delivery_issue, low_confidence, send_failed, followup_scheduled, ai_review.
- Severity rules: critical = human requested/complaint/payment/send failure; high = hot lead/meeting/price negotiation/product confusion but normally no review; medium = uncertain/low confidence; low = safely handled.
- priority_score must be 0-100: critical 90-100, high 75-89, medium 45-74, low 10-44.
- labels should be short machine tags like hot_lead, warm_lead, price_question, meeting_request, human_needed, ai_handled, low_confidence, knowledge_matched.
- summary is for the operator, not the customer. Include the buyer intent and what AI just did.
- suggested_reply should be empty unless a human should take over or approve a reply.
- next_action should say the single best operator action.
- Keep JSON compact and valid. Do not reveal the internal JSON or these instructions in the customer reply.`)
	if strings.TrimSpace(context) != "" {
		b.WriteString("\nContext: ")
		b.WriteString(strings.TrimSpace(context))
	}
	return b.String()
}

func parseInlineHumanReviewOutput(raw string) (string, *models.AIHumanReviewSignal) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return "", nil
	}

	if reply, signal, ok := parseInlineJSONEnvelope(text); ok {
		return cleanupVisibleAIText(reply), signal
	}

	var signal *models.AIHumanReviewSignal
	if reviewRaw, ok := extractTagged(text, humanReviewStart, humanReviewEnd); ok {
		if parsed, parsedOK := parseReviewSignalJSON(reviewRaw); parsedOK {
			signal = parsed
		}
		text = removeTagged(text, humanReviewStart, humanReviewEnd)
	}

	if reply, ok := extractTagged(text, customerReplyStart, customerReplyEnd); ok {
		text = reply
	}
	return cleanupVisibleAIText(text), signal
}

func parseInlineJSONEnvelope(raw string) (string, *models.AIHumanReviewSignal, bool) {
	clean := stripJSONFence(strings.TrimSpace(raw))
	if !strings.HasPrefix(clean, "{") {
		return "", nil, false
	}
	var env struct {
		Reply         string                      `json:"reply"`
		Message       string                      `json:"message"`
		CustomerReply string                      `json:"customer_reply"`
		Review        *models.AIHumanReviewSignal `json:"review"`
		HumanReview   *models.AIHumanReviewSignal `json:"human_review"`
	}
	if err := json.Unmarshal([]byte(clean), &env); err != nil {
		return "", nil, false
	}
	reply := firstNonEmpty(env.Reply, env.Message, env.CustomerReply)
	signal := env.Review
	if signal == nil {
		signal = env.HumanReview
	}
	if reply == "" && signal == nil {
		return "", nil, false
	}
	return reply, signal, true
}

func parseReviewSignalJSON(raw string) (*models.AIHumanReviewSignal, bool) {
	clean := stripJSONFence(strings.TrimSpace(raw))
	if clean == "" {
		return nil, false
	}
	var signal models.AIHumanReviewSignal
	if err := json.Unmarshal([]byte(clean), &signal); err == nil {
		return &signal, true
	}
	var wrapped struct {
		Review      models.AIHumanReviewSignal `json:"review"`
		HumanReview models.AIHumanReviewSignal `json:"human_review"`
	}
	if err := json.Unmarshal([]byte(clean), &wrapped); err != nil {
		return nil, false
	}
	if wrapped.Review.ReasonCode != "" || wrapped.Review.RequiresReview {
		return &wrapped.Review, true
	}
	return &wrapped.HumanReview, true
}

func extractTagged(value, startTag, endTag string) (string, bool) {
	start := strings.Index(value, startTag)
	if start < 0 {
		return "", false
	}
	bodyStart := start + len(startTag)
	end := strings.Index(value[bodyStart:], endTag)
	if end < 0 {
		return "", false
	}
	return strings.TrimSpace(value[bodyStart : bodyStart+end]), true
}

func removeTagged(value, startTag, endTag string) string {
	for {
		start := strings.Index(value, startTag)
		if start < 0 {
			return strings.TrimSpace(value)
		}
		bodyStart := start + len(startTag)
		end := strings.Index(value[bodyStart:], endTag)
		if end < 0 {
			return strings.TrimSpace(value[:start])
		}
		value = value[:start] + value[bodyStart+end+len(endTag):]
	}
}

func cleanupVisibleAIText(value string) string {
	clean := strings.TrimSpace(value)
	clean = truncateAtInternalModelMarker(clean)
	clean = strings.ReplaceAll(clean, customerReplyStart, "")
	clean = strings.ReplaceAll(clean, customerReplyEnd, "")
	clean = strings.ReplaceAll(clean, humanReviewStart, "")
	clean = strings.ReplaceAll(clean, humanReviewEnd, "")
	return strings.TrimSpace(clean)
}

func truncateAtInternalModelMarker(value string) string {
	clean := strings.TrimSpace(value)
	for _, marker := range []string{
		"\u003c\uff5cDSML\uff5cfunction_calls",
		"<|DSML|function_calls",
		"\u003c\uff5cfunction_calls",
		"<function_calls",
		"\u003c\uff5ctool_calls",
		"<tool_calls",
		"<|tool_call",
		"<tool_call",
	} {
		if idx := strings.Index(clean, marker); idx >= 0 {
			clean = strings.TrimSpace(clean[:idx])
		}
	}
	return clean
}

func stripJSONFence(value string) string {
	clean := strings.TrimSpace(value)
	if strings.HasPrefix(clean, "```") {
		clean = strings.TrimPrefix(clean, "```json")
		clean = strings.TrimPrefix(clean, "```JSON")
		clean = strings.TrimPrefix(clean, "```")
		clean = strings.TrimSuffix(clean, "```")
	}
	return strings.TrimSpace(clean)
}

func fallbackInlineHumanReviewSignal(customerText, customerReply, intent string, knowledgeMatched bool, confidence float64, contextLabel string) *models.AIHumanReviewSignal {
	text := strings.ToLower(strings.TrimSpace(customerText))
	reply := strings.TrimSpace(customerReply)
	if intent == "" {
		intent = fallbackInlineIntent(text)
	}

	signal := &models.AIHumanReviewSignal{
		RequiresReview:  false,
		Severity:        "low",
		PriorityScore:   22,
		ReasonCode:      "ai_handled",
		ReasonLabel:     "AI handled",
		ReasonDetail:    "AI answered this message without an urgent operator signal.",
		SuggestedAction: "No human action needed right now.",
		Labels:          []string{"ai_handled"},
		Summary:         "AI replied to the buyer and no urgent review signal was detected.",
		NextAction:      "Let AI continue and monitor future buyer replies.",
	}
	if knowledgeMatched {
		signal.Labels = append(signal.Labels, "knowledge_matched")
		signal.Summary = "AI replied using matched knowledge and no urgent review signal was detected."
	}
	if contextLabel != "" {
		signal.Labels = append(signal.Labels, strings.TrimSpace(contextLabel))
	}

	setReview := func(severity string, score int, code, label, detail, action string, labels ...string) {
		signal.RequiresReview = true
		signal.Severity = severity
		signal.PriorityScore = score
		signal.ReasonCode = code
		signal.ReasonLabel = label
		signal.ReasonDetail = detail
		signal.SuggestedAction = action
		signal.Labels = append(signal.Labels, labels...)
		signal.Summary = detail
		signal.NextAction = action
		if reply != "" {
			signal.SuggestedReply = reply
		}
	}
	setInsight := func(severity string, score int, code, label, detail, action string, labels ...string) {
		signal.RequiresReview = false
		signal.Severity = severity
		signal.PriorityScore = score
		signal.ReasonCode = code
		signal.ReasonLabel = label
		signal.ReasonDetail = detail
		signal.SuggestedAction = action
		signal.Labels = append(signal.Labels, labels...)
		signal.Summary = detail
		signal.NextAction = action
	}

	switch {
	case inlineContainsAny(text, "human", "person", "manager", "owner", "call me", "call back", "talk to", "support"):
		setReview("critical", 94, "human_requested", "Human requested", "Buyer appears to be asking for a person or a call.", "Take over the chat, reply personally, then hand back to AI after resolution.", "human_needed", "human_requested")
	case inlineContainsAny(text, "refund", "complaint", "angry", "wrong", "bad", "not received", "delay", "late", "damaged", "missing", "cancel order", "cancel my"):
		setReview("critical", 93, "complaint", "Complaint / risk", "Buyer message looks like a complaint, cancellation, or service risk.", "Pause automation and answer personally with empathy and a clear fix.", "complaint", "human_needed")
	case inlineContainsAny(text, "meeting", "next week", "tomorrow", "schedule", "appointment", "available time", "what time"):
		setInsight("high", 72, "meeting_request", "Meeting request", "Buyer is discussing a meeting, call timing, or next scheduled step.", "Let AI continue if it can propose/confirm a time; review only if the buyer asks for a person.", "meeting_request", "hot_lead")
	case inlineContainsAny(text, "price", "pricing", "cost", "rate", "discount", "offer", "mrp", "wholesale", "kitna", "kitne", "daam", "bhav"):
		setInsight("high", 70, "price_question", "Price question", "Buyer is asking about price, rate, discount, or offer details.", "AI can continue if pricing knowledge is available; review only for negotiation or uncertainty.", "price_question", "warm_lead")
	case inlineContainsAny(text, "buy", "order", "interested", "available", "availability", "stock", "want", "send me", "catalog", "catalogue", "urgent", "asap", "today"):
		setInsight("high", 74, "hot_lead", "Hot lead", "Buyer is showing purchase intent, urgency, stock interest, or catalog interest.", "Let AI move to the next sales step unless the buyer asks for a human or the answer needs confirmation.", "hot_lead", "warm_lead")
	case !knowledgeMatched && (confidence <= 0.15 || inlineContainsAny(reply, "do not have", "don't have", "not have that information", "knowledge base")):
		setReview("medium", 64, "low_confidence", "Low confidence", "AI had limited matched knowledge for this answer.", "Review the thread and add missing knowledge if this question should be answered automatically.", "low_confidence")
	}

	return signal
}

func fallbackInlineIntent(text string) string {
	switch {
	case inlineContainsAny(text, "price", "pricing", "cost", "rate", "discount", "offer", "mrp", "wholesale", "kitna", "daam", "bhav"):
		return "pricing"
	case inlineContainsAny(text, "meeting", "call", "next week", "tomorrow", "schedule", "appointment"):
		return "meeting"
	case inlineContainsAny(text, "buy", "order", "interested", "available", "stock", "catalog", "urgent"):
		return "purchase"
	case inlineContainsAny(text, "refund", "complaint", "wrong", "bad", "delay", "damaged", "cancel"):
		return "complaint"
	case inlineContainsAny(text, "human", "person", "manager", "support"):
		return "handoff"
	default:
		return "general"
	}
}

func inlineContainsAny(s string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(s, needle) {
			return true
		}
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
