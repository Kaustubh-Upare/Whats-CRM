package orchestrator

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/whatsyitc/backend/internal/llm"
)

// FollowUpGenerator is the interface the sequence worker depends on.
// Keeping it as a tiny one-method interface lets the worker stay
// independent of the orchestrator package's full surface and lets
// tests stub it without spinning up an LLM.
//
// The orchestrator implements this natively; the wiring happens in
// cmd/server/main.go where the SequenceWorker.followup field is set.
//
// The mode parameter selects the prompt + behavior:
//   - "default": one short AI nudge referencing the last topic
//     (today's behavior)
//   - "custom":  same as default but with admin-supplied goal/tone
//     baked into the prompt
//   - "agentic": the LLM decides whether a follow-up is appropriate
//     right now. Returns "" to mean "skip this tick" —
//     the worker treats that as a no-send + advance.
type FollowUpGenerator interface {
	GenerateFollowUp(ctx context.Context, adminID int64, batchID *int64, phone, goal, lastTopic, tone, mode string) (string, error)
}

// followUpMaxChars is the hard cap on a follow-up message body. WhatsApp
// UX is short; anything longer means the LLM lost the plot, so we
// truncate. 600 chars covers ~3 sentences.
const followUpMaxChars = 600

// followUpMaxHistory is the number of recent turns we send to the LLM.
// Smaller than HandleInbound's 20 because the follow-up only needs
// enough context to ground the message in the last real topic — not
// the full conversation.
const followUpMaxHistory = 6

// FollowUpDraft is returned to the admin preview endpoint. The context
// message id lets a saved draft be recognized as stale when the chat moves.
type FollowUpDraft struct {
	Body             string
	Model            string
	Provider         string
	HistoryUsed      int
	ContextMessageID *int64
	GeneratedAt      time.Time
}

// ErrFollowUpNoLLM is returned when the registry has no provider
// configured. The worker treats this the same as a send failure
// (3× retry → pause with reason='send_failed').
var ErrFollowUpNoLLM = errors.New("orchestrator: no LLM configured")

// GenerateFollowUp returns one short, contextually-aware follow-up
// message body. It does NOT send the message — the worker (or the
// follow-up check-in worker) is responsible for the actual WhatsApp
// delivery and the bc_ai_conversation_messages + bc_ai_llm_metrics
// writes. GenerateFollowUp is purely "give me the text to send."
//
// Why a separate method (and not HandleInbound with a flag):
//
//   - HandleInbound runs a 3-iteration tool-call loop with the full
//     agent's tool surface (capture_lead, transfer_to_human, ...).
//     Follow-ups must NOT call tools — they're an outbound message,
//     not a customer reply.
//   - The system prompt is materially different: we want a single
//     short message, not a multi-tool agent loop.
//   - The cheap-tier model is forced (Haiku / gpt-4.1-mini) — the
//     interactive routing logic is not the right answer for background
//     work.
//
// Concurrency: shares the per-phone single-flight mutex with
// HandleInbound. A follow-up tick and a real customer reply for the
// same phone will serialize; whichever runs first commits its work
// (webhook flips the enrollment to paused, or worker tick advances
// the step), the second sees the freshest state.
//
// Parameters:
//   - adminID:    workspace owner (multi-tenant isolation)
//   - phone:      E.164 phone number (no leading +)
//   - goal:       what the admin asked this follow-up to achieve
//     (e.g. "re-engage a warm lead who hasn't replied")
//   - lastTopic:  one-line summary of the last real chat topic; if
//     empty, the prompt just says "no recent context"
//   - tone:       overrides the agent config's tone for this one
//     message; empty string falls back to the configured
//     tone (or "friendly" if not set)
//   - mode:       "default" (today's behavior) | "custom" (admin
//     supplies goal/tone) | "agentic" (LLM decides
//     whether + what to send; returns "" to skip)
func (o *Orchestrator) GenerateFollowUp(
	ctx context.Context,
	adminID int64,
	batchID *int64,
	phone, goal, lastTopic, tone, mode string,
) (string, error) {
	if !o.llm.Enabled() {
		return "", ErrFollowUpNoLLM
	}

	// Single-flight per phone. Same lock HandleInbound uses — a
	// follow-up tick firing 200ms after a real inbound reply will
	// queue, and by the time it runs the webhook has flipped the
	// enrollment to paused so the next worker tick skips it. Safe.
	v, _ := o.flights.LoadOrStore(phone, &sync.Mutex{})
	mu := v.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()
	defer o.flights.Delete(phone)

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// Load the agent config so we get the persona + tone override.
	// When batchID is set, this honours the batch's per-agent override
	// — the operator can pick "Sales Hindi" for one batch and have it
	// stay Sales Hindi even if the global default later changes.
	cfg, err := o.loadAgentConfig(ctx, adminID, batchID)
	if err != nil {
		return "", err
	}
	if tone == "" {
		tone = cfg.Tone
	}
	if tone == "" {
		tone = "friendly"
	}

	// Load recent history (last 6 turns) so the LLM can reference
	// the last real topic instead of inventing one.
	history, err := o.loadHistory(ctx, adminID, conversationKey(phone))
	if err != nil {
		slog.Warn("orchestrator: follow-up load history", "err", err)
		history = nil
	}
	trimmed := trimHistory(history, followUpMaxHistory)

	// Build the follow-up prompt + messages. mode='agentic' uses
	// a different prompt that asks the LLM to decide whether to
	// follow up at all.
	system := withInlineHumanReviewInstructions(
		buildFollowUpPrompt(cfg, goal, lastTopic, tone, mode),
		"Scheduled AI follow-up. If the phone looks hot, confused, risky, or needs a human check, set requires_review=true. If this is just normal cadence, set requires_review=false.",
	)
	msgs := historyToMessages(trimmed)
	msgs = append(msgs, llm.Message{
		Role:    llm.RoleUser,
		Content: buildFollowUpUserInstruction(lastTopic, mode),
	})

	// Force the cheap tier. We bypass Router.Decide entirely because
	// the routing logic is designed for the interactive path — for
	// background work we always want Haiku / gpt-4.1-mini. The
	// failover wrapper on the registry still kicks in if the
	// configured cheap provider is down.
	cheapDecision := o.llm.Router().Decide(llm.RoutingContext{
		HasExactKBMatch: true, // forces the cheap-tier branch
	})

	resp, err := o.llm.Chat(ctx, llm.ChatRequest{
		Model:       cheapDecision.Model,
		System:      system,
		Messages:    msgs,
		Temperature: 0.7,
		MaxTokens:   240,
		BusinessID:  adminID,
		Intent:      "followup",
	})
	if err != nil {
		return "", err
	}

	text, reviewSignal := parseInlineHumanReviewOutput(resp.Text)
	text = strings.TrimSpace(text)
	if strings.EqualFold(text, "<NO_FOLLOWUP>") {
		text = ""
	}
	// In agentic mode, an empty body is a *legitimate* answer: the
	// LLM decided no follow-up is appropriate right now. Return ""
	// (no error) so the worker can advance the enrollment to the
	// next tick without sending.
	if text == "" {
		o.saveInlineHumanReviewSignal(ctx, adminID, phone, reviewSignal, "", resp.Model, firstNonEmpty(resp.Provider, cheapDecision.Provider), "followup_skip")
		if mode == "agentic" {
			slog.Info("orchestrator: agentic follow-up returned no body — skipping this tick",
				"phone", phone, "admin", adminID)
			return "", nil
		}
		return "", errors.New("orchestrator: empty follow-up body from LLM")
	}

	// Hard cap on length. WhatsApp UX is short.
	runes := []rune(text)
	if len(runes) > followUpMaxChars {
		text = strings.TrimSpace(string(runes[:followUpMaxChars]))
	}
	o.saveInlineHumanReviewSignal(ctx, adminID, phone, reviewSignal, text, resp.Model, firstNonEmpty(resp.Provider, cheapDecision.Provider), "followup_generation")

	// Metrics: record this as a cheap-tier LLM call so the AI
	// dashboard's cost card counts follow-ups too.
	o.recordLLMMetric(ctx, adminID, conversationKey(phone),
		resp.Model, resp.Usage, 0, cheapDecision, 0, 0)

	return text, nil
}

// GenerateFollowUpDraft creates an operator preview from the latest 10 or 20
// conversation messages. It does not persist or send anything.
// batchID is optional; when supplied, the per-batch agent override is
// honored so the preview reflects exactly what the worker will send.
func (o *Orchestrator) GenerateFollowUpDraft(
	ctx context.Context,
	adminID int64,
	batchID *int64,
	phone, instruction, lastTopic, tone string,
	historyLimit int,
) (*FollowUpDraft, error) {
	if !o.llm.Enabled() {
		return nil, ErrFollowUpNoLLM
	}
	if historyLimit != 10 && historyLimit != 20 {
		historyLimit = 20
	}

	v, _ := o.flights.LoadOrStore(phone, &sync.Mutex{})
	mu := v.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()
	defer o.flights.Delete(phone)

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cfg, err := o.loadAgentConfig(ctx, adminID, batchID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(tone) == "" {
		tone = cfg.Tone
	}
	if strings.TrimSpace(tone) == "" {
		tone = "friendly"
	}

	history, err := o.loadHistory(ctx, adminID, conversationKey(phone))
	if err != nil {
		slog.Warn("orchestrator: draft load history", "err", err)
		history = nil
	}
	trimmed := trimHistory(history, historyLimit)

	var contextID sql.NullInt64
	if err := o.pool.QueryRow(ctx, `
		SELECT MAX(id)
		FROM bc_ai_conversation_messages
		WHERE admin_user_id = $1 AND conversation_key = $2
	`, adminID, conversationKey(phone)).Scan(&contextID); err != nil {
		slog.Warn("orchestrator: draft load context id", "err", err)
		contextID = sql.NullInt64{}
	}
	contextMessageID := int64PtrFromNull(contextID)

	system := buildFollowUpPrompt(cfg, instruction, lastTopic, tone, "custom")
	msgs := historyToMessages(trimmed)
	msgs = append(msgs, llm.Message{
		Role:    llm.RoleUser,
		Content: "Write the single best next WhatsApp follow-up message now. Return only the message text.",
	})

	decision := o.llm.Router().Decide(llm.RoutingContext{
		HasExactKBMatch: true,
	})
	started := time.Now()
	resp, err := o.llm.Chat(ctx, llm.ChatRequest{
		Model:       decision.Model,
		System:      system,
		Messages:    msgs,
		Temperature: 0.7,
		MaxTokens:   240,
		BusinessID:  adminID,
		Intent:      "followup_preview",
	})
	if err != nil {
		return nil, err
	}

	text := strings.TrimSpace(resp.Text)
	if text == "" {
		return nil, errors.New("orchestrator: empty follow-up draft from LLM")
	}
	runes := []rune(text)
	if len(runes) > followUpMaxChars {
		text = strings.TrimSpace(string(runes[:followUpMaxChars]))
	}

	latencyMS := int(time.Since(started).Milliseconds())
	o.recordLLMMetric(ctx, adminID, conversationKey(phone),
		resp.Model, resp.Usage, latencyMS, decision, 0, 0)

	return &FollowUpDraft{
		Body:             text,
		Model:            resp.Model,
		Provider:         resp.Provider,
		HistoryUsed:      len(trimmed),
		ContextMessageID: contextMessageID,
		GeneratedAt:      time.Now().UTC(),
	}, nil
}

func int64PtrFromNull(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	n := v.Int64
	return &n
}

func buildFollowUpUserInstruction(lastTopic, mode string) string {
	var b strings.Builder
	if mode == "agentic" {
		b.WriteString("Review the recent chat and decide whether to send the next WhatsApp follow-up now. ")
		b.WriteString("If a follow-up would be spammy or inappropriate, return only <NO_FOLLOWUP>. ")
		b.WriteString("Otherwise return only the single message text.")
	} else {
		b.WriteString("Write the single best next WhatsApp follow-up message now. Return only the message text.")
	}
	if topic := strings.TrimSpace(lastTopic); topic != "" {
		b.WriteString("\nLast known topic: ")
		b.WriteString(topic)
	}
	return b.String()
}

// buildFollowUpPrompt is the dedicated prompt builder for follow-up
// mode. Kept separate from BuildSystemPrompt so the live-chat path
// stays clean.
//
// The rules block is opinionated:
//   - one short message (1-3 sentences)
//   - end with a question that prompts a reply
//   - light human WhatsApp style
//   - don't invent prices or commitments
//
// This is what makes the AI-generated follow-ups feel like a real
// person following up, not a marketing blast.
//
// mode='agentic' produces a different prompt: it asks the LLM to
// first DECIDE whether a follow-up is appropriate, and to return
// nothing if it isn't. The LLM is told to output "<NO_FOLLOWUP>" as
// a sentinel — which we then strip to an empty string before
// returning to the caller.
func buildFollowUpPrompt(cfg agentConfigRow, goal, lastTopic, tone, mode string) string {
	if mode == "agentic" {
		return buildAgenticFollowUpPrompt(cfg, goal, lastTopic, tone)
	}
	var b strings.Builder
	b.WriteString("You are ")
	b.WriteString(strings.TrimSpace(cfg.Name))
	if b.Len() == len("You are ") {
		b.WriteString("Assistant")
	}
	b.WriteString(", a sales assistant continuing a WhatsApp conversation.\n\n")

	b.WriteString("TONE: ")
	b.WriteString(strings.TrimSpace(tone))
	b.WriteString(". Stay in character. One short message, conversational, not pushy.\n\n")

	if persona := strings.TrimSpace(cfg.PersonaMd); persona != "" {
		b.WriteString("PERSONA:\n")
		b.WriteString(persona)
		b.WriteString("\n\n")
	}

	if goal != "" {
		b.WriteString("GOAL OF THIS FOLLOW-UP: ")
		b.WriteString(strings.TrimSpace(goal))
		b.WriteString("\n\n")
	} else {
		b.WriteString("GOAL OF THIS FOLLOW-UP: re-engage a warm lead who has gone quiet.\n\n")
	}

	if lastTopic != "" {
		b.WriteString("LAST REAL TOPIC IN THE CHAT: ")
		b.WriteString(strings.TrimSpace(lastTopic))
		b.WriteString("\n\n")
	}

	b.WriteString("RULES:\n")
	b.WriteString("- Reference the last topic naturally. Do not repeat it verbatim.\n")
	b.WriteString("- Plain text only. No markdown, no bullet lists, no links.\n")
	b.WriteString("- 1-3 sentences. End with a question that prompts a reply.\n")
	b.WriteString("- Sound like a real person checking in, not a campaign or bot.\n")
	b.WriteString("- Use at most one friendly emoji if it fits the tone. Skip emoji for complaints, payment issues, or sensitive conversations.\n")
	b.WriteString("- Never ask for the customer's phone number; WhatsApp already gives us the number.\n")
	b.WriteString("- Do not invent prices, features, or commitments. If you don't know, say you'll check and get back.\n")

	return b.String()
}

// buildAgenticFollowUpPrompt is the agentic-mode prompt. It instructs
// the LLM to first DECIDE whether a follow-up makes sense right now
// (don't be spammy, don't push someone who just paid, etc.) and
// only then write the message. The "<NO_FOLLOWUP>" sentinel is
// what makes the no-skip path observable to the caller — the
// orchestrator strips it before returning.
func buildAgenticFollowUpPrompt(cfg agentConfigRow, goal, lastTopic, tone string) string {
	var b strings.Builder
	b.WriteString("You are ")
	b.WriteString(strings.TrimSpace(cfg.Name))
	if b.Len() == len("You are ") {
		b.WriteString("Assistant")
	}
	b.WriteString(", a sales assistant continuing a WhatsApp conversation.\n\n")

	b.WriteString("TONE: ")
	b.WriteString(strings.TrimSpace(tone))
	if b.Len() == len("TONE: ") {
		b.WriteString("friendly")
	}
	b.WriteString(". Stay in character.\n\n")

	if persona := strings.TrimSpace(cfg.PersonaMd); persona != "" {
		b.WriteString("PERSONA:\n")
		b.WriteString(persona)
		b.WriteString("\n\n")
	}

	if goal != "" {
		b.WriteString("OVERALL GOAL: ")
		b.WriteString(strings.TrimSpace(goal))
		b.WriteString("\n\n")
	}

	if lastTopic != "" {
		b.WriteString("LAST REAL TOPIC IN THE CHAT: ")
		b.WriteString(strings.TrimSpace(lastTopic))
		b.WriteString("\n\n")
	}

	b.WriteString("DECIDE FIRST whether a follow-up is appropriate right now. Skip (output <NO_FOLLOWUP>) if:\n")
	b.WriteString("- the customer has paid or otherwise resolved the issue\n")
	b.WriteString("- we have already messaged them today (avoid spam)\n")
	b.WriteString("- they explicitly asked us to stop messaging\n")
	b.WriteString("- the last topic is too fresh — they'd be annoyed by a nudge right now\n")
	b.WriteString("- there is no good reason to reach out and you can't think of one\n\n")

	b.WriteString("OTHERWISE, write ONE short message (1-3 sentences) that:\n")
	b.WriteString("- references the last topic naturally (don't repeat it verbatim)\n")
	b.WriteString("- ends with a question that prompts a reply\n")
	b.WriteString("- is plain text (no markdown, no bullet lists, no links)\n")
	b.WriteString("- sounds like a real person checking in, not a campaign or bot\n")
	b.WriteString("- uses at most one friendly emoji if it fits, and no emoji for complaints/payment/sensitive topics\n")
	b.WriteString("- never asks for the customer's phone number because WhatsApp already gives it to us\n")
	b.WriteString("- does NOT invent prices, features, or commitments\n")
	b.WriteString("- feels like a real person, not a marketing blast\n\n")

	b.WriteString("OUTPUT FORMAT: either a single short message, or the literal token <NO_FOLLOWUP> on its own.\n")

	return b.String()
}

// historyToMessages converts the orchestrator's []llm.Message to the
// shape ChatRequest wants. We strip any Tags (debug metadata the LLM
// shouldn't see) and pass everything else through.
func historyToMessages(history []llm.Message) []llm.Message {
	if len(history) == 0 {
		return nil
	}
	out := make([]llm.Message, 0, len(history))
	for _, m := range history {
		out = append(out, llm.Message{
			Role:    m.Role,
			Content: m.Content,
			Name:    m.Name,
			ToolID:  m.ToolID,
		})
	}
	return out
}

// trimHistory returns the last N turns of the history slice (or all
// of it if shorter). Used to cap the follow-up context window.
func trimHistory(history []llm.Message, n int) []llm.Message {
	if len(history) <= n {
		return history
	}
	return history[len(history)-n:]
}
