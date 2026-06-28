package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/whatsyitc/backend/internal/ai/chunker"
	"github.com/whatsyitc/backend/internal/ai/retrieval"
	"github.com/whatsyitc/backend/internal/audit"
	"github.com/whatsyitc/backend/internal/llm"
	"github.com/whatsyitc/backend/internal/middleware"
	"github.com/whatsyitc/backend/internal/models"
	"github.com/whatsyitc/backend/internal/store"
	"github.com/whatsyitc/backend/internal/whatsapp"
)

type aiStatusResponse struct {
	LLMEnabled         bool `json:"llm_enabled"`
	EmbeddingsEnabled  bool `json:"embeddings_enabled"`
	TranscriberEnabled bool `json:"transcriber_enabled"`
}

func (s *Server) AIStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, aiStatusFromEnv())
}

func (s *Server) GetAIAgentConfig(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	cfg, err := s.Store.GetDefaultAIAgentConfig(r.Context(), uid)
	if err != nil {
		if errors.Is(err, store.ErrNoDefaultAgent) {
			// No agent yet — return the in-memory defaults so the UI can
			// render an empty editor on day one without a 404.
			writeJSON(w, http.StatusOK, store.DefaultAIAgentConfig(uid))
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

type putAIAgentConfigReq struct {
	Enabled                *bool           `json:"enabled"`
	Name                   *string         `json:"name"`
	PersonaMD              *string         `json:"persona_md"`
	Tone                   *string         `json:"tone"`
	Languages              *[]string       `json:"languages"`
	WorkingHours           *map[string]any `json:"working_hours"`
	HandoffRules           *map[string]any `json:"handoff_rules"`
	PrimaryModel           *string         `json:"primary_model"`
	FallbackModels         *[]string       `json:"fallback_models"`
	PremiumModel           *string         `json:"premium_model"`
	FAQConfidenceThreshold *float64        `json:"faq_confidence_threshold"`
	SystemPrompt           *string         `json:"system_prompt"`
	QualificationCriteria  *map[string]any `json:"qualification_criteria"`
}

func (s *Server) PutAIAgentConfig(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	cfg, err := s.Store.GetDefaultAIAgentConfig(r.Context(), uid)
	if err != nil {
		if errors.Is(err, store.ErrNoDefaultAgent) {
			writeErr(w, http.StatusNotFound, "no default agent configured")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	var req putAIAgentConfigReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	applyAIAgentPatch(cfg, req)
	if cfg.FAQConfidenceThreshold < 0 || cfg.FAQConfidenceThreshold > 1 {
		writeErr(w, http.StatusBadRequest, "faq_confidence_threshold must be between 0 and 1")
		return
	}
	saved, err := s.Store.UpdateAIAgent(r.Context(), uid, cfg.ID, cfg)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "ai.agent.updated", EntityType: strPtr("ai_agent"),
		EntityID: &saved.ID,
		Metadata: map[string]any{"enabled": saved.Enabled, "name": saved.Name},
	})
	writeJSON(w, http.StatusOK, saved)
}

// ---------------------------------------------------------------------------
// Multi-agent CRUD (Phase 8 — multi-agent + per-batch override).
// ---------------------------------------------------------------------------

// ListAIAgents returns every agent for the admin, default first.
// The sidebar in the UI uses this as its single source of truth.
func (s *Server) ListAIAgents(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	agents, err := s.Store.ListAIAgents(r.Context(), uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if agents == nil {
		agents = []*models.AIAgentConfig{}
	}
	writeJSON(w, http.StatusOK, agents)
}

// CreateAIAgent creates a new agent. Returns 400 with error code
// "agent_limit_reached" when the admin already has MaxAgentsPerAdmin.
func (s *Server) CreateAIAgent(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	var req putAIAgentConfigReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	cfg := store.DefaultAIAgentConfig(uid)
	applyAIAgentPatch(cfg, req)
	// require a non-empty name to avoid creating nameless agents
	if strings.TrimSpace(cfg.Name) == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	if cfg.FAQConfidenceThreshold < 0 || cfg.FAQConfidenceThreshold > 1 {
		writeErr(w, http.StatusBadRequest, "faq_confidence_threshold must be between 0 and 1")
		return
	}
	created, err := s.Store.CreateAIAgent(r.Context(), uid, cfg)
	if err != nil {
		if errors.Is(err, store.ErrAgentLimitReached) {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error":   "agent_limit_reached",
				"message": fmt.Sprintf("You can create up to %d agents per workspace.", store.MaxAgentsPerAdmin),
			})
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "ai.agent.created", EntityType: strPtr("ai_agent"),
		EntityID: &created.ID,
		Metadata: map[string]any{"name": created.Name, "is_default": created.IsDefault},
	})
	writeJSON(w, http.StatusCreated, created)
}

// GetAIAgent fetches a single agent by id.
func (s *Server) GetAIAgent(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	cfg, err := s.Store.GetAIAgent(r.Context(), uid, id)
	if err != nil {
		if errors.Is(err, store.ErrAgentNotFound) {
			writeErr(w, http.StatusNotFound, "agent not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

// UpdateAIAgent applies a patch to one agent.
func (s *Server) UpdateAIAgent(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req putAIAgentConfigReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	cfg, err := s.Store.GetAIAgent(r.Context(), uid, id)
	if err != nil {
		if errors.Is(err, store.ErrAgentNotFound) {
			writeErr(w, http.StatusNotFound, "agent not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	applyAIAgentPatch(cfg, req)
	if cfg.FAQConfidenceThreshold < 0 || cfg.FAQConfidenceThreshold > 1 {
		writeErr(w, http.StatusBadRequest, "faq_confidence_threshold must be between 0 and 1")
		return
	}
	saved, err := s.Store.UpdateAIAgent(r.Context(), uid, id, cfg)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "ai.agent.updated", EntityType: strPtr("ai_agent"),
		EntityID: &id,
		Metadata: map[string]any{"enabled": saved.Enabled, "name": saved.Name},
	})
	writeJSON(w, http.StatusOK, saved)
}

// DeleteAIAgent removes a non-default agent. Refuses (409) when the
// target is the admin's default — the UI guides the operator to pick
// a new default first.
func (s *Server) DeleteAIAgent(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	if err := s.Store.DeleteAIAgent(r.Context(), uid, id); err != nil {
		switch {
		case errors.Is(err, store.ErrAgentNotFound):
			writeErr(w, http.StatusNotFound, "agent not found")
		case errors.Is(err, store.ErrCannotDeleteDefault):
			writeJSON(w, http.StatusConflict, map[string]any{
				"error":   "cannot_delete_default",
				"message": "This is your default agent. Set another agent as default first.",
			})
		default:
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "ai.agent.deleted", EntityType: strPtr("ai_agent"),
		EntityID: &id,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// SetDefaultAIAgent promotes an agent to global default. Existing
// per-batch assignments are NOT touched — that's deliberate: a default
// change never silently rewrites a batch that already picked its own
// agent.
func (s *Server) SetDefaultAIAgent(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	prev, err := s.Store.GetDefaultAIAgentConfig(r.Context(), uid)
	if err != nil && !errors.Is(err, store.ErrNoDefaultAgent) {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	var prevID int64
	if prev != nil {
		prevID = prev.ID
	}
	saved, err := s.Store.SetDefaultAIAgent(r.Context(), uid, id)
	if err != nil {
		if errors.Is(err, store.ErrAgentNotFound) {
			writeErr(w, http.StatusNotFound, "agent not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "ai.agent.default_changed", EntityType: strPtr("ai_agent"),
		EntityID: &id,
		Metadata: map[string]any{"prev_agent_id": prevID, "new_agent_id": id},
	})
	writeJSON(w, http.StatusOK, saved)
}

type putAIAgentKnowledgeReq struct {
	SelectedIDs []int64 `json:"selected_ids"`
}

func (s *Server) GetAIAgentKnowledge(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	scope, err := s.Store.GetAIAgentKnowledgeScope(r.Context(), uid, id)
	if err != nil {
		if errors.Is(err, store.ErrAgentNotFound) {
			writeErr(w, http.StatusNotFound, "agent not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, scope)
}

func (s *Server) PutAIAgentKnowledge(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req putAIAgentKnowledgeReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	scope, err := s.Store.SetAIAgentKnowledgeScope(r.Context(), uid, id, req.SelectedIDs)
	if err != nil {
		switch {
		case errors.Is(err, store.ErrAgentNotFound):
			writeErr(w, http.StatusNotFound, "agent not found")
		case errors.Is(err, store.ErrAIKBChunkNotFound):
			writeErr(w, http.StatusBadRequest, "one or more selected knowledge chunks were not found")
		default:
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action:     "ai.agent.knowledge_updated",
		EntityType: strPtr("ai_agent"),
		EntityID:   &id,
		Metadata: map[string]any{
			"mode":           scope.Mode,
			"selected_count": len(scope.SelectedIDs),
		},
	})
	writeJSON(w, http.StatusOK, scope)
}

type testAIAgentReq struct {
	Message              string `json:"message"`
	SystemPromptOverride string `json:"system_prompt_override"`
	AgentID              int64  `json:"agent_id"`
}

func (s *Server) TestAIAgent(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	uid := middleware.UserID(r)
	var req testAIAgentReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" {
		writeErr(w, http.StatusBadRequest, "message is required")
		return
	}

	// Resolve which agent to test. agent_id=0 (or omitted) means "the
	// global default" — preserved from the legacy single-agent API.
	var cfg *models.AIAgentConfig
	var err error
	if req.AgentID > 0 {
		cfg, err = s.Store.GetAIAgent(r.Context(), uid, req.AgentID)
		if err != nil {
			if errors.Is(err, store.ErrAgentNotFound) {
				writeErr(w, http.StatusNotFound, "agent not found")
				return
			}
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !cfg.Configured {
			cfg = nil
		}
	}
	if cfg == nil {
		cfg, err = s.Store.GetDefaultAIAgentConfig(r.Context(), uid)
		if err != nil {
			if errors.Is(err, store.ErrNoDefaultAgent) {
				cfg = store.DefaultAIAgentConfig(uid)
			} else {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
	}
	var agentScopeID *int64
	if cfg != nil && cfg.ID > 0 {
		agentScopeID = &cfg.ID
	}
	chunks, err := s.searchAIKnowledge(r.Context(), uid, agentScopeID, req.Message, 5)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	status := aiStatusFromEnv()
	systemPrompt := cfg.SystemPrompt
	if strings.TrimSpace(req.SystemPromptOverride) != "" {
		systemPrompt = strings.TrimSpace(req.SystemPromptOverride)
	}
	if s.LLM != nil && s.LLM.Enabled() {
		resp, err := s.runLiveAIAgentTest(r.Context(), uid, cfg, req.Message, systemPrompt, chunks, start)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, resp)
		return
	}

	reply := buildLocalAgentPreview(cfg, req.Message, chunks, status)
	model := cfg.PrimaryModel
	if model == "" {
		model = "local-preview"
	}
	provider := "local"
	tier := "offline"
	reason := "No live LLM call is configured in this backend; returned a local retrieval preview."
	if status.LLMEnabled {
		provider = "configured"
		tier = "standard"
		reason = "LLM credentials were detected; this endpoint currently returns a local retrieval preview."
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"reply":            reply,
		"model":            model,
		"provider":         provider,
		"tier":             tier,
		"routing_reason":   reason,
		"intent":           inferLocalIntent(req.Message),
		"tokens_in":        estimateTokens(systemPrompt + "\n" + req.Message),
		"tokens_out":       estimateTokens(reply),
		"cost_usd":         0,
		"latency_ms":       time.Since(start).Milliseconds(),
		"retrieved_chunks": chunks,
	})
}

func (s *Server) runLiveAIAgentTest(ctx context.Context, uid int64, cfg *models.AIAgentConfig, message, systemPrompt string, chunks []models.AIRetrievedChunk, start time.Time) (map[string]any, error) {
	intent := inferLocalIntent(message)
	topScore := topRetrievedScore(chunks)
	decision := s.LLM.Router().Decide(llm.RoutingContext{
		BusinessTier:        "standard",
		RetrievalConfidence: topScore,
		HasExactKBMatch:     topScore >= cfg.FAQConfidenceThreshold,
		Intent:              intent,
		ConversationLength:  1,
	})
	resp, err := s.LLM.Chat(ctx, llm.ChatRequest{
		Model:       decision.Model,
		System:      buildAgentTestPrompt(cfg, systemPrompt, chunks),
		Messages:    []llm.Message{{Role: llm.RoleUser, Content: message}},
		Temperature: 0.3,
		MaxTokens:   512,
		BusinessID:  uid,
		Intent:      intent,
	})
	if err != nil {
		return nil, fmt.Errorf("LLM request failed: %w", err)
	}

	reply := strings.TrimSpace(resp.Text)
	if reply == "" && len(resp.ToolCalls) > 0 {
		names := make([]string, 0, len(resp.ToolCalls))
		for _, tc := range resp.ToolCalls {
			names = append(names, tc.Name)
		}
		reply = "The model requested a tool call in test mode: " + strings.Join(names, ", ")
	}
	if reply == "" {
		reply = "(empty reply)"
	}
	model := resp.Model
	if model == "" {
		model = decision.Model
	}
	return map[string]any{
		"reply":            reply,
		"model":            model,
		"provider":         resp.Provider,
		"tier":             decision.Tier,
		"routing_reason":   decision.Reason,
		"intent":           intent,
		"tokens_in":        resp.Usage.InputTokens,
		"tokens_out":       resp.Usage.OutputTokens,
		"cost_usd":         llm.CostFor(model, resp.Usage),
		"latency_ms":       time.Since(start).Milliseconds(),
		"retrieved_chunks": chunks,
	}, nil
}

func buildAgentTestPrompt(cfg *models.AIAgentConfig, systemPrompt string, chunks []models.AIRetrievedChunk) string {
	var b strings.Builder
	name := strings.TrimSpace(cfg.Name)
	if name == "" {
		name = "Assistant"
	}
	fmt.Fprintf(&b, "You are %s, a WhatsApp assistant for this business.\n", name)
	if persona := strings.TrimSpace(cfg.PersonaMD); persona != "" {
		b.WriteString("\nPersona:\n")
		b.WriteString(persona)
		b.WriteString("\n")
	}
	if tone := strings.TrimSpace(cfg.Tone); tone != "" {
		fmt.Fprintf(&b, "\nTone: %s. Keep replies short and useful for WhatsApp.\n", tone)
	}
	b.WriteString(`
Rules:
- Answer using the knowledge base when it is relevant.
- Do not invent prices, policies, stock, or delivery details.
- If the knowledge base does not contain the answer, say that clearly.
- Reply in the customer's language when obvious.
- This is an admin test run; do not claim that a real WhatsApp message was sent.
`)
	if len(chunks) > 0 {
		b.WriteString("\nKnowledge base:\n")
		for i, c := range chunks {
			title := strings.TrimSpace(c.Title)
			if title == "" {
				title = strings.TrimSpace(c.SourceRef)
			}
			if title == "" {
				title = fmt.Sprintf("Chunk #%d", c.ID)
			}
			fmt.Fprintf(&b, "[%d] %s: %s\n", i+1, title, compactText(c.Content, 900))
		}
		b.WriteString("Use inline citations like [1] when you rely on a chunk.\n")
	}
	if saved := strings.TrimSpace(systemPrompt); saved != "" {
		b.WriteString("\nAdditional instructions:\n")
		b.WriteString(saved)
		b.WriteString("\n")
	}
	return b.String()
}

func topRetrievedScore(chunks []models.AIRetrievedChunk) float64 {
	top := 0.0
	for _, c := range chunks {
		if c.FinalScore > top {
			top = c.FinalScore
		}
	}
	return top
}

func (s *Server) searchAIKnowledge(ctx context.Context, adminID int64, agentID *int64, query string, topK int) ([]models.AIRetrievedChunk, error) {
	if s.Retriever == nil {
		return s.Store.SearchAIKBForAgent(ctx, adminID, agentID, query, topK)
	}
	var (
		chunks []retrieval.RetrievedChunk
		err    error
	)
	if agentID != nil && *agentID > 0 {
		chunks, err = s.Retriever.RetrieveForAgent(ctx, adminID, *agentID, query)
	} else {
		chunks, err = s.Retriever.Retrieve(ctx, adminID, query)
	}
	if err != nil {
		return nil, err
	}
	out := make([]models.AIRetrievedChunk, 0, len(chunks))
	for _, c := range chunks {
		out = append(out, models.AIRetrievedChunk{
			ID:         c.ID,
			Title:      c.Title,
			Content:    c.Content,
			SourceType: c.SourceType,
			SourceRef:  c.SourceRef,
			VectorSim:  c.VectorSim,
			KeywordSim: c.KeywordSim,
			FinalScore: c.FinalScore,
		})
	}
	return out, nil
}

func (s *Server) addAIKnowledgeChunk(ctx context.Context, adminID int64, chunk *models.AIKBChunk) (int64, error) {
	id, err := s.Store.AddAIKB(ctx, adminID, chunk)
	if err != nil {
		return 0, err
	}
	s.embedAIKnowledgeChunk(ctx, adminID, id, chunk.Title, chunk.Content)
	return id, nil
}

type aiKBEmbeddingInput struct {
	ID      int64
	Title   string
	Content string
}

func (s *Server) embedAIKnowledgeChunks(ctx context.Context, adminID int64, chunks []aiKBEmbeddingInput) {
	if s.LLM == nil || !s.LLM.HasEmbeddings() || len(chunks) == 0 {
		return
	}
	const batchSize = 64
	for start := 0; start < len(chunks); start += batchSize {
		end := start + batchSize
		if end > len(chunks) {
			end = len(chunks)
		}
		batch := chunks[start:end]
		texts := make([]string, 0, len(batch))
		indexes := make([]int, 0, len(batch))
		for i, item := range batch {
			text := strings.TrimSpace(strings.TrimSpace(item.Title) + "\n\n" + strings.TrimSpace(item.Content))
			if text == "" {
				continue
			}
			texts = append(texts, text)
			indexes = append(indexes, i)
		}
		if len(texts) == 0 {
			continue
		}
		embedCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		vecs, err := s.LLM.Embed(embedCtx, texts)
		cancel()
		if err != nil {
			for _, idx := range indexes {
				_ = s.Store.MarkAIKBEmbeddingError(context.Background(), adminID, batch[idx].ID, err.Error())
			}
			continue
		}
		for i, vec := range vecs {
			if i >= len(indexes) {
				break
			}
			item := batch[indexes[i]]
			if len(vec) == 0 {
				_ = s.Store.MarkAIKBEmbeddingError(context.Background(), adminID, item.ID, "embedding provider returned no vector")
				continue
			}
			if err := s.Store.SetAIKBEmbedding(context.Background(), adminID, item.ID, s.LLM.EmbeddingModel(), vec); err != nil {
				_ = s.Store.MarkAIKBEmbeddingError(context.Background(), adminID, item.ID, err.Error())
			}
		}
	}
}

func (s *Server) embedAIKnowledgeChunk(ctx context.Context, adminID, chunkID int64, title, content string) {
	s.embedAIKnowledgeChunks(ctx, adminID, []aiKBEmbeddingInput{{ID: chunkID, Title: title, Content: content}})
}

// GenerateKBFromText handles POST /ai/kb/generate-from-text.
//
// Long documents are processed in two stages: a local overlapping
// pre-chunk pass first, then one LLM extraction call per section.
// If max_chunks is too low for full coverage, the endpoint returns a
// clear error instead of silently dropping later sections.
func (s *Server) GenerateKBFromText(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	if s.LLM == nil || !s.LLM.Enabled() {
		writeErr(w, http.StatusServiceUnavailable, "LLM not configured")
		return
	}
	var req generateKBFromTextReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	text := strings.TrimSpace(req.Text)
	if text == "" {
		writeErr(w, http.StatusBadRequest, "text is required")
		return
	}
	if len(text) > 50_000 {
		writeErr(w, http.StatusBadRequest, "text too large (max 50000 chars)")
		return
	}
	maxChunks := req.MaxChunks
	if maxChunks <= 0 {
		maxChunks = 20
	}
	if maxChunks > 60 {
		maxChunks = 60
	}

	// 90s covers up to ~30 chunks × embedding call. The model call
	// itself is usually 5-15s.
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	{
		parts := chunkTextForKBGeneration(text)
		if len(parts) == 0 {
			writeErr(w, http.StatusBadRequest, "text is required")
			return
		}

		// Extract atomic chunks from each overlapping section before
		// persisting anything, so we never silently lose later sections.
		allProposed := make([]generatedKBProposal, 0, len(parts)*2)
		for i, part := range parts {
			resp, err := s.LLM.Chat(ctx, llm.ChatRequest{
				Model:  "bedrock:deepseek-v3.2",
				System: kbSegregateSystemPrompt,
				Messages: []llm.Message{
					{Role: llm.RoleUser, Content: buildKBGenerateUserPrompt(part, i, len(parts))},
				},
				Temperature: 0.2,
				MaxTokens:   3000,
			})
			if err != nil {
				writeErr(w, http.StatusBadGateway, fmt.Sprintf("LLM call failed on section %d/%d: %s", i+1, len(parts), err.Error()))
				return
			}
			proposed, err := parseGeneratedKBProposals(resp.Text, i, len(parts))
			if err != nil {
				writeErr(
					w,
					http.StatusUnprocessableEntity,
					fmt.Sprintf("could not parse model output for section %d/%d: %s; raw=%s", i+1, len(parts), err.Error(), truncate(resp.Text, 400)),
				)
				return
			}
			allProposed = append(allProposed, proposed...)
		}

		proposed := dedupeGeneratedKBProposals(allProposed)
		if len(proposed) == 0 {
			writeErr(w, http.StatusUnprocessableEntity, "model returned 0 usable chunks")
			return
		}
		if len(proposed) > maxChunks {
			writeErr(
				w,
				http.StatusUnprocessableEntity,
				fmt.Sprintf(
					"this text expands to %d knowledge chunks across %d section(s); increase max_chunks to at least %d to avoid dropping details",
					len(proposed), len(parts), len(proposed),
				),
			)
			return
		}

		createdIDs := make([]int64, 0, len(proposed))
		titles := make([]string, 0, len(proposed))
		embeddingInputs := make([]aiKBEmbeddingInput, 0, len(proposed))
		for _, p := range proposed {
			content := p.Content
			if content == "" {
				continue
			}
			if len(content) > 8000 {
				content = content[:8000]
			}
			title := p.Title
			if len(title) > 100 {
				title = title[:100]
			}

			id, err := s.Store.AddAIKB(ctx, uid, &models.AIKBChunk{
				Title:      title,
				Content:    content,
				SourceType: "manual",
				Metadata: map[string]any{
					"category":          p.Category,
					"tags":              p.Tags,
					"source":            "generated",
					"model":             "bedrock:deepseek-v3.2",
					"source_sections":   len(parts),
					"source_section":    p.PartIndex + 1,
					"chunking_strategy": "sectioned_llm_generate",
				},
			})
			if err != nil {
				writeErr(w, http.StatusInternalServerError, fmt.Sprintf("persist chunk %q: %s", title, err.Error()))
				return
			}
			createdIDs = append(createdIDs, id)
			titles = append(titles, title)
			embeddingInputs = append(embeddingInputs, aiKBEmbeddingInput{ID: id, Title: title, Content: content})
		}

		if len(createdIDs) == 0 {
			writeErr(w, http.StatusUnprocessableEntity, "all proposed chunks were empty after validation")
			return
		}
		s.embedAIKnowledgeChunks(ctx, uid, embeddingInputs)

		email := middleware.Email(r)
		audit.Log(ctx, s.Store.DB, audit.Entry{
			ActorID: &uid, ActorEmail: &email,
			Action:     "ai.kb.bulk_generated",
			EntityType: strPtr("ai_kb_chunk"),
			Metadata: map[string]any{
				"chunk_count":   len(createdIDs),
				"chunk_ids":     createdIDs,
				"model":         "bedrock:deepseek-v3.2",
				"source_parts":  len(parts),
				"requested_cap": maxChunks,
			},
		})

		writeJSON(w, http.StatusOK, map[string]any{
			"count":       len(createdIDs),
			"created_ids": createdIDs,
			"titles":      titles,
		})
		return
	}

	// 1. Call DeepSeek V3.2 via the LLM registry. The Provider.Chat
	//    interface is provider-agnostic — no special Bedrock imports
	//    needed here.
	resp, err := s.LLM.Chat(ctx, llm.ChatRequest{
		Model:  "bedrock:deepseek-v3.2",
		System: kbSegregateSystemPrompt,
		Messages: []llm.Message{
			{Role: llm.RoleUser, Content: "Split this into knowledge chunks:\n\n" + text},
		},
		Temperature: 0.2, // low temperature — we want deterministic structured output
		MaxTokens:   8000,
	})
	if err != nil {
		writeErr(w, http.StatusBadGateway, "LLM call failed: "+err.Error())
		return
	}
	rawJSON, err := extractJSONArray(resp.Text)
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, "could not parse model output: "+err.Error()+"; raw="+truncate(resp.Text, 400))
		return
	}

	// 2. Decode the array into local structs.
	var proposed []struct {
		Title    string   `json:"title"`
		Content  string   `json:"content"`
		Category string   `json:"category"`
		Tags     []string `json:"tags"`
	}
	if err := json.Unmarshal(rawJSON, &proposed); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, "model output not valid JSON array: "+err.Error())
		return
	}
	if len(proposed) == 0 {
		writeErr(w, http.StatusUnprocessableEntity, "model returned 0 chunks")
		return
	}
	if len(proposed) > maxChunks {
		proposed = proposed[:maxChunks]
	}

	// 3. Validate + sanitise each proposed chunk, then persist.
	created := make([]int64, 0, len(proposed))
	titles := make([]string, 0, len(proposed))
	embeddingInputs := make([]aiKBEmbeddingInput, 0, len(proposed))
	for _, p := range proposed {
		content := strings.TrimSpace(p.Content)
		if content == "" {
			continue
		}
		if len(content) > 8000 {
			content = content[:8000]
		}
		title := strings.TrimSpace(p.Title)
		if len(title) > 100 {
			title = title[:100]
		}
		category := normaliseKBCategory(p.Category)
		tags := sanitiseKBTags(p.Tags)

		chunk := &models.AIKBChunk{
			Title:      title,
			Content:    content,
			SourceType: "manual",
			Metadata: map[string]any{
				"category": category,
				"tags":     tags,
				"source":   "generated",
				"model":    "bedrock:deepseek-v3.2",
			},
		}
		id, err := s.Store.AddAIKB(ctx, uid, chunk)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, fmt.Sprintf("persist chunk %q: %s", title, err.Error()))
			return
		}
		created = append(created, id)
		titles = append(titles, title)
		embeddingInputs = append(embeddingInputs, aiKBEmbeddingInput{ID: id, Title: title, Content: content})
	}

	if len(created) == 0 {
		writeErr(w, http.StatusUnprocessableEntity, "all proposed chunks were empty after validation")
		return
	}
	s.embedAIKnowledgeChunks(ctx, uid, embeddingInputs)

	// 4. One summary audit row.
	email := middleware.Email(r)
	audit.Log(ctx, s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action:     "ai.kb.bulk_generated",
		EntityType: strPtr("ai_kb_chunk"),
		Metadata: map[string]any{
			"chunk_count": len(created),
			"chunk_ids":   created,
			"model":       "bedrock:deepseek-v3.2",
		},
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"count":       len(created),
		"created_ids": created,
		"titles":      titles,
	})
}

// StartAIKnowledgeImport handles POST /ai/kb/imports.
//
// This is the robust long-document path. The request returns quickly
// with a job id, then a background processor chunks the source text,
// saves exact source-preserving KB chunks, and enriches titles/tags in
// batched LLM calls.
func (s *Server) StartAIKnowledgeImport(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	var req startAIKBImportReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	text := strings.TrimSpace(req.Text)
	if text == "" {
		writeErr(w, http.StatusBadRequest, "text is required")
		return
	}
	if len([]rune(text)) > 1_000_000 {
		writeErr(w, http.StatusBadRequest, "text too large (max 1000000 chars for async import)")
		return
	}
	maxChunks := req.MaxChunks
	if maxChunks <= 0 {
		maxChunks = 500
	}
	if maxChunks > 1000 {
		maxChunks = 1000
	}
	sourceName := strings.TrimSpace(req.SourceName)
	if sourceName == "" {
		sourceName = "Pasted knowledge"
	}

	job, err := s.Store.CreateAIKBImportJob(r.Context(), uid, text, sourceName, maxChunks, map[string]any{
		"chunking_strategy": "async_source_preserving",
		"llm_enrichment":    s.LLM != nil && s.LLM.Enabled(),
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	email := middleware.Email(r)
	go s.runAIKnowledgeImport(job.ID, uid, text, sourceName, maxChunks, email)

	writeJSON(w, http.StatusAccepted, job)
}

// GetAIKnowledgeImport handles GET /ai/kb/imports/{id}.
func (s *Server) GetAIKnowledgeImport(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	job, err := s.Store.GetAIKBImportJob(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if job == nil {
		writeErr(w, http.StatusNotFound, "import job not found")
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (s *Server) runAIKnowledgeImport(jobID, adminID int64, text, sourceName string, maxChunks int, actorEmail string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	parts := chunkTextForKBImport(text)
	warnings := []string{}
	if len(parts) == 0 {
		s.failAIKBImportJob(adminID, jobID, "text did not contain enough readable content", warnings)
		return
	}
	if err := s.Store.StartAIKBImportJob(ctx, adminID, jobID, len(parts)); err != nil {
		return
	}
	if len(parts) > maxChunks {
		s.failAIKBImportJob(
			adminID,
			jobID,
			fmt.Sprintf("document expands to %d source-preserving chunks; increase max_chunks to at least %d for full coverage", len(parts), len(parts)),
			warnings,
		)
		return
	}

	llmEnabled := s.LLM != nil && s.LLM.Enabled()
	if !llmEnabled {
		warnings = append(warnings, "LLM enrichment is not configured, so deterministic titles and tags were used.")
	}

	createdIDs := make([]int64, 0, len(parts))
	titles := make([]string, 0, len(parts))
	embeddingInputs := make([]aiKBEmbeddingInput, 0, len(parts))
	const enrichBatchSize = 8
	for start := 0; start < len(parts); start += enrichBatchSize {
		end := start + enrichBatchSize
		if end > len(parts) {
			end = len(parts)
		}
		metas := fallbackKBMetadataBatch(sourceName, parts[start:end], start, len(parts))
		if llmEnabled {
			enriched, err := enrichKBMetadataBatch(ctx, s.LLM, sourceName, parts[start:end], start, len(parts))
			if err != nil {
				warnings = append(warnings, fmt.Sprintf("AI labels failed for sections %d-%d, fallback labels were used: %s", start+1, end, err.Error()))
			} else {
				metas = enriched
			}
		}

		for i, part := range parts[start:end] {
			partIndex := start + i
			meta := metas[i]
			id, err := s.Store.AddAIKB(ctx, adminID, &models.AIKBChunk{
				Title:      meta.Title,
				Content:    part,
				SourceType: "manual",
				SourceRef:  sourceName,
				Metadata: map[string]any{
					"category":          meta.Category,
					"tags":              meta.Tags,
					"source":            "async_import",
					"source_name":       sourceName,
					"source_section":    partIndex + 1,
					"source_sections":   len(parts),
					"chunking_strategy": "async_source_preserving",
					"llm_enriched":      llmEnabled,
				},
			})
			if err != nil {
				s.failAIKBImportJob(adminID, jobID, fmt.Sprintf("persist section %d/%d: %s", partIndex+1, len(parts), err.Error()), warnings)
				return
			}
			createdIDs = append(createdIDs, id)
			titles = append(titles, meta.Title)
			embeddingInputs = append(embeddingInputs, aiKBEmbeddingInput{ID: id, Title: meta.Title, Content: part})
			if err := s.Store.UpdateAIKBImportProgress(ctx, adminID, jobID, partIndex+1, len(createdIDs), createdIDs, titles, warnings); err != nil {
				s.failAIKBImportJob(adminID, jobID, err.Error(), warnings)
				return
			}
		}
	}

	if len(createdIDs) == 0 {
		s.failAIKBImportJob(adminID, jobID, "no chunks were created", warnings)
		return
	}
	s.embedAIKnowledgeChunks(ctx, adminID, embeddingInputs)
	if err := s.Store.CompleteAIKBImportJob(ctx, adminID, jobID, len(parts), len(createdIDs), createdIDs, titles, warnings); err != nil {
		s.failAIKBImportJob(adminID, jobID, err.Error(), warnings)
		return
	}

	audit.Log(ctx, s.Store.DB, audit.Entry{
		ActorID: &adminID, ActorEmail: &actorEmail,
		Action:     "ai.kb.async_import_completed",
		EntityType: strPtr("ai_kb_import_job"),
		EntityID:   &jobID,
		Metadata: map[string]any{
			"chunk_count": len(createdIDs),
			"chunk_ids":   createdIDs,
			"source_name": sourceName,
		},
	})
}

func (s *Server) failAIKBImportJob(adminID, jobID int64, message string, warnings []string) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = s.Store.FailAIKBImportJob(ctx, adminID, jobID, message, warnings)
}

func (s *Server) ListAIKnowledge(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	sourceType := r.URL.Query().Get("source_type")
	search := r.URL.Query().Get("search")
	limit := intParam(r, "limit", 100)
	offset := intParam(r, "offset", 0)
	items, total, err := s.Store.ListAIKB(r.Context(), uid, sourceType, search, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

type addAIKBReq struct {
	Title      string `json:"title"`
	Content    string `json:"content"`
	SourceType string `json:"source_type"`
}

type generateKBFromTextReq struct {
	Text      string `json:"text"`
	MaxChunks int    `json:"max_chunks"`
}

type startAIKBImportReq struct {
	Text       string `json:"text"`
	SourceName string `json:"source_name"`
	MaxChunks  int    `json:"max_chunks"`
}

type generatedKBProposal struct {
	Title     string
	Content   string
	Category  string
	Tags      []string
	PartIndex int
	PartCount int
}

type kbChunkMetadata struct {
	Title    string
	Category string
	Tags     []string
}

func chunkTextForKBGeneration(text string) []string {
	parts := chunker.Chunk(text, chunker.Options{
		TargetTokens:  1200,
		OverlapTokens: 160,
	})
	if len(parts) == 0 && strings.TrimSpace(text) != "" {
		return []string{strings.TrimSpace(text)}
	}
	return parts
}

func chunkTextForKBImport(text string) []string {
	parts := chunker.Chunk(text, chunker.Options{
		TargetTokens:  700,
		OverlapTokens: 90,
	})
	if len(parts) == 0 && strings.TrimSpace(text) != "" {
		return []string{strings.TrimSpace(text)}
	}
	return parts
}

func fallbackKBMetadataBatch(sourceName string, parts []string, startIndex, total int) []kbChunkMetadata {
	out := make([]kbChunkMetadata, 0, len(parts))
	for i, part := range parts {
		out = append(out, fallbackKBMetadata(sourceName, part, startIndex+i, total))
	}
	return out
}

func fallbackKBMetadata(sourceName, content string, index, total int) kbChunkMetadata {
	title := strings.TrimSpace(sourceName)
	firstLine := ""
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			firstLine = compactText(line, 70)
			break
		}
	}
	switch {
	case title != "" && firstLine != "":
		title = compactText(title+" - "+firstLine, 100)
	case title == "" && firstLine != "":
		title = compactText(firstLine, 100)
	case title == "":
		title = "Imported knowledge"
	}
	if total > 1 {
		title = compactText(fmt.Sprintf("%s (%d/%d)", title, index+1, total), 100)
	}
	return kbChunkMetadata{
		Title:    title,
		Category: inferKBCategory(content),
		Tags:     inferKBTags(content),
	}
}

func enrichKBMetadataBatch(ctx context.Context, registry *llm.Registry, sourceName string, parts []string, startIndex, total int) ([]kbChunkMetadata, error) {
	if registry == nil || !registry.Enabled() {
		return fallbackKBMetadataBatch(sourceName, parts, startIndex, total), nil
	}
	type promptChunk struct {
		Index int    `json:"index"`
		Text  string `json:"text"`
	}
	payload := make([]promptChunk, 0, len(parts))
	for i, part := range parts {
		payload = append(payload, promptChunk{
			Index: startIndex + i + 1,
			Text:  compactText(part, 1800),
		})
	}
	payloadJSON, _ := json.Marshal(payload)
	resp, err := registry.Chat(ctx, llm.ChatRequest{
		Model:  "bedrock:deepseek-v3.2",
		System: kbMetadataSystemPrompt,
		Messages: []llm.Message{
			{Role: llm.RoleUser, Content: fmt.Sprintf(
				"Source name: %s\nTotal chunks: %d\nReturn labels for these chunks:\n%s",
				sourceName,
				total,
				string(payloadJSON),
			)},
		},
		Temperature: 0.1,
		MaxTokens:   1200,
	})
	if err != nil {
		return nil, err
	}
	rawJSON, err := extractJSONArray(resp.Text)
	if err != nil {
		return nil, err
	}
	var decoded []struct {
		Index    int      `json:"index"`
		Title    string   `json:"title"`
		Category string   `json:"category"`
		Tags     []string `json:"tags"`
	}
	if err := json.Unmarshal(rawJSON, &decoded); err != nil {
		return nil, err
	}
	fallbacks := fallbackKBMetadataBatch(sourceName, parts, startIndex, total)
	byIndex := make(map[int]kbChunkMetadata, len(decoded))
	for _, item := range decoded {
		title := compactText(strings.TrimSpace(item.Title), 100)
		if title == "" {
			continue
		}
		byIndex[item.Index] = kbChunkMetadata{
			Title:    title,
			Category: normaliseKBCategory(item.Category),
			Tags:     sanitiseKBTags(item.Tags),
		}
	}
	for i := range fallbacks {
		idx := startIndex + i + 1
		if meta, ok := byIndex[idx]; ok {
			if len(meta.Tags) == 0 {
				meta.Tags = fallbacks[i].Tags
			}
			fallbacks[i] = meta
		}
	}
	return fallbacks, nil
}

func buildKBGenerateUserPrompt(text string, partIndex, partCount int) string {
	if partCount <= 1 {
		return "Split this into knowledge chunks:\n\n" + text
	}
	return fmt.Sprintf(
		"You are processing section %d of %d from one longer business knowledge document.\n"+
			"This section may repeat a short overlap from the previous section so context at the boundary is preserved.\n"+
			"Do not emit duplicate chunks if a fact only appears because of that overlap.\n"+
			"Keep the final chunks in the same order as the source.\n\n"+
			"Split this section into knowledge chunks:\n\n%s",
		partIndex+1, partCount, text,
	)
}

func parseGeneratedKBProposals(raw string, partIndex, partCount int) ([]generatedKBProposal, error) {
	rawJSON, err := extractJSONArray(raw)
	if err != nil {
		return nil, err
	}
	var decoded []struct {
		Title    string   `json:"title"`
		Content  string   `json:"content"`
		Category string   `json:"category"`
		Tags     []string `json:"tags"`
	}
	if err := json.Unmarshal(rawJSON, &decoded); err != nil {
		return nil, err
	}
	out := make([]generatedKBProposal, 0, len(decoded))
	for _, item := range decoded {
		out = append(out, generatedKBProposal{
			Title:     strings.TrimSpace(item.Title),
			Content:   strings.TrimSpace(item.Content),
			Category:  strings.TrimSpace(item.Category),
			Tags:      sanitiseKBTags(item.Tags),
			PartIndex: partIndex,
			PartCount: partCount,
		})
	}
	return out, nil
}

func normaliseGeneratedKBText(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(s)), " "))
}

func dedupeGeneratedKBProposals(in []generatedKBProposal) []generatedKBProposal {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]int, len(in))
	out := make([]generatedKBProposal, 0, len(in))
	for _, item := range in {
		item.Title = strings.TrimSpace(item.Title)
		item.Content = strings.TrimSpace(item.Content)
		item.Category = normaliseKBCategory(item.Category)
		item.Tags = sanitiseKBTags(item.Tags)
		key := normaliseGeneratedKBText(item.Content)
		if key == "" {
			continue
		}
		if idx, ok := seen[key]; ok {
			if out[idx].Title == "" && item.Title != "" {
				out[idx].Title = item.Title
			}
			if len(item.Tags) > 0 {
				out[idx].Tags = sanitiseKBTags(append(out[idx].Tags, item.Tags...))
			}
			continue
		}
		seen[key] = len(out)
		out = append(out, item)
	}
	return out
}

func (s *Server) AddAIKnowledge(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	var req addAIKBReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeErr(w, http.StatusBadRequest, "content is required")
		return
	}
	chunk := &models.AIKBChunk{
		Title:      req.Title,
		Content:    req.Content,
		SourceType: req.SourceType,
		Metadata:   map[string]any{"source": "manual"},
	}
	id, err := s.addAIKnowledgeChunk(r.Context(), uid, chunk)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "ai.kb.created", EntityType: strPtr("ai_kb_chunk"),
		EntityID: &id,
		Metadata: map[string]any{"source_type": chunk.SourceType},
	})
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

type editAIKBReq struct {
	Title   string `json:"title"`
	Content string `json:"content"`
}

func (s *Server) UpdateAIKnowledge(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req editAIKBReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeErr(w, http.StatusBadRequest, "content is required")
		return
	}
	updated, err := s.Store.UpdateAIKB(r.Context(), uid, id, req.Title, req.Content)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if updated == nil {
		writeErr(w, http.StatusNotFound, "chunk not found")
		return
	}
	s.embedAIKnowledgeChunk(r.Context(), uid, updated.ID, updated.Title, updated.Content)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) DeleteAIKnowledge(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	deleted, err := s.Store.DeleteAIKB(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !deleted {
		writeErr(w, http.StatusNotFound, "chunk not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type ingestAIURLReq struct {
	URL   string `json:"url"`
	Title string `json:"title"`
}

func (s *Server) IngestAIKnowledgeURL(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	var req ingestAIURLReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	pageURL, err := validateHTTPURL(req.URL)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	raw, err := fetchURLText(r, pageURL)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = extractHTMLTitle(raw)
	}
	if title == "" {
		title = pageURL.Host
	}
	text := htmlToPlainText(raw)
	if len(text) < 20 {
		writeErr(w, http.StatusBadRequest, "URL did not contain enough readable text")
		return
	}

	parts := chunkPlainText(text, 3500)
	chunkIDs := []int64{}
	embeddingInputs := make([]aiKBEmbeddingInput, 0, len(parts))
	errors := []string{}
	for i, part := range parts {
		chunkTitle := title
		if len(parts) > 1 {
			chunkTitle = fmt.Sprintf("%s (%d/%d)", title, i+1, len(parts))
		}
		id, err := s.Store.AddAIKB(r.Context(), uid, &models.AIKBChunk{
			Title:      chunkTitle,
			Content:    part,
			SourceType: "url",
			SourceRef:  pageURL.String(),
			Metadata: map[string]any{
				"url":         pageURL.String(),
				"chunk":       i + 1,
				"chunk_count": len(parts),
			},
		})
		if err != nil {
			errors = append(errors, err.Error())
			continue
		}
		chunkIDs = append(chunkIDs, id)
		embeddingInputs = append(embeddingInputs, aiKBEmbeddingInput{ID: id, Title: chunkTitle, Content: part})
	}
	s.embedAIKnowledgeChunks(r.Context(), uid, embeddingInputs)

	writeJSON(w, http.StatusOK, map[string]any{
		"url":       pageURL.String(),
		"title":     title,
		"added":     len(chunkIDs),
		"skipped":   len(parts) - len(chunkIDs),
		"errors":    errors,
		"chunk_ids": chunkIDs,
	})
}

type searchAIKBReq struct {
	Query   string `json:"query"`
	TopK    int    `json:"top_k"`
	AgentID int64  `json:"agent_id"`
}

func (s *Server) SearchAIKnowledge(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	var req searchAIKBReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	req.Query = strings.TrimSpace(req.Query)
	if req.Query == "" {
		writeErr(w, http.StatusBadRequest, "query is required")
		return
	}
	var agentScopeID *int64
	if req.AgentID > 0 {
		if _, err := s.Store.GetAIAgent(r.Context(), uid, req.AgentID); err != nil {
			if errors.Is(err, store.ErrAgentNotFound) {
				writeErr(w, http.StatusNotFound, "agent not found")
				return
			}
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		agentScopeID = &req.AgentID
	}
	chunks, err := s.searchAIKnowledge(r.Context(), uid, agentScopeID, req.Query, req.TopK)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"query": req.Query, "chunks": chunks})
}

func (s *Server) ListAIConversations(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	status := r.URL.Query().Get("status")
	limit := intParam(r, "limit", 100)
	offset := intParam(r, "offset", 0)
	items, total, err := s.Store.ListAIConversations(r.Context(), uid, status, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

func (s *Server) GetAIConversation(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	conv, err := s.Store.GetAIConversation(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if conv == nil {
		writeErr(w, http.StatusNotFound, "conversation not found")
		return
	}
	writeJSON(w, http.StatusOK, conv)
}

func (s *Server) GetAIConversationMessages(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	items, err := s.Store.ListAIConversationMessages(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if items == nil {
		writeErr(w, http.StatusNotFound, "conversation not found")
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) TakeOverAIConversation(w http.ResponseWriter, r *http.Request) {
	s.setAIConversationStatus(w, r, "handed_off", "manual takeover")
}

func (s *Server) HandBackAIConversation(w http.ResponseWriter, r *http.Request) {
	s.setAIConversationStatus(w, r, "active", "")
}

func (s *Server) setAIConversationStatus(w http.ResponseWriter, r *http.Request, status, reason string) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	conv, err := s.Store.SetAIConversationStatus(r.Context(), uid, id, status, reason)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if conv == nil {
		writeErr(w, http.StatusNotFound, "conversation not found")
		return
	}
	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "ai.conversation." + status, EntityType: strPtr("ai_conversation"),
		EntityID: &id,
		Metadata: map[string]any{"phone": conv.Phone, "status": conv.Status},
	})
	_, _ = s.Store.RefreshAIHumanReviewForPhone(r.Context(), uid, conv.Phone)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": conv.Status})
}

type sendAIHumanMessageReq struct {
	Content string `json:"content"`
}

func (s *Server) SendAIHumanMessage(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req sendAIHumanMessageReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	req.Content = strings.TrimSpace(req.Content)
	if req.Content == "" {
		writeErr(w, http.StatusBadRequest, "content is required")
		return
	}

	conv, err := s.Store.GetAIConversation(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if conv == nil {
		writeErr(w, http.StatusNotFound, "conversation not found")
		return
	}
	if conv.Status != "handed_off" {
		writeErr(w, http.StatusBadRequest, "conversation must be handed off before sending a human reply")
		return
	}
	if strings.TrimSpace(conv.Phone) == "" {
		writeErr(w, http.StatusBadRequest, "conversation phone is missing")
		return
	}

	msg, err := s.Store.AddAIConversationHumanMessage(r.Context(), uid, id, req.Content)
	if err != nil {
		if strings.Contains(err.Error(), "handed off") || strings.Contains(err.Error(), "content is required") {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if msg == nil {
		writeErr(w, http.StatusNotFound, "conversation not found")
		return
	}

	wa, err := s.whatsappClientForAdmin(r, uid)
	if err != nil {
		sendErr := friendlyWhatsAppSendError(err)
		msg = markAIHumanReplyFailed(r, s, uid, msg.ID, sendErr, msg)
		logAIHumanReply(r, s, uid, id, conv.Phone, false, "", sendErr)
		_, _ = s.Store.RefreshAIHumanReviewForPhone(r.Context(), uid, conv.Phone)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "sent": false, "phone": conv.Phone, "error": sendErr, "message": msg})
		return
	}
	res, err := wa.SendText(r.Context(), conv.Phone, req.Content)
	if err != nil {
		sendErr := friendlyWhatsAppSendError(err)
		msg = markAIHumanReplyFailed(r, s, uid, msg.ID, sendErr, msg)
		logAIHumanReply(r, s, uid, id, conv.Phone, false, "", sendErr)
		_, _ = s.Store.RefreshAIHumanReviewForPhone(r.Context(), uid, conv.Phone)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "sent": false, "phone": conv.Phone, "error": sendErr, "message": msg})
		return
	}
	providerMsgID := ""
	if res != nil {
		providerMsgID = res.ProviderMsgID
	}
	if updated, err := s.Store.MarkAIConversationHumanMessageSendResult(r.Context(), uid, msg.ID, true, providerMsgID, ""); err == nil && updated != nil {
		msg = updated
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, "mark reply sent: "+err.Error())
		return
	}
	logAIHumanReply(r, s, uid, id, conv.Phone, true, providerMsgID, "")
	_, _ = s.Store.RefreshAIHumanReviewForPhone(r.Context(), uid, conv.Phone)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "sent": true, "phone": conv.Phone, "provider_msg_id": providerMsgID, "message": msg})
}

func (s *Server) whatsappClientForAdmin(r *http.Request, adminID int64) (*whatsapp.Client, error) {
	creds, accessToken, _, err := s.Store.GetWhatsappCredentials(r.Context(), adminID, s.Cfg.FieldEncKey)
	if err != nil {
		return nil, fmt.Errorf("load WhatsApp credentials: %w", err)
	}
	if creds == nil || creds.RemovedAt != nil {
		return nil, fmt.Errorf("no WhatsApp credentials configured")
	}
	apiVersion := creds.APIVersion
	if apiVersion == "" {
		apiVersion = s.Cfg.WhatsAPIVersion
	}
	return whatsapp.NewClient(apiVersion, creds.PhoneNumberID, accessToken), nil
}

func markAIHumanReplyFailed(r *http.Request, s *Server, uid, messageID int64, sendErr string, fallback *models.AIConversationMessage) *models.AIConversationMessage {
	updated, err := s.Store.MarkAIConversationHumanMessageSendResult(r.Context(), uid, messageID, false, "", sendErr)
	if err != nil || updated == nil {
		if fallback != nil {
			fallback.SendStatus = "failed"
			fallback.SendError = sendErr
		}
		return fallback
	}
	return updated
}

func logAIHumanReply(r *http.Request, s *Server, uid, conversationID int64, phone string, sent bool, providerMsgID, sendErr string) {
	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "ai.conversation.human_message", EntityType: strPtr("ai_conversation"),
		EntityID: &conversationID,
		Metadata: map[string]any{"phone": phone, "sent": sent, "provider_msg_id": providerMsgID, "error": sendErr},
	})
}

func friendlyWhatsAppSendError(err error) string {
	if err == nil {
		return ""
	}
	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		return "send failed"
	}
	const marker = "body="
	idx := strings.Index(msg, marker)
	if idx < 0 {
		return msg
	}
	raw := strings.TrimSpace(msg[idx+len(marker):])
	var parsed struct {
		Error struct {
			Message      string `json:"message"`
			Type         string `json:"type"`
			Code         int    `json:"code"`
			ErrorSubcode int    `json:"error_subcode"`
			FBTraceID    string `json:"fbtrace_id"`
		} `json:"error"`
	}
	if json.Unmarshal([]byte(raw), &parsed) != nil || strings.TrimSpace(parsed.Error.Message) == "" {
		return msg
	}
	parts := []string{strings.TrimSpace(parsed.Error.Message)}
	if parsed.Error.Code != 0 {
		parts = append(parts, fmt.Sprintf("code %d", parsed.Error.Code))
	}
	if parsed.Error.ErrorSubcode != 0 {
		parts = append(parts, fmt.Sprintf("subcode %d", parsed.Error.ErrorSubcode))
	}
	if parsed.Error.FBTraceID != "" {
		parts = append(parts, "trace "+parsed.Error.FBTraceID)
	}
	return "Meta WhatsApp error: " + strings.Join(parts, " - ")
}

func applyAIAgentPatch(cfg *models.AIAgentConfig, req putAIAgentConfigReq) {
	if req.Enabled != nil {
		cfg.Enabled = *req.Enabled
	}
	if req.Name != nil {
		cfg.Name = *req.Name
	}
	if req.PersonaMD != nil {
		cfg.PersonaMD = *req.PersonaMD
	}
	if req.Tone != nil {
		cfg.Tone = *req.Tone
	}
	if req.Languages != nil {
		cfg.Languages = *req.Languages
	}
	if req.WorkingHours != nil {
		cfg.WorkingHours = *req.WorkingHours
	}
	if req.HandoffRules != nil {
		cfg.HandoffRules = *req.HandoffRules
	}
	if req.PrimaryModel != nil {
		cfg.PrimaryModel = *req.PrimaryModel
	}
	if req.FallbackModels != nil {
		cfg.FallbackModels = *req.FallbackModels
	}
	if req.PremiumModel != nil {
		cfg.PremiumModel = *req.PremiumModel
	}
	if req.FAQConfidenceThreshold != nil {
		cfg.FAQConfidenceThreshold = *req.FAQConfidenceThreshold
	}
	if req.SystemPrompt != nil {
		cfg.SystemPrompt = *req.SystemPrompt
	}
	if req.QualificationCriteria != nil {
		cfg.QualificationCriteria = *req.QualificationCriteria
	}
}

func aiStatusFromEnv() aiStatusResponse {
	openAI := os.Getenv("OPENAI_API_KEY") != ""
	bedrockBearer := os.Getenv("AWS_BEARER_TOKEN_BEDROCK") != "" || os.Getenv("BEDROCK_API_KEY") != ""
	bedrockCompat := os.Getenv("BEDROCK_BASE_URL") != "" && os.Getenv("BEDROCK_API_KEY") != ""
	bedrockAWS := (os.Getenv("AWS_ACCESS_KEY_ID") != "" && os.Getenv("AWS_SECRET_ACCESS_KEY") != "") || os.Getenv("AWS_PROFILE") != ""
	bedrock := bedrockCompat || (os.Getenv("AWS_REGION") != "" && (bedrockBearer || bedrockAWS))
	otherLLM := os.Getenv("ANTHROPIC_API_KEY") != "" || os.Getenv("DEEPSEEK_API_KEY") != ""
	return aiStatusResponse{
		LLMEnabled:         openAI || bedrock || otherLLM,
		EmbeddingsEnabled:  openAI,
		TranscriberEnabled: openAI || os.Getenv("AWS_TRANSCRIBE_REGION") != "",
	}
}

func truthyEnv(key string) bool {
	switch os.Getenv(key) {
	case "1", "true", "TRUE", "yes", "YES", "on", "ON":
		return true
	default:
		return false
	}
}

func buildLocalAgentPreview(cfg *models.AIAgentConfig, message string, chunks []models.AIRetrievedChunk, status aiStatusResponse) string {
	name := strings.TrimSpace(cfg.Name)
	if name == "" {
		name = "the AI assistant"
	}
	if len(chunks) == 0 {
		if status.LLMEnabled {
			return fmt.Sprintf("%s is ready, but I did not find matching knowledge for: %q. Add relevant KB chunks or connect a live model call for full answers.", name, message)
		}
		return fmt.Sprintf("%s is configured locally, but no LLM key is active and no matching knowledge was found for: %q.", name, message)
	}
	lines := []string{
		fmt.Sprintf("%s found %d relevant knowledge chunk(s) for your test message.", name, len(chunks)),
		"",
	}
	for i, c := range chunks {
		title := c.Title
		if title == "" {
			title = fmt.Sprintf("Chunk #%d", c.ID)
		}
		lines = append(lines, fmt.Sprintf("[%d] %s: %s", i+1, title, compactText(c.Content, 220)))
	}
	lines = append(lines, "")
	if status.LLMEnabled {
		lines = append(lines, "LLM credentials are detected, but this endpoint is currently returning a local retrieval preview.")
	} else {
		lines = append(lines, "Add an LLM provider key to enable generated replies; this preview confirms retrieval is working.")
	}
	return strings.Join(lines, "\n")
}

func inferLocalIntent(message string) string {
	m := strings.ToLower(message)
	switch {
	case strings.Contains(m, "price") || strings.Contains(m, "cost") || strings.Contains(m, "kitna"):
		return "pricing"
	case strings.Contains(m, "human") || strings.Contains(m, "person") || strings.Contains(m, "agent"):
		return "handoff"
	case strings.Contains(m, "order") || strings.Contains(m, "delivery"):
		return "order_status"
	default:
		return "general"
	}
}

func estimateTokens(s string) int {
	words := len(strings.Fields(s))
	if words == 0 {
		return 0
	}
	return (words*4 + 2) / 3
}

func compactText(s string, limit int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) <= limit {
		return s
	}
	return strings.TrimSpace(s[:limit]) + "..."
}

func validateHTTPURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("url is required")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("invalid url")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("url must start with http:// or https://")
	}
	return u, nil
}

func fetchURLText(r *http.Request, u *url.URL) (string, error) {
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, u.String(), nil)
	req.Header.Set("User-Agent", "WhatsyITC-AI-Ingest/1.0")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetch url: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("fetch url returned %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return "", fmt.Errorf("read url: %w", err)
	}
	return string(raw), nil
}

var (
	htmlTitleRE       = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	htmlDropRE        = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>|<style[^>]*>.*?</style>|<noscript[^>]*>.*?</noscript>`)
	htmlBlockRE       = regexp.MustCompile(`(?i)</?(p|div|li|br|h[1-6]|tr|section|article|header|footer)[^>]*>`)
	htmlTagRE         = regexp.MustCompile(`(?s)<[^>]+>`)
	spaceCollapseRE   = regexp.MustCompile(`[ \t\f\v]+`)
	newlineCollapseRE = regexp.MustCompile(`\n{3,}`)
)

func extractHTMLTitle(raw string) string {
	m := htmlTitleRE.FindStringSubmatch(raw)
	if len(m) < 2 {
		return ""
	}
	return compactText(html.UnescapeString(strings.TrimSpace(m[1])), 120)
}

func htmlToPlainText(raw string) string {
	s := htmlDropRE.ReplaceAllString(raw, " ")
	s = htmlBlockRE.ReplaceAllString(s, "\n")
	s = htmlTagRE.ReplaceAllString(s, " ")
	s = html.UnescapeString(s)
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	s = spaceCollapseRE.ReplaceAllString(s, " ")
	lines := strings.Split(s, "\n")
	clean := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			clean = append(clean, line)
		}
	}
	return strings.TrimSpace(newlineCollapseRE.ReplaceAllString(strings.Join(clean, "\n"), "\n\n"))
}

func chunkPlainText(text string, maxChars int) []string {
	if maxChars <= 0 {
		maxChars = 3500
	}
	paras := strings.Split(text, "\n")
	out := []string{}
	var b strings.Builder
	flush := func() {
		part := strings.TrimSpace(b.String())
		if part != "" {
			out = append(out, part)
		}
		b.Reset()
	}
	for _, para := range paras {
		para = strings.TrimSpace(para)
		if para == "" {
			continue
		}
		if b.Len() > 0 && b.Len()+len(para)+2 > maxChars {
			flush()
		}
		if len(para) > maxChars {
			for len(para) > maxChars {
				out = append(out, strings.TrimSpace(para[:maxChars]))
				para = strings.TrimSpace(para[maxChars:])
			}
		}
		if para != "" {
			if b.Len() > 0 {
				b.WriteString("\n\n")
			}
			b.WriteString(para)
		}
	}
	flush()
	if len(out) == 0 && strings.TrimSpace(text) != "" {
		out = append(out, strings.TrimSpace(text))
	}
	return out
}

// kbSegregateSystemPrompt is the system prompt sent to DeepSeek when
// we ask it to split a blob of company info into atomic KB chunks.
// Kept as a package-level constant so it's easy to find and iterate.
const kbSegregateSystemPrompt = `You split a company-info blob into atomic knowledge-base chunks for an AI assistant that answers retailer questions on WhatsApp.

Follow these rules strictly:

1. Output a single JSON array — no prose, no markdown fences, no commentary, no explanation.
2. Each chunk must be self-contained: a retailer asking about it should NOT need any other chunk to understand the answer.
3. Target 100-400 words per chunk. Split long sections at logical boundaries (different policy, different category, different product).
4. Title: 60 chars max, human-friendly, like "Refund policy" or "Store hours". Do NOT start with "Chunk" or numbered prefixes.
5. Choose exactly one category per chunk from this enum:
     customer_service  (refunds, returns, hours, contact, support)
     billing           (invoices, payments, fees, receipts, due dates)
     product           (catalog, pricing, stock, warranty)
     policy            (privacy, terms, complaints, escalation)
6. Tags: 1-5 short keywords (30 chars max each). Useful for filtering.
   Example: ["refund", "return", "30-days"].
7. Do NOT invent facts not present in the text. If a section is vague, include it as written.
8. If the input is too short to warrant multiple chunks, output a single chunk covering everything.
9. If a section repeats text from an adjacent section, keep the best complete chunk once instead of duplicating it.

JSON schema (output ONLY this array, nothing else):
[{"title":string,"content":string,"category":"customer_service"|"billing"|"product"|"policy","tags":string[]}]
`

const kbMetadataSystemPrompt = `You label source-faithful knowledge-base chunks for a WhatsApp AI assistant.

Follow these rules strictly:

1. Output a single JSON array only. No prose, no markdown fences.
2. Return exactly one object for each input index.
3. Do not rewrite, summarize, or add facts from the chunk text. You are only creating labels.
4. Title: 60 chars max, human-friendly, specific.
5. Choose exactly one category per chunk from this enum:
     customer_service  (refunds, returns, hours, contact, support)
     billing           (invoices, payments, fees, receipts, due dates)
     product           (catalog, pricing, stock, warranty)
     policy            (privacy, terms, complaints, escalation)
6. Tags: 1-5 short keywords, 30 chars max each.

JSON schema:
[{"index":number,"title":string,"category":"customer_service"|"billing"|"product"|"policy","tags":string[]}]
`

// extractJSONArray pulls a JSON array out of a model response. It is
// tolerant: strips ```json fences, trims leading prose, and slices
// from the first '[' to the matching ']'.
func extractJSONArray(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		if i := strings.Index(s, "\n"); i != -1 {
			s = s[i+1:]
		}
		if i := strings.LastIndex(s, "```"); i != -1 {
			s = s[:i]
		}
		s = strings.TrimSpace(s)
	}
	start := strings.Index(s, "[")
	end := strings.LastIndex(s, "]")
	if start == -1 || end == -1 || end <= start {
		return nil, fmt.Errorf("no JSON array found in model output")
	}
	return []byte(s[start : end+1]), nil
}

// normaliseKBCategory maps whatever the model returned to one of the
// four canonical categories. Anything unrecognised falls back to
// "customer_service" (the broadest bucket).
func normaliseKBCategory(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "customer_service", "customer service", "service", "support":
		return "customer_service"
	case "billing", "payments", "finance":
		return "billing"
	case "product", "catalog", "inventory":
		return "product"
	case "policy", "legal", "compliance":
		return "policy"
	}
	return "customer_service"
}

func inferKBCategory(content string) string {
	s := strings.ToLower(content)
	switch {
	case strings.Contains(s, "invoice") || strings.Contains(s, "payment") ||
		strings.Contains(s, "receipt") || strings.Contains(s, "billing") ||
		strings.Contains(s, "price") || strings.Contains(s, "pricing"):
		return "billing"
	case strings.Contains(s, "product") || strings.Contains(s, "catalog") ||
		strings.Contains(s, "stock") || strings.Contains(s, "warranty") ||
		strings.Contains(s, "available"):
		return "product"
	case strings.Contains(s, "policy") || strings.Contains(s, "privacy") ||
		strings.Contains(s, "terms") || strings.Contains(s, "complaint") ||
		strings.Contains(s, "refund") || strings.Contains(s, "return"):
		return "policy"
	default:
		return "customer_service"
	}
}

func inferKBTags(content string) []string {
	s := strings.ToLower(content)
	candidates := []struct {
		needle string
		tag    string
	}{
		{"refund", "refund"},
		{"return", "returns"},
		{"price", "pricing"},
		{"payment", "payment"},
		{"invoice", "invoice"},
		{"delivery", "delivery"},
		{"shipping", "shipping"},
		{"catalog", "catalog"},
		{"product", "product"},
		{"stock", "stock"},
		{"warranty", "warranty"},
		{"support", "support"},
		{"hours", "hours"},
		{"complaint", "complaint"},
	}
	tags := []string{}
	for _, c := range candidates {
		if strings.Contains(s, c.needle) {
			tags = append(tags, c.tag)
			if len(tags) >= 5 {
				break
			}
		}
	}
	if len(tags) == 0 {
		tags = append(tags, inferKBCategory(content))
	}
	return sanitiseKBTags(tags)
}

// sanitiseKBTags trims, dedupes, and caps each tag to 30 chars.
// Keeps at most 5 tags per chunk.
func sanitiseKBTags(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	seen := map[string]bool{}
	out := make([]string, 0, 5)
	for _, t := range in {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if len(t) > 30 {
			t = t[:30]
		}
		key := strings.ToLower(t)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, t)
		if len(out) >= 5 {
			break
		}
	}
	return out
}

// truncate returns at most n bytes of s, suffixing with "…" if cut.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	if n < 1 {
		return ""
	}
	return s[:n-1] + "…"
}
