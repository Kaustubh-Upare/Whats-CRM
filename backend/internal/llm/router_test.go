package llm

import (
	"testing"
)

func TestRouterDecide(t *testing.T) {
	r := NewRouter(DefaultRoutingRules())

	cases := []struct {
		name       string
		ctx        RoutingContext
		wantTier   string
		wantReason string
	}{
		{
			name:       "premium_business_wins_over_all",
			ctx:        RoutingContext{BusinessTier: "premium"},
			wantTier:   "premium",
			wantReason: "business_tier=premium",
		},
		{
			name:       "exact_kb_match_routes_cheap",
			ctx:        RoutingContext{HasExactKBMatch: true},
			wantTier:   "cheap",
			wantReason: "exact_kb_match",
		},
		{
			name:       "high_retrieval_confidence_routes_cheap",
			ctx:        RoutingContext{RetrievalConfidence: 0.95},
			wantTier:   "cheap",
			wantReason: "exact_kb_match",
		},
		{
			name:       "high_complexity_routes_premium",
			ctx:        RoutingContext{QueryComplexity: 0.9},
			wantTier:   "premium",
			wantReason: "high_complexity",
		},
		{
			name:       "long_conversation_routes_premium",
			ctx:        RoutingContext{ConversationLength: 12},
			wantTier:   "premium",
			wantReason: "long_conversation",
		},
		{
			name:       "default",
			ctx:        RoutingContext{},
			wantTier:   "standard",
			wantReason: "default",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := r.Decide(tc.ctx)
			if d.Tier != tc.wantTier {
				t.Errorf("tier = %q, want %q", d.Tier, tc.wantTier)
			}
			if d.Reason != tc.wantReason {
				t.Errorf("reason = %q, want %q", d.Reason, tc.wantReason)
			}
			if d.Model == "" {
				t.Error("model is empty")
			}
			if d.Provider == "" {
				t.Error("provider is empty")
			}
		})
	}
}

func TestRouterDefaults(t *testing.T) {
	rules := DefaultRoutingRules()
	if rules.PremiumModel == "" || rules.DefaultModel == "" || rules.CheapModel == "" {
		t.Fatal("default rules have empty model ids")
	}
	if rules.FAQConfidence <= 0 || rules.FAQConfidence > 1 {
		t.Errorf("FAQConfidence out of range: %v", rules.FAQConfidence)
	}
	if rules.PremiumComplexity <= 0 || rules.PremiumComplexity > 1 {
		t.Errorf("PremiumComplexity out of range: %v", rules.PremiumComplexity)
	}
}

func TestRouterEmptyRulesFallsBackToDefaults(t *testing.T) {
	r := NewRouter(RoutingRules{})
	d := r.Decide(RoutingContext{})
	if d.Tier != "standard" {
		t.Errorf("empty-rules router default tier = %q, want %q", d.Tier, "standard")
	}
}

func TestRouterObservationDoesNotPanic(t *testing.T) {
	// Observe is a debug logger — must never panic, even with weird
	// input. We can't easily assert log output without a custom
	// handler so we just call it.
	r := NewRouter(DefaultRoutingRules())
	r.Observe(r.Decide(RoutingContext{}), Usage{InputTokens: 10, OutputTokens: 20}, 100, nil)
	r.Observe(r.Decide(RoutingContext{}), Usage{InputTokens: 0, OutputTokens: 0}, 0, errBoom{})
}

// errBoom is a tiny test-only error type for the Observe test.
type errBoom struct{}

func (errBoom) Error() string { return "boom" }