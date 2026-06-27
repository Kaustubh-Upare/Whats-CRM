// Package chunker splits long-form text into overlapping chunks
// sized for LLM retrieval + embedding. Pure Go, zero deps — used by
// the URL ingest handler today, and reused later by PDF + manual
// paste flows.
//
// Design choices
// --------------
//   - Target ~800 tokens per chunk, 200-token overlap so adjacent
//     chunks share context (helps retrieval recall at chunk boundaries).
//   - Splits on paragraph boundaries (`\n\n`) first, then sentence
//     boundaries (`. `, `? `, `! `, `\n`), then whitespace as a last
//     resort. This produces readable chunks that don't cut a sentence
//     in half.
//   - Token count is approximated as `len(text) / 4` (the rule of
//     thumb for English with GPT-style BPE tokenizers). Close enough
//     for chunk sizing; the embedding model is the source of truth
//     for what fits.
//   - Empty chunks are never emitted. Whitespace-only content is
//     skipped at the paragraph level.
package chunker

import (
	"strings"
	"unicode"
)

// DefaultTargetTokens is the default chunk size target.
const DefaultTargetTokens = 800

// DefaultOverlapTokens is the default overlap between adjacent chunks.
const DefaultOverlapTokens = 200

// Options tweaks the chunker. Zero values mean "use defaults".
type Options struct {
	TargetTokens  int // default 800
	OverlapTokens int // default 200
}

// resolve fills zero fields with defaults.
func (o Options) resolve() (target, overlap int) {
	target = o.TargetTokens
	if target <= 0 {
		target = DefaultTargetTokens
	}
	overlap = o.OverlapTokens
	if overlap < 0 {
		overlap = 0
	}
	// Don't let overlap >= target (would produce infinite chunks).
	if overlap >= target {
		overlap = target / 4
		if overlap == 0 {
			overlap = 1
		}
	}
	return
}

// Chunk splits text into overlapping pieces. Each returned chunk
// preserves the document order; chunk[i] and chunk[i+1] share roughly
// `overlap` tokens at the tail/head boundary.
func Chunk(text string, opts Options) []string {
	target, overlap := opts.resolve()
	text = normalize(text)
	if text == "" {
		return nil
	}

	// Stage 1: split into paragraphs (preserves the natural breaks).
	paragraphs := splitParagraphs(text)
	if len(paragraphs) == 0 {
		return nil
	}

	// Stage 2: greedily pack paragraphs into chunks under target,
	// splitting oversize paragraphs on sentence boundaries. Even
	// when there's only one paragraph we still run through packChunks
	// so an oversize single-paragraph document gets split.
	raw := packChunks(paragraphs, target)
	if len(raw) == 0 {
		return nil
	}

	// Stage 3: apply overlap between adjacent chunks.
	return overlapChunks(raw, overlap)
}

// --- internals ---

// normalize collapses whitespace, strips control runes, and trims.
func normalize(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	// Strip BOM (U+FEFF) at the start. We construct the rune via its
	// numeric codepoint so the source file stays free of the literal
	// BOM byte (which Go's parser rejects inside a string literal).
	bom := string(rune(0xfeff))
	s = strings.TrimPrefix(s, bom)
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == '\t' {
			b.WriteByte(' ')
			continue
		}
		if unicode.IsControl(r) && r != '\n' {
			continue
		}
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

// splitParagraphs splits on `\n\n` (one or more blank lines) and
// returns non-empty, trimmed paragraphs.
func splitParagraphs(s string) []string {
	parts := strings.Split(s, "\n\n")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// packChunks greedily packs paragraphs into chunks <= target tokens.
// Oversize paragraphs (or any content with no paragraph breaks) are
// split on sentence boundaries first so a 50KB blob of one long
// "word word word..." string still gets chunked sanely.
func packChunks(paragraphs []string, target int) []string {
	out := []string{}
	var cur strings.Builder
	curTokens := 0

	flush := func() {
		if cur.Len() == 0 {
			return
		}
		out = append(out, strings.TrimSpace(cur.String()))
		cur.Reset()
		curTokens = 0
	}

	// If every paragraph fits and we're under target, return as one.
	totalTokens := 0
	for _, p := range paragraphs {
		totalTokens += approxTokens(p)
	}
	if totalTokens <= target {
		// Single output, paragraphs joined with blank line.
		joined := strings.Join(paragraphs, "\n\n")
		out = append(out, joined)
		return out
	}

	for _, p := range paragraphs {
		pTokens := approxTokens(p)
		// Oversize paragraph: split on sentence boundaries first,
		// then on whitespace as a last resort (handles "word word
		// word..." blobs that have no punctuation).
		if pTokens > target {
			flush()
			pieces := splitSentences(p)
			// If a single sentence is itself oversize, split it on
			// whitespace so we never produce a chunk larger than the
			// target.
			for _, sent := range pieces {
				if approxTokens(sent) > target {
					for _, w := range splitWhitespace(sent, target) {
						wTokens := approxTokens(w)
						if curTokens+wTokens > target && cur.Len() > 0 {
							flush()
						}
						cur.WriteString(w)
						cur.WriteByte(' ')
						curTokens += wTokens
					}
					continue
				}
				sTokens := approxTokens(sent)
				if curTokens+sTokens > target && cur.Len() > 0 {
					flush()
				}
				cur.WriteString(sent)
				cur.WriteByte(' ')
				curTokens += sTokens
			}
			flush()
			continue
		}
		// Fits in current chunk.
		if curTokens+pTokens <= target {
			if cur.Len() > 0 {
				cur.WriteString("\n\n")
				curTokens++
			}
			cur.WriteString(p)
			curTokens += pTokens
			continue
		}
		// Doesn't fit — flush current and start a new chunk.
		flush()
		cur.WriteString(p)
		curTokens = pTokens
	}
	flush()
	return out
}

// splitSentences splits on `. `, `? `, `! `, and newlines. Keeps the
// delimiter on the previous sentence so we don't lose punctuation.
func splitSentences(s string) []string {
	out := []string{}
	var cur strings.Builder
	runes := []rune(s)
	for i := 0; i < len(runes); i++ {
		cur.WriteRune(runes[i])
		r := runes[i]
		if r == '\n' {
			out = append(out, strings.TrimSpace(cur.String()))
			cur.Reset()
			continue
		}
		if (r == '.' || r == '?' || r == '!') && i+1 < len(runes) && (runes[i+1] == ' ' || runes[i+1] == '\n') {
			out = append(out, strings.TrimSpace(cur.String()))
			cur.Reset()
		}
	}
	if cur.Len() > 0 {
		out = append(out, strings.TrimSpace(cur.String()))
	}
	return out
}

// splitWhitespace splits a long no-punctuation blob into pieces that
// fit under `target` tokens. Each returned piece ends at a word
// boundary and is roughly `target` tokens long.
func splitWhitespace(s string, target int) []string {
	words := strings.Fields(s)
	if len(words) == 0 {
		return nil
	}
	out := []string{}
	var cur []string
	for _, w := range words {
		// Approximate: assume each word is ~1 token.
		if len(cur) >= target {
			out = append(out, strings.Join(cur, " "))
			cur = cur[:0]
		}
		cur = append(cur, w)
	}
	if len(cur) > 0 {
		out = append(out, strings.Join(cur, " "))
	}
	return out
}

// overlapChunks prefixes each chunk (except the first) with the
// trailing `overlap` tokens from the previous chunk so adjacent
// chunks share context. Always returns a copy of the input slice.
func overlapChunks(chunks []string, overlap int) []string {
	if overlap <= 0 || len(chunks) <= 1 {
		return chunks
	}
	out := make([]string, len(chunks))
	out[0] = chunks[0]
	for i := 1; i < len(chunks); i++ {
		prev := chunks[i-1]
		tail := tailTokens(prev, overlap)
		out[i] = strings.TrimSpace(tail + "\n\n" + chunks[i])
	}
	return out
}

// tailTokens returns the last `n` tokens of s, where a "token" is
// approximated as a whitespace-delimited word. The returned slice
// always begins at a word boundary.
func tailTokens(s string, n int) string {
	if n <= 0 {
		return ""
	}
	words := strings.Fields(s)
	if len(words) <= n {
		return s
	}
	tail := words[len(words)-n:]
	return strings.Join(tail, " ")
}

// approxTokens is the rough "len/4" estimate.
func approxTokens(s string) int {
	if s == "" {
		return 0
	}
	// Use rune count, not byte count — closer to actual tokens for
	// non-ASCII content (Hindi, etc.).
	return len([]rune(s)) / 4
}