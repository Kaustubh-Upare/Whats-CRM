package handlers

import (
	"net/http"

	"github.com/whatsyitc/backend/internal/middleware"
)

// ListWebhookLogs returns the most recent webhook log entries for the live UI feed.
// Polled every few seconds by the WebhookLogPanel component.
//
// Scoped to the calling admin (plus NULL-owner rows so legacy / unattributed
// payloads are still visible).
func (s *Server) ListWebhookLogs(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	limit := intParam(r, "limit", 50)
	if limit > 500 {
		limit = 500
	}
	items, err := s.Store.ListWebhookLogs(r.Context(), uid, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}