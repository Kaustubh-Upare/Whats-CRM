package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

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
		// Don't leak whether the email exists — same error as wrong password.
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if !u.IsActive {
		writeErr(w, http.StatusForbidden, "account disabled")
		return
	}
	// OAuth-only accounts have no password (PasswordHash is NULL in the
	// DB). Reject the password-login attempt with a 401 instead of
	// passing an empty hash into bcrypt, which would always fail with a
	// confusing "invalid credentials" message that hides the real cause.
	if u.PasswordHash == nil || *u.PasswordHash == "" {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if err := auth.CheckPassword(*u.PasswordHash, req.Password); err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	issuer := auth.NewIssuer(s.Cfg.JWTSecret, s.Cfg.JWTAudience)
	tok, err := issuer.Issue(u.ID, u.Email, u.Role, u.Name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token error")
		return
	}
	// Secure cookie in production (HTTPS); Lax in dev so the cookie still
	// travels back over http://localhost.
	secure := s.Cfg.IsProduction()
	sameSite := http.SameSiteLaxMode
	if secure {
		sameSite = http.SameSiteStrictMode
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "bc_token",
		Value:    tok,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: sameSite,
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
	hasCreds, _ := s.Store.HasWhatsAppCredentials(r.Context(), uid)
	// Look up the admin row so we can surface oauth_provider / avatar_url.
	// We use the email from the JWT as the lookup key (the auth middleware
	// already verified it).
	admin, _ := s.Store.GetAdminByEmail(r.Context(), strings.ToLower(middleware.Email(r)))
	resp := map[string]any{
		"id":                  uid,
		"email":               middleware.Email(r),
		"role":                middleware.Role(r),
		"name":                middleware.Name(r),
		"whatsapp_configured": hasCreds,
	}
	if admin != nil {
		if admin.OAuthProvider != nil {
			resp["oauth_provider"] = *admin.OAuthProvider
		}
		if admin.AvatarURL != nil {
			resp["avatar_url"] = *admin.AvatarURL
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// PutMyProfile updates the calling admin's display name and workspace
// label. The email + role are immutable from this endpoint — those are
// identity-level fields, not profile preferences.
type putMyProfileReq struct {
	Name          string `json:"name"`
	WorkspaceName string `json:"workspace_name"`
}

func (s *Server) PutMyProfile(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r)
	if uid == 0 {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req putMyProfileReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	ws := strings.TrimSpace(req.WorkspaceName)
	if ws == "" {
		writeErr(w, http.StatusBadRequest, "workspace_name cannot be empty")
		return
	}
	if len(ws) > 80 {
		writeErr(w, http.StatusBadRequest, "workspace_name too long (max 80 chars)")
		return
	}
	u, err := s.Store.UpdateMyProfile(r.Context(), uid, req.Name, ws)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if u == nil {
		writeErr(w, http.StatusNotFound, "admin not found")
		return
	}
	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &u.ID, ActorEmail: &u.Email,
		Action: "auth.profile.updated", EntityType: strPtr("admin_user"), EntityID: &u.ID,
		Metadata: map[string]any{"workspace_name": ws},
		IPAddress: &ip, UserAgent: &ua,
	})
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) Logout(w http.ResponseWriter, r *http.Request) {
	secure := s.Cfg.IsProduction()
	http.SetCookie(w, &http.Cookie{
		Name: "bc_token", Value: "", Path: "/",
		Secure: secure, HttpOnly: true, SameSite: http.SameSiteLaxMode,
		MaxAge: -1,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func strPtr(s string) *string { return &s }
func int64Ptr(v int64) *int64  { return &v }

// ---------- Google OAuth ----------

// GoogleStatus is a tiny JSON helper for the frontend to know whether
// "Continue with Google" should be enabled. We never tell the client
// the secret, just whether the server is ready.
type googleStatus struct {
	Enabled     bool   `json:"enabled"`
	StartURL    string `json:"start_url"`
	RedirectURL string `json:"redirect_url,omitempty"`
	ClientID    string `json:"client_id,omitempty"`
}

// GoogleStatus returns whether the OAuth client is configured and the
// URL the browser should hit to start the flow. The frontend uses this
// to render the "Continue with Google" button (or a disabled state).
//
// We also surface the redirect URL and client id so the operator can
// verify against Google Cloud Console when a redirect_uri_mismatch
// error appears — copy-paste beats hunting through env files.
func (s *Server) GoogleStatus(w http.ResponseWriter, r *http.Request) {
	resp := googleStatus{
		Enabled:  s.Google.Enabled(),
		StartURL: "/auth/google/start",
	}
	if s.Google.Enabled() {
		resp.RedirectURL = s.Google.RedirectURL
		resp.ClientID = s.Google.ClientID
	}
	writeJSON(w, http.StatusOK, resp)
}

// GoogleLogin starts the OAuth dance. It generates a CSRF state token,
// stores it server-side (in OAuthState) keyed to the post-login
// `next` path, and 302s the browser to Google.
//
// We use a server-side state map instead of a cookie because the dev
// Vite proxy sometimes drops Set-Cookie headers on cross-origin
// responses, which would leave the callback reading a missing state
// cookie. With the in-memory map, the `state` URL parameter that
// Google echoes back is sufficient — the cookie is decorative.
func (s *Server) GoogleLogin(w http.ResponseWriter, r *http.Request) {
	if !s.Google.Enabled() {
		http.Error(w, "Google sign-in is not configured on this server", http.StatusNotImplemented)
		return
	}
	state, err := auth.NewStateToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not generate state")
		return
	}
	next := sanitizeNext(r.URL.Query().Get("next"))
	s.OAuthState.Put(state, next, 10*time.Minute)
	http.Redirect(w, r, s.Google.AuthCodeURL(state), http.StatusFound)
}

// GoogleCallback handles the redirect back from Google.
// 1. look up the state token in OAuthState (consumes it)
// 2. exchange the code for an access_token
// 3. fetch the userinfo profile
// 4. upsert the admin row keyed on `sub`
// 5. issue the JWT cookie + redirect to the `next` URL (default /admin)
func (s *Server) GoogleCallback(w http.ResponseWriter, r *http.Request) {
	if !s.Google.Enabled() {
		http.Error(w, "Google sign-in is not configured on this server", http.StatusNotImplemented)
		return
	}
	q := r.URL.Query()
	if errMsg := q.Get("error"); errMsg != "" {
		// User clicked "Cancel" or Google refused — bounce to /login with a flag.
		http.Redirect(w, r, absoluteFrontendURL(s.Cfg.GoogleOAuthRedirectURL, "/login?google_error="+url.QueryEscape(errMsg)), http.StatusFound)
		return
	}
	code := q.Get("code")
	state := q.Get("state")
	if code == "" || state == "" {
		http.Redirect(w, r, absoluteFrontendURL(s.Cfg.GoogleOAuthRedirectURL, "/login?google_error=missing_code_or_state"), http.StatusFound)
		return
	}

	next, ok := s.OAuthState.Consume(state)
	if !ok {
		// State token wasn't issued by us, or expired (10-min TTL),
		// or was already consumed (replay).
		http.Redirect(w, r, absoluteFrontendURL(s.Cfg.GoogleOAuthRedirectURL, "/login?google_error=state_cookie_missing"), http.StatusFound)
		return
	}

	accessToken, err := s.Google.ExchangeCode(r.Context(), code)
	if err != nil {
		slogAuthError("google_exchange", err, r)
		http.Redirect(w, r, absoluteFrontendURL(s.Cfg.GoogleOAuthRedirectURL, "/login?google_error=exchange_failed"), http.StatusFound)
		return
	}
	profile, err := s.Google.FetchProfile(r.Context(), accessToken)
	if err != nil {
		slogAuthError("google_profile", err, r)
		http.Redirect(w, r, absoluteFrontendURL(s.Cfg.GoogleOAuthRedirectURL, "/login?google_error=profile_failed"), http.StatusFound)
		return
	}
	if !profile.EmailVerified {
		http.Redirect(w, r, absoluteFrontendURL(s.Cfg.GoogleOAuthRedirectURL, "/login?google_error=email_unverified"), http.StatusFound)
		return
	}

	u, err := s.Store.UpsertAdminFromGoogle(r.Context(), profile.Sub, strings.ToLower(strings.TrimSpace(profile.Email)), profile.Name, profile.Picture)
	if err != nil {
		slogAuthError("google_upsert", err, r)
		// Surface the actual DB error to the URL so the operator can see it
		// in the address bar without grepping logs. Truncated to keep the URL short.
		detail := err.Error()
		if len(detail) > 180 {
			detail = detail[:180] + "…"
		}
		http.Redirect(w, r, absoluteFrontendURL(s.Cfg.GoogleOAuthRedirectURL,
			"/login?google_error=upsert_failed&detail="+url.QueryEscape(detail)), http.StatusFound)
		return
	}
	if !u.IsActive {
		http.Redirect(w, r, absoluteFrontendURL(s.Cfg.GoogleOAuthRedirectURL, "/login?google_error=account_disabled"), http.StatusFound)
		return
	}

	issuer := auth.NewIssuer(s.Cfg.JWTSecret, s.Cfg.JWTAudience)
	tok, err := issuer.Issue(u.ID, u.Email, u.Role, u.Name)
	if err != nil {
		slogAuthError("google_issue", err, r)
		http.Redirect(w, r, absoluteFrontendURL(s.Cfg.GoogleOAuthRedirectURL, "/login?google_error=token_error"), http.StatusFound)
		return
	}

	secure := s.Cfg.IsProduction()
	sameSite := http.SameSiteLaxMode
	if secure {
		sameSite = http.SameSiteStrictMode
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "bc_token",
		Value:    tok,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: sameSite,
		MaxAge:   int(auth.TokenTTL.Seconds()),
	})
	_ = s.Store.TouchAdminLogin(r.Context(), u.ID)

	ip := middleware.IP(r)
	ua := middleware.UA(r)
	audit.Log(r.Context(), s.Store.DB, audit.Entry{
		ActorID: &u.ID, ActorEmail: &u.Email,
		Action: "auth.login.google", EntityType: strPtr("admin_user"), EntityID: &u.ID,
		IPAddress: &ip, UserAgent: &ua,
	})

	http.Redirect(w, r, absoluteFrontendURL(s.Cfg.GoogleOAuthRedirectURL, next), http.StatusFound)
}

// absoluteFrontendURL turns a relative post-login path ("/admin") into
// an absolute URL on the frontend origin. We derive the origin from the
// OAuth redirect URL because they're guaranteed to share the same host
// (that's the whole point of putting the redirect URL on the frontend).
//
// Examples (with BC_GOOGLE_REDIRECT_URL=http://localhost:5173/auth/google/callback):
//   absoluteFrontendURL(redirect, "/admin")        → http://localhost:5173/admin
//   absoluteFrontendURL(redirect, "/login?err=1")   → http://localhost:5173/login?err=1
//
// Falls back to the relative path (preserving the original behaviour)
// when the redirect URL doesn't parse cleanly.
func absoluteFrontendURL(redirectURL, relPath string) string {
	u, err := url.Parse(redirectURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return relPath
	}
	// Already absolute? (defensive — sanitizeNext should already guarantee this.)
	if strings.HasPrefix(relPath, "http://") || strings.HasPrefix(relPath, "https://") {
		return relPath
	}
	if !strings.HasPrefix(relPath, "/") {
		relPath = "/" + relPath
	}
	return u.Scheme + "://" + u.Host + relPath
}

// sanitizeNext ensures the post-login redirect points back at our own
// app. Empty / external / scheme-relative paths collapse to /admin.
func sanitizeNext(next string) string {
	if next == "" {
		return "/admin"
	}
	if !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") {
		return "/admin"
	}
	return next
}

// slogAuthError logs an OAuth error without crashing the response.
// Without this, a DB failure during the upsert silently surfaces as
// "google_error=upsert_failed" with no breadcrumb. The log line gives
// us the actual error so we can fix the underlying cause instead of
// guessing at the URL the user sees.
func slogAuthError(stage string, err error, r *http.Request) {
	if err == nil {
		return
	}
	slog.Warn("google oauth error",
		"stage", stage,
		"err", err.Error(),
		"remote_addr", r.RemoteAddr,
		"path", r.URL.Path,
	)
}

var _ = pgx.ErrNoRows // keep import (auth uses it indirectly)