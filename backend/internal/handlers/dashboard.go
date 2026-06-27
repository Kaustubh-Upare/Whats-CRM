package handlers

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/whatsyitc/backend/internal/middleware"
)

// Healthz reports the overall liveness of the service. It pings Postgres and
// surfaces the in-memory queue depth. Returns 503 when the DB is unreachable
// or the queue is saturated past its buffer size.
func (s *Server) Healthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	resp := map[string]any{
		"ok":         true,
		"service":    "whatsyitc-billingcomm",
		"env":        s.Cfg.Env,
		"queueDepth": s.Queue.Depth(),
		"checkedAt":  time.Now().UTC().Format(time.RFC3339),
	}
	if err := s.Store.DB.Ping(ctx); err != nil {
		resp["ok"] = false
		resp["error"] = err.Error()
		writeJSON(w, http.StatusServiceUnavailable, resp)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) DashboardKPI(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	k, err := s.Store.KPIs(r.Context(), uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, k)
}

func (s *Server) DashboardTrend(w http.ResponseWriter, r *http.Request) {
	days := intParam(r, "days", 7)
	if days < 1 || days > 60 {
		days = 7
	}
	uid := middleware.UserID(r)
	pts, err := s.Store.DailyTrend(r.Context(), uid, days)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, pts)
}

func (s *Server) RecentActivity(w http.ResponseWriter, r *http.Request) {
	limit := intParam(r, "limit", 20)
	uid := middleware.UserID(r)
	entityType := r.URL.Query().Get("entity_type")
	var entityID int64
	if v := r.URL.Query().Get("entity_id"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			entityID = n
		}
	}
	logs, err := s.Store.RecentAudit(r.Context(), uid, limit, entityType, entityID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, logs)
}