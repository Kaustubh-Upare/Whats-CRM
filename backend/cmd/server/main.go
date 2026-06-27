// cmd/server is the main HTTP entrypoint for the WhatsyITC billing-comm
// service. It exposes the API the admin frontend talks to.
//
//	go run ./cmd/server
//
// Listens on PORT (default 8082).
package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/whatsyitc/backend/internal/ai/orchestrator"
	"github.com/whatsyitc/backend/internal/ai/retrieval"
	"github.com/whatsyitc/backend/internal/ai/tools"
	"github.com/whatsyitc/backend/internal/auth"
	"github.com/whatsyitc/backend/internal/config"
	"github.com/whatsyitc/backend/internal/crypto"
	"github.com/whatsyitc/backend/internal/db"
	"github.com/whatsyitc/backend/internal/handlers"
	"github.com/whatsyitc/backend/internal/llm"
	"github.com/whatsyitc/backend/internal/middleware"
	"github.com/whatsyitc/backend/internal/queue"
	"github.com/whatsyitc/backend/internal/store"
	"github.com/whatsyitc/backend/internal/whatsapp"
	"github.com/whatsyitc/backend/internal/worker"
)

func main() {
	_ = godotenv.Load()
	cfg := config.Load()

	logger := newLogger(cfg)
	slog.SetDefault(logger)
	logger.Info("starting",
		"env", cfg.Env,
		"port", cfg.Port,
		"frontend", cfg.AllowedOrigins(),
		"worker_concurrency", cfg.WorkerConcurrency,
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := db.New(ctx, cfg.PostgresURI)
	if err != nil {
		logger.Error("postgres connect", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	logger.Info("postgres connected")

	migDir := os.Getenv("BC_MIGRATIONS_DIR")
	if migDir == "" {
		migDir = filepath.Join("internal", "db", "migrations")
	}
	if err := db.RunMigrations(ctx, pool, migDir); err != nil {
		logger.Error("migrations", "err", err)
		os.Exit(1)
	}
	logger.Info("migrations ok")

	if err := os.MkdirAll(cfg.UploadDir, 0o755); err != nil {
		logger.Error("upload dir", "err", err)
		os.Exit(1)
	}

	st := store.New(pool)

	// Per-user credentials resolver. The worker (and any other send
	// path) calls this with the admin id of the job to get a
	// *whatsapp.Client bound to that admin's tokens. Decrypts happen
	// here, in-memory, so the plaintext never lands on disk.
	resolver := func(ctx context.Context, adminID int64) (*whatsapp.Client, error) {
		if adminID <= 0 {
			return nil, worker.ErrNoCredentials
		}
		creds, accessToken, _, err := st.GetWhatsappCredentials(ctx, adminID, cfg.FieldEncKey)
		if err != nil {
			return nil, err
		}
		if creds == nil {
			return nil, worker.ErrNoCredentials
		}
		apiVersion := creds.APIVersion
		if apiVersion == "" {
			apiVersion = cfg.WhatsAPIVersion
		}
		return whatsapp.NewClient(apiVersion, creds.PhoneNumberID, accessToken), nil
	}

	q := queue.NewMemory(1024, cfg.WorkerConcurrency)
	wk := worker.New(st, resolver)
	q.Run(ctx, wk.Handle)
	defer q.Stop()
	logger.Info("queue + worker started")

	// Phase 5: sequence worker. Polls bc_crm_sequence_enrollments
	// every 5s and sends due messages via the per-admin WhatsApp
	// resolver. If the admin has no WABA creds, every enrollment it
	// picks up is paused with reason 'no_sender' so the UI surfaces
	// the issue rather than a silent broken state.
	seqWk := worker.NewSequenceWorker(st.DB, resolver)
	seqWk.SetHumanReviewRefresher(st)
	// Phase 7: wire the orchestrator's FollowUpGenerator into the
	// worker. When the LLM registry isn't configured, the worker
	// still runs but pauses any ai_followup enrollment it picks up
	// with reason 'no_followup_generator' — the Runs panel surfaces
	// it. Nil-safe.
	go seqWk.Start(ctx)
	logger.Info("sequence worker started")

	srv := handlers.NewServer(cfg, st, nil, q)
	issuer := auth.NewIssuer(cfg.JWTSecret, cfg.JWTAudience)

	// Phase 6: AI agent brain. Build the LLM registry, the
	// retriever (if OpenAI is configured for embeddings), and the
	// orchestrator. The orchestrator is nil-safe — the webhook
	// no-ops when s.Orch is unset (i.e. no LLM keys configured).
	//
	// Env vars are read directly here because the live config
	// package doesn't expose LLM-specific fields. Adding them
	// belongs in a follow-up; for Phase 6 we just need the
	// registry to exist (and degrade to disabled) so the webhook
	// wiring + opt-out handler can ship.
	bedrockConfigured := bedrockEnvConfigured()
	openAIAPIKey := envOr("OPENAI_API_KEY", "")
	if bedrockConfigured && !envBool("OPENAI_FALLBACK_ENABLED", false) {
		openAIAPIKey = ""
	}

	llmReg, llmErr := llm.NewRegistry(ctx, llm.RegistryConfig{
		AWSRegion:            envOr("AWS_REGION", ""),
		AWSAccessKey:         envOr("AWS_ACCESS_KEY_ID", ""),
		AWSSecretKey:         envOr("AWS_SECRET_ACCESS_KEY", ""),
		BedrockBearerToken:   firstEnv("AWS_BEARER_TOKEN_BEDROCK", "BEDROCK_API_KEY"),
		BedrockOpenAIAPIKey:  envOr("BEDROCK_API_KEY", ""),
		BedrockOpenAIBaseURL: envOr("BEDROCK_BASE_URL", ""),
		BedrockModel:         envOr("BEDROCK_MODEL", ""),
		OpenAIAPIKey:         openAIAPIKey,
		OpenAIBaseURL:        envOr("OPENAI_BASE_URL", ""),
		OpenAIModel:          envOr("OPENAI_MODEL", "gpt-4.1"),
		EmbedModel:           envOr("OPENAI_EMBED_MODEL", "text-embedding-3-small"),
		EmbedDim:             1536,
		DeepgramAPIKey:       envOr("DEEPGRAM_API_KEY", ""),
		DeepgramModel:        envOr("DEEPGRAM_MODEL", "nova-2"),
		BedrockDeepSeek:      envOr("BEDROCK_DEEPSEEK_MODEL", envOr("BEDROCK_MODEL", "deepseek.deepseek-v3-2")),
		BedrockClaudeSonnet:  envOr("BEDROCK_CLAUDE_SONNET_MODEL", envOr("BEDROCK_MODEL", "anthropic.claude-sonnet-4-5-20250929")),
		BedrockClaudeHaiku:   envOr("BEDROCK_CLAUDE_HAIKU_MODEL", envOr("BEDROCK_MODEL", "anthropic.claude-haiku-4-5-20251001")),
		BedrockProfile:       envOr("BEDROCK_INFERENCE_PROFILE_ARN", ""),
	})
	if llmErr != nil {
		logger.Warn("llm registry build error (continuing without AI)", "err", llmErr)
	} else {
		srv.SetLLMRegistry(llmReg)
		logger.Info("llm registry ready",
			"enabled", llmReg.Enabled(),
			"embeddings", llmReg.HasEmbeddings(),
			"transcriber", llmReg.HasTranscriber(),
		)
	}

	var retriever *retrieval.Retriever
	if llmReg != nil && llmReg.Enabled() {
		retriever = retrieval.NewRetriever(st.DB, nil, retrieval.NewMemoryCache(), retrieval.DefaultConfig())
		logger.Info("retrieval ready", "mode", "keyword")
	} else {
		logger.Warn("retrieval disabled (no LLM configured)")
	}

	if llmReg != nil {
		senderFactory := func(ctx context.Context, adminID int64) (orchestrator.Sender, error) {
			client, err := resolver(ctx, adminID)
			if err != nil {
				return nil, err
			}
			return orchestrator.NewWhatsAppAdapter(client), nil
		}
		orch := orchestrator.New(st.DB, llmReg, retriever, tools.NewRegistry(st.DB), nil, senderFactory)
		orch.SetHumanReviewSignalSaver(st)
		srv.SetOrchestrator(orch)
		// Phase 7: the sequence worker needs the orchestrator's
		// GenerateFollowUp to render ai_followup bodies.
		seqWk.SetFollowUpGenerator(orch)
		logger.Info("orchestrator wired (incl. follow-up generator)")
	} else {
		logger.Warn("orchestrator disabled (no LLM keys configured)")
	}

	// Phase 7: hand the sequence worker to the Server so the webhook
	// can call PauseAllFollowupsForPhone on every inbound text.
	srv.SetSequenceWorker(seqWk)

	mux := http.NewServeMux()

	// health + auth
	mux.HandleFunc("GET /healthz", srv.Healthz)
	mux.Handle("POST /auth/login",
		middleware.RateLimit(cfg.LoginRPS, cfg.LoginBurst, middleware.ClientIP)(
			middleware.MaxBytes(cfg.MaxJSONBytes)(http.HandlerFunc(srv.Login))))
	mux.Handle("GET /auth/me", middleware.JWTAuth(issuer)(http.HandlerFunc(srv.Me)))
	mux.Handle("PUT /auth/me", middleware.JWTAuth(issuer)(http.HandlerFunc(srv.PutMyProfile)))
	mux.HandleFunc("POST /auth/logout", srv.Logout)
	// Google OAuth (state cookie handles CSRF; rate-limit the start
	// endpoint so a misbehaving tab can't keep minting state tokens).
	mux.HandleFunc("GET /auth/google", srv.GoogleStatus) // JSON status for the frontend
	mux.Handle("GET /auth/google/start",
		middleware.RateLimit(cfg.LoginRPS, cfg.LoginBurst, middleware.ClientIP)(
			http.HandlerFunc(srv.GoogleLogin)))
	mux.HandleFunc("GET /auth/google/callback", srv.GoogleCallback)

	// public webhook (Meta). Body cap mirrors the same JSON ceiling.
	mux.HandleFunc("GET /webhook/whatsapp", srv.WebhookVerify)
	mux.Handle("POST /webhook/whatsapp",
		middleware.MaxBytes(cfg.MaxJSONBytes)(http.HandlerFunc(srv.WebhookStatus)))
	// Public alias for deployments whose reverse proxy already forwards /api/*.
	mux.HandleFunc("GET /api/webhook/whatsapp", srv.WebhookVerify)
	mux.Handle("POST /api/webhook/whatsapp",
		middleware.MaxBytes(cfg.MaxJSONBytes)(http.HandlerFunc(srv.WebhookStatus)))

	// protected API
	api := http.NewServeMux()
	api.HandleFunc("GET /dashboard/kpi", srv.DashboardKPI)
	api.HandleFunc("GET /dashboard/trend", srv.DashboardTrend)
	api.HandleFunc("GET /dashboard/activity", srv.RecentActivity)

	api.HandleFunc("GET /retailers", srv.ListRetailers)
	api.HandleFunc("GET /retailers/{id}", srv.GetRetailer)
	api.HandleFunc("POST /retailers/{id}/opt", srv.SetOptOut)

	api.HandleFunc("GET /messages", srv.ListMessages)
	api.HandleFunc("GET /messages/{id}", srv.GetMessage)
	api.HandleFunc("POST /messages/{id}/resend", srv.ResendMessage)
	api.HandleFunc("POST /messages/resend-failed", srv.ResendFailed)

	api.HandleFunc("GET /conversations", srv.ListConversations)
	api.HandleFunc("GET /conversations/{id}/messages", srv.GetConversationMessages)
	api.HandleFunc("GET /conversations/by-phone/{phone}/messages", srv.GetConversationByPhone)

	api.HandleFunc("GET /batches", srv.ListBatches)
	api.HandleFunc("POST /batches/upload", srv.UploadBatch)
	api.HandleFunc("GET /batches/{id}", srv.GetBatch)
	// Inline-editable batch name. PATCH so it can grow other small
	// mutations (notes, etc.) later without a new route.
	api.HandleFunc("PATCH /batches/{id}", srv.PatchBatch)
	api.HandleFunc("GET /batches/{id}/preview-message", srv.PreviewBatchMessage)
	api.HandleFunc("POST /batches/{id}/approve", srv.ApproveBatch)
	// "Approve only" — flips the batch status to 'approved' WITHOUT
	// queuing any message jobs. Used by the "Approve only" button on
	// /admin/batches/{id} when the admin wants to stage AI follow-up
	// for a batch without committing to the send.
	api.HandleFunc("POST /batches/{id}/approve-only", srv.ApproveBatchOnly)
	// Resend — create a NEW round of message jobs for an
	// already-sent batch. Distinct from POST /messages/resend-failed
	// (which retries transient Meta failures). Supports
	// ?template=NAME&lang=CODE and an optional JSON body
	// { only_failed, row_numbers } to scope which recipients get a
	// new job. Does NOT flip batch status.
	api.HandleFunc("POST /batches/{id}/resend", srv.ResendBatch)
	// Per-batch AI follow-up toggle + activity feed for the Upload
	// page's "AI agent activity" panel.
	api.HandleFunc("GET /batches/{id}/ai-followup", srv.GetBatchAIFollowup)
	api.HandleFunc("PUT /batches/{id}/ai-followup", srv.PutBatchAIFollowup)
	// "Enable AI with timeline" — flips the flag AND creates one
	// sequence enrollment per recipient. Used by the Enable AI
	// modal on /admin/ai/followups.
	api.HandleFunc("POST /batches/{id}/ai-followup/sequence", srv.StartBatchAIFollowupSequence)
	// Preflight — read-only check for phones in this batch that
	// already have an active AI follow-up elsewhere. Powers the
	// "duplicate phones" warning modal before the admin commits
	// to the sequence-start above.
	api.HandleFunc("POST /batches/{id}/ai-followup/duplicates", srv.PreflightBatchAIFollowupDuplicates)
	api.HandleFunc("GET /batches/{id}/ai-followup/summary", srv.GenerateBatchAICRMSummary)
	// Per-recipient workflow detail page. Returns the recipient row
	// + linked conversation + lead + active follow-up enrollment +
	// batch header in one round-trip so the page can render without
	// N sequential GETs.
	api.HandleFunc("GET /batch-ai-recipients/{id}", srv.GetBatchAIRecipient)
	api.HandleFunc("POST /batch-ai-recipients/{id}/exclude", srv.ExcludeRecipient)
	api.HandleFunc("POST /batch-ai-recipients/{id}/include", srv.IncludeRecipient)
	// Per-recipient intervention endpoints — powers the operator
	// controls on the detail page (pause/resume/edit plan/send now
	// / change mode) plus the History panel and the cross-batch
	// CSV export.
	api.HandleFunc("POST /batch-ai-recipients/{id}/pause", srv.PauseFollowup)
	api.HandleFunc("POST /batch-ai-recipients/{id}/resume", srv.ResumeFollowup)
	api.HandleFunc("POST /batch-ai-recipients/{id}/send-next", srv.SendNextFollowupStep)
	api.HandleFunc("PUT /batch-ai-recipients/{id}/plan", srv.UpdateFollowupPlan)
	api.HandleFunc("POST /batch-ai-recipients/{id}/next-message/generate", srv.GenerateNextFollowupMessage)
	api.HandleFunc("PUT /batch-ai-recipients/{id}/next-message", srv.SaveNextFollowupMessage)
	api.HandleFunc("DELETE /batch-ai-recipients/{id}/next-message", srv.ClearNextFollowupMessage)
	api.HandleFunc("POST /batch-ai-recipients/{id}/mode", srv.SetFollowupMode)
	api.HandleFunc("GET /batch-ai-recipients/{id}/audit", srv.RecipientAuditLog)
	api.HandleFunc("GET /ai/followups/export", srv.ExportFollowupsCSV)

	api.HandleFunc("GET /templates", srv.ListTemplates)
	api.HandleFunc("POST /templates", srv.CreateTemplate)
	api.HandleFunc("GET /templates/{id}", srv.GetTemplate)
	api.HandleFunc("PUT /templates/{id}", srv.UpdateTemplate)
	api.HandleFunc("DELETE /templates/{id}", srv.DeleteTemplate)
	api.HandleFunc("PATCH /templates/{id}/active", srv.SetTemplateActive)
	api.HandleFunc("POST /templates/{id}/preview", srv.PreviewTemplate)
	// Editor preview that doesn't need an existing id — body + sample in,
	// rendered body out.
	api.HandleFunc("POST /templates/preview", srv.PreviewTemplate)

	api.HandleFunc("GET /reports/summary", srv.ReportSummary)
	api.HandleFunc("GET /reports/trend", srv.ReportTrend)
	api.HandleFunc("GET /reports/export.csv", srv.ReportExport)

	api.HandleFunc("GET /webhook-logs", srv.ListWebhookLogs)

	// AI assistant admin surface.
	api.HandleFunc("GET /ai/status", srv.AIStatus)
	// Multi-agent CRUD (Phase 8).
	api.HandleFunc("GET /ai/agents", srv.ListAIAgents)
	api.HandleFunc("POST /ai/agents", srv.CreateAIAgent)
	api.HandleFunc("GET /ai/agents/default", srv.GetAIAgentConfig) // alias of GET /ai/agent
	api.HandleFunc("PUT /ai/agents/default", srv.PutAIAgentConfig) // alias of PUT /ai/agent
	api.HandleFunc("GET /ai/agents/{id}", srv.GetAIAgent)
	api.HandleFunc("PUT /ai/agents/{id}", srv.UpdateAIAgent)
	api.HandleFunc("DELETE /ai/agents/{id}", srv.DeleteAIAgent)
	api.HandleFunc("POST /ai/agents/{id}/default", srv.SetDefaultAIAgent)
	api.HandleFunc("GET /ai/agents/{id}/knowledge", srv.GetAIAgentKnowledge)
	api.HandleFunc("PUT /ai/agents/{id}/knowledge", srv.PutAIAgentKnowledge)
	// Back-compat aliases for one release (Phase 8). The legacy
	// single-agent editor calls these — they map to the default agent.
	api.HandleFunc("GET /ai/agent", srv.GetAIAgentConfig)
	api.HandleFunc("PUT /ai/agent", srv.PutAIAgentConfig)
	api.HandleFunc("POST /ai/agent/test", srv.TestAIAgent)
	// Per-batch agent assignment (Phase 8). Used by the inline
	// picker on the batch follow-up page.
	api.HandleFunc("GET /batches/{id}/agent", srv.GetBatchAIAgent)
	api.HandleFunc("PUT /batches/{id}/agent", srv.PutBatchAIAgent)
	api.HandleFunc("GET /ai/kb", srv.ListAIKnowledge)
	api.HandleFunc("POST /ai/kb", srv.AddAIKnowledge)
	api.HandleFunc("PUT /ai/kb/{id}", srv.UpdateAIKnowledge)
	api.HandleFunc("DELETE /ai/kb/{id}", srv.DeleteAIKnowledge)
	api.HandleFunc("POST /ai/kb/url", srv.IngestAIKnowledgeURL)
	api.HandleFunc("POST /ai/kb/search", srv.SearchAIKnowledge)
	api.HandleFunc("POST /ai/kb/generate-from-text", srv.GenerateKBFromText)
	api.HandleFunc("POST /ai/kb/imports", srv.StartAIKnowledgeImport)
	api.HandleFunc("GET /ai/kb/imports/{id}", srv.GetAIKnowledgeImport)
	api.HandleFunc("GET /ai/conversations", srv.ListAIConversations)
	api.HandleFunc("GET /ai/conversations/{id}", srv.GetAIConversation)
	api.HandleFunc("GET /ai/conversations/{id}/messages", srv.GetAIConversationMessages)
	// Cross-batch AI follow-up operator queue. Used by the
	// /admin/ai/followups sidebar page.
	api.HandleFunc("GET /ai/followups", srv.ListBatchAIFollowups)
	api.HandleFunc("GET /ai/followups/insights", srv.ListBatchAICRMInsights)
	api.HandleFunc("GET /ai/human-review", srv.ListAIHumanReview)
	api.HandleFunc("GET /ai/human-review/{id}", srv.GetAIHumanReview)
	api.HandleFunc("POST /ai/human-review/{id}/resolve", srv.ResolveAIHumanReview)
	api.HandleFunc("POST /ai/human-review/{id}/ai-help", srv.GenerateAIHumanReviewHelp)
	api.HandleFunc("POST /ai/conversations/{id}/takeover", srv.TakeOverAIConversation)
	api.HandleFunc("POST /ai/conversations/{id}/handback", srv.HandBackAIConversation)
	api.HandleFunc("POST /ai/conversations/{id}/messages", srv.SendAIHumanMessage)

	// CRM admin surface.
	api.HandleFunc("GET /crm/pipelines", srv.ListCRMPipelines)
	api.HandleFunc("POST /crm/pipelines", srv.CreateCRMPipeline)
	api.HandleFunc("GET /crm/pipelines/{id}", srv.GetCRMPipeline)
	api.HandleFunc("PUT /crm/pipelines/{id}", srv.UpdateCRMPipeline)
	api.HandleFunc("PUT /crm/pipelines/{id}/stages", srv.UpdateCRMPipelineStages)
	api.HandleFunc("DELETE /crm/pipelines/{id}", srv.DeleteCRMPipeline)
	api.HandleFunc("GET /crm/leads", srv.ListCRMLeads)
	api.HandleFunc("POST /crm/leads", srv.CreateCRMLead)
	api.HandleFunc("GET /crm/leads/{id}", srv.GetCRMLead)
	api.HandleFunc("PUT /crm/leads/{id}", srv.UpdateCRMLead)
	api.HandleFunc("DELETE /crm/leads/{id}", srv.DeleteCRMLead)
	api.HandleFunc("GET /crm/leads/{id}/activities", srv.ListCRMLeadActivities)
	api.HandleFunc("POST /crm/leads/{id}/activities", srv.AddCRMLeadActivity)
	api.HandleFunc("GET /crm/leads/{id}/tasks", srv.ListCRMLeadTasks)
	api.HandleFunc("POST /crm/leads/{id}/tasks", srv.AddCRMLeadTask)
	api.HandleFunc("PUT /crm/leads/{id}/tasks/{taskID}", srv.UpdateCRMLeadTask)
	api.HandleFunc("GET /crm/leads/{id}/conversations", srv.ListCRMLeadConversations)
	api.HandleFunc("GET /crm/leads/{id}/deals", srv.ListCRMLeadDeals)
	api.HandleFunc("GET /crm/deals", srv.ListCRMDeals)
	api.HandleFunc("POST /crm/deals", srv.CreateCRMDeal)
	api.HandleFunc("POST /crm/deals/{id}/stage", srv.MoveCRMDealStage)
	api.HandleFunc("PUT /crm/deals/{id}", srv.UpdateCRMDeal)
	api.HandleFunc("DELETE /crm/deals/{id}", srv.DeleteCRMDeal)
	api.HandleFunc("GET /crm/sequences", srv.ListCRMSequences)
	api.HandleFunc("POST /crm/sequences", srv.CreateCRMSequence)
	api.HandleFunc("PUT /crm/sequences/{id}", srv.UpdateCRMSequence)
	api.HandleFunc("DELETE /crm/sequences/{id}", srv.DeleteCRMSequence)
	api.HandleFunc("GET /crm/sequences/{id}/steps", srv.GetCRMSequenceSteps)
	api.HandleFunc("PUT /crm/sequences/{id}/steps", srv.UpdateCRMSequenceSteps)
	api.HandleFunc("GET /crm/sequences/{id}/enrollments", srv.ListCRMSequenceEnrollments)
	api.HandleFunc("POST /crm/sequences/{id}/enrollments", srv.EnrollCRMLeadInSequence)
	// Phase 5: per-sequence run history (drives the "Runs" panel in
	// the sequence editor).
	api.HandleFunc("GET /crm/sequences/{id}/runs", srv.ListCRMSequenceRuns)

	// Phase 7: smart follow-up endpoints.
	api.HandleFunc("POST /crm/leads/{id}/followup", srv.SetupLeadFollowup)
	api.HandleFunc("GET /crm/leads/{id}/followup", srv.GetLeadFollowupStatus)
	api.HandleFunc("POST /crm/leads/{id}/followup/pause", srv.PauseLeadFollowup)

	// Per-user WABA credentials (Settings page).
	api.HandleFunc("GET /settings/whatsapp", srv.GetWhatsappSettings)
	api.HandleFunc("PUT /settings/whatsapp", srv.PutWhatsappSettings)
	api.HandleFunc("POST /settings/whatsapp/test", srv.TestWhatsappSettings)
	api.HandleFunc("DELETE /settings/whatsapp", srv.DeleteWhatsappSettings)
	// Restore + lifecycle history for soft-deleted credentials.
	api.HandleFunc("POST /settings/whatsapp/restore", srv.RestoreWhatsappSettings)
	api.HandleFunc("GET /settings/whatsapp/history", srv.ListCredentialsHistory)

	// Dev helpers are only mounted in non-production environments.
	if !cfg.IsProduction() {
		api.HandleFunc("POST /dev/simulate-inbound", srv.SimulateInbound)
		logger.Warn("dev-only routes mounted (ENV != production)")
	}

	// /api/* requires auth + a JSON body cap.
	mux.Handle("/api/",
		middleware.MaxBytes(cfg.MaxJSONBytes)(
			middleware.JWTAuth(issuer)(http.StripPrefix("/api", api))))

	// Outermost: RequestID for tracing, then CORS, then mux.
	handler := middleware.RequestID(middleware.CORS(cfg.AllowedOrigins(), mux))

	httpSrv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		logger.Info("listening", "addr", ":"+cfg.Port)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("listen", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	logger.Info("shutdown signal received — draining")

	sc, c2 := context.WithTimeout(context.Background(), 10*time.Second)
	defer c2()
	if err := httpSrv.Shutdown(sc); err != nil {
		logger.Error("http shutdown", "err", err)
	}

	q.Stop()
	logger.Info("worker drained, bye")
}

// newLogger returns a slog.Logger configured for the runtime environment.
func newLogger(cfg *config.Config) *slog.Logger {
	level := slog.LevelInfo
	if !cfg.IsProduction() {
		level = slog.LevelDebug
	}
	if cfg.IsProduction() {
		return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// crypto is referenced transitively to silence unused-import lints when
// this file is built in isolation; the package is used by the store
// directly.
var _ = crypto.NewAEAD

// envOr returns the value of os.Getenv(key) when set, else fallback.
// Tiny helper used by the LLM registry init (Phase 6) — the live
// config package doesn't expose LLM-specific fields, so we read them
// straight from env.
func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if v := envOr(key, ""); v != "" {
			return v
		}
	}
	return ""
}

func envBool(key string, fallback bool) bool {
	switch envOr(key, "") {
	case "1", "true", "TRUE", "yes", "YES", "on", "ON":
		return true
	case "0", "false", "FALSE", "no", "NO", "off", "OFF":
		return false
	default:
		return fallback
	}
}

func bedrockEnvConfigured() bool {
	if envOr("BEDROCK_BASE_URL", "") != "" && envOr("BEDROCK_API_KEY", "") != "" {
		return true
	}
	if envOr("AWS_REGION", "") == "" {
		return false
	}
	return firstEnv(
		"AWS_BEARER_TOKEN_BEDROCK",
		"BEDROCK_API_KEY",
		"AWS_ACCESS_KEY_ID",
		"AWS_PROFILE",
		"AWS_EXECUTION_ENV",
		"AWS_LAMBDA_FUNCTION_NAME",
	) != ""
}
