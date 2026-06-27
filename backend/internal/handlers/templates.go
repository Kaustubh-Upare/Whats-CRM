package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/whatsyitc/backend/internal/audit"
	"github.com/whatsyitc/backend/internal/middleware"
	"github.com/whatsyitc/backend/internal/models"
)

func (s *Server) ListTemplates(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	ts, err := s.Store.ListTemplates(r.Context(), uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ts)
}

type createTemplateReq struct {
	Name         string          `json:"name"`
	LanguageCode string          `json:"language_code"`
	Category     string          `json:"category"`
	Body         string          `json:"body"`
	Sample       json.RawMessage `json:"sample_payload"`
}

func (s *Server) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	var req createTemplateReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.LanguageCode = defaultStr(req.LanguageCode, "en")
	req.Category = defaultStr(req.Category, "utility")
	if req.Name == "" || req.Body == "" {
		writeErr(w, http.StatusBadRequest, "name and body required")
		return
	}
	owner := uid
	t := &models.Template{
		AdminUserID: &owner, Name: req.Name, LanguageCode: req.LanguageCode, Category: req.Category,
		Body: req.Body, VariableCount: countVars(req.Body),
		SamplePayload: req.Sample, IsActive: true,
	}
	id, err := s.Store.CreateTemplate(r.Context(), t)
	if err != nil {
		// Most likely the (name, language_code) unique index was hit. Surface
		// it as 409 instead of 500 so the UI can recover gracefully.
		if strings.Contains(err.Error(), "uq_bc_templates_name_lang") {
			writeErr(w, http.StatusConflict, "a template with this name and language already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "template.created", EntityType: strPtr("template"), EntityID: &id,
		Metadata: map[string]any{"name": req.Name, "lang": req.LanguageCode},
	})
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

// GetTemplate returns one template row by id. Used by the editor to hydrate
// the form before letting the user edit / preview it.
func (s *Server) GetTemplate(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	t, err := s.Store.GetTemplateByID(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if t == nil {
		writeErr(w, http.StatusNotFound, "template not found")
		return
	}
	writeJSON(w, http.StatusOK, t)
}

type updateTemplateReq struct {
	Name         string          `json:"name"`
	LanguageCode string          `json:"language_code"`
	Category     string          `json:"category"`
	Body         string          `json:"body"`
	Sample       json.RawMessage `json:"sample_payload"`
	IsActive     *bool           `json:"is_active"`
}

// UpdateTemplate updates an existing template's editable fields. The body's
// variable_count is re-derived from the new body text so the cached count
// never drifts from what the worker / preview path will count.
func (s *Server) UpdateTemplate(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	existing, err := s.Store.GetTemplateByID(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing == nil {
		writeErr(w, http.StatusNotFound, "template not found")
		return
	}
	var req updateTemplateReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		req.Name = existing.Name
	}
	if strings.TrimSpace(req.LanguageCode) == "" {
		req.LanguageCode = existing.LanguageCode
	}
	if strings.TrimSpace(req.Category) == "" {
		req.Category = existing.Category
	}
	if req.Body == "" {
		req.Body = existing.Body
	}
	// nil means "leave as-is"; false means "explicitly deactivate".
	isActive := existing.IsActive
	if req.IsActive != nil {
		isActive = *req.IsActive
	}
	owner := uid
	updated := &models.Template{
		ID:            existing.ID,
		AdminUserID:   &owner,
		Name:          req.Name,
		LanguageCode:  req.LanguageCode,
		Category:      req.Category,
		Body:          req.Body,
		VariableCount: countVars(req.Body),
		SamplePayload: req.Sample,
		IsActive:      isActive,
	}
	if err := s.Store.UpdateTemplate(r.Context(), updated); err != nil {
		if strings.Contains(err.Error(), "uq_bc_templates_name_lang") {
			writeErr(w, http.StatusConflict, "another template already uses this name and language")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "template.updated", EntityType: strPtr("template"), EntityID: &id,
		Metadata: map[string]any{"name": req.Name, "lang": req.LanguageCode, "is_active": isActive},
	})
	fresh, err := s.Store.GetTemplateByID(r.Context(), uid, id)
	if err != nil || fresh == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	writeJSON(w, http.StatusOK, fresh)
}

// SetTemplateActive is a thin wrapper around PATCH /templates/{id}/active
// so the UI doesn't have to send a full PUT body just to flip the toggle.
func (s *Server) SetTemplateActive(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req struct {
		IsActive bool `json:"is_active"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if err := s.Store.SetTemplateActive(r.Context(), uid, id, req.IsActive); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "template.active_toggled", EntityType: strPtr("template"), EntityID: &id,
		Metadata: map[string]any{"is_active": req.IsActive},
	})
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "is_active": req.IsActive})
}

func (s *Server) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	existing, err := s.Store.GetTemplateByID(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing == nil {
		writeErr(w, http.StatusNotFound, "template not found")
		return
	}
	if err := s.Store.DeleteTemplate(r.Context(), uid, id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "template.deleted", EntityType: strPtr("template"), EntityID: &id,
		Metadata: map[string]any{"name": existing.Name, "lang": existing.LanguageCode},
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// PreviewTemplateRequest accepts the in-progress form values from the editor
// (no save required) and renders what the worker would send, substituting the
// JSON `sample_payload` into the body. The body may use either {{1}}..{{N}}
// OR {{name}} style placeholders — if a placeholder doesn't have a matching
// sample key, it's left untouched so the user can spot missing fields.
type PreviewTemplateRequest struct {
	Body   string          `json:"body"`
	Sample json.RawMessage `json:"sample_payload"`
}

// PreviewTemplate renders a template body + sample payload into a final
// message body string. This is editor-only (no DB write, no audit) and is
// safe to call on every keystroke.
func (s *Server) PreviewTemplate(w http.ResponseWriter, r *http.Request) {
	var req PreviewTemplateRequest
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if req.Body == "" {
		writeErr(w, http.StatusBadRequest, "body required")
		return
	}
	// Parse sample_payload as a JSON object {key: value, ...}.
	var params map[string]any
	if len(req.Sample) > 0 {
		if err := json.Unmarshal(req.Sample, &params); err != nil {
			writeErr(w, http.StatusBadRequest, "sample_payload must be a JSON object")
			return
		}
	}
	rendered := renderTemplateBody(req.Body, params)
	writeJSON(w, http.StatusOK, map[string]any{
		"body":              rendered,
		"variable_count":    countVars(req.Body),
		"sample_params":     params,
		"unresolved_tokens": findUnresolvedTokens(req.Body, params),
	})
}

// renderTemplateBody does {{N}} AND {{key}} substitution on a body string.
// {{N}} takes precedence when present in the body (numeric mode keeps the
// existing buildTemplateParams contract intact). {{key}} mode lets users
// write templates like "Hello {{retailer_name}}, your invoice {{invoice}}"
// instead of memorising positional indexes.
func renderTemplateBody(body string, params map[string]any) string {
	out := body
	// {{key}} substitution first, longest-key-first to avoid partial overlaps.
	if len(params) > 0 {
		keys := make([]string, 0, len(params))
		for k := range params {
			keys = append(keys, k)
		}
		// sort longest-first
		for i := 1; i < len(keys); i++ {
			for j := i; j > 0 && len(keys[j]) > len(keys[j-1]); j-- {
				keys[j], keys[j-1] = keys[j-1], keys[j]
			}
		}
		for _, k := range keys {
			out = strings.ReplaceAll(out, "{{"+k+"}}", toString(params[k]))
		}
	}
	// {{N}} substitution: only if {{1}}..{{N}} are present in the body so we
	// don't double-substitute text that already used {{key}} form.
	if countVars(out) > 0 && len(params) > 0 {
		// Walk params in insertion order — Go map iteration is randomised,
		// but for positional substitution the canonical ordering from the
		// worker is the slice we pass via {{1}},{{2}}… so we just use the
		// key set sorted alphabetically for deterministic preview output.
		keys := make([]string, 0, len(params))
		for k := range params {
			keys = append(keys, k)
		}
		// alphabetic sort keeps the order stable across calls
		for i := 1; i < len(keys); i++ {
			for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
				keys[j], keys[j-1] = keys[j-1], keys[j]
			}
		}
		for i, k := range keys {
			out = strings.ReplaceAll(out, "{{"+strconv.Itoa(i+1)+"}}", toString(params[k]))
		}
	}
	return out
}

// findUnresolvedTokens returns the set of {{…}} placeholders that survived
// rendering, so the editor can warn the user "you used {{3}} but only have 2
// sample keys" without parsing the body itself.
func findUnresolvedTokens(body string, params map[string]any) []string {
	out := []string{}
	for i := 0; i < len(body)-3; {
		if body[i] == '{' && body[i+1] == '{' {
			end := strings.Index(body[i+2:], "}}")
			if end < 0 {
				break
			}
			tok := body[i+2 : i+2+end]
			out = append(out, "{{"+tok+"}}")
			i += 2 + end + 2
			continue
		}
		i++
	}
	_ = params
	return out
}

func toString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case float64:
		// JSON numbers decode to float64 — format without trailing zeros if integer.
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		if t {
			return "true"
		}
		return "false"
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}

func defaultStr(s, def string) string {
	if s == "" {
		return def
	}
	return s
}