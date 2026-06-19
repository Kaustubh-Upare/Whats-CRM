package handlers

import (
	"net/http"
)

// ListWebhookLogs returns the most recent webhook log entries for the live UI feed.
// Polled every few seconds by the WebhookLogPanel component.
func (s *Server) ListWebhookLogs(w http.ResponseWriter, r *http.Request) {
	limit := intParam(r, "limit", 50)
	if limit > 500 {
		limit = 500
	}
	items, err := s.Store.ListWebhookLogs(r.Context(), limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}