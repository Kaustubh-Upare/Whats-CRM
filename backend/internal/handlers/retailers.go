package handlers

import (
	"net/http"

	"github.com/whatsyitc/backend/internal/audit"
	"github.com/whatsyitc/backend/internal/middleware"
)

func (s *Server) ListRetailers(w http.ResponseWriter, r *http.Request) {
	search := r.URL.Query().Get("q")
	limit := intParam(r, "limit", 50)
	offset := intParam(r, "offset", 0)
	items, total, err := s.Store.ListRetailers(r.Context(), search, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "limit": limit, "offset": offset,
	})
}

func (s *Server) GetRetailer(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	ret, err := s.Store.GetRetailer(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if ret == nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	history, err := s.Store.RetailerHistory(r.Context(), id, 200)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"retailer": ret, "history": history})
}

type optOutReq struct {
	OptOut bool   `json:"opt_out"`
	Reason string `json:"reason"`
}

func (s *Server) SetOptOut(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req optOutReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if err := s.Store.SetOptOut(r.Context(), id, req.OptOut, req.Reason); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	action := "retailer.opt_in"
	if req.OptOut {
		action = "retailer.opt_out"
	}
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email, Action: action,
		EntityType: strPtr("retailer"), EntityID: &id,
		Metadata: map[string]any{"reason": req.Reason},
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
