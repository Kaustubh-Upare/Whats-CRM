package handlers

import (
	"strings"
	"testing"
)

func TestChunkTextForKBGenerationSplitsLongInput(t *testing.T) {
	long := strings.Repeat("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu. ", 450)
	parts := chunkTextForKBGeneration(long)
	if len(parts) < 2 {
		t.Fatalf("expected long input to split into multiple parts, got %d", len(parts))
	}
	if !strings.Contains(parts[1], "alpha") {
		t.Fatalf("expected overlap context in later part, got %q", parts[1][:min(80, len(parts[1]))])
	}
}

func TestParseGeneratedKBProposalsHandlesFencedJSON(t *testing.T) {
	raw := "```json\n" +
		`[{"title":"Refund policy","content":"Refunds are accepted within 30 days.","category":"policy","tags":["refund","30-days"]}]` +
		"\n```"
	got, err := parseGeneratedKBProposals(raw, 1, 3)
	if err != nil {
		t.Fatalf("parseGeneratedKBProposals error = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if got[0].Title != "Refund policy" || got[0].PartIndex != 1 || got[0].PartCount != 3 {
		t.Fatalf("unexpected proposal: %+v", got[0])
	}
}

func TestDedupeGeneratedKBProposalsMergesExactOverlap(t *testing.T) {
	in := []generatedKBProposal{
		{
			Title:    "Refund policy",
			Content:  "Refunds are accepted within 30 days.",
			Category: "policy",
			Tags:     []string{"refund"},
		},
		{
			Title:    "",
			Content:  "  refunds are accepted within 30 days.  ",
			Category: "policy",
			Tags:     []string{"30-days"},
		},
	}
	got := dedupeGeneratedKBProposals(in)
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if got[0].Title != "Refund policy" {
		t.Fatalf("title = %q, want Refund policy", got[0].Title)
	}
	if len(got[0].Tags) != 2 {
		t.Fatalf("tags = %v, want merged tags", got[0].Tags)
	}
}

func TestChunkTextForKBImportSplitsSourcePreservingChunks(t *testing.T) {
	long := strings.Repeat("Pricing starts at 999 rupees for the starter pack. Delivery is available pan India. ", 500)
	parts := chunkTextForKBImport(long)
	if len(parts) < 2 {
		t.Fatalf("expected import text to split into multiple parts, got %d", len(parts))
	}
	if !strings.Contains(parts[0], "Pricing starts") {
		t.Fatalf("expected first part to keep source text, got %q", parts[0][:min(80, len(parts[0]))])
	}
	if !strings.Contains(parts[1], "Delivery is available") {
		t.Fatalf("expected later part to keep source text, got %q", parts[1][:min(80, len(parts[1]))])
	}
}

func TestFallbackKBMetadataUsesSourceAndInference(t *testing.T) {
	meta := fallbackKBMetadata("Summer catalog", "Product stock and pricing are updated every Monday.", 0, 2)
	if !strings.Contains(meta.Title, "Summer catalog") {
		t.Fatalf("title = %q, want source name", meta.Title)
	}
	if meta.Category != "billing" {
		t.Fatalf("category = %q, want billing because pricing is present", meta.Category)
	}
	if len(meta.Tags) == 0 {
		t.Fatalf("expected fallback tags")
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
