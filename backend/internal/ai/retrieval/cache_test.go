package retrieval

import (
	"bytes"
	"testing"
	"time"
)

func TestMemoryCacheBasicGetSet(t *testing.T) {
	c := NewMemoryCache()
	c.Set("k1", []byte("v1"), time.Minute)
	if v, ok := c.Get("k1"); !ok || !bytes.Equal(v, []byte("v1")) {
		t.Errorf("Get(k1) = (%v, %v), want (\"v1\", true)", v, ok)
	}
	if _, ok := c.Get("missing"); ok {
		t.Error("Get(missing) returned ok=true")
	}
}

func TestMemoryCacheTTLExpiry(t *testing.T) {
	c := NewMemoryCache()
	c.Set("k", []byte("v"), 10*time.Millisecond)
	time.Sleep(30 * time.Millisecond)
	if _, ok := c.Get("k"); ok {
		t.Error("Get(k) after TTL returned ok=true")
	}
}

func TestMemoryCacheOverwrite(t *testing.T) {
	c := NewMemoryCache()
	c.Set("k", []byte("v1"), time.Minute)
	c.Set("k", []byte("v2"), time.Minute)
	v, _ := c.Get("k")
	if !bytes.Equal(v, []byte("v2")) {
		t.Errorf("after overwrite Get(k) = %q, want %q", v, "v2")
	}
}

func TestNoopCacheAlwaysMisses(t *testing.T) {
	var c Cache = NoopCache{}
	c.Set("k", []byte("v"), time.Minute)
	if _, ok := c.Get("k"); ok {
		t.Error("NoopCache.Get returned ok=true")
	}
}

func TestCitationsFormat(t *testing.T) {
	chunks := []RetrievedChunk{
		{ID: 1, Content: "First chunk", Title: "FAQ", SourceRef: "faq.md", SourceType: "manual"},
		{ID: 2, Content: "Second chunk", Title: "", SourceRef: "https://example.com", SourceType: "url"},
	}
	got := FormatCitations(chunks)
	if got == "" {
		t.Fatal("FormatCitations returned empty string")
	}
	if !bytes.Contains([]byte(got), []byte("[1] FAQ — faq.md")) {
		t.Errorf("missing [1] entry: %s", got)
	}
	if !bytes.Contains([]byte(got), []byte("[2] https://example.com")) {
		t.Errorf("missing [2] entry: %s", got)
	}
}

func TestCitationsEmptySkipsFooter(t *testing.T) {
	if got := FormatCitations(nil); got != "" {
		t.Errorf("FormatCitations(nil) = %q, want empty", got)
	}
	if got := FormatCitations([]RetrievedChunk{}); got != "" {
		t.Errorf("FormatCitations([]) = %q, want empty", got)
	}
}

func TestFormatForPromptTruncatesLongContent(t *testing.T) {
	long := make([]byte, 2000)
	for i := range long {
		long[i] = 'a'
	}
	chunks := []RetrievedChunk{
		{ID: 1, Title: "Long", Content: string(long)},
	}
	out := FormatForPrompt(chunks)
	if len(out) > 1100 { // header + truncated content + slack
		t.Errorf("output too long (%d bytes); chunk should have been truncated", len(out))
	}
	if !bytes.Contains([]byte(out), []byte("...")) {
		t.Error("expected '...' truncation marker in output")
	}
}

func TestChunkIDsPreservesOrder(t *testing.T) {
	chunks := []RetrievedChunk{
		{ID: 10}, {ID: 5}, {ID: 99},
	}
	ids := ChunkIDs(chunks)
	want := []int64{10, 5, 99}
	if len(ids) != len(want) {
		t.Fatalf("len(ids)=%d, want %d", len(ids), len(want))
	}
	for i := range want {
		if ids[i] != want[i] {
			t.Errorf("ids[%d] = %d, want %d", i, ids[i], want[i])
		}
	}
}

func TestVectorToPgVectorFormat(t *testing.T) {
	cases := []struct {
		in   []float32
		want string
	}{
		{[]float32{0.1, 0.2, 0.3}, "[0.1,0.2,0.3]"},
		{[]float32{0}, "[0]"},
		{[]float32{}, "[]"},
	}
	for _, tc := range cases {
		got := vectorToPgVector(tc.in)
		if got != tc.want {
			t.Errorf("vectorToPgVector(%v) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestHasExactKBMatchThreshold(t *testing.T) {
	c := RetrievedChunk{VectorSim: 0.95, KeywordSim: 0.4}
	if !c.HasExactKBMatch(0.92, 0.3) {
		t.Error("expected HasExactKBMatch=true at threshold 0.92")
	}
	c2 := RetrievedChunk{VectorSim: 0.5, KeywordSim: 0.5}
	if c2.HasExactKBMatch(0.92, 0.3) {
		t.Error("expected HasExactKBMatch=false when vector sim below threshold")
	}
}

func TestTitleOrRefFallback(t *testing.T) {
	cases := []struct {
		c    RetrievedChunk
		want string
	}{
		{RetrievedChunk{Title: "FAQ", SourceRef: "f.md"}, "FAQ"},
		{RetrievedChunk{SourceRef: "f.md"}, "f.md"},
		{RetrievedChunk{ID: 7}, "Source #7"},
	}
	for _, tc := range cases {
		if got := tc.c.TitleOrRef(); got != tc.want {
			t.Errorf("TitleOrRef(%+v) = %q, want %q", tc.c, got, tc.want)
		}
	}
}

func TestHashKeyStable(t *testing.T) {
	a := hashKey("hello")
	b := hashKey("hello")
	if a != b {
		t.Errorf("hashKey not stable: %q vs %q", a, b)
	}
	c := hashKey("world")
	if a == c {
		t.Error("hashKey collision on different inputs")
	}
	if len(a) != 32 {
		t.Errorf("hashKey length = %d, want 32", len(a))
	}
}

func TestTokenizeQueryExpandsProductQuestions(t *testing.T) {
	terms := tokenizeQuery("Hi! I saw your ad. What kinds of sweets do you have?")
	got := map[string]bool{}
	for _, term := range terms {
		got[term] = true
	}
	for _, want := range []string{"sweets", "product", "categories", "carry", "mithai"} {
		if !got[want] {
			t.Fatalf("tokenizeQuery missing %q in %#v", want, terms)
		}
	}
	for _, noise := range []string{"hi", "your", "what", "have"} {
		if got[noise] {
			t.Fatalf("tokenizeQuery kept stopword %q in %#v", noise, terms)
		}
	}
}
