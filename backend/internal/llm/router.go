package llm

import (
	"log/slog"
)

// RoutingContext is the input to a routing decision. The agent loop
// populates this from the conversation + retrieval result before each
// LLM call.
type RoutingContext struct {
	// BusinessTier is "standard" by default. Premium businesses always
	// route to the strongest model regardless of other signals.
	BusinessTier string

	// QueryComplexity is a 0-1 score produced by the agent loop. High
	// complexity (multi-turn reasoning, ambiguous queries) routes to
	// premium. Low complexity (simple FAQ) routes to cheap.
	QueryComplexity float64

	// RetrievalConfidence is the top-1 cosine similarity from the
	// hybrid retrieval. >= faqThreshold means "the KB has the answer"
	// → use Haiku (cheap exact-match path).
	RetrievalConfidence float64

	// Intent is the agent's classified intent ("faq", "qualify",
	// "objection", "general", ...). Used as a tie-breaker.
	Intent string

	// HasExactKBMatch is set when the top retrieved chunk has a very
	// high confidence AND matches the intent — the cheapest path.
	HasExactKBMatch bool

	// ConversationLength grows with each turn. We cap cheap-tier use
	// after N turns so a long conversation eventually gets Sonnet even
	// if every individual query looks simple.
	ConversationLength int
}

// RoutingDecision is the output of the router. The agent loop sends
// req.Model = decision.Model to the failover wrapper, which dispatches
// to the right provider.
type RoutingDecision struct {
	Model    string // e.g. "bedrock:deepseek-v3.2"
	Provider string // "bedrock" | "openai"
	Tier     string // "premium" | "standard" | "cheap"
	Reason   string // human-readable, logged for observability
}

// RoutingRules is the configurable policy. Default values come from
// ai_agent_config.faq_confidence_threshold + sensible defaults baked
// here.
type RoutingRules struct {
	PremiumModel       string  // "bedrock:claude-sonnet-4.5"
	DefaultModel       string  // "bedrock:deepseek-v3.2"
	CheapModel         string  // "bedrock:claude-haiku-4.5"
	FAQConfidence      float64 // default 0.92
	PremiumComplexity  float64 // default 0.7
	LongConvThreshold int     // default 8 turns
}

// DefaultRoutingRules returns the production defaults. Tests use this
// verbatim; admins can override per-business in Phase 1's UI.
func DefaultRoutingRules() RoutingRules {
	return RoutingRules{
		PremiumModel:       "bedrock:claude-sonnet-4.5",
		DefaultModel:       "bedrock:deepseek-v3.2",
		CheapModel:         "bedrock:claude-haiku-4.5",
		FAQConfidence:      0.92,
		PremiumComplexity:  0.7,
		LongConvThreshold:  8,
	}
}

// Router picks the model + tier for each LLM call based on the routing
// context and the configured rules.
//
// The router is pure: no I/O, no goroutines. It runs on every LLM
// call so its cost matters; we keep the function body small.
type Router struct {
	rules RoutingRules
}

// NewRouter builds a router with the supplied rules. Empty rules get
// DefaultRoutingRules so callers can't accidentally disable routing.
func NewRouter(rules RoutingRules) *Router {
	if rules.DefaultModel == "" {
		rules = DefaultRoutingRules()
	}
	return &Router{rules: rules}
}

// Decide picks the (model, tier) for the given context. The decision
// is deterministic — same input, same output — so the metrics
// dashboard can attribute every call to a reason.
func (r *Router) Decide(ctx RoutingContext) RoutingDecision {
	rules := r.rules

	// Premium tier wins over everything else (admin override).
	if ctx.BusinessTier == "premium" {
		return RoutingDecision{
			Model:    rules.PremiumModel,
			Provider: "bedrock",
			Tier:     "premium",
			Reason:   "business_tier=premium",
		}
	}

	// Cheap exact-match path: KB has the answer, send it to Haiku.
	if ctx.HasExactKBMatch || ctx.RetrievalConfidence >= rules.FAQConfidence {
		return RoutingDecision{
			Model:    rules.CheapModel,
			Provider: "bedrock",
			Tier:     "cheap",
			Reason:   "exact_kb_match",
		}
	}

	// High-complexity or long-conversation → premium.
	if ctx.QueryComplexity >= rules.PremiumComplexity {
		return RoutingDecision{
			Model:    rules.PremiumModel,
			Provider: "bedrock",
			Tier:     "premium",
			Reason:   "high_complexity",
		}
	}
	if ctx.ConversationLength >= rules.LongConvThreshold {
		return RoutingDecision{
			Model:    rules.PremiumModel,
			Provider: "bedrock",
			Tier:     "premium",
			Reason:   "long_conversation",
		}
	}

	// Default.
	return RoutingDecision{
		Model:    rules.DefaultModel,
		Provider: "bedrock",
		Tier:     "standard",
		Reason:   "default",
	}
}

// Observe is the metrics sink the agent loop calls after each LLM
// call. We log at debug so it stays out of prod logs by default.
func (r *Router) Observe(d RoutingDecision, u Usage, latencyMs int, err error) {
	slog.Debug("llm_call",
		"model", d.Model,
		"provider", d.Provider,
		"tier", d.Tier,
		"reason", d.Reason,
		"input_tokens", u.InputTokens,
		"output_tokens", u.OutputTokens,
		"latency_ms", latencyMs,
		"cost_usd", CostFor(d.Model, u),
		"err", errStr(err),
	)
}

// --- helpers ---

// errStr safely renders an error for logging without panicking on nil.
func errStr(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}