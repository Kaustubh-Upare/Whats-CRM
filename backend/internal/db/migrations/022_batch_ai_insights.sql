-- Migration 022 - Persist AI follow-up CRM insight per batch.
--
-- The AI CRM overview should not have to call the LLM every time an
-- operator opens the page. This table stores the latest generated
-- summary, action-required signal, and recommended next move for each
-- AI-enabled batch.

CREATE TABLE IF NOT EXISTS bc_batch_ai_insights (
    id                 BIGSERIAL PRIMARY KEY,
    admin_user_id      BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    batch_id           BIGINT NOT NULL REFERENCES bc_upload_batches(id) ON DELETE CASCADE,
    summary            TEXT NOT NULL DEFAULT '',
    mood               TEXT NOT NULL DEFAULT 'mixed',
    buyer_intent       TEXT NOT NULL DEFAULT 'unknown',
    action_required    BOOLEAN NOT NULL DEFAULT FALSE,
    action_reason      TEXT NOT NULL DEFAULT '',
    priority_score     INT NOT NULL DEFAULT 0,
    recommended_action TEXT NOT NULL DEFAULT '',
    what_happened      JSONB NOT NULL DEFAULT '[]'::jsonb,
    risks              JSONB NOT NULL DEFAULT '[]'::jsonb,
    next_actions       JSONB NOT NULL DEFAULT '[]'::jsonb,
    warm_leads         JSONB NOT NULL DEFAULT '[]'::jsonb,
    labels             JSONB NOT NULL DEFAULT '[]'::jsonb,
    history_limit      INT NOT NULL DEFAULT 20,
    history_used       INT NOT NULL DEFAULT 0,
    model              TEXT NOT NULL DEFAULT '',
    provider           TEXT NOT NULL DEFAULT '',
    last_message_at    TIMESTAMPTZ,
    last_analyzed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    generated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    generation_error   TEXT NOT NULL DEFAULT '',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (admin_user_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_bc_batch_ai_insights_admin_action
    ON bc_batch_ai_insights (admin_user_id, action_required DESC, priority_score DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bc_batch_ai_insights_batch
    ON bc_batch_ai_insights (batch_id);

CREATE OR REPLACE FUNCTION bc_batch_ai_insights_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bc_batch_ai_insights_touch ON bc_batch_ai_insights;
CREATE TRIGGER trg_bc_batch_ai_insights_touch
  BEFORE UPDATE ON bc_batch_ai_insights
  FOR EACH ROW
  EXECUTE FUNCTION bc_batch_ai_insights_touch_updated_at();
