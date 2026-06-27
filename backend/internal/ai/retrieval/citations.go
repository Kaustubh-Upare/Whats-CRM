package retrieval

import (
	"fmt"
	"strings"
)

// Citation is one "[n] source" reference rendered into the agent's
// system prompt. The agent loop should append a numbered footer like
//
//	[1] pricing-faq.md
//	[2] https://example.com/shipping-policy
//
// so the LLM can include inline citations like "see [1] for details".
type Citation struct {
	Index      int
	SourceRef  string
	SourceType string
	Title      string
}

// FormatCitations renders the citation footer the agent loop appends
// to its system prompt. Returns "" when there are no chunks so the
// agent can skip the footer.
func FormatCitations(chunks []RetrievedChunk) string {
	if len(chunks) == 0 {
		return ""
	}
	cites := make([]Citation, len(chunks))
	for i, c := range chunks {
		cites[i] = Citation{
			Index:      i + 1,
			SourceRef:  c.SourceRef,
			SourceType: c.SourceType,
			Title:      c.Title,
		}
	}
	var b strings.Builder
	b.WriteString("\n\nSources you can cite (use [N] inline):\n")
	for _, c := range cites {
		b.WriteString(fmt.Sprintf("[%d] ", c.Index))
		if c.Title != "" {
			b.WriteString(c.Title)
			b.WriteString(" — ")
		}
		b.WriteString(formatSourceRef(c.SourceRef, c.SourceType))
		b.WriteByte('\n')
	}
	return b.String()
}

// FormatForPrompt renders the chunks as a numbered block the LLM can
// use directly. The output is intentionally plain text — the LLM
// understands numbered lists well, and structured prompts (markdown
// headers, JSON) tend to fight the provider's templating.
func FormatForPrompt(chunks []RetrievedChunk) string {
	if len(chunks) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n\nKnowledge base (use [N] to cite):\n")
	for i, c := range chunks {
		b.WriteString(fmt.Sprintf("\n[%d] %s\n", i+1, c.TitleOrRef()))
		// Trim content to keep the prompt under control. ~800 chars
		// per chunk x 5 chunks = ~4kB, fine for every model we use.
		content := c.Content
		if len(content) > 800 {
			content = content[:797] + "..."
		}
		b.WriteString(content)
		b.WriteByte('\n')
	}
	return b.String()
}

// TitleOrRef returns the human-readable title when available, falling
// back to the source ref, falling back to "Source N".
func (c *RetrievedChunk) TitleOrRef() string {
	if c.Title != "" {
		return c.Title
	}
	if c.SourceRef != "" {
		return c.SourceRef
	}
	return fmt.Sprintf("Source #%d", c.ID)
}

// formatSourceRef normalises a source ref for display.
func formatSourceRef(ref, kind string) string {
	if ref == "" {
		return kind
	}
	switch kind {
	case "url":
		return ref
	case "pdf":
		if strings.HasSuffix(ref, ".pdf") {
			return ref
		}
		return ref + ".pdf"
	default:
		return ref
	}
}

// ChunkIDs extracts the IDs of the supplied chunks in their order —
// useful when persisting bc_ai_conversation_messages.retrieved_chunk_ids.
func ChunkIDs(chunks []RetrievedChunk) []int64 {
	out := make([]int64, len(chunks))
	for i, c := range chunks {
		out[i] = c.ID
	}
	return out
}
