-- Migration 024 - Async knowledge import jobs.
--
-- Large knowledge documents should not be processed inside one long HTTP
-- request. This table lets the UI start an import, poll progress, and see
-- the exact chunks created when the background worker finishes.

CREATE TABLE IF NOT EXISTS bc_ai_kb_import_jobs (
    id                  BIGSERIAL PRIMARY KEY,
    admin_user_id       BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    source_type         TEXT NOT NULL DEFAULT 'text',
    source_name         TEXT NOT NULL DEFAULT '',
    source_chars        INTEGER NOT NULL DEFAULT 0,
    input_text          TEXT,
    max_chunks          INTEGER NOT NULL DEFAULT 250,
    total_sections      INTEGER NOT NULL DEFAULT 0,
    processed_sections  INTEGER NOT NULL DEFAULT 0,
    created_count       INTEGER NOT NULL DEFAULT 0,
    created_ids         BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
    titles              JSONB NOT NULL DEFAULT '[]'::jsonb,
    warnings            JSONB NOT NULL DEFAULT '[]'::jsonb,
    error               TEXT,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_ai_kb_import_jobs_admin_updated
    ON bc_ai_kb_import_jobs (admin_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bc_ai_kb_import_jobs_admin_status
    ON bc_ai_kb_import_jobs (admin_user_id, status, updated_at DESC);
