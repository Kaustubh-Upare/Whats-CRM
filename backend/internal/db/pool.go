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

func New(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 25
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 5 * time.Minute
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := p.Ping(ctx); err != nil {
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
