// Package llm is the multi-provider LLM abstraction for WhatsyITC.
//
// It exposes a single Provider interface and ships three concrete
// implementations:
//
//   - Bedrock (DeepSeek V3.2 primary, Claude Sonnet / Haiku for premium
//     and cheap tiers respectively).
//   - OpenAI  (fallback LLM + embedding provider).
//   - Deepgram (audio transcription; separate because the response
//     shape is fundamentally different).
//
// All providers return a unified StreamEvent channel so the agent loop
// in the aibrain package never has to branch on provider.
//
// Failover is handled by the Failover wrapper — the router picks the
// primary model based on the routing context (lead tier, query
// complexity, retrieval confidence) and the failover walks the chain
// on any provider error.
package llm

import (
	"context"
	"encoding/json"
)

// Role enumerates who produced a message in a chat.
type Role string

const (
	RoleSystem    Role = "system"
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
	RoleTool      Role = "tool"
)

// Message is a single turn in a chat. The Tags field is free-form and
// lets the agent loop attach trace metadata (e.g. "router=deepseek",
// "retrieved=3") without polluting the LLM input.
//
// Images carries multimodal content (Phase 6 image understanding).
// When non-empty, providers render the message as a multi-part content
// block (OpenAI: array of {type, text|image_url}; Bedrock: array of
// {text|image}). The LLM is responsible for describing what's in the
// image when the customer sends one.
type Message struct {
	Role    Role           `json:"role"`
	Content string         `json:"content"`
	Name    string         `json:"name,omitempty"`    // for role=tool: which tool replied
	ToolID  string         `json:"tool_call_id,omitempty"`
	Tags    map[string]any `json:"tags,omitempty"`    // trace metadata (NOT sent to LLM)
	Images  []ImageURL     `json:"images,omitempty"`  // Phase 6: multimodal
}

// ImageURL is a single image attached to a user message. URL is the
// publicly fetchable URL (https://...) — providers that need bytes
// fetch them server-side. Detail is the OpenAI "low|high|auto"
// resolution hint; Bedrock ignores it.
type ImageURL struct {
	URL    string `json:"url"`
	Detail string `json:"detail,omitempty"` // "low" | "high" | "auto"; empty = auto
}

// ToolDef describes one function the LLM is allowed to call. The
// JSONSchema is what we pass verbatim to each provider — we keep it
// raw to avoid leaking provider-specific field names (Bedrock uses
// "inputSchema", OpenAI uses "parameters", etc.).
type ToolDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	JSONSchema  json.RawMessage `json:"json_schema"`
}

// ToolCall is one tool invocation the model wants to make. Args is the
// raw JSON object the LLM produced; the caller validates it against
// the tool's schema before executing.
type ToolCall struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Args  json.RawMessage `json:"args"`
}

// Usage is what every provider reports back. Cost is computed by the
// cost package (not the provider) so we keep one source of truth for
// pricing.
type Usage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

// StreamEvent is the union of all events a streaming LLM call can emit.
// Consumers switch on type — see the typed events below.
type StreamEvent interface{ isStreamEvent() }

func (TextDeltaEvent) isStreamEvent()         {}
func (ToolCallStartEvent) isStreamEvent()     {}
func (ToolCallDeltaEvent) isStreamEvent()     {}
func (ToolCallCompleteEvent) isStreamEvent()  {}
func (UsageEvent) isStreamEvent()             {}
func (DoneEvent) isStreamEvent()              {}
func (ErrorEvent) isStreamEvent()             {}

// TextDeltaEvent is a chunk of assistant text. Concatenate these in
// order to get the final message.
type TextDeltaEvent struct {
	Text string
}

// ToolCallStartEvent fires when the model begins a tool call. The
// final ToolCallCompleteEvent gives the parsed arguments.
type ToolCallStartEvent struct {
	ID   string
	Name string
}

// ToolCallDeltaEvent fires for partial argument JSON during streaming.
// Useful for showing a "thinking…" preview in the admin UI; not
// required for correctness.
type ToolCallDeltaEvent struct {
	ID    string
	Delta json.RawMessage
}

// ToolCallCompleteEvent fires when a tool call's arguments are fully
// received and parseable as JSON.
type ToolCallCompleteEvent struct {
	Call ToolCall
}

// UsageEvent fires once per response with the final token counts.
type UsageEvent struct {
	Usage Usage
}

// DoneEvent fires as the last event of a successful stream. StopReason
// is the provider's reason (end_turn, tool_use, max_tokens, ...).
type DoneEvent struct {
	StopReason string
}

// ErrorEvent fires when the stream terminates with an error. The
// caller decides whether to fail or fall through to the next provider.
type ErrorEvent struct {
	Err     error
	Fatal   bool   // Fatal errors skip failover (e.g. context cancelled)
	Message string
}

// ChatRequest is everything needed to make one LLM call. The agent
// loop builds this in a single place so routing decisions stay
// traceable.
type ChatRequest struct {
	Model       string    // provider-specific model id (or alias — resolved by Router)
	System      string    // system prompt
	Messages    []Message // history (already trimmed to fit the window)
	Tools       []ToolDef // function definitions; empty slice = no tools
	Temperature float64   // 0.0–2.0
	MaxTokens   int       // hard cap; provider clamps to its own limit

	// Trace metadata for observability. NOT sent to the LLM.
	BusinessID     int64
	ConversationID int64
	Intent         string // e.g. "faq" | "qualify" | "objection" | "general"
	RequestID      string // for log correlation
}

// Cost returns the dollar cost for a given model + usage. The cost
// table is in cost.go and is the single source of truth used by
// every provider wrapper.
func (r ChatRequest) Cost(u Usage) float64 { return CostFor(r.Model, u) }

// TextSender is a minimal interface for "send plain text to a
// WhatsApp number". Defined here (rather than in handlers or
// orchestrator) so any package can depend on it without cycles.
//
// The orchestrator.Sender interface is identical in shape; this
// alias exists for callers (e.g. MediaHandler) that want the
// surface without pulling in the orchestrator package.
type TextSender interface {
	SendText(ctx context.Context, to, body string) error
}

// ChatResponse is what non-streaming callers get. Most callers should
// prefer Stream, but Chat is useful for tests and small utility calls
// (e.g. the LLM-test playground can call Chat to summarise a thread).
type ChatResponse struct {
	Text       string
	ToolCalls  []ToolCall
	Usage      Usage
	StopReason string
	Model      string
	Provider   string
}
