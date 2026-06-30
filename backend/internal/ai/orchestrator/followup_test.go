package orchestrator

import (
	"strings"
	"testing"

	"github.com/whatsyitc/backend/internal/ai/retrieval"
)

func TestBuildFollowUpUserInstructionDefaultIncludesRealUserTurn(t *testing.T) {
	got := buildFollowUpUserInstruction("pricing", "custom")

	if !strings.Contains(got, "Write the single best next WhatsApp follow-up") {
		t.Fatalf("instruction missing follow-up request: %q", got)
	}
	if !strings.Contains(got, "Last known topic: pricing") {
		t.Fatalf("instruction missing topic: %q", got)
	}
}

func TestBuildFollowUpUserInstructionAgenticAllowsSkip(t *testing.T) {
	got := buildFollowUpUserInstruction("", "agentic")

	if !strings.Contains(got, "<NO_FOLLOWUP>") {
		t.Fatalf("agentic instruction missing skip token: %q", got)
	}
}

func TestIsExplicitNoFollowUpRequiresSentinel(t *testing.T) {
	if !isExplicitNoFollowUp("<NO_FOLLOWUP>", "") {
		t.Fatal("plain sentinel should be treated as explicit skip")
	}
	if !isExplicitNoFollowUp("<customer_reply>\n<NO_FOLLOWUP>\n</customer_reply>", "<NO_FOLLOWUP>") {
		t.Fatal("tagged sentinel should be treated as explicit skip")
	}
	if isExplicitNoFollowUp("<customer_reply>\n</customer_reply>\n<｜DSML｜function_calls", "") {
		t.Fatal("empty reply/internal marker should not be treated as explicit skip")
	}
}

func TestFallbackFollowUpBodyUsesTopic(t *testing.T) {
	got := fallbackFollowUpBody("", "bulk pricing", nil)
	if !strings.Contains(got, "bulk pricing") {
		t.Fatalf("fallback missing topic: %q", got)
	}
	if strings.Contains(strings.ToLower(got), "phone") {
		t.Fatalf("fallback should not ask for phone: %q", got)
	}
}

func TestBuildFollowUpPromptIncludesKnowledgeWhenAvailable(t *testing.T) {
	got := buildFollowUpPrompt(
		agentConfigRow{Name: "Kast"},
		"sell sweets",
		"kaju katli",
		"friendly",
		"custom",
		[]retrieval.RetrievedChunk{{ID: 1, Title: "Catalog", Content: "Kaju katli boxes are available in 500g and 1kg packs."}},
	)

	if !strings.Contains(got, "RELEVANT KNOWLEDGE BASE") {
		t.Fatalf("prompt missing knowledge section: %q", got)
	}
	if !strings.Contains(got, "Kaju katli boxes") {
		t.Fatalf("prompt missing KB content: %q", got)
	}
	if !strings.Contains(got, "Only mention exact products") {
		t.Fatalf("prompt missing grounded knowledge rule: %q", got)
	}
}

func TestBuildFollowUpPromptWithoutKnowledgeAllowsGenericNudge(t *testing.T) {
	got := buildFollowUpPrompt(
		agentConfigRow{Name: "Kast"},
		"",
		"",
		"friendly",
		"custom",
		nil,
	)

	if strings.Contains(got, "RELEVANT KNOWLEDGE BASE") {
		t.Fatalf("prompt should not include empty knowledge section: %q", got)
	}
	if !strings.Contains(got, "No matching knowledge was found") {
		t.Fatalf("prompt missing no-knowledge rule: %q", got)
	}
	if !strings.Contains(got, "do not invent catalog") {
		t.Fatalf("prompt should guard against invented facts: %q", got)
	}
}
