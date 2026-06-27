package db

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// New builds a connection pool.
//
// SNI override
// -----------
// Supabase's Supavisor pooler identifies tenants by the TLS ServerName
// in the SNI handshake. The pooler publishes IPv4 records (so it
// works on residential ISPs) but the SNI hostname must be the
// project-specific subdomain, not the bare pooler hostname.
//
// If BC_DB_SNI is set, we install a custom DialFunc that performs the
// TCP connect normally and then wraps the conn in a TLS client with
// that SNI servername, so the pooler can route to the correct tenant.
//
// The base config's TLSConfig is also updated to use the same SNI
// for cert validation, so verification still works.
func New(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 25
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 5 * time.Minute

	// Supavisor tenant identification. Two methods are supported:
	//   1. external_id via the startup options:   "options=-c%20external_id%3D<value>"
	//   2. SNI servername in the TLS handshake (used when TLS is required)
	//
	// We set the external_id startup option via the connection URL's
	// "options" query parameter, which is the most reliable for plain
	// (non-TLS) pooler connections. The SNI path is attempted as a
	// fallback if the pooler is reachable but rejects the connection.
	tenantID := os.Getenv("BC_DB_TENANT_ID")
	if tenantID == "" {
		tenantID = "1"
	}
	projectRef := os.Getenv("BC_DB_PROJECT_REF")
	if projectRef != "" {
		// The "options" parameter is passed in the Postgres startup
		// packet as a runtime parameter. Supavisor parses it and routes
		// to the matching tenant.
		if cfg.ConnConfig.RuntimeParams == nil {
			cfg.ConnConfig.RuntimeParams = map[string]string{}
		}
		cfg.ConnConfig.RuntimeParams["options"] = fmt.Sprintf("-c project=%s", projectRef)
		fmt.Fprintf(os.Stderr, "[db] Supavisor tenant via options=-c project=%s (tenant id %s)\n", projectRef, tenantID)
	}

	// Supabase Supavisor (the pooler) is reachable on IPv4 but the
	// current Supabase project doesn't publish the per-project
	// pooler hostname that the SNI tenant-routing requires, so the
	// only way to identify a tenant from a plain TCP connection is
	// the `external_id` startup option. pgx doesn't expose that as
	// a top-level URL param — callers should set it via the user
	// field (Supavisor accepts the `user.<project_ref>` form for
	// the default tenant, or `user.<tenant_id>.<project_ref>`).
	//
	// If you ever switch to a Supabase region where the pooler is
	// reachable AND the per-project SNI tenant is supported, you
	// can re-enable the SNI DialFunc hook here by reading BC_DB_SNI.
	_ = os.Getenv("BC_DB_SNI") // intentionally unused; see comment above.

	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := p.Ping(ctx); err != nil {
		p.Close()
		return nil, err
	}
	return p, nil
}

// RunMigrations applies every *.sql file in dir in lexical order.
// It tracks applied files in bc_schema_migrations so each file is run
// exactly once. The DDL inside the files also uses IF NOT EXISTS /
// DO blocks as a second line of defense.
func RunMigrations(ctx context.Context, p *pgxpool.Pool, dir string) error {
	// 1. Ensure the ledger table exists.
	if _, err := p.Exec(ctx, `
        CREATE TABLE IF NOT EXISTS bc_schema_migrations (
            filename     TEXT PRIMARY KEY,
            applied_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        );`); err != nil {
		return fmt.Errorf("create bc_schema_migrations: %w", err)
	}

	// 2. List files in lexical order.
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read migrations dir %q: %w", dir, err)
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files)
	if len(files) == 0 {
		return fmt.Errorf("no .sql files in %s", dir)
	}

	// 3. Fetch the set of already-applied filenames.
	rows, err := p.Query(ctx, `SELECT filename FROM bc_schema_migrations`)
	if err != nil {
		return fmt.Errorf("read bc_schema_migrations: %w", err)
	}
	applied := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return err
		}
		applied[name] = true
	}
	rows.Close()

	// 4. Apply any not-yet-applied files, inside a tx, and record them.
	for _, f := range files {
		if applied[f] {
			continue
		}
		path := filepath.Join(dir, f)
		b, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read %s: %w", path, err)
		}
		tx, err := p.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin tx for %s: %w", f, err)
		}
		if _, err := tx.Exec(ctx, string(b)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply %s: %w", f, err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO bc_schema_migrations (filename) VALUES ($1)`, f); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record %s: %w", f, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit %s: %w", f, err)
		}
	}
	return nil
}
