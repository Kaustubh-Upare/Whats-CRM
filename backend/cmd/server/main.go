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
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/whatsyitc/backend/internal/auth"
	"github.com/whatsyitc/backend/internal/config"
	"github.com/whatsyitc/backend/internal/db"
	"github.com/whatsyitc/backend/internal/handlers"
	"github.com/whatsyitc/backend/internal/middleware"
	"github.com/whatsyitc/backend/internal/queue"
	"github.com/whatsyitc/backend/internal/store"
	"github.com/whatsyitc/backend/internal/whatsapp"
	"github.com/whatsyitc/backend/internal/worker"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	cfg := config.Load()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := db.New(ctx, cfg.PostgresURI)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer pool.Close()
	log.Printf("[server] postgres connected")

	migDir := os.Getenv("BC_MIGRATIONS_DIR")
	if migDir == "" {
		migDir = filepath.Join("internal", "db", "migrations")
	}
	if err := db.RunMigrations(ctx, pool, migDir); err != nil {
		log.Fatalf("migrations: %v", err)
	}
	if err := os.MkdirAll(cfg.UploadDir, 0o755); err != nil {
		log.Fatalf("upload dir: %v", err)
	}

	st := store.New(pool)
	wa := whatsapp.NewClient(cfg.WhatsAPIVersion, cfg.WhatsPhoneID, cfg.WhatsAccessToken)
	q := queue.NewMemory(1024)
	wk := worker.New(st, wa, cfg.WhatsForceText)
	q.Run(ctx, wk.Handle)
	defer q.Stop()

	srv := handlers.NewServer(cfg, st, wa, q)
	issuer := auth.NewIssuer(cfg.JWTSecret)

	mux := http.NewServeMux()

	// health + auth
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "whatsyitc-billingcomm"})
	})
	mux.HandleFunc("POST /auth/login", srv.Login)
	mux.Handle("GET /auth/me", middleware.JWTAuth(issuer)(http.HandlerFunc(srv.Me)))
	mux.HandleFunc("POST /auth/logout", srv.Logout)

	// public webhook
	mux.HandleFunc("GET /webhook/whatsapp", srv.WebhookVerify)
	mux.HandleFunc("POST /webhook/whatsapp", srv.WebhookStatus)

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

	// Dev helpers (auth-protected, so only admins can fire them)
	api.HandleFunc("POST /dev/simulate-inbound", srv.SimulateInbound)

	mux.Handle("/api/", http.StripPrefix("/api", middleware.JWTAuth(issuer)(api)))

	handler := middleware.CORS(cfg.FrontendURL, mux)

	httpSrv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		log.Printf("[server] listening on :%s (env=%s, frontend=%s)", cfg.Port, cfg.Env, cfg.FrontendURL)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Printf("[server] shutting down")
	sc, c2 := context.WithTimeout(context.Background(), 10*time.Second)
	defer c2()
	_ = httpSrv.Shutdown(sc)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
