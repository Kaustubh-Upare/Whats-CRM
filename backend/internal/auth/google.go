// Package auth — Google OAuth helpers.
//
// The implementation deliberately avoids the official `golang.org/x/oauth2`
// and `google.golang.org/api` modules so we don't pull in extra deps for
// two HTTP calls. We use Google's OIDC discovery document to find the
// token + userinfo endpoints, and we trust the `sub` claim as the
// stable Google user id.
//
// The flow is:
//
//   1. Frontend redirects to /auth/google?next=/admin
//   2. Handler mints a CSRF state token (16 random bytes hex), stores
//      it in a short-lived cookie, and redirects the browser to
//      https://accounts.google.com/o/oauth2/v2/auth...
//   3. Google calls /auth/google/callback?code=...&state=...
//   4. Handler validates the state cookie, exchanges the code for an
//      access_token, fetches the userinfo, upserts an admin row keyed
//      on `sub`, issues a JWT cookie, and redirects to `next` (or /admin).
//
// All errors get rendered as a tiny HTML page that links back to /login
// with a query string the frontend can read and toast.
package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// GoogleProfile is the slim subset of the Google userinfo response we
// need to upsert an admin.
type GoogleProfile struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

// GoogleClient wraps the minimal OAuth dance.
type GoogleClient struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	// Allow overriding the endpoints for tests / proxies.
	AuthEndpoint     string
	TokenEndpoint    string
	UserinfoEndpoint string
	HTTP             *http.Client
}

// NewGoogleClient fills in the standard Google endpoints when the
// caller leaves them blank. httpClient is reused for both the token
// exchange and the userinfo fetch — short timeout keeps login snappy.
func NewGoogleClient(clientID, clientSecret, redirectURL string) *GoogleClient {
	c := &GoogleClient{
		ClientID:         clientID,
		ClientSecret:     clientSecret,
		RedirectURL:      redirectURL,
		AuthEndpoint:     "https://accounts.google.com/o/oauth2/v2/auth",
		TokenEndpoint:    "https://oauth2.googleapis.com/token",
		UserinfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
		HTTP:             &http.Client{Timeout: 10 * time.Second},
	}
	return c
}

// Enabled reports whether the client has enough config to start an
// OAuth flow. The /login page reads this through the handler so the
// "Continue with Google" button can render a disabled state when the
// server hasn't been configured yet.
func (c *GoogleClient) Enabled() bool {
	return c != nil && c.ClientID != "" && c.ClientSecret != "" && c.RedirectURL != ""
}

// AuthCodeURL returns the URL the browser should be redirected to.
func (c *GoogleClient) AuthCodeURL(state string) string {
	v := url.Values{}
	v.Set("client_id", c.ClientID)
	v.Set("redirect_uri", c.RedirectURL)
	v.Set("response_type", "code")
	v.Set("scope", "openid email profile")
	v.Set("access_type", "online")
	v.Set("state", state)
	v.Set("prompt", "select_account")
	return c.AuthEndpoint + "?" + v.Encode()
}

// ExchangeCode trades the auth code from Google's callback for tokens.
func (c *GoogleClient) ExchangeCode(ctx context.Context, code string) (string, error) {
	if !c.Enabled() {
		return "", errors.New("google oauth not configured")
	}
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", c.ClientID)
	form.Set("client_secret", c.ClientSecret)
	form.Set("redirect_uri", c.RedirectURL)
	form.Set("grant_type", "authorization_code")

	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.TokenEndpoint, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("token exchange failed: %d %s", resp.StatusCode, string(body))
	}
	var out struct {
		AccessToken string `json:"access_token"`
		IDToken     string `json:"id_token"`
		ExpiresIn   int    `json:"expires_in"`
		Scope       string `json:"scope"`
		TokenType   string `json:"token_type"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", err
	}
	if out.AccessToken == "" {
		return "", errors.New("token exchange returned empty access_token")
	}
	return out.AccessToken, nil
}

// FetchProfile calls the userinfo endpoint with the access token.
func (c *GoogleClient) FetchProfile(ctx context.Context, accessToken string) (*GoogleProfile, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.UserinfoEndpoint, nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("userinfo failed: %d %s", resp.StatusCode, string(body))
	}
	var p GoogleProfile
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, err
	}
	if p.Sub == "" {
		return nil, errors.New("userinfo missing sub claim")
	}
	return &p, nil
}

// NewStateToken returns a 32-character hex string suitable for use as
// the OAuth `state` parameter and as a CSRF cookie value.
func NewStateToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}