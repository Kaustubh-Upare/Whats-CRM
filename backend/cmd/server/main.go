// cmd/server is the main HTTP entrypoint for the WhatsyITC billing-comm
// service. It exposes the API the admin frontend talks to.
//
//   go run ./cmd/server
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
	"github.com/whatsyitc/backend/internal/auth"
	"github.com/whatsyitc/backend/internal/config"
	"github.com/whatsyitc/backend/internal/db"
	"github.com/whatsyitc/backend/internal/handlers"
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
	wa := whatsapp.NewClient(cfg.WhatsAPIVersion, cfg.WhatsPhoneID, cfg.WhatsAccessToken)
	q := queue.NewMemory(1024, cfg.WorkerConcurrency)
	wk := worker.New(st, wa, cfg.WhatsForceText)
	q.Run(ctx, wk.Handle)
	defer q.Stop()
	logger.Info("queue + worker started")

	srv := handlers.NewServer(cfg, st, wa, q)
	issuer := auth.NewIssuer(cfg.JWTSecret, cfg.JWTAudience)

	mux := http.NewServeMux()

	// health + auth
	mux.HandleFunc("GET /healthz", srv.Healthz)
	mux.Handle("POST /auth/login",
		middleware.RateLimit(cfg.LoginRPS, cfg.LoginBurst, middleware.ClientIP)(
			middleware.MaxBytes(cfg.MaxJSONBytes)(http.HandlerFunc(srv.Login))))
	mux.Handle("GET /auth/me", middleware.JWTAuth(issuer)(http.HandlerFunc(srv.Me)))
	mux.HandleFunc("POST /auth/logout", srv.Logout)

	// public webhook (Meta). Body cap mirrors the same JSON ceiling.
	mux.HandleFunc("GET /webhook/whatsapp", srv.WebhookVerify)
	mux.Handle("POST /webhook/whatsapp",
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
	api.HandleFunc("GET /batches/{id}/preview-message", srv.PreviewBatchMessage)
	api.HandleFunc("POST /batches/{id}/approve", srv.ApproveBatch)

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

	// Dev helpers are only mounted in non-production environments. In prod
	// they are not reachable (the mux entry doesn't exist) so an attacker
	// can't hit them even with a valid JWT.
	if !cfg.IsProduction() {
		api.HandleFunc("POST /dev/simulate-inbound", srv.SimulateInbound)
		logger.Warn("dev-only routes mounted (ENV != production)")
	}

	// /api/* requires auth + a JSON body cap. Body cap is a no-op for GETs
	// (no body to read), and rejects oversize POSTs before they hit handlers.
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

	// 1. Stop accepting new HTTP requests.
	sc, c2 := context.WithTimeout(context.Background(), 10*time.Second)
	defer c2()
	if err := httpSrv.Shutdown(sc); err != nil {
		logger.Error("http shutdown", "err", err)
	}

	// 2. Stop the worker pool (drains in-flight jobs, blocks new enqueues).
	q.Stop()
	logger.Info("worker drained, bye")
}

// newLogger returns a slog.Logger configured for the runtime environment.
// Production gets JSON for log shippers (Loki/CloudWatch/Datadog); dev gets
// the human-readable text format.
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