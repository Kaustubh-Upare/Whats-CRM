-- Migration 023 - Optional display_name on batches.
--
-- Until now the only label a batch carried was `file_name`, which is
-- not user-chosen (it comes straight from the uploaded .xlsx/.csv).
-- Operators want to rename batches after upload so the Batches list and
-- the BatchDetail header read as "March invoice follow-up" instead of
-- "billing_feb_2024.xlsx". We keep `file_name` immutable for audit and
-- add `display_name` as a nullable override.
--
-- Deliberately no DEFAULT — NULL means "no override, fall back to
-- file_name". No NOT NULL so existing rows remain valid with no data
-- rewrite.
--
-- The partial index is keyed on rows that actually have a name set,
-- so the cost on the hot path (list all batches) is unchanged.

ALTER TABLE bc_upload_batches
    ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Cap length at the application layer, but defend against a direct
-- DB write blowing past VARCHAR-like limits by enforcing a CHECK
-- constraint here too. NULL is allowed (no override).
ALTER TABLE bc_upload_batches
    DROP CONSTRAINT IF EXISTS bc_upload_batches_display_name_len;
ALTER TABLE bc_upload_batches
    ADD CONSTRAINT bc_upload_batches_display_name_len
    CHECK (display_name IS NULL OR char_length(display_name) <= 100);

-- Trim trailing whitespace so the UI never has to render "   ".
-- Leading whitespace is preserved (some operators prefix with "·").
CREATE OR REPLACE FUNCTION bc_upload_batches_trim_display_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.display_name IS NOT NULL THEN
    NEW.display_name = trim(NEW.display_name);
    IF NEW.display_name = '' THEN
      NEW.display_name = NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bc_upload_batches_trim_display_name ON bc_upload_batches;
CREATE TRIGGER trg_bc_upload_batches_trim_display_name
  BEFORE INSERT OR UPDATE OF display_name ON bc_upload_batches
  FOR EACH ROW
  EXECUTE FUNCTION bc_upload_batches_trim_display_name();

-- Cheap lookup when an operator searches by name in the Batches list
-- (frontend wiring can come later; this keeps it free at the DB level).
-- NOTE: bc_upload_batches is owned via uploaded_by (not admin_user_id),
-- per migration 004 / 020 — index by uploaded_by to keep it consistent
-- with the rest of the schema.
CREATE INDEX IF NOT EXISTS idx_bc_upload_batches_display_name
    ON bc_upload_batches (uploaded_by, display_name)
    WHERE display_name IS NOT NULL;