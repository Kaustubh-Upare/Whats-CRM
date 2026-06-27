package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/whatsyitc/backend/internal/audit"
	"github.com/whatsyitc/backend/internal/middleware"
	"github.com/whatsyitc/backend/internal/queue"
)

func (s *Server) ListMessages(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	status := r.URL.Query().Get("status")
	search := r.URL.Query().Get("q")
	limit := intParam(r, "limit", 50)
	offset := intParam(r, "offset", 0)
	items, total, err := s.Store.ListMessages(r.Context(), uid, status, search, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "limit": limit, "offset": offset,
	})
}

func (s *Server) GetMessage(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	m, events, err := s.Store.GetMessage(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if m == nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"message": m, "events": events})
}

// ResendMessage resets a single failed job and re-enqueues it. The
// store-layer admin-guard prevents Admin A from resending Admin B's
// job by guessing an id.
func (s *Server) ResendMessage(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	j, err := s.Store.ResetJobForRetry(r.Context(), uid, id)
	if err != nil {
		// pgx.ErrNoRows is treated as 404 (the job either doesn't exist
		// or isn't owned by this admin — same response either way to
		// avoid leaking existence).
		if err.Error() == "no rows in result set" {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	// Audit row in the status-event timeline.
	_ = s.Store.InsertStatusEvent(r.Context(), j.ID, nil, strPtr("retry"), nil,
		strPtr("manual resend"), []byte(`{"source":"ui"}`))

	// Re-enqueue using the same queue.MessageJob shape as upload.go.
	params := []string{}
	if len(j.TemplateParams) > 0 {
		_ = json.Unmarshal(j.TemplateParams, &params)
	}
	qj := queue.MessageJob{
		MessageJobID:    j.ID,
		BatchID:         j.BatchID,
		BillingRecordID: j.BillingRecordID,
		ToNumber:        j.ToNumber,
		TemplateName:    j.TemplateName,
		LanguageCode:    j.LanguageCode,
		TemplateParams:  params,
	}
	if err := s.Queue.Enqueue(r.Context(), qj); err != nil {
		writeErr(w, http.StatusInternalServerError, "enqueue: "+err.Error())
		return
	}

	email := middleware.Email(r)
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID:    &uid,
		ActorEmail: &email,
		Action:     "message.resend",
		EntityType: strPtr("message_job"),
		EntityID:   &j.ID,
		IPAddress:  &ip,
		UserAgent:  &ua,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": j.ID, "status": j.Status})
}

// ResendFailed bulk-resets all failed jobs (optionally scoped to a batch)
// owned by the calling admin and re-enqueues them.
func (s *Server) ResendFailed(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	batchID := int64(0)
	if v := r.URL.Query().Get("batch_id"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			batchID = n
		}
	}
	jobs, err := s.Store.ResetManyFailedForRetry(r.Context(), uid, batchID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	for i := range jobs {
		j := jobs[i]
		params := []string{}
		if len(j.TemplateParams) > 0 {
			_ = json.Unmarshal(j.TemplateParams, &params)
		}
		_ = s.Store.InsertStatusEvent(r.Context(), j.ID, nil, strPtr("retry"), nil,
			strPtr("bulk resend"), []byte(`{"source":"ui-bulk"}`))
		_ = s.Queue.Enqueue(r.Context(), queue.MessageJob{
			MessageJobID:    j.ID,
			BatchID:         j.BatchID,
			BillingRecordID: j.BillingRecordID,
			ToNumber:        j.ToNumber,
			TemplateName:    j.TemplateName,
			LanguageCode:    j.LanguageCode,
			TemplateParams:  params,
		})
	}

	email := middleware.Email(r)
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID:    &uid,
		ActorEmail: &email,
		Action:     "message.bulk_resend",
		EntityType: strPtr("message_job"),
		Metadata:   map[string]any{"count": len(jobs), "batch_id": batchID},
		IPAddress:  &ip,
		UserAgent:  &ua,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "retried": len(jobs)})
}

// int64PathParam reads {id} from the path (the std mux syntax).
func int64PathParam(r *http.Request, key string) (int64, bool) {
	v := r.PathValue(key)
	if v == "" {
		return 0, false
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}