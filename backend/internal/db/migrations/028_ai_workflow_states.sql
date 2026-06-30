-- Migration 028 - AI workflow state and decision log.
--
-- This is an additive product layer over the existing batch AI recipients,
-- conversations, sequence enrollments, and human review queue. It answers:
-- "what is AI doing for this phone, why, and what happens next?"

CREATE TABLE IF NOT EXISTS bc_ai_workflow_states (
    id                    BIGSERIAL PRIMARY KEY,
    admin_user_id          BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    batch_id               BIGINT REFERENCES bc_upload_batches(id) ON DELETE CASCADE,
    batch_ai_recipient_id  BIGINT NOT NULL REFERENCES bc_batch_ai_recipients(id) ON DELETE CASCADE,
    conversation_id        BIGINT REFERENCES bc_ai_conversation_states(id) ON DELETE SET NULL,
    retailer_id            BIGINT REFERENCES bc_retailers(id) ON DELETE SET NULL,
    phone                  TEXT NOT NULL,
    retailer_name          TEXT NOT NULL DEFAULT '',
    batch_name             TEXT NOT NULL DEFAULT '',

    state                  TEXT NOT NULL DEFAULT 'new'
                           CHECK (state IN (
                               'new',
                               'ai_talking',
                               'buyer_replied',
                               'needs_human',
                               'followup_scheduled',
                               'paused',
                               'closed'
                           )),
    state_label            TEXT NOT NULL DEFAULT 'New',
    state_reason           TEXT NOT NULL DEFAULT '',
    next_action            TEXT NOT NULL DEFAULT '',
    next_message_preview   TEXT NOT NULL DEFAULT '',

    confidence_score       INT NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 100),
    risk_level             TEXT NOT NULL DEFAULT 'low'
                           CHECK (risk_level IN ('critical', 'high', 'medium', 'low')),
    buyer_intent           TEXT NOT NULL DEFAULT 'unknown',
    knowledge_matched      BOOLEAN NOT NULL DEFAULT FALSE,
    knowledge_refs         JSONB NOT NULL DEFAULT '[]'::jsonb,
    quality                JSONB NOT NULL DEFAULT '{}'::jsonb,
    source                 TEXT NOT NULL DEFAULT 'rules',
    signal_hash            TEXT NOT NULL DEFAULT '',

    last_message_at        TIMESTAMPTZ,
    last_event_at          TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (admin_user_id, batch_ai_recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_bc_ai_workflow_states_admin_state
    ON bc_ai_workflow_states (admin_user_id, state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bc_ai_workflow_states_batch
    ON bc_ai_workflow_states (admin_user_id, batch_id, state);

CREATE INDEX IF NOT EXISTS idx_bc_ai_workflow_states_phone
    ON bc_ai_workflow_states (admin_user_id, phone);

CREATE TABLE IF NOT EXISTS bc_ai_decision_logs (
    id                    BIGSERIAL PRIMARY KEY,
    admin_user_id          BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    workflow_state_id      BIGINT REFERENCES bc_ai_workflow_states(id) ON DELETE CASCADE,
    batch_id               BIGINT REFERENCES bc_upload_batches(id) ON DELETE CASCADE,
    batch_ai_recipient_id  BIGINT REFERENCES bc_batch_ai_recipients(id) ON DELETE CASCADE,
    conversation_id        BIGINT REFERENCES bc_ai_conversation_states(id) ON DELETE SET NULL,
    phone                  TEXT NOT NULL DEFAULT '',

    decision_type          TEXT NOT NULL DEFAULT 'state_changed',
    title                  TEXT NOT NULL DEFAULT '',
    reason                 TEXT NOT NULL DEFAULT '',
    knowledge_refs         JSONB NOT NULL DEFAULT '[]'::jsonb,
    next_action            TEXT NOT NULL DEFAULT '',
    quality                JSONB NOT NULL DEFAULT '{}'::jsonb,
    model                  TEXT NOT NULL DEFAULT '',
    provider               TEXT NOT NULL DEFAULT '',
    source                 TEXT NOT NULL DEFAULT 'rules',
    signal_hash            TEXT NOT NULL DEFAULT '',
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_ai_decision_logs_recipient
    ON bc_ai_decision_logs (admin_user_id, batch_ai_recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bc_ai_decision_logs_batch
    ON bc_ai_decision_logs (admin_user_id, batch_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bc_ai_decision_logs_signal_hash
    ON bc_ai_decision_logs (admin_user_id, batch_ai_recipient_id, signal_hash)
    WHERE signal_hash <> '';

CREATE TABLE IF NOT EXISTS bc_ai_workflow_templates (
    id              BIGSERIAL PRIMARY KEY,
    admin_user_id   BIGINT REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    key             TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    goal            TEXT NOT NULL DEFAULT '',
    tone            TEXT NOT NULL DEFAULT 'friendly',
    followup_rules  JSONB NOT NULL DEFAULT '{}'::jsonb,
    handoff_rules   JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_system       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (admin_user_id, key)
);

CREATE TABLE IF NOT EXISTS bc_batch_ai_memory (
    id              BIGSERIAL PRIMARY KEY,
    admin_user_id   BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    batch_id        BIGINT NOT NULL REFERENCES bc_upload_batches(id) ON DELETE CASCADE,
    template_key    TEXT NOT NULL DEFAULT '',
    goal            TEXT NOT NULL DEFAULT '',
    tone            TEXT NOT NULL DEFAULT 'friendly',
    offer           TEXT NOT NULL DEFAULT '',
    blocked_topics  JSONB NOT NULL DEFAULT '[]'::jsonb,
    followup_rules  JSONB NOT NULL DEFAULT '{}'::jsonb,
    handoff_rules   JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (admin_user_id, batch_id)
);

CREATE OR REPLACE FUNCTION bc_ai_workflow_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bc_ai_workflow_states_touch ON bc_ai_workflow_states;
CREATE TRIGGER trg_bc_ai_workflow_states_touch
  BEFORE UPDATE ON bc_ai_workflow_states
  FOR EACH ROW
  EXECUTE FUNCTION bc_ai_workflow_touch_updated_at();

DROP TRIGGER IF EXISTS trg_bc_batch_ai_memory_touch ON bc_batch_ai_memory;
CREATE TRIGGER trg_bc_batch_ai_memory_touch
  BEFORE UPDATE ON bc_batch_ai_memory
  FOR EACH ROW
  EXECUTE FUNCTION bc_ai_workflow_touch_updated_at();

