-- Migration 030 - Dedicated one-user AI follow-up batches.
--
-- AI Users can now start follow-up automation for a single phone without
-- uploading a spreadsheet. We still reuse the existing batch follow-up
-- engine by creating a tiny hidden one-row batch, then linking that batch
-- back to the AI user here. This keeps the sequence worker, human review,
-- recipient timeline, and follow-up control room on one shared model.

CREATE TABLE IF NOT EXISTS bc_ai_user_followup_targets (
    id                    BIGSERIAL PRIMARY KEY,
    admin_user_id          BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    retailer_id            BIGINT NOT NULL REFERENCES bc_retailers(id) ON DELETE CASCADE,
    batch_id               BIGINT NOT NULL REFERENCES bc_upload_batches(id) ON DELETE CASCADE,
    batch_ai_recipient_id  BIGINT REFERENCES bc_batch_ai_recipients(id) ON DELETE SET NULL,
    phone                  TEXT NOT NULL DEFAULT '',
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (admin_user_id, retailer_id),
    UNIQUE (admin_user_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_bc_ai_user_followup_targets_phone
    ON bc_ai_user_followup_targets (admin_user_id, phone);

CREATE OR REPLACE FUNCTION bc_ai_user_followup_targets_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bc_ai_user_followup_targets_touch ON bc_ai_user_followup_targets;
CREATE TRIGGER trg_bc_ai_user_followup_targets_touch
  BEFORE UPDATE ON bc_ai_user_followup_targets
  FOR EACH ROW
  EXECUTE FUNCTION bc_ai_user_followup_targets_touch_updated_at();
