package handlers

import (
	"net/http"

	"github.com/whatsyitc/backend/internal/middleware"
	"github.com/whatsyitc/backend/internal/store"
)

// ListConversations returns the chat-thread summaries for the left pane of /chats.
func (s *Server) ListConversations(w http.ResponseWriter, r *http.Request) {
	search := r.URL.Query().Get("q")
	limit := intParam(r, "limit", 50)
	offset := intParam(r, "offset", 0)
	uid := middleware.UserID(r)
	items, total, err := s.Store.ListConversations(r.Context(), uid, search, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "limit": limit, "offset": offset,
	})
}

// GetConversationMessages returns the merged outbound + inbound thread for
// one retailer (path id = retailer_id).
func (s *Server) GetConversationMessages(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	limit := intParam(r, "limit", 500)
	offset := intParam(r, "offset", 0)
	uid := middleware.UserID(r)
	items, err := s.Store.ListConversationMessages(r.Context(), uid, id, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// GetConversationByPhone returns the thread for an unlinked-phone conversation
// (where the message has retailer_id IS NULL). Fallback when the conversation
// list has a row whose retailer_id is missing.
func (s *Server) GetConversationByPhone(w http.ResponseWriter, r *http.Request) {
	phone := r.PathValue("phone")
	if phone == "" {
		writeErr(w, http.StatusBadRequest, "missing phone")
		return
	}
	limit := intParam(r, "limit", 500)
	offset := intParam(r, "offset", 0)
	uid := middleware.UserID(r)
	items, err := s.Store.ListConversationMessagesByPhone(r.Context(), uid, phone, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// compile-time guard so adding the store method doesn't silently miss wire-up.
var _ store.ConversationStorer = (*store.Store)(nil)
