package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/whatsyitc/backend/internal/auth"
)

type ctxKey int

const (
	CtxUserID ctxKey = iota
	CtxEmail
	CtxRole
	CtxName
	CtxRequestID
)

// CORS reflects the request Origin when it matches the allowlist, and
// short-circuits OPTIONS preflights. With Access-Control-Allow-Credentials
// the spec disallows the literal "*" origin, so we MUST echo the exact value.
//
// If the request has no Origin header (curl, server-to-server), no CORS
// headers are written but the request still flows through.
func CORS(allowedOrigins []string, next http.Handler) http.Handler {
	set := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		set[strings.TrimRight(o, "/")] = struct{}{}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if _, ok := set[strings.TrimRight(origin, "/")]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
				w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition")
				w.Header().Set("Access-Control-Max-Age", "600")
			}
		}
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

// MaxBytes caps the size of a request body (any method) at `n` bytes. Requests
// exceeding the cap get a 413. Useful as a defensive guard against oversize
// JSON POSTs on routes that don't otherwise set a Content-Length cap.
func MaxBytes(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, n)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequestID assigns or propagates an X-Request-Id header (16-hex) and stashes
// it on the context for downstream handlers / logs to reference.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if id == "" {
			id = newRequestID()
		}
		w.Header().Set("X-Request-Id", id)
		ctx := context.WithValue(r.Context(), CtxRequestID, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func newRequestID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// --- per-IP token-bucket rate limiter (in-memory, single-process) ---

type bucket struct {
	tokens    float64
	lastReset time.Time
}

// RateLimit allows `rps` requests/sec per key (typically the client IP),
// bursting up to `burst` in a single instant. Older buckets are GC'd every
// 5 minutes. Suitable for protecting login + sensitive endpoints behind a
// single-process backend; replace with a distributed limiter when scaling
// out beyond one node.
func RateLimit(rps float64, burst int, keyFn func(*http.Request) string) func(http.Handler) http.Handler {
	if rps <= 0 {
		rps = 1
	}
	if burst <= 0 {
		burst = 1
	}
	var (
		mu      sync.Mutex
		buckets = make(map[string]*bucket)
		lastGC  = time.Now()
	)
	gc := func(now time.Time) {
		if now.Sub(lastGC) < 5*time.Minute {
			return
		}
		lastGC = now
		for k, b := range buckets {
			if now.Sub(b.lastReset) > 10*time.Minute {
				delete(buckets, k)
			}
		}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			k := keyFn(r)
			if k == "" {
				next.ServeHTTP(w, r)
				return
			}
			now := time.Now()
			mu.Lock()
			b, ok := buckets[k]
			if !ok {
				b = &bucket{tokens: float64(burst), lastReset: now}
				buckets[k] = b
			}
			// Refill: rps tokens per second since last touch, capped at burst.
			elapsed := now.Sub(b.lastReset).Seconds()
			b.tokens += elapsed * rps
			if b.tokens > float64(burst) {
				b.tokens = float64(burst)
			}
			b.lastReset = now
			if b.tokens < 1 {
				mu.Unlock()
				w.Header().Set("Retry-After", "1")
				http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
				return
			}
			b.tokens--
			gc(now)
			mu.Unlock()
			next.ServeHTTP(w, r)
		})
	}
}

// ClientIP returns the most plausible client IP: the first entry of
// X-Forwarded-For if a trusted proxy set it, otherwise RemoteAddr's host part.
func ClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	if xrip := r.Header.Get("X-Real-IP"); xrip != "" {
		return strings.TrimSpace(xrip)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func UserID(r *http.Request) int64   { v, _ := r.Context().Value(CtxUserID).(int64); return v }
func Email(r *http.Request) string   { v, _ := r.Context().Value(CtxEmail).(string); return v }
func Role(r *http.Request) string    { v, _ := r.Context().Value(CtxRole).(string); return v }
func Name(r *http.Request) string    { v, _ := r.Context().Value(CtxName).(string); return v }
func RequestIDOf(r *http.Request) string {
	v, _ := r.Context().Value(CtxRequestID).(string)
	return v
}
func IP(r *http.Request) string  { return ClientIP(r) }
func UA(r *http.Request) string  { return r.UserAgent() }