package orchestrator

import (
	"strings"
	"testing"

	"github.com/whatsyitc/backend/internal/ai/retrieval"
)

func TestFallbackInboundReplyNeverUsesNoResponse(t *testing.T) {
	got := fallbackInboundReply("Okay tell me about the products", nil)
	if strings.Contains(strings.ToLower(got), "(no response)") {
		t.Fatalf("fallback leaked no response marker: %q", got)
	}
	if strings.TrimSpace(got) == "" {
		t.Fatal("fallback returned empty reply")
	}
}

func TestFallbackInboundReplyUsesKnowledgeSnippet(t *testing.T) {
	got := fallbackInboundReply("Okay tell me about the products", []retrieval.RetrievedChunk{
		{Content: "We sell kaju katli, ladoo, gulab jamun, and rasgulla boxes for bulk orders."},
	})
	if !strings.Contains(got, "kaju katli") {
		t.Fatalf("fallback did not use knowledge snippet: %q", got)
	}
	if strings.Contains(strings.ToLower(got), "(no response)") {
		t.Fatalf("fallback leaked no response marker: %q", got)
	}
}
