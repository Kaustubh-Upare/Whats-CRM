// Package handlers wires every HTTP endpoint for the billingcomm service.
// Each handler is a method on Server (so they share *store.Store + *config).
package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/whatsyitc/backend/internal/ai/orchestrator"
	"github.com/whatsyitc/backend/internal/ai/retrieval"
	"github.com/whatsyitc/backend/internal/auth"
	"github.com/whatsyitc/backend/internal/config"
	"github.com/whatsyitc/backend/internal/llm"
	"github.com/whatsyitc/backend/internal/queue"
	"github.com/whatsyitc/backend/internal/store"
	"github.com/whatsyitc/backend/internal/whatsapp"
	"github.com/whatsyitc/backend/internal/worker"
)

type Server struct {
	Cfg    *config.Config
	Store  *store.Store
	WA     *whatsapp.Client
	Queue  queue.JobQueue
	Google *auth.GoogleClient
	LLM    *llm.Registry
	// Retriever is the shared KB retrieval path. Admin playground,
	// manual KB search, and WhatsApp orchestration all use this so
	// keyword/vector behavior stays consistent.
	Retriever *retrieval.Retriever
	// Orch is the AI agent loop (Phase 6). The webhook calls
	// HandleInbound on every inbound text message; nil-safe (the
	// webhook no-ops if Orch is unset, e.g. when LLM is disabled).
	Orch *orchestrator.Orchestrator
	// Worker is the sequence worker (Phase 5 + Phase 7). The webhook
	// calls PauseAllFollowupsForPhone on every inbound text to stop
	// active AI follow-up sequences when the customer replies.
	// Nil-safe (Phase 5 deployments without Phase 7 just don't get
	// the pause-on-reply behavior).
	Worker *worker.SequenceWorker
	// OAuthState holds a short-lived map of in-flight OAuth state tokens
	// to the post-login redirect path. We use this instead of a cookie
	// because the dev Vite proxy can drop Set-Cookie on cross-origin
	// responses; storing the state server-side and looking it up by
	// token (the `state` URL parameter Google echoes back) is
	// bulletproof across any proxy / browser config.
	OAuthState *oauthStateMap
}

// SetOrchestrator wires the AI agent loop into the server. Called
// from cmd/server/main.go after the orchestrator is built. Nil-safe.
func (s *Server) SetOrchestrator(o *orchestrator.Orchestrator) {
	s.Orch = o
}

// SetSequenceWorker wires the Phase 5 sequence worker (which also
// runs the Phase 7 follow-up send path). The webhook uses it to
// pause active AI follow-up enrollments on customer replies.
func (s *Server) SetSequenceWorker(w *worker.SequenceWorker) {
	s.Worker = w
}

// SetLLMRegistry makes the live LLM stack available to admin handlers
// such as the agent test playground.
func (s *Server) SetLLMRegistry(l *llm.Registry) {
	s.LLM = l
}

func (s *Server) SetRetriever(r *retrieval.Retriever) {
	s.Retriever = r
}

type oauthStateEntry struct {
	next      string
	createdAt time.Time
}

type oauthStateMap struct {
	mu      sync.Mutex
	entries map[string]oauthStateEntry
}

func newOAuthStateMap() *oauthStateMap {
	return &oauthStateMap{entries: make(map[string]oauthStateEntry)}
}

func (m *oauthStateMap) Put(token, next string, ttl time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.entries[token] = oauthStateEntry{next: next, createdAt: time.Now()}
	// Best-effort cleanup of expired entries — safe to skip under
	// concurrent load; the next successful or stale Put will sweep.
	for k, v := range m.entries {
		if time.Since(v.createdAt) > ttl {
			delete(m.entries, k)
		}
	}
}

func (m *oauthStateMap) Consume(token string) (next string, ok bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, found := m.entries[token]
	if !found {
		return "", false
	}
	delete(m.entries, token)
	return v.next, true
}

func NewServer(cfg *config.Config, st *store.Store, wa *whatsapp.Client, q queue.JobQueue) *Server {
	return &Server{
		Cfg:        cfg,
		Store:      st,
		WA:         wa,
		Queue:      q,
		Google:     auth.NewGoogleClient(cfg.GoogleOAuthClientID, cfg.GoogleOAuthClientSecret, cfg.GoogleOAuthRedirectURL),
		OAuthState: newOAuthStateMap(),
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func intParam(r *http.Request, key string, def int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func int64Param(r *http.Request, key string) (int64, bool) {
	v := r.URL.Query().Get(key)
	if v == "" {
		return 0, false
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}
