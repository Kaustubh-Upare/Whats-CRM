package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/whatsyitc/backend/internal/audit"
	"github.com/whatsyitc/backend/internal/middleware"
	"github.com/whatsyitc/backend/internal/models"
)

func (s *Server) ListCRMPipelines(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	items, err := s.Store.ListCRMPipelines(r.Context(), uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (s *Server) GetCRMPipeline(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	p, err := s.Store.GetCRMPipeline(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if p == nil {
		writeErr(w, http.StatusNotFound, "pipeline not found")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

type createCRMPipelineReq struct {
	Name     string `json:"name"`
	Template string `json:"template"`
}

func (s *Server) CreateCRMPipeline(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	var req createCRMPipelineReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	id, err := s.Store.CreateCRMPipeline(r.Context(), uid, req.Name, req.Template, false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

func (s *Server) UpdateCRMPipeline(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	ok, err := s.Store.UpdateCRMPipeline(r.Context(), uid, id, req.Name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeErr(w, http.StatusNotFound, "pipeline not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) UpdateCRMPipelineStages(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req struct {
		Stages []models.CRMPipelineStage `json:"stages"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if err := s.Store.ReplaceCRMPipelineStages(r.Context(), uid, id, req.Stages); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) DeleteCRMPipeline(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	deleted, err := s.Store.DeleteCRMPipeline(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !deleted {
		writeErr(w, http.StatusBadRequest, "pipeline not found or default pipeline cannot be deleted")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) ListCRMLeads(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	scoreMin := intParam(r, "score_min", 0)
	limit := intParam(r, "limit", 100)
	offset := intParam(r, "offset", 0)
	items, total, err := s.Store.ListCRMLeads(r.Context(), uid, status, search, scoreMin, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

func (s *Server) GetCRMLead(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	lead, err := s.Store.GetCRMLead(r.Context(), uid, id, true)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if lead == nil {
		writeErr(w, http.StatusNotFound, "lead not found")
		return
	}
	writeJSON(w, http.StatusOK, lead)
}

type crmLeadReq struct {
	Name     string   `json:"name"`
	Phone    string   `json:"phone"`
	Email    string   `json:"email"`
	Source   string   `json:"source"`
	Status   string   `json:"status"`
	Score    *int     `json:"score"`
	Interest string   `json:"interest"`
	Budget   string   `json:"budget"`
	Timeline string   `json:"timeline"`
	Location string   `json:"location"`
	Notes    string   `json:"notes"`
	Tags     []string `json:"tags"`
}

func (s *Server) CreateCRMLead(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	var req crmLeadReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if strings.TrimSpace(req.Phone) == "" {
		writeErr(w, http.StatusBadRequest, "phone is required")
		return
	}
	score := 0
	if req.Score != nil {
		score = *req.Score
	}
	id, err := s.Store.CreateCRMLead(r.Context(), uid, &models.CRMLead{
		Name: req.Name, Phone: req.Phone, Email: req.Email, Source: req.Source,
		Status: req.Status, Score: score, Interest: req.Interest, Budget: req.Budget,
		Timeline: req.Timeline, Location: req.Location, Notes: req.Notes, Tags: req.Tags,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	email := middleware.Email(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "crm.lead.created", EntityType: strPtr("crm_lead"), EntityID: &id,
	})
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

func (s *Server) UpdateCRMLead(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	lead, err := s.Store.GetCRMLead(r.Context(), uid, id, false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if lead == nil {
		writeErr(w, http.StatusNotFound, "lead not found")
		return
	}
	var raw map[string]json.RawMessage
	if err := decodeJSON(r, &raw); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	oldStatus := lead.Status
	applyCRMLeadPatch(lead, raw)
	saved, err := s.Store.SaveCRMLead(r.Context(), uid, lead)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !saved {
		writeErr(w, http.StatusNotFound, "lead not found")
		return
	}
	if oldStatus != lead.Status {
		_, _ = s.Store.AddCRMLeadActivity(r.Context(), uid, id, "lead_status_change", "Status changed from "+oldStatus+" to "+lead.Status, uid, map[string]any{"from": oldStatus, "to": lead.Status})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) DeleteCRMLead(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	deleted, err := s.Store.DeleteCRMLead(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !deleted {
		writeErr(w, http.StatusNotFound, "lead not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) ListCRMLeadActivities(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	leadID, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	items, err := s.Store.ListCRMLeadActivities(r.Context(), uid, leadID, intParam(r, "limit", 100), intParam(r, "offset", 0))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) AddCRMLeadActivity(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	leadID, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req struct {
		Type    string `json:"type"`
		Content string `json:"content"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeErr(w, http.StatusBadRequest, "content is required")
		return
	}
	id, err := s.Store.AddCRMLeadActivity(r.Context(), uid, leadID, req.Type, req.Content, uid, nil)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

func (s *Server) ListCRMLeadTasks(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	leadID, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	items, err := s.Store.ListCRMTasks(r.Context(), uid, leadID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) AddCRMLeadTask(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	leadID, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		DueAt       string `json:"due_at"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	due, err := parseOptionalTime(req.DueAt)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad due_at")
		return
	}
	id, err := s.Store.AddCRMTask(r.Context(), uid, leadID, req.Title, req.Description, due)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

func (s *Server) UpdateCRMLeadTask(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	leadID, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad lead id")
		return
	}
	taskID, ok := int64PathParam(r, "taskID")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad task id")
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	updated, err := s.Store.UpdateCRMTaskStatus(r.Context(), uid, leadID, taskID, req.Status)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !updated {
		writeErr(w, http.StatusNotFound, "task not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) ListCRMLeadConversations(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	leadID, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	items, err := s.Store.ListCRMLeadConversations(r.Context(), uid, leadID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) ListCRMLeadDeals(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	leadID, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	items, err := s.Store.ListCRMDealsByLead(r.Context(), uid, leadID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) ListCRMDeals(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	pipelineID, ok := int64Param(r, "pipeline_id")
	if !ok || pipelineID <= 0 {
		writeErr(w, http.StatusBadRequest, "pipeline_id is required")
		return
	}
	items, err := s.Store.ListCRMDealsByPipeline(r.Context(), uid, pipelineID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (s *Server) CreateCRMDeal(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	var req struct {
		LeadID     int64    `json:"lead_id"`
		PipelineID int64    `json:"pipeline_id"`
		StageID    int64    `json:"stage_id"`
		Name       string   `json:"name"`
		Value      *float64 `json:"value"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "New deal"
	}
	id, err := s.Store.CreateCRMDeal(r.Context(), uid, &models.CRMDeal{
		LeadID: req.LeadID, PipelineID: req.PipelineID, StageID: req.StageID,
		Name: name, Value: req.Value, Currency: "INR", Probability: 10,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

func (s *Server) MoveCRMDealStage(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req struct {
		StageID int64 `json:"stage_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	deal, err := s.Store.MoveCRMDealStage(r.Context(), uid, id, req.StageID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if deal == nil {
		writeErr(w, http.StatusNotFound, "deal not found")
		return
	}
	writeJSON(w, http.StatusOK, deal)
}

func (s *Server) UpdateCRMDeal(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	deal, err := s.Store.GetCRMDeal(r.Context(), uid, id)
	if err != nil || deal == nil {
		writeErr(w, http.StatusNotFound, "deal not found")
		return
	}
	var raw map[string]json.RawMessage
	if err := decodeJSON(r, &raw); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	applyCRMDealPatch(deal, raw)
	updated, err := s.Store.UpdateCRMDeal(r.Context(), uid, deal)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !updated {
		writeErr(w, http.StatusNotFound, "deal not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) DeleteCRMDeal(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	deleted, err := s.Store.DeleteCRMDeal(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !deleted {
		writeErr(w, http.StatusNotFound, "deal not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func applyCRMLeadPatch(lead *models.CRMLead, raw map[string]json.RawMessage) {
	assignString(raw, "name", &lead.Name)
	assignString(raw, "phone", &lead.Phone)
	assignString(raw, "email", &lead.Email)
	assignString(raw, "source", &lead.Source)
	assignString(raw, "status", &lead.Status)
	assignString(raw, "interest", &lead.Interest)
	assignString(raw, "budget", &lead.Budget)
	assignString(raw, "timeline", &lead.Timeline)
	assignString(raw, "location", &lead.Location)
	assignString(raw, "notes", &lead.Notes)
	if v, ok := raw["score"]; ok {
		_ = json.Unmarshal(v, &lead.Score)
	}
	if v, ok := raw["tags"]; ok {
		_ = json.Unmarshal(v, &lead.Tags)
	}
}

func applyCRMDealPatch(deal *models.CRMDeal, raw map[string]json.RawMessage) {
	assignString(raw, "name", &deal.Name)
	assignString(raw, "currency", &deal.Currency)
	if v, ok := raw["value"]; ok {
		_ = json.Unmarshal(v, &deal.Value)
	}
	if v, ok := raw["probability"]; ok {
		_ = json.Unmarshal(v, &deal.Probability)
	}
	if v, ok := raw["expected_close_date"]; ok {
		var s string
		if json.Unmarshal(v, &s) == nil {
			deal.ExpectedCloseDate, _ = parseOptionalTime(s)
		}
	}
}

func assignString(raw map[string]json.RawMessage, key string, dest *string) {
	if v, ok := raw[key]; ok {
		var s string
		if json.Unmarshal(v, &s) == nil {
			*dest = s
		}
	}
}

func parseOptionalTime(s string) (*time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return &t, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Server) ListCRMSequences(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	items, err := s.Store.ListCRMSequences(r.Context(), uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (s *Server) CreateCRMSequence(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	var req struct {
		Name          string         `json:"name"`
		TriggerEvent  string         `json:"trigger_event"`
		TriggerConfig map[string]any `json:"trigger_config"`
		Enabled       *bool          `json:"enabled"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	id, err := s.Store.CreateCRMSequence(r.Context(), uid, &models.CRMSequence{
		Name: req.Name, TriggerEvent: req.TriggerEvent, TriggerConfig: req.TriggerConfig, Enabled: enabled,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

func (s *Server) UpdateCRMSequence(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	seq, err := s.Store.GetCRMSequence(r.Context(), uid, id)
	if err != nil || seq == nil {
		writeErr(w, http.StatusNotFound, "sequence not found")
		return
	}
	var raw map[string]json.RawMessage
	if err := decodeJSON(r, &raw); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	assignString(raw, "name", &seq.Name)
	assignString(raw, "trigger_event", &seq.TriggerEvent)
	if v, ok := raw["trigger_config"]; ok {
		_ = json.Unmarshal(v, &seq.TriggerConfig)
	}
	if v, ok := raw["enabled"]; ok {
		_ = json.Unmarshal(v, &seq.Enabled)
	}
	updated, err := s.Store.SaveCRMSequence(r.Context(), uid, seq)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !updated {
		writeErr(w, http.StatusNotFound, "sequence not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) DeleteCRMSequence(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	deleted, err := s.Store.DeleteCRMSequence(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !deleted {
		writeErr(w, http.StatusNotFound, "sequence not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) GetCRMSequenceSteps(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	items, err := s.Store.ListCRMSequenceSteps(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) UpdateCRMSequenceSteps(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req struct {
		Steps []models.CRMSequenceStep `json:"steps"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if err := s.Store.ReplaceCRMSequenceSteps(r.Context(), uid, id, req.Steps); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) EnrollCRMLeadInSequence(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var req struct {
		LeadID int64 `json:"lead_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	enrollmentID, err := s.Store.EnrollCRMLeadInSequence(r.Context(), uid, id, req.LeadID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": enrollmentID})
}

func (s *Server) ListCRMSequenceEnrollments(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	items, err := s.Store.ListCRMSequenceEnrollments(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListCRMSequenceRuns handles GET /crm/sequences/:id/runs. Returns the
// last 50 enrollments with current_step, next_run_at, status, and the
// most recent 'needs_attention' activity row (NULL when healthy).
// Phase 5 surface for the sequence editor's "Runs" panel.
func (s *Server) ListCRMSequenceRuns(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	id, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	items, err := s.Store.ListCRMSequenceRuns(r.Context(), uid, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ---------------------------------------------------------------------------
// Phase 7: Smart Follow-Up
// ---------------------------------------------------------------------------

// SetupLeadFollowup handles POST /crm/leads/:id/followup. Creates or
// restarts an AI-generated follow-up sequence for the lead.
//
// Body: {cadence_days, max_messages, tone, goal, checkin_enabled}
//
// Behavior:
//   - If no existing smart_followup enrollment for the lead: create a
//     hidden sequence + steps + enrollment, return both IDs.
//   - If an existing smart_followup enrollment exists (active OR
//     paused): restart it with the new cadence/max/tone and return
//     the existing IDs.
//
// The lead's phone is read from bc_crm_leads (the lead row was
// created when the retailer first messaged; for orphan leads the
// store layer treats it as a 404).
func (s *Server) SetupLeadFollowup(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	leadID, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad lead id")
		return
	}
	var req struct {
		CadenceDays    int    `json:"cadence_days"`
		MaxMessages    int    `json:"max_messages"`
		Tone           string `json:"tone"`
		Goal           string `json:"goal"`
		CheckinEnabled bool   `json:"checkin_enabled"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if req.CadenceDays < 1 {
		req.CadenceDays = 3
	}
	if req.MaxMessages < 1 {
		req.MaxMessages = 3
	}
	if req.Tone == "" {
		req.Tone = "friendly"
	}

	// Load the lead to get name + phone.
	lead, err := s.Store.GetCRMLead(r.Context(), uid, leadID, false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if lead == nil {
		writeErr(w, http.StatusNotFound, "lead not found")
		return
	}

	// Restart path: there's already a smart follow-up for this lead.
	// Flip it back to active with the new cadence and update the
	// step condition JSONB so subsequent picks see the new tone/max.
	if existing, err := s.Store.GetActiveFollowupEnrollment(r.Context(), uid, leadID); err == nil && existing != nil {
		if err := s.Store.RestartFollowupEnrollment(r.Context(), uid, existing.ID, req.CadenceDays); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		// Update step conditions so the worker sees the new cadence/tone/max.
		condJSON, _ := json.Marshal(map[string]any{
			"goal":            req.Goal,
			"tone":            req.Tone,
			"max_messages":    req.MaxMessages,
			"checkin_enabled": req.CheckinEnabled,
			"last_topic":      existing.Goal,
			"cadence_days":    req.CadenceDays,
		})
		_, _ = s.Store.DB.Exec(r.Context(), `
			UPDATE bc_crm_sequence_steps
			SET condition = $2::jsonb
			WHERE sequence_id = $1
		`, existing.SequenceID, string(condJSON))
		_, _ = s.Store.DB.Exec(r.Context(), `
			UPDATE bc_crm_sequence_enrollments
			SET checkin_enabled = $2
			WHERE id = $1
		`, existing.ID, req.CheckinEnabled)
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true, "sequence_id": existing.SequenceID,
			"enrollment_id": existing.ID, "restarted": true,
		})
		return
	}

	// Fresh path: create the hidden sequence + steps + enrollment.
	seqID, enrollID, err := s.Store.CreateSmartFollowupSequence(
		r.Context(), uid, leadID,
		lead.Name, lead.Phone,
		req.CadenceDays, req.MaxMessages,
		req.Tone, req.Goal, req.CheckinEnabled,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "sequence_id": seqID,
		"enrollment_id": enrollID, "restarted": false,
	})
}

// GetLeadFollowupStatus handles GET /crm/leads/:id/followup. Returns
// the active or paused smart_followup enrollment for the lead (or
// null). The frontend dialog uses this to switch between "Start",
// "Restart", and "Pause" states.
func (s *Server) GetLeadFollowupStatus(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	leadID, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad lead id")
		return
	}
	row, err := s.Store.GetActiveFollowupEnrollment(r.Context(), uid, leadID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if row == nil {
		writeJSON(w, http.StatusOK, map[string]any{"enrollment": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"enrollment": map[string]any{
			"id":              row.ID,
			"sequence_id":     row.SequenceID,
			"status":          row.Status,
			"current_step":    row.CurrentStep,
			"pause_reason":    row.PauseReason,
			"checkin_enabled": row.CheckinEnabled,
			"next_run_at":     row.NextRunAt,
			"cadence_days":    row.CadenceDays,
			"max_messages":    row.MaxMessages,
			"tone":            row.Tone,
			"goal":            row.Goal,
		},
	})
}

// PauseLeadFollowup handles POST /crm/leads/:id/followup/pause. Flips
// the active smart_followup enrollment to paused with
// reason='admin_paused'. Idempotent.
func (s *Server) PauseLeadFollowup(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	leadID, ok := int64PathParam(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad lead id")
		return
	}
	row, err := s.Store.GetActiveFollowupEnrollment(r.Context(), uid, leadID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if row == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "noop": true})
		return
	}
	if err := s.Store.PauseFollowupEnrollment(r.Context(), uid, row.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "enrollment_id": row.ID})
}
