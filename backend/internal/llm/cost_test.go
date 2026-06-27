package llm

import (
	"testing"
)

func TestCostFor(t *testing.T) {
	cases := []struct {
		name  string
		model string
		in    int
		out   int
		want  float64
	}{
		{"deepseek-mini", "bedrock:deepseek-v3.2", 1_000_000, 0, 1.00},
		{"deepseek-out", "bedrock:deepseek-v3.2", 0, 1_000_000, 2.50},
		{"deepseek-combo", "bedrock:deepseek-v3.2", 500_000, 500_000, 0.5*1.00 + 0.5*2.50},
		{"sonnet-in", "bedrock:claude-sonnet-4.5", 1_000_000, 0, 3.00},
		{"sonnet-out", "bedrock:claude-sonnet-4.5", 0, 1_000_000, 15.00},
		{"haiku-in", "bedrock:claude-haiku-4.5", 1_000_000, 0, 0.80},
		{"haiku-out", "bedrock:claude-haiku-4.5", 0, 1_000_000, 4.00},
		{"gpt41-in", "openai:gpt-4.1", 1_000_000, 0, 2.00},
		{"gpt41mini-in", "openai:gpt-4.1-mini", 1_000_000, 0, 0.40},
		{"embed3small", "text-embedding-3-small", 1_000_000, 0, 0.02},
		{"unknown", "deepseek-v8-from-the-future", 1_000_000, 0, 0},
		{"zero", "bedrock:deepseek-v3.2", 0, 0, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := CostFor(tc.model, Usage{InputTokens: tc.in, OutputTokens: tc.out})
			if !approxEqual(got, tc.want, 1e-6) {
				t.Errorf("CostFor(%q, %d in, %d out) = %v, want %v",
					tc.model, tc.in, tc.out, got, tc.want)
			}
		})
	}
}

func TestEmbeddingCost(t *testing.T) {
	cases := []struct {
		model string
		toks  int
		want  float64
	}{
		{"text-embedding-3-small", 1_000_000, 0.02},
		{"text-embedding-3-small", 0, 0},
		{"text-embedding-3-large", 1_000_000, 0.13},
		{"unknown", 1_000_000, 0},
	}
	for _, tc := range cases {
		t.Run(tc.model, func(t *testing.T) {
			got := EmbeddingCost(tc.model, tc.toks)
			if !approxEqual(got, tc.want, 1e-6) {
				t.Errorf("EmbeddingCost(%q, %d) = %v, want %v",
					tc.model, tc.toks, got, tc.want)
			}
		})
	}
}

func TestIsKnownModel(t *testing.T) {
	known := []string{"bedrock:deepseek-v3.2", "bedrock:claude-sonnet-4.5", "openai:gpt-4.1"}
	for _, m := range known {
		if !IsKnownModel(m) {
			t.Errorf("IsKnownModel(%q) = false, want true", m)
		}
	}
	if IsKnownModel("definitely-not-a-real-model") {
		t.Error("IsKnownModel returned true for an unknown model")
	}
}

func TestKnownModelsCoversAllAliases(t *testing.T) {
	// The KnownModels list should be non-empty AND should include at
	// least one alias from each family.
	models := KnownModels()
	if len(models) == 0 {
		t.Fatal("KnownModels returned empty list")
	}
	want := map[string]bool{
		"bedrock:deepseek-v3.2":    true,
		"bedrock:claude-sonnet-4.5": true,
		"bedrock:claude-haiku-4.5":  true,
		"openai:gpt-4.1":           true,
		"openai:gpt-4.1-mini":      true,
		"text-embedding-3-small":   true,
	}
	for m := range want {
		found := false
		for _, k := range models {
			if k == m {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("KnownModels missing %q", m)
		}
	}
}

// approxEqual compares two floats within an epsilon. We use this
// instead of a direct == to avoid false-positives from IEEE rounding.
func approxEqual(a, b, eps float64) bool {
	d := a - b
	if d < 0 {
		d = -d
	}
	return d <= eps
}