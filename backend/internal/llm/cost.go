package llm

// Per-token pricing in USD. Numbers are conservative mid-2026 estimates
// for the Bedrock marketplace and OpenAI list price; refresh in this
// file when providers change rates.
//
// Costs are deliberately over-stated slightly so dashboards never
// under-report.

type priceRow struct {
	inputPerMTok  float64 // $ per 1M input tokens
	outputPerMTok float64 // $ per 1M output tokens
}

// prices is keyed by the same model id used in ChatRequest.Model.
// Aliases (e.g. "bedrock:deepseek-v3.2") are normalised in CostFor.
var prices = map[string]priceRow{
	// Bedrock — DeepSeek V3.2 (typical marketplace rate).
	"bedrock:deepseek-v3.2":           {inputPerMTok: 1.00, outputPerMTok: 2.50},
	"deepseek.deepseek-v3-2":          {inputPerMTok: 1.00, outputPerMTok: 2.50},

	// Bedrock — Claude Sonnet 4.5 (latest at time of writing).
	"bedrock:claude-sonnet-4.5":       {inputPerMTok: 3.00, outputPerMTok: 15.00},
	"anthropic.claude-sonnet-4-5-20250929": {inputPerMTok: 3.00, outputPerMTok: 15.00},

	// Bedrock — Claude Haiku 4.5.
	"bedrock:claude-haiku-4.5":        {inputPerMTok: 0.80, outputPerMTok: 4.00},
	"anthropic.claude-haiku-4-5-20251001": {inputPerMTok: 0.80, outputPerMTok: 4.00},

	// OpenAI — gpt-4.1 family.
	"openai:gpt-4.1":                  {inputPerMTok: 2.00, outputPerMTok: 8.00},
	"openai:gpt-4.1-mini":             {inputPerMTok: 0.40, outputPerMTok: 1.60},
	"gpt-4.1":                         {inputPerMTok: 2.00, outputPerMTok: 8.00},
	"gpt-4.1-mini":                    {inputPerMTok: 0.40, outputPerMTok: 1.60},

	// OpenAI — embeddings.
	"text-embedding-3-small":          {inputPerMTok: 0.02, outputPerMTok: 0.0},
	"text-embedding-3-large":          {inputPerMTok: 0.13, outputPerMTok: 0.0},

	// Deepgram — Nova-2 (charged per minute of audio, not per token).
	// Stored here so a single CostFor("deepgram:nova-2", Usage{}) call
	// returns 0 (Deepgram cost is computed from duration in deepgram.go).
}

// CostFor returns the dollar cost for a model + token usage. Returns 0
// when the model is unknown (we'd rather under-report than halt on a
// typo — the metrics dashboard will surface this as zero-cost rows).
//
// Costs are returned in dollars (not cents). Round at the persistence
// layer, not here.
func CostFor(model string, u Usage) float64 {
	row, ok := prices[model]
	if !ok {
		return 0
	}
	in := float64(u.InputTokens) / 1_000_000.0 * row.inputPerMTok
	out := float64(u.OutputTokens) / 1_000_000.0 * row.outputPerMTok
	return in + out
}

// EmbeddingCost returns the dollar cost to embed `textTokens` tokens
// using the named embedding model.
func EmbeddingCost(model string, textTokens int) float64 {
	row, ok := prices[model]
	if !ok {
		return 0
	}
	return float64(textTokens) / 1_000_000.0 * row.inputPerMTok
}

// KnownModels returns the list of model ids we have pricing for. Useful
// for the test playground's model dropdown.
func KnownModels() []string {
	out := make([]string, 0, len(prices))
	for k := range prices {
		out = append(out, k)
	}
	return out
}

// IsKnownModel returns true if we have pricing for the given model id.
func IsKnownModel(model string) bool {
	_, ok := prices[model]
	return ok
}
