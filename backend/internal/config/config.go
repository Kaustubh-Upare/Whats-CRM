package config

import (
	"log"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port              string
	FrontendURL       string
	Env               string
	UploadDir         string
	MaxUploadBytes    int64
	BcryptCost        int
	WorkerConcurrency int
	PostgresURI       string
	JWTSecret         string

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
		BcryptCost:        getInt("BC_BCRYPT_COST", 10),
		WorkerConcurrency: getInt("BC_WORKER_CONCURRENCY", 4),
		PostgresURI:       os.Getenv("POSTGRES_URI"),
		JWTSecret:         firstNonEmpty(os.Getenv("BC_JWT_SECRET"), os.Getenv("JWT_SECRET")),
		WhatsAPIVersion:   getEnv("WHATS_API_VERSION", "v18.0"),
		WhatsPhoneID:      os.Getenv("WHATS_PHONE_NUMBER_ID"),
		WhatsAccessToken:  os.Getenv("WHATS_ACCESS_TOKEN"),
		WhatsVerifyToken:  os.Getenv("WHATS_VERIFY_TOKEN"),
		WhatsForceText:    getBool("WHATS_FORCE_TEXT", false),
	}
	if c.PostgresURI == "" {
		log.Fatal("POSTGRES_URI is required (copy from backend/.env.example)")
	}
	if c.JWTSecret == "" {
		log.Fatal("BC_JWT_SECRET is required")
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
