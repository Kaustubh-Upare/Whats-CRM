-- 015_batch_ai_followup.sql
--
-- Adds a per-batch "AI follow-up" switch and a derived table that tracks
-- per-recipient AI agent activity for a given batch.
--
-- Why derived state?
--   The agent and message tables (bc_ai_conversation_states,
--   bc_ai_conversation_messages) remain the source of truth.
--   bc_batch_ai_recipients only answers:
--     "for this batch, who is the AI agent eligible to follow up with
--      right now, and what is their current status?"
--   One row per (batch_id, whatsapp_number) is created the first time the
--   admin enables the toggle (idempotent), or lazily on first inbound
--   message from that phone in this batch.
--
-- This is a Phase 7 follow-up change. The orchestrator (Phase 6) and the
-- sequence worker (Phase 7) continue to operate per-conversation; they do
-- NOT need to know about this table — they just need the global
-- AIAgentConfig.Enabled flag to be true.

-- Add the per-batch switch to the real batches table. (The naming is
-- bc_upload_batches in the existing schema; "bc_batches" is a common
-- misnomer we avoid here so the migration runs against a fresh DB.)
ALTER TABLE bc_upload_batches
  ADD COLUMN IF NOT EXISTS ai_followup_enabled    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_followup_enabled_at TIMESTAMPTZ;

-- Per-recipient AI activity for a given batch.
-- One row per (batch_id, whatsapp_number). Created when the admin toggles
-- the batch-level switch on, or lazily on the first inbound message from
-- that phone in this batch.
--
-- We stamp admin_user_id on each row (denormalized from the owning batch
-- at insert time) so the per-recipient API doesn't have to hop through
-- bc_upload_batches to filter by tenant. conversation_id is a plain BIGINT
-- (no FK) because the conversation lives on bc_ai_conversation_states,
-- which we'd rather not couple with a hard reference here — we match
-- the last message by (admin_user_id, phone) at read time anyway.
CREATE TABLE IF NOT EXISTS bc_batch_ai_recipients (
  id              BIGSERIAL PRIMARY KEY,
  batch_id        BIGINT NOT NULL REFERENCES bc_upload_batches(id)     ON DELETE CASCADE,
  admin_user_id   BIGINT          REFERENCES bc_admin_users(id)         ON DELETE CASCADE,
  retailer_id     BIGINT          REFERENCES bc_retailers(id)           ON DELETE SET NULL,
  whatsapp_number TEXT   NOT NULL,
  ai_status       TEXT   NOT NULL DEFAULT 'pending'
                  CHECK (ai_status IN ('pending','active','handed_off','opted_out','disabled','failed')),
  conversation_id BIGINT,
  last_event_at   TIMESTAMPTZ,
  last_event      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, whatsapp_number)
);

CREATE INDEX IF NOT EXISTS ix_bcai_batch
  ON bc_batch_ai_recipients (batch_id);

CREATE INDEX IF NOT EXISTS ix_bcai_admin_phone
  ON bc_batch_ai_recipients (admin_user_id, whatsapp_number);

-- updated_at maintenance
CREATE OR REPLACE FUNCTION bc_bcai_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bcai_touch ON bc_batch_ai_recipients;
CREATE TRIGGER trg_bcai_touch
  BEFORE UPDATE ON bc_batch_ai_recipients
  FOR EACH ROW
  EXECUTE FUNCTION bc_bcai_touch_updated_at();
