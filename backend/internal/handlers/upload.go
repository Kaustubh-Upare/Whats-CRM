package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/whatsyitc/backend/internal/audit"
	"github.com/whatsyitc/backend/internal/excel"
	"github.com/whatsyitc/backend/internal/middleware"
	"github.com/whatsyitc/backend/internal/models"
)

func (s *Server) ListBatches(w http.ResponseWriter, r *http.Request) {
	limit := intParam(r, "limit", 50)
	offset := intParam(r, "offset", 0)
	items, total, err := s.Store.ListBatches(r.Context(), limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "limit": limit, "offset": offset,
	})
}

func (s *Server) GetBatch(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	b, err := s.Store.GetBatch(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if b == nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	// Build a validation report
	recs, err := s.Store.ListBillingRecords(r.Context(), id, true)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	invalid, err := s.Store.ListInvalidBillingRecords(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jobs, err := s.Store.ListJobsByBatch(r.Context(), id)
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
	id, err := s.Store.CreateBatch(r.Context(), batch)
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
			if err := excel.UpsertRetailerForRow(ctx, s.Store, rec); err == nil {
				// check opt-out
				if rec.RetailerID != nil {
					if r2, _ := s.Store.GetRetailer(ctx, *rec.RetailerID); r2 != nil && r2.IsOptedOut {
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
	if fresh, err := s.Store.GetBatch(ctx, id); err == nil && fresh != nil {
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
		Metadata: map[string]any{"total": total, "valid": valid, "invalid": invalid, "duplicates": duplicates, "optouts": optouts, "file": header.Filename},
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
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	b, err := s.Store.GetBatch(r.Context(), id)
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
	// Resolve template
	tname := r.URL.Query().Get("template")
	lang := r.URL.Query().Get("lang")
	if tname == "" {
		tname = "billing_summary_v1"
	}
	if lang == "" {
		lang = "en"
	}
	tpl, err := s.Store.GetActiveTemplate(r.Context(), tname, lang)
	if tpl == nil {
		writeErr(w, http.StatusBadRequest, "template not active: "+tname+"/"+lang+" — add it under /templates first")
		return
	}
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	if err := s.Store.ApproveBatch(r.Context(), id, uid); err != nil {
		writeErr(w, http.StatusInternalServerError, "approve: "+err.Error())
		return
	}
	// Queue one job per valid billing record
	recs, err := s.Store.ListBillingRecords(r.Context(), id, true)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list records: "+err.Error())
		return
	}
	queued := 0
	for _, rec := range recs {
		params := buildTemplateParams(rec, tpl.Body)
		job := &models.MessageJob{
			BatchID: id, BillingRecordID: rec.ID, RetailerID: rec.RetailerID,
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
		Metadata: map[string]any{"queued": queued, "template": tpl.Name, "lang": tpl.LanguageCode},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "queued": queued})
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// PreviewBatchMessage renders the exact WhatsApp message body that will be
// delivered for one row of a batch — using the same template + param
// substitution the worker uses, so the chat-thread preview matches what
// the retailer sees on their phone pixel-for-pixel.
//
// Query params:
//   ?template=<name>&lang=<code>&row=<row_number>
//
// `row` is the row_number of the billing record to render. If omitted,
// the first valid row is used. The response also returns the recipient
// name + phone so the UI can render a phone-mockup header.
//
// Returns 404 if the batch has no valid rows to preview.
func (s *Server) PreviewBatchMessage(w http.ResponseWriter, r *http.Request) {
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	b, err := s.Store.GetBatch(r.Context(), id)
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
	if tname == "" {
		tname = "billing_summary_v1"
	}
	if lang == "" {
		lang = "en"
	}
	tpl, err := s.Store.GetActiveTemplate(r.Context(), tname, lang)
	if tpl == nil {
		writeErr(w, http.StatusBadRequest, "template not active: "+tname+"/"+lang)
		return
	}

	// Pull valid rows, then pick the requested one (or first).
	recs, err := s.Store.ListBillingRecords(r.Context(), id, true)
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
		"body":             body,
		"template_name":    tpl.Name,
		"language_code":    tpl.LanguageCode,
		"row_number":       chosen.RowNumber,
		"retailer_name":    name,
		"whatsapp_number":  phone,
		"template_params":  params,
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
