package config

import (
	"log"
	"os"
	"strconv"
	"strings"
)

// IsProduction reports whether the server is running in production mode.
// Used to flip behaviour that should differ between dev and prod (e.g. cookie
// Secure flag, structured JSON logs, dev-only routes).
func (c *Config) IsProduction() bool { return strings.EqualFold(c.Env, "production") }

// AllowedOrigins returns the normalized list of origins permitted for CORS.
// Honors both FRONTEND_URLS (comma-separated allowlist, recommended for prod)
// and FRONTEND_URL (single origin, back-compat with the dev setup).
func (c *Config) AllowedOrigins() []string {
	raw := os.Getenv("FRONTEND_URLS")
	if raw == "" {
		raw = c.FrontendURL
	}
	var out []string
	for _, o := range strings.Split(raw, ",") {
		o = strings.TrimSpace(o)
		o = strings.TrimRight(o, "/")
		if o != "" {
			out = append(out, o)
		}
	}
	if len(out) == 0 {
		out = []string{"http://localhost:5173"}
	}
	return out
}

type Config struct {
	Port              string
	FrontendURL       string
	Env               string
	UploadDir         string
	MaxUploadBytes    int64
	MaxJSONBytes      int64 // cap for JSON request bodies (defends against oversize POSTs)
	BcryptCost        int
	WorkerConcurrency int
	JWTAudience       string
	JWTSecret         string
	LoginRPS          float64 // sustained login requests/sec per IP
	LoginBurst        int     // login burst size per IP

	PostgresURI string

	WhatsAPIVersion  string
	WhatsPhoneID     string
	WhatsAccessToken string
	WhatsVerifyToken string
	WhatsForceText   bool // WHATS_FORCE_TEXT=true => skip template, send as free-form text (test-mode only)
}

func Load() *Config {
	c := &Config{
		Port:              getEnv("PORT", "8082"),
		FrontendURL:       getEnv("FRONTEND_URL", "http://localhost:5173"),
		Env:               getEnv("ENV", "development"),
		UploadDir:         getEnv("BC_UPLOAD_DIR", "./uploads"),
		MaxUploadBytes:    getInt64("BC_MAX_UPLOAD_BYTES", 25*1024*1024),
		MaxJSONBytes:      getInt64("BC_MAX_JSON_BYTES", 1*1024*1024),
		BcryptCost:        getInt("BC_BCRYPT_COST", 10),
		WorkerConcurrency: getInt("BC_WORKER_CONCURRENCY", 4),
		JWTAudience:       getEnv("BC_JWT_AUDIENCE", "whatsyitc-admin"),
		PostgresURI:       os.Getenv("POSTGRES_URI"),
		JWTSecret:         firstNonEmpty(os.Getenv("BC_JWT_SECRET"), os.Getenv("JWT_SECRET")),
		WhatsAPIVersion:   getEnv("WHATS_API_VERSION", "v18.0"),
		WhatsPhoneID:      os.Getenv("WHATS_PHONE_NUMBER_ID"),
		WhatsAccessToken:  os.Getenv("WHATS_ACCESS_TOKEN"),
		WhatsVerifyToken:  os.Getenv("WHATS_VERIFY_TOKEN"),
		WhatsForceText:    getBool("WHATS_FORCE_TEXT", false),
		LoginRPS:          getFloat("BC_LOGIN_RPS", 1),
		LoginBurst:        getInt("BC_LOGIN_BURST", 5),
	}
	if c.PostgresURI == "" {
		log.Fatal("POSTGRES_URI is required (copy from backend/.env.example)")
	}
	if c.JWTSecret == "" {
		log.Fatal("BC_JWT_SECRET is required")
	}
	if len(c.JWTSecret) < 32 {
		// HS256 with a short key is brute-forceable; refuse to boot rather than
		// silently serving a weak-secret deployment.
		log.Fatalf("BC_JWT_SECRET must be at least 32 bytes (got %d). Generate with: openssl rand -base64 48", len(c.JWTSecret))
	}
	if c.BcryptCost < 4 || c.BcryptCost > 31 {
		log.Fatalf("BC_BCRYPT_COST must be between 4 and 31 (got %d)", c.BcryptCost)
	}
	if c.WorkerConcurrency < 1 {
		log.Fatalf("BC_WORKER_CONCURRENCY must be >= 1 (got %d)", c.WorkerConcurrency)
	}
	return c
}

func getEnv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
func getInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
func getInt64(k string, def int64) int64 {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return def
}
func getFloat(k string, def float64) float64 {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			return n
		}
	}
	return def
}
func getBool(k string, def bool) bool {
	if v := os.Getenv(k); v != "" {
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "1", "true", "yes", "y", "on":
			return true
		case "0", "false", "no", "n", "off":
			return false
		}
	}
	return def
}
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}