// Package retrieval is the RAG (Retrieval-Augmented Generation) layer
// for the WhatsyITC AI assistant. It owns the three moving parts:
//
//  1. Retrieval:    keyword search via PostgreSQL tsvector, with a
//     cheap re-rank step.
//  2. Embedding:    optional future vector path. The live schema does
//     not store KB embeddings yet, so the current runtime
//     path does not call an embedding provider.
//  3. Citations:    format the retrieved chunks with source metadata
//     so the agent loop can inject "[1] pricing-faq.md"
//     style references into the system prompt.
//
// All operations are scoped to an admin_user_id so multi-tenant
// isolation is enforced at the SQL layer (the WHERE clause is the
// boundary).
package retrieval

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RetrievedChunk is the result of one retrieval call. It carries the
// raw content + the per-signal scores so the agent loop can surface
// "I cited source X" to the user.
type RetrievedChunk struct {
	ID         int64
	Content    string
	Title      string
	SourceType string // 'manual' | 'url' | 'pdf' | 'qa_pair' | 'conversation'
	SourceRef  string
	VectorSim  float64
	KeywordSim float64
	FinalScore float64
}

// HasExactKBMatch is a heuristic: top chunk is well above threshold AND
// the keyword overlap is non-trivial. The router uses this to pick the
// cheap Haiku path.
func (r *RetrievedChunk) HasExactKBMatch(faqThreshold, kwThreshold float64) bool {
	return r.VectorSim >= faqThreshold && r.KeywordSim >= kwThreshold
}

// Retriever is the top-level RAG surface. Construct once at startup
// (passing the pgxpool + llm.Embedder) and call Retrieve per query.
type Retriever struct {
	pool   *pgxpool.Pool
	embed  Embedder
	cache  Cache
	config Config
}

// Embedder is the subset of llm.Registry the retriever needs. Defined
// as an interface so we can pass a stub in tests.
type Embedder interface {
	Embed(ctx context.Context, texts []string) ([][]float32, error)
}

// Config is the retriever's tunable knobs. Defaults are sensible for
// the demo; admins can override per-business in Phase 1.
type Config struct {
	VectorWeight  float64       // 0.7 — weight on pgvector cosine similarity
	KeywordWeight float64       // 0.3 — weight on tsvector BM25 rank
	TopK          int           // 8 chunks returned (after re-rank: 5)
	VectorTopK    int           // 20 — oversample before re-rank
	MinVectorSim  float64       // 0.55 — drop chunks below this similarity
	MinFinalScore float64       // 0.10 — drop chunks below combined score
	CacheTTL      time.Duration // 5 min
}

// DefaultConfig is what we ship with.
func DefaultConfig() Config {
	return Config{
		VectorWeight:  0.7,
		KeywordWeight: 0.3,
		TopK:          5,
		VectorTopK:    20,
		MinVectorSim:  0.55,
		MinFinalScore: 0.10,
		CacheTTL:      5 * time.Minute,
	}
}

// NewRetriever builds a Retriever. cache may be nil for the
// always-fresh (no-cache) path; the constructor will install an
// in-process map cache in that case so we still avoid duplicate
// OpenAI calls in a single request.
func NewRetriever(pool *pgxpool.Pool, embed Embedder, cache Cache, cfg Config) *Retriever {
	if cache == nil {
		cache = NewMemoryCache()
	}
	if cfg.TopK == 0 {
		cfg = DefaultConfig()
	}
	return &Retriever{pool: pool, embed: embed, cache: cache, config: cfg}
}

// Retrieve runs keyword search for a query. The agent loop calls
// this on every user message; the cache makes repeat queries cheap.
//
// adminID scopes the result set to a single workspace (Phase 6: the
// live WhatsyITC/backend uses admin_user_id; the legacy Backend/ used
// business_id for the same role).
func (r *Retriever) Retrieve(ctx context.Context, adminID int64, query string) ([]RetrievedChunk, error) {
	return r.retrieve(ctx, adminID, nil, query)
}

// RetrieveForAgent runs retrieval using an agent's optional knowledge
// scope. If the agent has selected chunks, only those chunks are searched.
// If the agent has no selection rows, retrieval falls back to all KB chunks.
func (r *Retriever) RetrieveForAgent(ctx context.Context, adminID, agentID int64, query string) ([]RetrievedChunk, error) {
	if agentID <= 0 {
		return r.Retrieve(ctx, adminID, query)
	}
	return r.retrieve(ctx, adminID, &agentID, query)
}

func (r *Retriever) retrieve(ctx context.Context, adminID int64, agentID *int64, query string) ([]RetrievedChunk, error) {
	if strings.TrimSpace(query) == "" {
		return nil, nil
	}
	var cacheKey string
	if agentID == nil {
		cacheKey = r.cacheKey(adminID, query)
		if v, ok := r.cache.Get(cacheKey); ok {
			var cached []RetrievedChunk
			if err := json.Unmarshal(v, &cached); err == nil {
				return cached, nil
			}
		}
	}

	// The live KB table has content_tsv but no embedding column, so use
	// keyword-only retrieval. This keeps Bedrock-only deployments from
	// needing an OpenAI embedding key.
	chunks, err := r.keywordSearch(ctx, adminID, agentID, query)
	if err != nil {
		return nil, fmt.Errorf("keyword search: %w", err)
	}

	// Re-rank (cheap heuristic — sort by final score, drop low).
	chunks = r.rerank(chunks)

	// Cache.
	if agentID == nil {
		if buf, err := json.Marshal(chunks); err == nil {
			r.cache.Set(cacheKey, buf, r.config.CacheTTL)
		}
	}
	return chunks, nil
}

// embedQuery gets the embedding for a single text, with cache.
func (r *Retriever) embedQuery(ctx context.Context, query string) ([]float32, error) {
	key := "emb:" + hashKey(query)
	if v, ok := r.cache.Get(key); ok {
		var cached []float32
		if err := json.Unmarshal(v, &cached); err == nil {
			return cached, nil
		}
	}
	vecs, err := r.embed.Embed(ctx, []string{query})
	if err != nil {
		return nil, err
	}
	if len(vecs) == 0 {
		return nil, nil
	}
	if buf, err := json.Marshal(vecs[0]); err == nil {
		r.cache.Set(key, buf, 24*time.Hour) // embeddings are stable per-text
	}
	return vecs[0], nil
}

// keywordSearch mirrors the admin test playground's forgiving keyword
// scoring. PostgreSQL ts_rank values are often too small for short
// WhatsApp questions, so scanning the recent KB rows keeps the live
// conversation path aligned with /admin/ai/agent test runs.
func (r *Retriever) keywordSearch(ctx context.Context, adminID int64, agentID *int64, query string) ([]RetrievedChunk, error) {
	_ = vectorToPgVector // also unused; kept for future hybrid mode

	terms := tokenizeQuery(query)
	if len(terms) == 0 {
		return nil, nil
	}

	rows, err := r.pool.Query(ctx, `
		SELECT id, content, source_type, coalesce(source_ref, ''), coalesce(title, ''), updated_at
		FROM bc_ai_kb_chunks
		WHERE admin_user_id = $1
		  AND (
		    $2::bigint IS NULL
		    OR NOT EXISTS (
		      SELECT 1 FROM bc_ai_agent_kb_chunks scope
		      WHERE scope.admin_user_id = $1 AND scope.agent_id = $2
		    )
		    OR EXISTS (
		      SELECT 1 FROM bc_ai_agent_kb_chunks scope
		      WHERE scope.admin_user_id = $1
		        AND scope.agent_id = $2
		        AND scope.kb_chunk_id = bc_ai_kb_chunks.id
		    )
		  )
		ORDER BY updated_at DESC, id DESC
		LIMIT 500
	`, adminID, nullableAgentID(agentID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type scored struct {
		chunk     RetrievedChunk
		updatedAt time.Time
	}
	out := []scored{}
	for rows.Next() {
		var c RetrievedChunk
		var updatedAt time.Time
		if err := rows.Scan(&c.ID, &c.Content, &c.SourceType, &c.SourceRef, &c.Title, &updatedAt); err != nil {
			return nil, err
		}
		score := keywordScore(terms, c.Title, c.SourceRef, c.Content)
		if score <= 0 {
			continue
		}
		c.VectorSim = 0
		c.KeywordSim = score
		c.FinalScore = score
		out = append(out, scored{chunk: c, updatedAt: updatedAt})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].chunk.FinalScore == out[j].chunk.FinalScore {
			return out[i].updatedAt.After(out[j].updatedAt)
		}
		return out[i].chunk.FinalScore > out[j].chunk.FinalScore
	})
	if len(out) > r.config.TopK {
		out = out[:r.config.TopK]
	}

	chunks := make([]RetrievedChunk, 0, len(out))
	for _, item := range out {
		chunks = append(chunks, item.chunk)
	}
	return chunks, nil
}

// rerank is a cheap pass that:
//   - demotes very short chunks (often template fragments) by
//     multiplying score by 0.8 when content < 50 chars
//   - promotes chunks whose source_type is 'qa_pair' slightly
//     (FAQ-style content is usually a better answer)
func (r *Retriever) rerank(in []RetrievedChunk) []RetrievedChunk {
	for i := range in {
		if len(in[i].Content) < 50 {
			in[i].FinalScore *= 0.8
		}
		if in[i].SourceType == "qa_pair" {
			in[i].FinalScore *= 1.1
		}
	}
	sort.SliceStable(in, func(i, j int) bool {
		return in[i].FinalScore > in[j].FinalScore
	})
	return in
}

func tokenizeQuery(query string) []string {
	parts := strings.FieldsFunc(strings.ToLower(query), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	terms := []string{}
	seen := map[string]bool{}
	add := func(p string) {
		p = strings.TrimSpace(strings.ToLower(p))
		if len([]rune(p)) < 2 || retrievalStopWords[p] || seen[p] {
			return
		}
		seen[p] = true
		terms = append(terms, p)
	}
	for _, p := range parts {
		add(p)
	}
	q := strings.ToLower(query)
	if strings.Contains(q, "kind") || strings.Contains(q, "what do you") || strings.Contains(q, "what all") ||
		strings.Contains(q, "sell") || strings.Contains(q, "carry") || strings.Contains(q, "available") ||
		strings.Contains(q, "product") || strings.Contains(q, "category") {
		for _, term := range []string{"product", "products", "category", "categories", "carry"} {
			add(term)
		}
	}
	if strings.Contains(q, "sweet") || strings.Contains(q, "mithai") {
		for _, term := range []string{"sweet", "sweets", "mithai"} {
			add(term)
		}
	}
	return terms
}

var retrievalStopWords = map[string]bool{
	"a": true, "an": true, "and": true, "are": true, "as": true, "at": true,
	"be": true, "but": true, "by": true, "can": true, "do": true, "for": true,
	"from": true, "have": true, "hello": true, "hey": true, "hi": true, "i": true,
	"in": true, "is": true, "it": true, "me": true, "of": true, "on": true,
	"or": true, "our": true, "please": true, "saw": true, "the": true, "this": true,
	"to": true, "u": true, "we": true, "what": true, "whats": true, "with": true,
	"you": true, "your": true,
}

func keywordScore(terms []string, title, sourceRef, content string) float64 {
	if len(terms) == 0 {
		return 0
	}
	hay := strings.ToLower(title + " " + sourceRef + " " + content)
	titleHay := strings.ToLower(title + " " + sourceRef)
	matches := 0
	titleMatches := 0
	for _, term := range terms {
		if strings.Contains(hay, term) {
			matches++
		}
		if strings.Contains(titleHay, term) {
			titleMatches++
		}
	}
	if matches == 0 {
		return 0
	}
	base := float64(matches) / float64(len(terms))
	titleBoost := 0.15 * (float64(titleMatches) / float64(len(terms)))
	return math.Min(1, base+titleBoost)
}

// cacheKey combines admin id + query for the retrieval cache.
func (r *Retriever) cacheKey(adminID int64, query string) string {
	return fmt.Sprintf("ret:%d:%s", adminID, hashKey(query))
}

func nullableAgentID(agentID *int64) any {
	if agentID == nil || *agentID <= 0 {
		return nil
	}
	return *agentID
}

func hashKey(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:16]) // 32 hex chars is plenty
}

// vectorToPgVector renders a float32 slice into the "[v1,v2,...]"
// string pgvector wants.
func vectorToPgVector(v []float32) string {
	var b strings.Builder
	b.Grow(2 + len(v)*12)
	b.WriteByte('[')
	for i, x := range v {
		if i > 0 {
			b.WriteByte(',')
		}
		// 6 significant digits is plenty for cosine similarity.
		fmt.Fprintf(&b, "%g", x)
	}
	b.WriteByte(']')
	return b.String()
}
