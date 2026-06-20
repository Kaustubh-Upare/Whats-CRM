package handlers

import (
	"context"
	"net/http"
	"time"
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
	k, err := s.Store.KPIs(r.Context())
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
	pts, err := s.Store.DailyTrend(r.Context(), days)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, pts)
}

func (s *Server) RecentActivity(w http.ResponseWriter, r *http.Request) {
	limit := intParam(r, "limit", 20)
	logs, err := s.Store.RecentAudit(r.Context(), limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, logs)
}
