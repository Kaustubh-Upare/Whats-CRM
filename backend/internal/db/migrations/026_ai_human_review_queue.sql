-- Migration 026 - Per-phone human review queue for AI follow-ups.
--
-- Batch-level summaries are useful for managers, but operators need a
-- phone-level inbox that says exactly who needs human attention and why.
-- This table stores deterministic, rule-based urgency signals so the UI can
-- stay fast and avoid spending LLM tokens on every inbound WhatsApp message.
-- AI advice is generated only on demand and cached on the same row.

CREATE TABLE IF NOT EXISTS bc_ai_human_review_items (
    id                    BIGSERIAL PRIMARY KEY,
    admin_user_id          BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    batch_id               BIGINT REFERENCES bc_upload_batches(id) ON DELETE CASCADE,
    batch_ai_recipient_id  BIGINT NOT NULL REFERENCES bc_batch_ai_recipients(id) ON DELETE CASCADE,
    conversation_id        BIGINT REFERENCES bc_ai_conversation_states(id) ON DELETE SET NULL,
    retailer_id            BIGINT REFERENCES bc_retailers(id) ON DELETE SET NULL,
    phone                  TEXT NOT NULL,
    retailer_name          TEXT NOT NULL DEFAULT '',
    batch_name             TEXT NOT NULL DEFAULT '',

    status                 TEXT NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open', 'resolved', 'snoozed')),
    severity               TEXT NOT NULL DEFAULT 'medium'
                           CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    priority_score         INT NOT NULL DEFAULT 0,
    reason_code            TEXT NOT NULL DEFAULT '',
    reason_label           TEXT NOT NULL DEFAULT '',
    reason_detail          TEXT NOT NULL DEFAULT '',
    suggested_action       TEXT NOT NULL DEFAULT '',
    labels                 JSONB NOT NULL DEFAULT '[]'::jsonb,

    last_message_preview   TEXT NOT NULL DEFAULT '',
    last_message_role      TEXT NOT NULL DEFAULT '',
    last_message_at        TIMESTAMPTZ,
    last_event_at          TIMESTAMPTZ,
    source                 TEXT NOT NULL DEFAULT 'rules',
    signal_hash            TEXT NOT NULL DEFAULT '',

    ai_summary             TEXT NOT NULL DEFAULT '',
    ai_suggested_reply     TEXT NOT NULL DEFAULT '',
    ai_next_action         TEXT NOT NULL DEFAULT '',
    ai_model               TEXT NOT NULL DEFAULT '',
    ai_provider            TEXT NOT NULL DEFAULT '',
    ai_generated_at        TIMESTAMPTZ,
    ai_error               TEXT NOT NULL DEFAULT '',

    snoozed_until          TIMESTAMPTZ,
    resolved_at            TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (admin_user_id, batch_ai_recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_bc_ai_human_review_open
    ON bc_ai_human_review_items
       (admin_user_id, status, priority_score DESC, last_message_at DESC NULLS LAST, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bc_ai_human_review_reason
    ON bc_ai_human_review_items (admin_user_id, reason_code, status);

CREATE INDEX IF NOT EXISTS idx_bc_ai_human_review_phone
    ON bc_ai_human_review_items (admin_user_id, phone);

CREATE OR REPLACE FUNCTION bc_ai_human_review_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bc_ai_human_review_touch ON bc_ai_human_review_items;
CREATE TRIGGER trg_bc_ai_human_review_touch
  BEFORE UPDATE ON bc_ai_human_review_items
  FOR EACH ROW
  EXECUTE FUNCTION bc_ai_human_review_touch_updated_at();
