// cmd/seed bootstraps the first admin user and a default template.
//
//   go run ./cmd/seed --email admin@your-domain.com --password 'YOUR_PASSWORD' --name "Your Admin"
//
// Idempotent: re-running with the same email updates the password hash.
// Honours BC_BCRYPT_COST from env (defaults to 10).
package main

import (
	"context"
	"flag"
	"log"
	"os"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/whatsyitc/backend/internal/auth"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	_ = godotenv.Load()

	email := flag.String("email", "admin@whatsyitc.local", "admin email")
	password := flag.String("password", "admin123", "admin password")
	name := flag.String("name", "Demo Admin", "display name")
	role := flag.String("role", "admin", "role")
	flag.Parse()

	cost := bcrypt.DefaultCost
	if v := os.Getenv("BC_BCRYPT_COST"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= bcrypt.MinCost && n <= bcrypt.MaxCost {
			cost = n
		}
	}

	uri := os.Getenv("POSTGRES_URI")
	if uri == "" {
		log.Fatal("POSTGRES_URI not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, uri)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	hash, err := auth.HashPassword(*password, cost)
	if err != nil {
		log.Fatalf("hash: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO bc_admin_users (email, password_hash, name, role)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, name=EXCLUDED.name, role=EXCLUDED.role
	`, *email, hash, *name, *role)
	if err != nil {
		log.Fatalf("upsert admin: %v", err)
	}
	log.Printf("[seed] admin user ready: %s", *email)

	// seed the default Utility template (idempotent). Body uses real newlines so
	// the chat bubble renders with the same line breaks the recipient sees on
	// their phone.
	_, err = pool.Exec(ctx, `
		INSERT INTO bc_templates (name, language_code, category, body, variable_count, sample_payload, is_active)
		VALUES ('billing_summary_v1','en','utility',
		        E'Hello {{1}},\n\nYour billing summary for {{2}}.\n\nInvoice: {{3}}\nAmount: INR {{4}}\nDue Date: {{5}}\n\nFor billing queries, contact {{6}}.',
		        6,
		        '{"1":"Ramesh","2":"2026-06-18","3":"INV-2026-001","4":"12500.50","5":"2026-06-25","6":"support@itc.example"}'::jsonb,
		        TRUE)
		ON CONFLICT (name, language_code) DO UPDATE
		  SET body=EXCLUDED.body, variable_count=EXCLUDED.variable_count,
		      sample_payload=EXCLUDED.sample_payload, is_active=TRUE
	`)
	if err != nil {
		log.Fatalf("upsert template: %v", err)
	}
	log.Printf("[seed] default template 'billing_summary_v1' (en) ready")
}
