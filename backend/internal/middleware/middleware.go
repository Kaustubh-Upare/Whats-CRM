package middleware

import (
	"context"
	"net/http"

	"github.com/whatsyitc/backend/internal/auth"
)

type ctxKey int

const (
	CtxUserID ctxKey = iota
	CtxEmail
	CtxRole
	CtxName
)

func CORS(frontendURL string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", frontendURL)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// JWTAuth validates the token from Authorization header (or bc_token cookie),
// and stuffs uid/email/role/name into the request context.
func JWTAuth(issuer *auth.Issuer) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tok := auth.ExtractBearer(r.Header.Get("Authorization"))
			if tok == "" {
				if c, err := r.Cookie("bc_token"); err == nil {
					tok = c.Value
				}
			}
			if tok == "" {
				http.Error(w, `{"error":"missing token"}`, http.StatusUnauthorized)
				return
			}
			c, err := issuer.Parse(tok)
			if err != nil {
				http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
				return
			}
			ctx := r.Context()
			ctx = context.WithValue(ctx, CtxUserID, c.UserID)
			ctx = context.WithValue(ctx, CtxEmail, c.Email)
			ctx = context.WithValue(ctx, CtxRole, c.Role)
			ctx = context.WithValue(ctx, CtxName, c.Name)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func UserID(r *http.Request) int64    { v, _ := r.Context().Value(CtxUserID).(int64); return v }
func Email(r *http.Request) string    { v, _ := r.Context().Value(CtxEmail).(string); return v }
func Role(r *http.Request) string     { v, _ := r.Context().Value(CtxRole).(string); return v }
func Name(r *http.Request) string     { v, _ := r.Context().Value(CtxName).(string); return v }
func IP(r *http.Request) string       { return r.RemoteAddr }
func UA(r *http.Request) string       { return r.UserAgent() }
