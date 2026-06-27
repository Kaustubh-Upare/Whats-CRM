-- 017_batch_ai_excluded_status.sql
--
-- Adds 'excluded' to bc_batch_ai_recipients.ai_status so the per-batch
-- sequence-start flow can mark individual phones that the admin
-- explicitly opted out of the new sequence (vs. 'disabled' which is
-- batch-wide). The semantic of 'excluded' is:
--   "this batch's recipient row was intentionally skipped during the
--    most recent sequence-start by admin choice, because the phone is
--    already enrolled in an active AI follow-up on another batch
--    (or because the admin wants this phone left alone for any reason)."
-- 'excluded' is sticky across the toggle-on/toggle-off cycle — only the
-- admin's next sequence-start, where they un-check the box, clears it.
--
-- Mirrors the pattern from 016_batch_ai_followup_modes.sql: drop the
-- auto-named CHECK constraint and re-add with the new value list.
DO $$
DECLARE
    cname text;
BEGIN
    SELECT con.conname INTO cname
      FROM pg_constraint con
      JOIN pg_class       cls ON cls.oid = con.conrelid
     WHERE cls.relname = 'bc_batch_ai_recipients'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) LIKE '%ai_status%';
    IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE bc_batch_ai_recipients DROP CONSTRAINT %I', cname);
    END IF;
END $$;

ALTER TABLE bc_batch_ai_recipients
  ADD CONSTRAINT bc_bcai_ai_status_chk
  CHECK (ai_status IN ('pending','active','handed_off','opted_out','disabled','failed','excluded'));

-- Partial index that powers the duplicate-detection query at scale.
-- The store helper FindActiveFollowupDuplicatesForBatch joins
-- bc_batch_ai_recipients → bc_crm_leads → bc_crm_sequence_enrollments;
-- this index turns the second join into an index-only lookup for the
-- hot path (admin enabling AI on a large batch).
CREATE INDEX IF NOT EXISTS ix_bc_crm_seq_enroll_active_ai
  ON bc_crm_sequence_enrollments (admin_user_id, lead_id)
  WHERE status = 'active'
    AND mode IN ('ai_followup', 'agentic_followup');
