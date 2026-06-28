package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/whatsyitc/backend/internal/audit"
	"github.com/whatsyitc/backend/internal/excel"
	"github.com/whatsyitc/backend/internal/middleware"
	"github.com/whatsyitc/backend/internal/models"
)

func (s *Server) ListBatches(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	limit := intParam(r, "limit", 50)
	offset := intParam(r, "offset", 0)
	items, total, err := s.Store.ListBatches(r.Context(), uid, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "limit": limit, "offset": offset,
	})
}

func (s *Server) GetBatch(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	b, err := s.Store.GetBatch(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if b == nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	// Build a validation report
	recs, err := s.Store.ListBillingRecords(r.Context(), uid, id, true)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	invalid, err := s.Store.ListInvalidBillingRecords(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jobs, err := s.Store.ListJobsByBatch(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	preview := recs
	if len(preview) > 10 {
		preview = preview[:10]
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"batch":   b,
		"errors":  invalid,
		"preview": preview,
		"summary": models.ValidationSummary{
			TotalRows: b.TotalRows, ValidRows: b.ValidRows, InvalidRows: b.InvalidRows,
		},
		"jobs": jobs,
	})
}

func (s *Server) UploadBatch(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(s.Cfg.MaxUploadBytes); err != nil {
		writeErr(w, http.StatusBadRequest, "file too large or bad multipart: "+err.Error())
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "missing 'file' field")
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext != ".xlsx" && ext != ".csv" {
		writeErr(w, http.StatusBadRequest, "only .xlsx or .csv accepted")
		return
	}
	mt := mime.TypeByExtension(ext)
	if mt == "" {
		mt = "application/octet-stream"
	}

	// save to disk
	if err := os.MkdirAll(s.Cfg.UploadDir, 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, "mkdir: "+err.Error())
		return
	}
	rnd := randHex(8)
	safeName := sanitize(header.Filename)
	dst := filepath.Join(s.Cfg.UploadDir, fmt.Sprintf("%d_%s_%s", time.Now().Unix(), rnd, safeName))
	out, err := os.Create(dst)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "save: "+err.Error())
		return
	}
	n, err := io.Copy(out, file)
	out.Close()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "save copy: "+err.Error())
		return
	}

	uid := middleware.UserID(r)
	email := middleware.Email(r)
	batch := &models.UploadBatch{
		FileName:      header.Filename,
		FilePath:      dst,
		FileSizeBytes: n,
		MimeType:      mt,
		UploadedBy:    &uid,
	}
	id, err := s.Store.CreateBatch(r.Context(), uid, batch)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "create batch: "+err.Error())
		return
	}
	batch.ID = id

	// Parse + validate rows
	sheet, err := excel.Read(dst)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "parse file: "+err.Error())
		return
	}
	if err := excel.CheckHeaders(sheet.Headers); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	// process rows
	ctx := r.Context()
	total, valid, invalid := 0, 0, 0
	preview := []models.BillingRecord{}
	invalidRecs := []models.BillingRecord{}
	seen := map[string]int{} // retailer_code -> first row number
	duplicates := 0
	optouts := 0

	for i, row := range sheet.Rows {
		total++
		m := sheet.ToMap(row)
		rec, _ := excel.ParseRow(i+1, m)
		rec.BatchID = id
		owner := uid
		rec.AdminUserID = &owner
		// upsert retailer (only for rows that have retailer_code)
		if rec.RetailerCode != nil {
			if firstRow, ok := seen[*rec.RetailerCode]; ok {
				duplicates++
				err := models.ValidationError{
					Field: "retailer_code", Code: "duplicate",
					Message: fmt.Sprintf("duplicate of row %d", firstRow),
				}
				rec.ValidationErrors = append(rec.ValidationErrors, err)
				rec.IsValid = false
			} else {
				seen[*rec.RetailerCode] = i + 1
			}
			if err := excel.UpsertRetailerForRow(ctx, s.Store, uid, rec); err == nil {
				// check opt-out
				if rec.RetailerID != nil {
					if r2, _ := s.Store.GetRetailer(ctx, uid, *rec.RetailerID); r2 != nil && r2.IsOptedOut {
						optouts++
						rec.IsValid = false
						rec.ValidationErrors = append(rec.ValidationErrors, models.ValidationError{
							Field: "whatsapp_number", Code: "opted_out", Message: "retailer has opted out",
						})
					}
				}
			}
		}
		// insert
		newID, err := s.Store.InsertBillingRecord(ctx, rec)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "insert record: "+err.Error())
			return
		}
		rec.ID = newID
		if rec.IsValid {
			valid++
			if len(preview) < 10 {
				preview = append(preview, *rec)
			}
		} else {
			invalid++
			invalidRecs = append(invalidRecs, *rec)
		}
	}
	if err := s.Store.UpdateBatchCounts(ctx, id, total, valid, invalid); err != nil {
		writeErr(w, http.StatusInternalServerError, "update counts: "+err.Error())
		return
	}
	// Refresh the batch struct so valid_rows / invalid_rows reflect the
	// just-updated counts. Without this, the response's `batch.valid_rows`
	// is stuck at 0 (from CreateBatch) and the UI hides the "Approve & open"
	// button + phone preview, even though summary.valid is correct.
	if fresh, err := s.Store.GetBatch(ctx, uid, id); err == nil && fresh != nil {
		*batch = *fresh
	} else {
		// Fall back to setting the counts inline if GetBatch ever fails.
		batch.TotalRows = total
		batch.ValidRows = valid
		batch.InvalidRows = invalid
	}
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(ctx, s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch.uploaded", EntityType: strPtr("batch"), EntityID: &id,
		Metadata:  map[string]any{"total": total, "valid": valid, "invalid": invalid, "duplicates": duplicates, "optouts": optouts, "file": header.Filename},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"batch":     batch,
		"summary":   map[string]int{"total": total, "valid": valid, "invalid": invalid, "duplicates": duplicates, "optouts": optouts},
		"preview":   preview,
		"errors":    invalidRecs,
		"file_path": dst,
	})
}

func (s *Server) ApproveBatch(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	b, err := s.Store.GetBatch(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if b == nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if b.Status == "approved" || b.Status == "sending" || b.Status == "completed" {
		writeErr(w, http.StatusConflict, "batch already in status "+b.Status)
		return
	}
	// Resolve template — front-end should pass ?template=NAME&lang=en
	// explicitly (the BatchDetail picker now does). We DON'T fall back
	// to a hard-coded name because each admin's template names are
	// private; guessing wrong was the source of the previous
	// "template not active: billing_summary_v1/en" error. If the
	// caller forgets, we return 400 with a clear pointer to /templates.
	tname := r.URL.Query().Get("template")
	lang := r.URL.Query().Get("lang")
	if tname == "" || lang == "" {
		writeErr(w, http.StatusBadRequest,
			"template not selected — pick one from your workspace on /admin/templates and pass ?template=NAME&lang=CODE")
		return
	}
	tpl, err := s.Store.GetActiveTemplate(r.Context(), uid, tname, lang)
	if tpl == nil {
		writeErr(w, http.StatusBadRequest, templateNotActiveMessage(tname, lang))
		return
	}
	email := middleware.Email(r)
	if err := s.Store.ApproveBatch(r.Context(), id, uid); err != nil {
		writeErr(w, http.StatusInternalServerError, "approve: "+err.Error())
		return
	}
	// Queue one job per valid billing record
	recs, err := s.Store.ListBillingRecords(r.Context(), uid, id, true)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list records: "+err.Error())
		return
	}
	queued := 0
	owner := uid
	for _, rec := range recs {
		params := buildTemplateParams(rec, tpl.Body)
		job := &models.MessageJob{
			AdminUserID: &owner,
			BatchID:     id, BillingRecordID: rec.ID, RetailerID: rec.RetailerID,
			ToNumber: *rec.WhatsappNumber, TemplateName: tpl.Name, LanguageCode: tpl.LanguageCode,
			MaxAttempts: 3,
		}
		job.TemplateParams = mustJSON(params)
		jobID, err := s.Store.CreateMessageJob(r.Context(), job)
		if err != nil {
			continue
		}
		_ = s.Store.SetBillingRecordJob(r.Context(), rec.ID, jobID)
		_ = s.Queue.Enqueue(r.Context(), queueJob(jobID, rec, tpl, params))
		queued++
	}
	_ = s.Store.SetBatchStatus(r.Context(), id, "sending")
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch.approved_and_queued", EntityType: strPtr("batch"), EntityID: &id,
		Metadata:  map[string]any{"queued": queued, "template": tpl.Name, "lang": tpl.LanguageCode},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "queued": queued})
}

// ApproveBatchOnly flips a batch's status to 'approved' WITHOUT
// queuing any message jobs. Use this when the admin wants to
// stage the batch for AI follow-up tracking without committing to
// the WhatsApp send yet. The existing ApproveBatch endpoint is the
// one-shot "approve + queue + send" flow; this is the explicit
// "approve now, send later" flow.
//
// Status transitions:
//
//	validated → approved   (success)
//	approved / sending / sent / completed → 409 Conflict
//	missing / not owned → 404
func (s *Server) ApproveBatchOnly(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	// Ownership probe so a cross-tenant id returns 404 instead of
	// silently no-op'ing (the SQL UPDATE on a non-owned batch
	// would also no-op, but a 404 is a clearer signal).
	b, err := s.Store.GetBatch(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if b == nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if b.Status != "validated" {
		writeErr(w, http.StatusConflict, "batch already in status "+b.Status)
		return
	}
	if err := s.Store.ApproveBatchOnly(r.Context(), id, uid); err != nil {
		// Race: someone else moved the batch off 'validated'
		// between our probe and the UPDATE. Surface 409 — same
		// shape as the eager conflict above.
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusConflict, "batch already in status approved (or further)")
			return
		}
		writeErr(w, http.StatusInternalServerError, "approve-only: "+err.Error())
		return
	}
	ip := r.RemoteAddr
	ua := r.UserAgent()
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch.approved_only", EntityType: strPtr("batch"), EntityID: &id,
		Metadata:  map[string]any{"note": "approve-only; no messages queued"},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "queued": 0})
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func templateNotActiveMessage(name, lang string) string {
	if name == "" || lang == "" {
		return "No template selected. Open Templates, create or activate a WhatsApp template, then choose it before previewing or sending."
	}
	return fmt.Sprintf(
		"Template %s/%s is not active for your workspace. Open Templates, activate this template, or choose another active template before previewing or sending.",
		name,
		lang,
	)
}

// PreviewBatchMessage renders the exact WhatsApp message body that will be
// delivered for one row of a batch — using the same template + param
// substitution the worker uses, so the chat-thread preview matches what
// the retailer sees on their phone pixel-for-pixel.
//
// Query params:
//
//	?template=<name>&lang=<code>&row=<row_number>
//
// `row` is the row_number of the billing record to render. If omitted,
// the first valid row is used. The response also returns the recipient
// name + phone so the UI can render a phone-mockup header.
//
// Returns 404 if the batch has no valid rows to preview.
func (s *Server) PreviewBatchMessage(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	b, err := s.Store.GetBatch(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if b == nil {
		writeErr(w, http.StatusNotFound, "batch not found")
		return
	}

	tname := r.URL.Query().Get("template")
	lang := r.URL.Query().Get("lang")
	if tname == "" || lang == "" {
		writeErr(w, http.StatusBadRequest,
			"template not selected — pick one from your workspace on /admin/templates and pass ?template=NAME&lang=CODE")
		return
	}
	tpl, err := s.Store.GetActiveTemplate(r.Context(), uid, tname, lang)
	if tpl == nil {
		writeErr(w, http.StatusBadRequest, templateNotActiveMessage(tname, lang))
		return
	}

	// Pull valid rows, then pick the requested one (or first).
	recs, err := s.Store.ListBillingRecords(r.Context(), uid, id, true)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(recs) == 0 {
		writeErr(w, http.StatusNotFound, "no valid rows in this batch to preview")
		return
	}
	var chosen models.BillingRecord
	if rowStr := r.URL.Query().Get("row"); rowStr != "" {
		if rowNum, err := strconv.Atoi(rowStr); err == nil {
			found := false
			for _, rec := range recs {
				if rec.RowNumber == rowNum {
					chosen = rec
					found = true
					break
				}
			}
			if !found {
				writeErr(w, http.StatusNotFound, fmt.Sprintf("row %d not found or not valid", rowNum))
				return
			}
		}
	}
	if chosen.ID == 0 {
		chosen = recs[0]
	}

	// Same substitution the worker uses (handlers/helpers.go buildTemplateParams)
	params := buildTemplateParams(chosen, tpl.Body)
	body := tpl.Body
	for i, p := range params {
		body = strings.ReplaceAll(body, fmt.Sprintf("{{%d}}", i+1), p)
	}

	phone := ""
	if chosen.WhatsappNumber != nil {
		phone = *chosen.WhatsappNumber
	}
	name := ""
	if chosen.RetailerName != nil {
		name = *chosen.RetailerName
	} else if chosen.RetailerCode != nil {
		name = *chosen.RetailerCode
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"body":            body,
		"template_name":   tpl.Name,
		"language_code":   tpl.LanguageCode,
		"row_number":      chosen.RowNumber,
		"retailer_name":   name,
		"whatsapp_number": phone,
		"template_params": params,
	})
}

// PatchBatch is the small update endpoint used by the inline-editable
// batch name on /admin/batches/{id}. Today it only accepts
// `display_name` — pass a string to set, null to clear, an empty
// string is treated as "clear" so the trigger can collapse it to NULL.
//
// Validation:
//   - display_name must be a string, may be null, may be empty (→ NULL)
//   - length must be ≤ 100 chars (also enforced by migration 023's CHECK)
//
// Behaviour:
//   - 200 OK with the updated batch on success
//   - 400 on validation failure
//   - 404 on missing or cross-tenant batch
func (s *Server) PatchBatch(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}

	// Body is tiny — cap at the same limit used for other small JSON
	// payloads. Reject bodies we can't parse BEFORE touching the DB so
	// we don't waste a probe round-trip.
	var body struct {
		DisplayName *string `json:"display_name"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, s.Cfg.MaxJSONBytes)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json: "+err.Error())
		return
	}

	// Normalise: empty string → nil so the DB trigger can collapse it
	// to NULL and the UI can show "no override". Length cap matches
	// the migration CHECK constraint.
	if body.DisplayName != nil {
		trimmed := strings.TrimSpace(*body.DisplayName)
		if trimmed == "" {
			body.DisplayName = nil
		} else if len(trimmed) > 100 {
			writeErr(w, http.StatusBadRequest, "display_name must be 100 characters or fewer")
			return
		} else {
			body.DisplayName = &trimmed
		}
	}

	updated, err := s.Store.UpdateBatchDisplayName(r.Context(), uid, id, body.DisplayName)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "batch not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "rename: "+err.Error())
		return
	}

	ip := middleware.IP(r)
	ua := middleware.UA(r)
	meta := map[string]any{}
	if body.DisplayName == nil {
		meta["cleared"] = true
	} else {
		meta["display_name"] = *body.DisplayName
	}
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch.renamed", EntityType: strPtr("batch"), EntityID: &id,
		Metadata:  meta,
		IPAddress: &ip, UserAgent: &ua,
	})

	writeJSON(w, http.StatusOK, map[string]any{"batch": updated})
}

// ResendBatch creates a NEW round of message jobs for an already-sent
// (or at-least-once-validated) batch. This is intentionally distinct
// from POST /api/messages/resend-failed which only retries rows that
// hit a transient Meta error — ResendBatch is the operator's "send
// the same recipients a new reminder" affordance.
//
// Scope:
//   - default: all currently valid billing_records in the batch
//   - only_failed=true: only the rows whose latest message_job is failed
//   - row_numbers=[n,m,...]: explicit subset of row_number values
//
// Template:
//   - ?template=NAME&lang=CODE  (same convention as ApproveBatch)
//
// What this does NOT do:
//   - does not flip the batch status. The original approval is
//     preserved (completed/failed/apprvoed/etc) so the audit trail
//     remains truthful. The new jobs are queued and the worker picks
//     them up immediately.
//   - does not touch bc_batch_ai_recipients or any CRM sequences.
//     Those are sequenced against the original approval and stay
//     unchanged.
//
// Returns { ok, queued, skipped } where `skipped` counts rows that
// were either opted-out, had no whatsapp number, or were filtered
// out by the scope rules.
func (s *Server) ResendBatch(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}

	b, err := s.Store.GetBatch(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if b == nil {
		writeErr(w, http.StatusNotFound, "batch not found")
		return
	}
	if b.ValidRows == 0 {
		writeErr(w, http.StatusBadRequest, "batch has no valid rows to resend")
		return
	}
	if b.Status == "validated" {
		// 'validated' means the admin hasn't approved the batch yet,
		// so "resend" is the wrong verb — point them at Approve & Send.
		writeErr(w, http.StatusConflict, "batch has not been sent yet — use Approve & Send instead")
		return
	}

	tname := r.URL.Query().Get("template")
	lang := r.URL.Query().Get("lang")
	if tname == "" || lang == "" {
		writeErr(w, http.StatusBadRequest,
			"template not selected — pick one from your workspace on /admin/templates and pass ?template=NAME&lang=CODE")
		return
	}
	tpl, err := s.Store.GetActiveTemplate(r.Context(), uid, tname, lang)
	if tpl == nil {
		writeErr(w, http.StatusBadRequest, templateNotActiveMessage(tname, lang))
		return
	}

	// Optional scope body. Defaults to "all valid rows". We accept the
	// body silently — unknown keys are ignored so the frontend can
	// grow the API without coordination.
	var scope struct {
		OnlyFailed bool  `json:"only_failed"`
		RowNumbers []int `json:"row_numbers"`
	}
	// Body is optional and tiny; MaxBytesReader cap matches PatchBatch.
	if r.ContentLength > 0 {
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, s.Cfg.MaxJSONBytes)).Decode(&scope); err != nil {
			writeErr(w, http.StatusBadRequest, "bad json: "+err.Error())
			return
		}
	}

	recs, err := s.Store.ListBillingRecords(r.Context(), uid, id, true)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list records: "+err.Error())
		return
	}

	// Build a quick lookup of "row_number → latest job status" when
	// only_failed is requested. We pull all jobs once and reduce in Go
	// rather than writing SQL — the batches table is small enough
	// that this is fine and it keeps the store API stable.
	failedRows := map[int]struct{}{}
	if scope.OnlyFailed {
		jobs, err := s.Store.ListJobsByBatch(r.Context(), uid, id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "list jobs: "+err.Error())
			return
		}
		// We want "most recent status per billing_record_id". Walk
		// the jobs in ASC id order and remember only the last seen
		// status per row; if it's 'failed', mark for inclusion.
		latest := map[int64]string{}
		for _, j := range jobs {
			latest[j.BillingRecordID] = j.Status
		}
		for _, rec := range recs {
			if status, ok := latest[rec.ID]; ok && status == "failed" {
				failedRows[rec.RowNumber] = struct{}{}
			}
		}
	}

	rowSet := map[int]struct{}{}
	if len(scope.RowNumbers) > 0 {
		for _, n := range scope.RowNumbers {
			rowSet[n] = struct{}{}
		}
	}

	queued, skipped := 0, 0
	owner := uid
	for _, rec := range recs {
		// Skip opt-outs and missing phone numbers — same safety as the
		// initial ApproveBatch fan-out.
		if rec.WhatsappNumber == nil || *rec.WhatsappNumber == "" {
			skipped++
			continue
		}
		if rec.RetailerID != nil {
			if r2, _ := s.Store.GetRetailer(r.Context(), uid, *rec.RetailerID); r2 != nil && r2.IsOptedOut {
				skipped++
				continue
			}
		}

		if scope.OnlyFailed {
			if _, ok := failedRows[rec.RowNumber]; !ok {
				skipped++
				continue
			}
		}
		if len(rowSet) > 0 {
			if _, ok := rowSet[rec.RowNumber]; !ok {
				skipped++
				continue
			}
		}

		params := buildTemplateParams(rec, tpl.Body)
		job := &models.MessageJob{
			AdminUserID: &owner,
			BatchID:     id, BillingRecordID: rec.ID, RetailerID: rec.RetailerID,
			ToNumber: *rec.WhatsappNumber, TemplateName: tpl.Name, LanguageCode: tpl.LanguageCode,
			MaxAttempts: 3,
		}
		job.TemplateParams = mustJSON(params)
		jobID, err := s.Store.CreateMessageJob(r.Context(), job)
		if err != nil {
			skipped++
			continue
		}
		// Same overwrite pattern ApproveBatch uses — billing_records
		// holds a pointer to the LATEST job for that row, so the
		// Resend job takes its place for "retry this row" purposes.
		_ = s.Store.SetBillingRecordJob(r.Context(), rec.ID, jobID)
		_ = s.Queue.Enqueue(r.Context(), queueJob(jobID, rec, tpl, params))
		queued++
	}

	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "batch.resent", EntityType: strPtr("batch"), EntityID: &id,
		Metadata: map[string]any{
			"queued":      queued,
			"skipped":     skipped,
			"template":    tpl.Name,
			"lang":        tpl.LanguageCode,
			"only_failed": scope.OnlyFailed,
			"row_numbers": scope.RowNumbers,
		},
		IPAddress: &ip, UserAgent: &ua,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"queued":  queued,
		"skipped": skipped,
	})
}

func sanitize(s string) string {
	s = filepath.Base(s)
	s = strings.ReplaceAll(s, " ", "_")
	return s
}

// helper: keep ctx in store import alive
var _ = context.Background

// helpers in messages.go (mustJSON/queueJob/buildTemplateParams) live there
