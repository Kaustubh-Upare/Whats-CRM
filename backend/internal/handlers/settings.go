package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/whatsyitc/backend/internal/audit"
	"github.com/whatsyitc/backend/internal/middleware"
)

// WhatsappSettingsResponse is the shape returned by GET /api/settings/whatsapp.
// Tokens and verify-tokens are NEVER included — even the encrypted form
// shouldn't leave the server.
//
// When the row has been soft-deleted (RemovedAt != nil) the response
// flips `configured=false` so the UI behaves the same as "never added",
// but `is_removed=true`, `removed_at`, and the snapshot columns
// (LastKnown*) are populated so the Settings card can render a
// "previously configured" view with a Restore button.
type WhatsappSettingsResponse struct {
	Configured    bool       `json:"configured"`
	IsRemoved     bool       `json:"is_removed"`
	PhoneNumberID string     `json:"phone_number_id,omitempty"`
	WABAID        *string    `json:"waba_id,omitempty"`
	APIVersion    string     `json:"api_version"`
	IsVerified    bool       `json:"is_verified"`
	VerifiedAt    *time.Time `json:"verified_at,omitempty"`
	LastError     *string    `json:"last_error,omitempty"`
	CreatedAt     *time.Time `json:"created_at,omitempty"`
	UpdatedAt     *time.Time `json:"updated_at,omitempty"`
	RemovedAt     *time.Time `json:"removed_at,omitempty"`
	RemovedBy     *int64     `json:"removed_by,omitempty"`
	// Snapshot of the last-known public identifiers when the row has
	// been soft-deleted. Empty when the row is still active.
	LastKnownPhoneNumberID string `json:"last_known_phone_number_id,omitempty"`
	LastKnownWABAID        string `json:"last_known_waba_id,omitempty"`
	LastKnownAPIVersion    string `json:"last_known_api_version,omitempty"`
	LastSeenIsVerified     *bool  `json:"last_seen_is_verified,omitempty"`
}

// GetWhatsappSettings returns the calling admin's WABA settings (without
// the secrets). If no row exists, configured=false and the rest is zero.
// If the row is soft-deleted, configured=false but is_removed=true plus
// the last_known_* snapshot is returned.
func (s *Server) GetWhatsappSettings(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	creds, _, _, err := s.Store.GetWhatsappCredentials(r.Context(), uid, s.Cfg.FieldEncKey)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	resp := WhatsappSettingsResponse{}
	if creds == nil {
		writeJSON(w, http.StatusOK, resp)
		return
	}

	resp.IsRemoved = creds.RemovedAt != nil
	resp.Configured = !resp.IsRemoved
	resp.PhoneNumberID = creds.PhoneNumberID
	resp.WABAID = creds.WABAID
	resp.APIVersion = creds.APIVersion
	resp.IsVerified = creds.IsVerified
	resp.VerifiedAt = creds.VerifiedAt
	resp.LastError = creds.LastError
	t := creds.CreatedAt
	resp.CreatedAt = &t
	t2 := creds.UpdatedAt
	resp.UpdatedAt = &t2
	resp.RemovedAt = creds.RemovedAt
	resp.RemovedBy = creds.RemovedBy

	if resp.IsRemoved {
		// The store layer already populates PhoneNumberID/WABAID/APIVersion
		// from the last_known_* snapshot when removed_at is set, so we just
		// echo them back as the LastKnown* fields for the UI to render
		// in a clearly-labelled "previously configured" section.
		resp.LastKnownPhoneNumberID = creds.PhoneNumberID
		resp.LastKnownWABAID = strOrEmpty(creds.WABAID)
		resp.LastKnownAPIVersion = creds.APIVersion
		resp.LastSeenIsVerified = &creds.IsVerified
	}

	writeJSON(w, http.StatusOK, resp)
}

func strOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

type putWhatsappSettingsReq struct {
	PhoneNumberID string `json:"phone_number_id"`
	AccessToken   string `json:"access_token"`
	VerifyToken   string `json:"verify_token"`
	WABAID        string `json:"waba_id"`
	APIVersion    string `json:"api_version"`
}

// PutWhatsappSettings writes (or replaces) the calling admin's WABA
// credentials. Tokens are encrypted with BC_FIELD_ENC_KEY before being
// written; the response is the same shape as GET (no secrets).
//
// Calling PUT against a soft-deleted row is treated as a re-add —
// removed_at is cleared by UpsertWhatsappCredentials, the encrypted
// blobs are overwritten with the freshly-encrypted values, and the
// credentials_history table gets a "restored" or "updated" row depending
// on whether the row was previously removed.
func (s *Server) PutWhatsappSettings(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	var req putWhatsappSettingsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.PhoneNumberID = strings.TrimSpace(req.PhoneNumberID)
	req.AccessToken = strings.TrimSpace(req.AccessToken)
	req.VerifyToken = strings.TrimSpace(req.VerifyToken)
	req.WABAID = strings.TrimSpace(req.WABAID)
	req.APIVersion = strings.TrimSpace(req.APIVersion)
	if req.PhoneNumberID == "" || req.AccessToken == "" || req.VerifyToken == "" {
		writeErr(w, http.StatusBadRequest, "phone_number_id, access_token, and verify_token are required")
		return
	}

	// Capture the prior state so we can label the history row correctly.
	var wasRemoved bool
	prior, _, _, _ := s.Store.GetWhatsappCredentials(r.Context(), uid, s.Cfg.FieldEncKey)
	if prior != nil && prior.RemovedAt != nil {
		wasRemoved = true
	}

	if err := s.Store.UpsertWhatsappCredentials(
		r.Context(), uid, s.Cfg.FieldEncKey,
		req.PhoneNumberID, req.AccessToken, req.VerifyToken, req.WABAID, req.APIVersion,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "save credentials: "+err.Error())
		return
	}

	email := middleware.Email(r)
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "settings.whatsapp.updated", EntityType: strPtr("whatsapp_credentials"),
		EntityID: &uid,
		Metadata: map[string]any{"phone_number_id": req.PhoneNumberID, "waba_id": req.WABAID, "after_remove": wasRemoved},
		IPAddress: &ip, UserAgent: &ua,
	})

	// History entry: "restored" when this PUT was against a soft-deleted
	// row (i.e. the user came back and re-added), "created" if there was
	// no prior row, "updated" otherwise.
	histAction := "updated"
	if prior == nil {
		histAction = "created"
	} else if wasRemoved {
		histAction = "restored"
	}
	wabaStr := req.WABAID
	apiStr := req.APIVersion
	phoneStr := req.PhoneNumberID
	isVerified := false
	ipStr, uaStr := ip, ua
	actorID := uid
	_ = s.Store.InsertCredentialsHistory(r.Context(), uid, histAction, &phoneStr, &wabaStr, &apiStr, &isVerified, &actorID, &ipStr, &uaStr)

	// Return the current settings (without secrets).
	s.GetWhatsappSettings(w, r)
}

// TestWhatsappSettings probes the stored access_token against Meta's
// graph API. On success it flips is_verified=true; on failure it stores
// the Meta error in last_error. Useful as the "Test connection" button.
func (s *Server) TestWhatsappSettings(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	creds, accessToken, _, err := s.Store.GetWhatsappCredentials(r.Context(), uid, s.Cfg.FieldEncKey)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if creds == nil {
		writeErr(w, http.StatusBadRequest, "no credentials configured")
		return
	}
	apiVersion := creds.APIVersion
	if apiVersion == "" {
		apiVersion = s.Cfg.WhatsAPIVersion
	}
	url := fmt.Sprintf("https://graph.facebook.com/%s/%s?fields=id,display_phone_number,verified_name,quality_rating", apiVersion, creds.PhoneNumberID)
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, url, nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		errStr := "network error: " + err.Error()
		_ = s.Store.MarkWhatsappVerified(r.Context(), uid, false, errStr)
		writeErr(w, http.StatusBadGateway, errStr)
		return
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errStr := fmt.Sprintf("Meta API returned %d: %s", resp.StatusCode, string(raw))
		_ = s.Store.MarkWhatsappVerified(r.Context(), uid, false, errStr)
		writeErr(w, http.StatusBadRequest, errStr)
		return
	}
	// Parse the response to surface a few useful fields.
	var probe struct {
		ID                string `json:"id"`
		DisplayPhoneNumber string `json:"display_phone_number"`
		VerifiedName      string `json:"verified_name"`
		QualityRating     string `json:"quality_rating"`
	}
	_ = json.Unmarshal(raw, &probe)
	_ = s.Store.MarkWhatsappVerified(r.Context(), uid, true, "")
	email := middleware.Email(r)
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "settings.whatsapp.tested", EntityType: strPtr("whatsapp_credentials"),
		EntityID: &uid,
		Metadata: map[string]any{"phone_number_id": creds.PhoneNumberID, "ok": true},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                  true,
		"phone_number_id":     probe.ID,
		"display_phone_number": probe.DisplayPhoneNumber,
		"verified_name":       probe.VerifiedName,
		"quality_rating":      probe.QualityRating,
	})
}

// DeleteWhatsappSettings soft-deletes the calling admin's credentials
// row. The encrypted blobs stay on disk so the user can restore later
// without re-entering the access token. See Store.DeleteWhatsappCredentials
// for the snapshot fields it writes.
func (s *Server) DeleteWhatsappSettings(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	// Capture the prior values for the history row before soft-deleting.
	prior, _, _, _ := s.Store.GetWhatsappCredentials(r.Context(), uid, s.Cfg.FieldEncKey)
	if err := s.Store.DeleteWhatsappCredentials(r.Context(), uid, uid); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	email := middleware.Email(r)
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "settings.whatsapp.deleted", EntityType: strPtr("whatsapp_credentials"),
		EntityID: &uid,
		IPAddress: &ip, UserAgent: &ua,
	})

	// History entry — captures the public identifiers the user just
	// removed so they can see them in the "previously configured" view.
	if prior != nil {
		phoneStr := prior.PhoneNumberID
		wabaStr := strOrEmpty(prior.WABAID)
		apiStr := prior.APIVersion
		isVerified := prior.IsVerified
		ipStr, uaStr := ip, ua
		actorID := uid
		_ = s.Store.InsertCredentialsHistory(r.Context(), uid, "removed", &phoneStr, &wabaStr, &apiStr, &isVerified, &actorID, &ipStr, &uaStr)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// RestoreWhatsappSettings clears the soft-delete flags so the row
// becomes active again, with the previously-stored encrypted tokens
// intact. Returns the GET-shaped response so the UI can refresh in place.
func (s *Server) RestoreWhatsappSettings(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	if err := s.Store.RestoreWhatsappCredentials(r.Context(), uid); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	email := middleware.Email(r)
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &uid, ActorEmail: &email,
		Action: "settings.whatsapp.restored", EntityType: strPtr("whatsapp_credentials"),
		EntityID: &uid,
		IPAddress: &ip, UserAgent: &ua,
	})

	// History entry.
	prior, _, _, _ := s.Store.GetWhatsappCredentials(r.Context(), uid, s.Cfg.FieldEncKey)
	if prior != nil {
		phoneStr := prior.PhoneNumberID
		wabaStr := strOrEmpty(prior.WABAID)
		apiStr := prior.APIVersion
		isVerified := prior.IsVerified
		ipStr, uaStr := ip, ua
		actorID := uid
		_ = s.Store.InsertCredentialsHistory(r.Context(), uid, "restored", &phoneStr, &wabaStr, &apiStr, &isVerified, &actorID, &ipStr, &uaStr)
	}
	s.GetWhatsappSettings(w, r)
}

// ListCredentialsHistory returns the admin's recent credentials
// lifecycle events (created/updated/removed/restored) newest first.
func (s *Server) ListCredentialsHistory(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	limit := intParam(r, "limit", 25)
	items, err := s.Store.ListCredentialsHistory(r.Context(), uid, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}