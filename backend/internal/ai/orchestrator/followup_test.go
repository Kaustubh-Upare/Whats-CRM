package orchestrator

import (
	"strings"
	"testing"
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
