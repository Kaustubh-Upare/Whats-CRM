package handlers

import (
	"net/http"
)

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
