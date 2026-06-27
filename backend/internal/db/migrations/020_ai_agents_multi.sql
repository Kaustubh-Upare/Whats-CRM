-- Migration 020 - Multi-agent AI configuration
--
-- Converts the singleton per-admin bc_ai_agent_configs table into a
-- multi-agent bc_ai_agents table with id BIGSERIAL, is_default flag, and
-- a partial unique index that enforces exactly one default per admin.
--
-- Adds bc_upload_batches.ai_agent_id so a batch can be assigned to a
-- specific agent. When null, the batch inherits the global default.
-- ON DELETE SET NULL keeps live batches functional even if their
-- assigned agent is deleted.
--
-- Idempotent (CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS) so
-- re-runs against a fresh DB are safe.

BEGIN;

-- 1. New table. Same shape as the legacy table + id PK + is_default.
CREATE TABLE IF NOT EXISTS bc_ai_agents (
    id                       BIGSERIAL PRIMARY KEY,
    admin_user_id            BIGINT NOT NULL
                             REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    enabled                  BOOLEAN NOT NULL DEFAULT FALSE,
    name                     TEXT NOT NULL DEFAULT 'Riya',
    persona_md               TEXT NOT NULL DEFAULT '',
    tone                     TEXT NOT NULL DEFAULT 'friendly',
    languages                TEXT[] NOT NULL DEFAULT ARRAY['en']::TEXT[],
    working_hours            JSONB NOT NULL DEFAULT '{}'::jsonb,
    handoff_rules            JSONB NOT NULL DEFAULT '{}'::jsonb,
    primary_model            TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    fallback_models          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    premium_model            TEXT NOT NULL DEFAULT 'gpt-4o',
    faq_confidence_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.72
                             CHECK (faq_confidence_threshold >= 0
                                    AND faq_confidence_threshold <= 1),
    system_prompt            TEXT NOT NULL DEFAULT
        'You are a helpful WhatsApp assistant for this business. '
        || 'Answer clearly, stay concise, and ask for a human handoff '
        || 'when confidence is low.',
    qualification_criteria   JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_default               BOOLEAN NOT NULL DEFAULT FALSE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Backfill from the legacy table. Each existing row (one per admin)
--    becomes one new row, marked as the global default. Idempotent: if
--    the legacy table doesn't exist (fresh DB), the SELECT is empty.
INSERT INTO bc_ai_agents (
    admin_user_id, enabled, name, persona_md, tone, languages,
    working_hours, handoff_rules, primary_model, fallback_models,
    premium_model, faq_confidence_threshold, system_prompt,
    qualification_criteria, is_default, created_at, updated_at
)
SELECT
    c.admin_user_id, c.enabled, c.name, c.persona_md, c.tone, c.languages,
    c.working_hours, c.handoff_rules, c.primary_model, c.fallback_models,
    c.premium_model, c.faq_confidence_threshold, c.system_prompt,
    c.qualification_criteria, TRUE, c.created_at, c.updated_at
FROM bc_ai_agent_configs c
WHERE NOT EXISTS (
    SELECT 1 FROM bc_ai_agents a
    WHERE a.admin_user_id = c.admin_user_id AND a.is_default = TRUE
);

-- 3. Per-admin default uniqueness. Partial index keeps the constraint
--    cheap (only default rows are indexed).
CREATE UNIQUE INDEX IF NOT EXISTS uq_bc_ai_agents_one_default
    ON bc_ai_agents (admin_user_id) WHERE is_default;

-- 4. Per-batch agent assignment. Nullable FK with ON DELETE SET NULL
--    so deleting an agent gracefully returns affected batches to the
--    global default without breaking the live batch row. Note
--    bc_upload_batches is owned via uploaded_by (not admin_user_id)
--    — see migration 004. The store layer filters by
--    uploaded_by=$adminID OR uploaded_by IS NULL.
ALTER TABLE bc_upload_batches
    ADD COLUMN IF NOT EXISTS ai_agent_id BIGINT
    REFERENCES bc_ai_agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bc_upload_batches_ai_agent
    ON bc_upload_batches (ai_agent_id) WHERE ai_agent_id IS NOT NULL;

-- 5. updated_at trigger (mirrors the bc_bcai_touch pattern in 015).
CREATE OR REPLACE FUNCTION bc_ai_agents_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bc_ai_agents_touch ON bc_ai_agents;
CREATE TRIGGER trg_bc_ai_agents_touch
    BEFORE UPDATE ON bc_ai_agents
    FOR EACH ROW EXECUTE FUNCTION bc_ai_agents_touch_updated_at();

-- 6. Drop the legacy table. No other table FKs to it (verified across
--    migrations 001-019; only the orchestrator and the agent editor
--    read it by name). Backfill is complete and idempotent.
DROP TABLE IF EXISTS bc_ai_agent_configs;

COMMIT;
