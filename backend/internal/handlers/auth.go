package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/whatsyitc/backend/internal/audit"
	"github.com/whatsyitc/backend/internal/auth"
	"github.com/whatsyitc/backend/internal/middleware"
	"github.com/jackc/pgx/v5"
)

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Server) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req loginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.Email == "" || req.Password == "" {
		writeErr(w, http.StatusBadRequest, "email and password required")
		return
	}
	ctx := r.Context()
	u, err := s.Store.GetAdminByEmail(ctx, req.Email)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if !u.IsActive {
		writeErr(w, http.StatusForbidden, "account disabled")
		return
	}
	if err := auth.CheckPassword(u.PasswordHash, req.Password); err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	issuer := auth.NewIssuer(s.Cfg.JWTSecret)
	tok, err := issuer.Issue(u.ID, u.Email, u.Role, u.Name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token error")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "bc_token",
		Value:    tok,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(auth.TokenTTL.Seconds()),
	})
	_ = s.Store.TouchAdminLogin(ctx, u.ID)
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(ctx, s.Store.DB, audit.Entry{
		ActorID: &u.ID, ActorEmail: &u.Email,
		Action: "auth.login", EntityType: strPtr("admin_user"), EntityID: &u.ID,
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"token": tok,
		"user":  map[string]any{"id": u.ID, "email": u.Email, "name": u.Name, "role": u.Role},
	})
}

func (s *Server) Me(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	if uid == 0 {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": uid, "email": middleware.Email(r), "role": middleware.Role(r), "name": middleware.Name(r),
	})
}

func (s *Server) Logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: "bc_token", Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func strPtr(s string) *string { return &s }

var _ = pgx.ErrNoRows // keep import (auth uses it indirectly)
