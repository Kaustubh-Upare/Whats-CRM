package chunker

import (
	"strings"
	"testing"
)

func TestChunkEmptyAndWhitespace(t *testing.T) {
	cases := []string{"", "   ", "\n\n\n", "\t\t  \n\n "}
	for _, in := range cases {
		got := Chunk(in, Options{})
		if len(got) != 0 {
			t.Errorf("Chunk(%q) = %v, want empty", in, got)
		}
	}
}

func TestChunkFitsInOneChunk(t *testing.T) {
	in := "Hello world. This is a short document that fits in a single chunk."
	got := Chunk(in, Options{})
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1; chunks = %v", len(got), got)
	}
	if got[0] != in {
		t.Errorf("content = %q, want %q", got[0], in)
	}
}

func TestChunkSplitsLongText(t *testing.T) {
	// Build ~50KB of "word " — far larger than the default target.
	var b strings.Builder
	for i := 0; i < 12000; i++ {
		if i > 0 {
			b.WriteByte(' ')
		}
		b.WriteString("word")
	}
	got := Chunk(b.String(), Options{})
	// 50KB / 800 tokens / 4 chars-per-token ≈ 15+ chunks.
	if len(got) < 4 {
		t.Errorf("expected 4+ chunks for ~50KB input, got %d", len(got))
	}
	for i, c := range got {
		if strings.TrimSpace(c) == "" {
			t.Errorf("chunk %d is empty", i)
		}
	}
}

func TestChunkRespectsParagraphBoundaries(t *testing.T) {
	in := "First paragraph is short.\n\nSecond paragraph is also short.\n\nThird paragraph for good measure."
	got := Chunk(in, Options{TargetTokens: 30})
	if len(got) != 1 {
		t.Fatalf("expected single chunk for short text, got %d: %v", len(got), got)
	}
	if !strings.Contains(got[0], "First") || !strings.Contains(got[0], "Third") {
		t.Errorf("chunk missing content: %q", got[0])
	}
}

func TestChunkOverlapApplies(t *testing.T) {
	// Two long paragraphs that should land in separate chunks but
	// share overlap tokens.
	p1 := strings.Repeat("alpha ", 500) // ~2000 chars
	p2 := strings.Repeat("beta ", 500)
	in := p1 + "\n\n" + p2
	got := Chunk(in, Options{TargetTokens: 200, OverlapTokens: 20})
	if len(got) < 2 {
		t.Fatalf("expected >= 2 chunks, got %d", len(got))
	}
	// Chunk #2 should contain some overlap from the end of chunk #1.
	if !strings.Contains(got[1], "alpha") {
		t.Errorf("chunk 2 should overlap with chunk 1 (contain 'alpha'): %q", got[1])
	}
}

func TestChunkNormalizesLineEndings(t *testing.T) {
	in := "Hello\r\n\r\nWorld"
	got := Chunk(in, Options{})
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if strings.Contains(got[0], "\r") {
		t.Errorf("chunk still has CR: %q", got[0])
	}
}

func TestChunkHandlesUnicode(t *testing.T) {
	// Hindi + English mixed content. Should not panic, should produce
	// valid chunks that preserve the unicode.
	in := "नमस्ते दुनिया। Hello world. हम हिंदी और अंग्रेजी दोनों बोल सकते हैं।"
	got := Chunk(in, Options{TargetTokens: 5}) // tiny target → force splits
	if len(got) == 0 {
		t.Fatal("got no chunks for unicode input")
	}
	// Reassembled chunks should still contain the original words.
	joined := strings.Join(got, " ")
	if !strings.Contains(joined, "नमस्ते") || !strings.Contains(joined, "Hello") {
		t.Errorf("lost content during chunking: %q", joined)
	}
}

func TestSplitSentencesPreservesPunctuation(t *testing.T) {
	got := splitSentences("Hello world. How are you? I'm fine!")
	if len(got) != 3 {
		t.Fatalf("expected 3 sentences, got %d: %v", len(got), got)
	}
	if !strings.HasSuffix(got[0], ".") {
		t.Errorf("sentence 1 missing '.': %q", got[0])
	}
	if !strings.HasSuffix(got[1], "?") {
		t.Errorf("sentence 2 missing '?': %q", got[1])
	}
	if !strings.HasSuffix(got[2], "!") {
		t.Errorf("sentence 3 missing '!': %q", got[2])
	}
}

func TestApproxTokens(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"", 0},
		{"abc", 0},           // 3 runes / 4 = 0
		{"abcd", 1},          // 4 runes / 4 = 1
		{"hello world", 2},   // 11 runes / 4 = 2
	}
	for _, tc := range cases {
		if got := approxTokens(tc.in); got != tc.want {
			t.Errorf("approxTokens(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

func TestTailTokensStableBoundary(t *testing.T) {
	s := "alpha beta gamma delta epsilon"
	got := tailTokens(s, 2)
	if got != "delta epsilon" {
		t.Errorf("tailTokens(%q, 2) = %q, want %q", s, got, "delta epsilon")
	}
}
