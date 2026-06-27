-- Migration 008 - AI assistant phase 1
--
-- Adds the backend storage needed by the existing React pages under
-- /admin/ai. The first phase keeps retrieval local and deterministic:
-- config is stored per admin, and knowledge chunks are searched by keyword.

CREATE TABLE IF NOT EXISTS bc_ai_agent_configs (
    admin_user_id             BIGINT PRIMARY KEY REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    enabled                   BOOLEAN NOT NULL DEFAULT FALSE,
    name                      TEXT NOT NULL DEFAULT 'Riya',
    persona_md                TEXT NOT NULL DEFAULT '',
    tone                      TEXT NOT NULL DEFAULT 'friendly',
    languages                 TEXT[] NOT NULL DEFAULT ARRAY['en']::TEXT[],
    working_hours             JSONB NOT NULL DEFAULT '{}'::jsonb,
    handoff_rules             JSONB NOT NULL DEFAULT '{}'::jsonb,
    primary_model             TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    fallback_models           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    premium_model             TEXT NOT NULL DEFAULT 'gpt-4o',
    faq_confidence_threshold  DOUBLE PRECISION NOT NULL DEFAULT 0.72
                              CHECK (faq_confidence_threshold >= 0 AND faq_confidence_threshold <= 1),
    system_prompt             TEXT NOT NULL DEFAULT 'You are a helpful WhatsApp assistant for this business. Answer clearly, stay concise, and ask for a human handoff when confidence is low.',
    qualification_criteria    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bc_ai_kb_chunks (
    id             BIGSERIAL PRIMARY KEY,
    admin_user_id  BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    title          TEXT,
    content        TEXT NOT NULL,
    source_type    TEXT NOT NULL DEFAULT 'manual',
    source_ref     TEXT,
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_ai_kb_chunks_admin_updated
    ON bc_ai_kb_chunks (admin_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bc_ai_kb_chunks_admin_source
    ON bc_ai_kb_chunks (admin_user_id, source_type);

CREATE INDEX IF NOT EXISTS idx_bc_ai_kb_chunks_title_trgm_fallback
    ON bc_ai_kb_chunks (admin_user_id, lower(coalesce(title, '')));
