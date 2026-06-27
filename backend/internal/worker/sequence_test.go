package worker

import (
	"testing"
	"time"
)

// TestRenderSeqTemplate_SubstitutesKnownVars is the core template test.
func TestRenderSeqTemplate_SubstitutesKnownVars(t *testing.T) {
	lead := map[string]string{
		"lead.name":     "Rohit",
		"lead.phone":    "919876543210",
		"lead.interest": "2 kg gulab jamun",
		"lead.budget":   "5000",
	}
	in := "Hi {{lead.name}}, your order for {{lead.interest}} (₹{{lead.budget}}) was received on {{lead.phone}}."
	out := renderSeqTemplate(in, lead)
	want := "Hi Rohit, your order for 2 kg gulab jamun (₹5000) was received on 919876543210."
	if out != want {
		t.Fatalf("renderSeqTemplate mismatch:\n got:  %q\n want: %q", out, want)
	}
}

// TestRenderSeqTemplate_LeavesUnknownTokensAsIs catches typos in the
// template editor — we want admins to notice {{lead.nmae}} in the
// inbox, not have it silently disappear.
func TestRenderSeqTemplate_LeavesUnknownTokensAsIs(t *testing.T) {
	lead := map[string]string{"lead.name": "Asha"}
	in := "Hello {{lead.name}}, typo test: {{lead.nmae}}"
	out := renderSeqTemplate(in, lead)
	want := "Hello Asha, typo test: {{lead.nmae}}"
	if out != want {
		t.Fatalf("renderSeqTemplate mismatch:\n got:  %q\n want: %q", out, want)
	}
}

// TestRenderSeqTemplate_EmptyInputs covers the no-op edge cases.
func TestRenderSeqTemplate_EmptyInputs(t *testing.T) {
	if got := renderSeqTemplate("", map[string]string{"lead.name": "x"}); got != "" {
		t.Errorf("empty template should return empty, got %q", got)
	}
	if got := renderSeqTemplate("static text", nil); got != "static text" {
		t.Errorf("nil lead should pass through, got %q", got)
	}
	if got := renderSeqTemplate("static text", map[string]string{}); got != "static text" {
		t.Errorf("empty lead should pass through, got %q", got)
	}
}

// TestRenderSeqTemplate_UnterminatedToken: a stray "{{" with no
// matching "}}" is left alone (better than panicking).
func TestRenderSeqTemplate_UnterminatedToken(t *testing.T) {
	lead := map[string]string{"lead.name": "Asha"}
	in := "Hello {{lead.name, your order for {{lead.interest"
	out := renderSeqTemplate(in, lead)
	want := "Hello {{lead.name, your order for {{lead.interest"
	if out != want {
		t.Fatalf("renderSeqTemplate mismatch:\n got:  %q\n want: %q", out, want)
	}
}

// TestSeqLeadVars exercises the var map builder, including the
// int->str score conversion.
func TestSeqLeadVars(t *testing.T) {
	v := seqLeadVars("Rohit", "919876543210", "r@x.com", "gulab jamun",
		"5000", "tomorrow", "Mumbai", "qualified", 85)
	if v["lead.name"] != "Rohit" {
		t.Errorf("name = %q", v["lead.name"])
	}
	if v["lead.score"] != "85" {
		t.Errorf("score = %q", v["lead.score"])
	}
	if v["lead.status"] != "qualified" {
		t.Errorf("status = %q", v["lead.status"])
	}
}

// TestSeqBackoff_ExponentialSequence checks the three retry intervals.
func TestSeqBackoff_ExponentialSequence(t *testing.T) {
	if got := seqBackoff(1); got != 2*time.Second {
		t.Errorf("attempt 1 = %v", got)
	}
	if got := seqBackoff(2); got != 8*time.Second {
		t.Errorf("attempt 2 = %v", got)
	}
	if got := seqBackoff(3); got != 30*time.Second {
		t.Errorf("attempt 3 = %v", got)
	}
	// attempt >=4 returns the 30s default.
	if got := seqBackoff(4); got != 30*time.Second {
		t.Errorf("attempt 4 = %v", got)
	}
}

func TestDraftMatchesContext(t *testing.T) {
	a := int64(12)
	b := int64(12)
	c := int64(13)
	tests := []struct {
		name   string
		based  *int64
		latest *int64
		want   bool
	}{
		{name: "no history", want: true},
		{name: "same message", based: &a, latest: &b, want: true},
		{name: "new message arrived", based: &a, latest: &c, want: false},
		{name: "history appeared", latest: &c, want: false},
		{name: "history disappeared", based: &a, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := draftMatchesContext(tt.based, tt.latest); got != tt.want {
				t.Fatalf("draftMatchesContext() = %v, want %v", got, tt.want)
			}
		})
	}
}
