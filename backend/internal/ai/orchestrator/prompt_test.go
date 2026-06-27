package orchestrator

import (
	"strings"
	"testing"

	"github.com/whatsyitc/backend/internal/ai/retrieval"
	"github.com/whatsyitc/backend/internal/llm"
)

func TestBuildSystemPromptContainsIdentity(t *testing.T) {
	got := BuildSystemPrompt(agentConfigRow{
		Name:         "Riya",
		Tone:         "friendly",
		SystemPrompt: "Answer briefly.",
	}, nil, nil, 17)
	for _, want := range []string{"Riya", "friendly", "Answer briefly.", "17"} {
		if !strings.Contains(got, want) {
			t.Errorf("prompt missing %q\nfull: %s", want, got)
		}
	}
}

func TestBuildSystemPromptIncludesKBContext(t *testing.T) {
	chunks := []retrieval.RetrievedChunk{
		{ID: 7, Title: "Hours", Content: "Mon-Sat 9am-9pm", SourceType: "manual"},
		{ID: 8, Title: "Location", Content: "MG Road", SourceType: "manual"},
	}
	got := BuildSystemPrompt(agentConfigRow{Name: "Riya"}, nil, chunks, 1)
	// FormatForPrompt emits "[1] Title — content" or "[1] content".
	if !strings.Contains(got, "[1]") || !strings.Contains(got, "Mon-Sat") {
		t.Errorf("prompt missing KB block\nfull: %s", got)
	}
}

func TestBuildSystemPromptNoChunksNoBlock(t *testing.T) {
	got := BuildSystemPrompt(agentConfigRow{Name: "Riya"}, nil, nil, 1)
	if !strings.Contains(got, "No matching KB entries") {
		t.Errorf("prompt should explicitly tell the model no KB matched\nfull: %s", got)
	}
}

func TestBuildSystemPromptMentionsTools(t *testing.T) {
	got := BuildSystemPrompt(agentConfigRow{Name: "Riya"}, nil, nil, 1)
	for _, want := range []string{"capture_lead", "qualify_lead", "transfer_to_human"} {
		if !strings.Contains(got, want) {
			t.Errorf("prompt should describe tool %q", want)
		}
	}
}

func TestBuildSystemPromptIncludesRules(t *testing.T) {
	got := BuildSystemPrompt(agentConfigRow{Name: "Riya"}, nil, nil, 1)
	for _, want := range []string{
		"Rules:",
		"source of truth",
		"Do NOT answer from memory",
		"capture_lead",
		"transfer_to_human",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("prompt missing rule fragment %q\nfull: %s", want, got)
		}
	}
}

func TestClassifyIntent(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"What is the price?", "pricing"},
		{"kitna padega", "pricing"},
		{"I want to buy 5kg", "purchase"},
		{"refund please", "objection"},
		{"human please", "handoff_request"},
		{"hello there", "general"},
	}
	for _, tc := range cases {
		if got := classifyIntent(tc.in); got != tc.want {
			t.Errorf("classifyIntent(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestTruncate was removed: the helper `truncate()` from the legacy
// code was only used inside the chat-summary path which we didn't
// port (the live orchestrator summarises differently). The string
// truncation behaviour is covered by retrieval/FormatForPrompt's
// 800-char cap.

// Ensure Message history is unused by the prompt builder (sanity
// check — the agent loop puts history into the messages list, not
// the system prompt). Kept as a regression test for future changes.
func TestBuildSystemPromptIgnoresHistory(t *testing.T) {
	history := []llm.Message{{Role: llm.RoleUser, Content: "earlier question"}}
	got := BuildSystemPrompt(agentConfigRow{Name: "Riya"}, history, nil, 1)
	if strings.Contains(got, "earlier question") {
		t.Errorf("prompt should not include history in system prompt")
	}
}

func TestHistoryForLLMDropsHistoryWhenKBExists(t *testing.T) {
	history := []llm.Message{
		{Role: llm.RoleUser, Content: "Which products do you have?"},
		{Role: llm.RoleAssistant, Content: "We sell sarees and kurtas."},
	}
	chunks := []retrieval.RetrievedChunk{{ID: 1, Title: "Sweets", Content: "We sell ladoo."}}
	if got := historyForLLM(history, chunks); len(got) != 0 {
		t.Fatalf("historyForLLM returned %d messages with KB present, want 0", len(got))
	}
	if got := historyForLLM(history, nil); len(got) != len(history) {
		t.Fatalf("historyForLLM without KB returned %d messages, want %d", len(got), len(history))
	}
}
