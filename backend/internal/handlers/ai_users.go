package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/whatsyitc/backend/internal/audit"
	"github.com/whatsyitc/backend/internal/excel"
	"github.com/whatsyitc/backend/internal/middleware"
	"github.com/whatsyitc/backend/internal/models"
	"github.com/whatsyitc/backend/internal/store"
)

type aiUserPayload struct {
	Name        string            `json:"name"`
	Phone       string            `json:"phone"`
	ExtraFields map[string]string `json:"extra_fields"`
}

type aiUserImportMapping struct {
	Name         string   `json:"name"`
	Phone        string   `json:"phone"`
	ExtraColumns []string `json:"extra_columns"`
}

type startAIUserFollowupReq struct {
	models.BatchFollowupConfig
	OverrideExisting bool `json:"override_existing"`
}

func (s *Server) ListAIUsers(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	search := r.URL.Query().Get("q")
	limit := intParam(r, "limit", 100)
	offset := intParam(r, "offset", 0)

	items, total, err := s.Store.ListAIUsers(r.Context(), uid, search, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "limit": limit, "offset": offset,
	})
}

func (s *Server) CreateAIUser(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	var req aiUserPayload
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	name := strings.TrimSpace(req.Name)
	phone := excel.NormalizeWhatsAppNumber(req.Phone)
	if name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	if !validAIUserPhone(phone) {
		writeErr(w, http.StatusBadRequest, "phone must contain 10-15 digits after cleanup")
		return
	}

	user, err := s.Store.UpsertAIUser(r.Context(), uid, name, phone, req.ExtraFields, "manual")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "ai_user.upserted", EntityType: strPtr("retailer"), EntityID: &user.RetailerID,
		Metadata:  map[string]any{"phone": user.Phone, "extra_fields": len(user.ExtraFields), "source": "manual"},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) InspectAIUsersUpload(w http.ResponseWriter, r *http.Request) {
	sheet, fileName, cleanup, ok := s.readAIUsersUploadSheet(w, r)
	if !ok {
		return
	}
	defer cleanup()

	samples := []map[string]string{}
	for i, row := range sheet.Rows {
		if i >= 5 {
			break
		}
		samples = append(samples, sheet.ToOriginalMap(row))
	}
	suggested := suggestAIUserMapping(sheet.Headers)
	writeJSON(w, http.StatusOK, map[string]any{
		"headers":     sheet.Headers,
		"sample_rows": samples,
		"total_rows":  len(sheet.Rows),
		"file_name":   fileName,
		"suggested":   suggested,
	})
}

func (s *Server) ImportAIUsers(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	sheet, fileName, cleanup, ok := s.readAIUsersUploadSheet(w, r)
	if !ok {
		return
	}
	defer cleanup()

	mapping, err := parseAIUserImportMapping(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	total := len(sheet.Rows)
	imported := 0
	updated := []models.AIUser{}
	rowErrors := []models.AIUserImportError{}
	seenPhones := map[string]int{}
	for i, row := range sheet.Rows {
		rowNumber := i + 2
		original := sheet.ToOriginalMap(row)
		name := strings.TrimSpace(aiUserMappedValue(original, mapping.Name))
		phone := excel.NormalizeWhatsAppNumber(aiUserMappedValue(original, mapping.Phone))

		if name == "" {
			rowErrors = append(rowErrors, models.AIUserImportError{Row: rowNumber, Field: "name", Message: "name is empty"})
			continue
		}
		if !validAIUserPhone(phone) {
			rowErrors = append(rowErrors, models.AIUserImportError{Row: rowNumber, Field: "phone", Message: "phone must contain 10-15 digits after cleanup"})
			continue
		}
		if first, exists := seenPhones[phone]; exists {
			rowErrors = append(rowErrors, models.AIUserImportError{Row: rowNumber, Field: "phone", Message: fmt.Sprintf("duplicate phone from row %d", first)})
			continue
		}
		seenPhones[phone] = rowNumber

		extra := map[string]string{}
		for _, column := range mapping.ExtraColumns {
			column = strings.TrimSpace(column)
			if column == "" || sameFold(column, mapping.Name) || sameFold(column, mapping.Phone) {
				continue
			}
			if value := strings.TrimSpace(aiUserMappedValue(original, column)); value != "" {
				extra[column] = value
			}
		}

		user, err := s.Store.UpsertAIUser(r.Context(), uid, name, phone, extra, "import")
		if err != nil {
			rowErrors = append(rowErrors, models.AIUserImportError{Row: rowNumber, Field: "row", Message: err.Error()})
			continue
		}
		imported++
		if len(updated) < 10 {
			updated = append(updated, *user)
		}
	}

	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "ai_users.imported", EntityType: strPtr("ai_user"),
		Metadata: map[string]any{
			"file": fileName, "total": total, "imported": imported,
			"skipped": len(rowErrors), "extra_columns": mapping.ExtraColumns,
		},
		IPAddress: &ip, UserAgent: &ua,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "file_name": fileName, "total": total, "imported": imported,
		"skipped": len(rowErrors), "errors": rowErrors, "preview": updated,
	})
}

func (s *Server) StartAIUserFollowup(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	email := middleware.Email(r)
	retailerID, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}

	var req startAIUserFollowupReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	cfg := req.BatchFollowupConfig
	switch strings.TrimSpace(cfg.Behavior) {
	case "":
		cfg.Behavior = "default"
	case "default", "custom", "agentic":
		// ok
	default:
		writeErr(w, http.StatusBadRequest, "behavior must be 'default', 'custom', or 'agentic'")
		return
	}

	user, batchID, err := s.Store.EnsureAIUserFollowupBatch(r.Context(), uid, retailerID)
	if err != nil {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	if user == nil || batchID <= 0 {
		writeErr(w, http.StatusNotFound, "AI user not found")
		return
	}

	if enrollmentID, status, err := s.Store.FindFollowupEnrollmentForBatchPhone(r.Context(), uid, batchID, user.Phone); err != nil {
		writeErr(w, http.StatusInternalServerError, "find existing follow-up: "+err.Error())
		return
	} else if enrollmentID > 0 {
		if _, err := s.Store.SetBatchAIFollowup(r.Context(), uid, batchID, true); err != nil {
			if errors.Is(err, store.ErrNoRecipientsToTrack) {
				writeErr(w, http.StatusUnprocessableEntity, "this user has no valid WhatsApp number to track")
				return
			}
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		recipients, err := s.Store.ListBatchAIRecipients(r.Context(), uid, batchID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "list recipient: "+err.Error())
			return
		}
		recipientID := int64(0)
		if len(recipients) > 0 {
			recipientID = recipients[0].ID
			for i := range recipients {
				if strings.TrimSpace(recipients[i].WhatsappNumber) == strings.TrimSpace(user.Phone) {
					recipientID = recipients[i].ID
					break
				}
			}
			_ = s.Store.SetAIUserFollowupRecipient(r.Context(), uid, retailerID, recipientID)
		}
		if status == "paused" {
			if err := s.Store.ResumeFollowupEnrollment(r.Context(), uid, enrollmentID); err != nil {
				writeErr(w, http.StatusInternalServerError, "resume follow-up: "+err.Error())
				return
			}
		}
		writeAIUserFollowupResult(w, *user, batchID, recipientID, nil, nil, true, "AI follow-up is already ready for this user.")
		return
	}

	conflicts, err := s.Store.FindActiveFollowupDuplicatesForBatch(r.Context(), uid, batchID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "check existing follow-ups: "+err.Error())
		return
	}
	if len(conflicts) > 0 && !req.OverrideExisting {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":        "followup_conflict",
			"message":      "This phone already has AI follow-up running in another batch. Choose whether to keep that batch or move the phone to this AI User workspace.",
			"user":         user,
			"batch_id":     batchID,
			"recipient_id": 0,
			"conflicts":    conflicts,
		})
		return
	}

	if _, err := s.Store.SetBatchAIFollowup(r.Context(), uid, batchID, true); err != nil {
		if errors.Is(err, store.ErrNoRecipientsToTrack) {
			writeErr(w, http.StatusUnprocessableEntity, "this user has no valid WhatsApp number to track")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	recipients, err := s.Store.ListBatchAIRecipients(r.Context(), uid, batchID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list recipient: "+err.Error())
		return
	}
	var recipient *models.BatchAIRecipient
	for i := range recipients {
		if strings.TrimSpace(recipients[i].WhatsappNumber) == strings.TrimSpace(user.Phone) {
			recipient = &recipients[i]
			break
		}
	}
	if recipient == nil && len(recipients) > 0 {
		recipient = &recipients[0]
	}
	if recipient == nil {
		writeErr(w, http.StatusUnprocessableEntity, "AI follow-up is enabled, but no recipient row was created")
		return
	}
	_ = s.Store.SetAIUserFollowupRecipient(r.Context(), uid, retailerID, recipient.ID)

	overridePhones := []string{}
	if req.OverrideExisting {
		overridePhones = []string{recipient.WhatsappNumber}
	}
	seqIDs, enrollIDs, err := s.Store.StartBatchAIFollowupSequence(
		r.Context(),
		uid,
		batchID,
		cfg,
		[]models.BatchAIRecipient{*recipient},
		nil,
		overridePhones,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	if _, err := s.Store.RefreshAIHumanReviewQueue(r.Context(), uid, 2000); err != nil {
		// Non-blocking: the follow-up itself is already created.
		fmt.Printf("[ai-users] refresh human review after user follow-up start admin=%d retailer=%d: %v\n", uid, retailerID, err)
	}

	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "ai_user.followup_started", EntityType: strPtr("retailer"), EntityID: &retailerID,
		Metadata: map[string]any{
			"batch_id":         batchID,
			"recipient_id":     recipient.ID,
			"phone":            recipient.WhatsappNumber,
			"behavior":         cfg.Behavior,
			"cadence_days":     cfg.CadenceDays,
			"max_messages":     cfg.MaxMessages,
			"sequence_count":   len(seqIDs),
			"enrollment_count": len(enrollIDs),
		},
		IPAddress: &ip, UserAgent: &ua,
	})

	writeAIUserFollowupResult(w, *user, batchID, recipient.ID, enrollIDs, seqIDs, false, "AI follow-up started for this user.")
}

func writeAIUserFollowupResult(
	w http.ResponseWriter,
	user models.AIUser,
	batchID, recipientID int64,
	enrollIDs, seqIDs []int64,
	alreadyActive bool,
	message string,
) {
	writeJSON(w, http.StatusOK, models.AIUserFollowupResult{
		User:          user,
		BatchID:       batchID,
		RecipientID:   recipientID,
		EnrollmentIDs: enrollIDs,
		SequenceIDs:   seqIDs,
		Count:         len(enrollIDs),
		AlreadyActive: alreadyActive,
		RedirectURL:   fmt.Sprintf("/admin/ai/followups/%d", batchID),
		Message:       message,
	})
}

func (s *Server) readAIUsersUploadSheet(w http.ResponseWriter, r *http.Request) (*excel.Sheet, string, func(), bool) {
	if err := r.ParseMultipartForm(s.Cfg.MaxUploadBytes); err != nil {
		writeErr(w, http.StatusBadRequest, "file too large or bad multipart: "+err.Error())
		return nil, "", func() {}, false
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "missing 'file' field")
		return nil, "", func() {}, false
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext != ".xlsx" && ext != ".csv" {
		writeErr(w, http.StatusBadRequest, "only .xlsx or .csv accepted")
		return nil, "", func() {}, false
	}
	if err := os.MkdirAll(s.Cfg.UploadDir, 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, "mkdir: "+err.Error())
		return nil, "", func() {}, false
	}
	tmpPath := filepath.Join(s.Cfg.UploadDir, fmt.Sprintf("ai_users_%d_%s_%s", time.Now().Unix(), randHex(8), sanitize(header.Filename)))
	out, err := os.Create(tmpPath)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "save: "+err.Error())
		return nil, "", func() {}, false
	}
	_, err = io.Copy(out, file)
	out.Close()
	if err != nil {
		_ = os.Remove(tmpPath)
		writeErr(w, http.StatusInternalServerError, "save copy: "+err.Error())
		return nil, "", func() {}, false
	}
	cleanup := func() { _ = os.Remove(tmpPath) }
	sheet, err := excel.Read(tmpPath)
	if err != nil {
		cleanup()
		writeErr(w, http.StatusBadRequest, "parse file: "+err.Error())
		return nil, "", func() {}, false
	}
	if len(sheet.Headers) == 0 {
		cleanup()
		writeErr(w, http.StatusBadRequest, "file has no header row")
		return nil, "", func() {}, false
	}
	return sheet, header.Filename, cleanup, true
}

func parseAIUserImportMapping(r *http.Request) (aiUserImportMapping, error) {
	raw := strings.TrimSpace(r.FormValue("mapping"))
	if raw == "" {
		return aiUserImportMapping{}, fmt.Errorf("mapping is required")
	}
	var mapping aiUserImportMapping
	if err := json.Unmarshal([]byte(raw), &mapping); err != nil {
		return aiUserImportMapping{}, fmt.Errorf("mapping must be valid JSON")
	}
	mapping.Name = strings.TrimSpace(mapping.Name)
	mapping.Phone = strings.TrimSpace(mapping.Phone)
	if mapping.Name == "" {
		return aiUserImportMapping{}, fmt.Errorf("name column is required")
	}
	if mapping.Phone == "" {
		return aiUserImportMapping{}, fmt.Errorf("phone column is required")
	}
	return mapping, nil
}

func suggestAIUserMapping(headers []string) aiUserImportMapping {
	name := guessAIUserColumn(headers, []string{
		"name", "full name", "customer name", "retailer name", "retailer_name",
		"contact name", "shop name", "store name", "business name", "party name",
	})
	phone := guessAIUserColumn(headers, []string{
		"phone", "phone number", "mobile", "mobile number", "whatsapp", "whatsapp number",
		"whatsapp_number", "contact", "contact number", "number",
	})
	extra := []string{}
	for _, h := range headers {
		h = strings.TrimSpace(h)
		if h == "" || sameFold(h, name) || sameFold(h, phone) {
			continue
		}
		extra = append(extra, h)
	}
	return aiUserImportMapping{Name: name, Phone: phone, ExtraColumns: extra}
}

func guessAIUserColumn(headers []string, candidates []string) string {
	type scored struct {
		header string
		score  int
	}
	best := scored{}
	for _, h := range headers {
		normal := normalizeAIUserHeader(h)
		for _, c := range candidates {
			cn := normalizeAIUserHeader(c)
			score := 0
			switch {
			case normal == cn:
				score = 100
			case strings.Contains(normal, cn):
				score = 70
			case strings.Contains(cn, normal) && len(normal) >= 4:
				score = 50
			}
			if score > best.score {
				best = scored{header: strings.TrimSpace(h), score: score}
			}
		}
	}
	return best.header
}

func normalizeAIUserHeader(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	replacer := strings.NewReplacer("_", " ", "-", " ", ".", " ", "/", " ")
	s = replacer.Replace(s)
	return strings.Join(strings.Fields(s), " ")
}

func aiUserMappedValue(row map[string]string, column string) string {
	column = strings.TrimSpace(column)
	if column == "" {
		return ""
	}
	if v, ok := row[column]; ok {
		return v
	}
	want := strings.ToLower(column)
	for k, v := range row {
		if strings.ToLower(strings.TrimSpace(k)) == want {
			return v
		}
	}
	return ""
}

func sameFold(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}

func validAIUserPhone(phone string) bool {
	if len(phone) < 10 || len(phone) > 15 {
		return false
	}
	for _, r := range phone {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
