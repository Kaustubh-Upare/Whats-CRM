-- Migration 021 - Link AI follow-up enrollments to their source batch.
--
-- A CRM sequence enrollment is keyed by lead, so when the same phone
-- appears in multiple uploaded batches we need an explicit source link to
-- know which batch/agent currently owns the active follow-up.

ALTER TABLE bc_crm_sequence_enrollments
    ADD COLUMN IF NOT EXISTS source_batch_id BIGINT
        REFERENCES bc_upload_batches(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_batch_recipient_id BIGINT
        REFERENCES bc_batch_ai_recipients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bc_crm_sequence_enrollments_source_batch
    ON bc_crm_sequence_enrollments (admin_user_id, source_batch_id)
    WHERE source_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bc_crm_sequence_enrollments_source_recipient
    ON bc_crm_sequence_enrollments (source_batch_recipient_id)
    WHERE source_batch_recipient_id IS NOT NULL;

-- Best-effort backfill for already-created batch AI enrollments. If a phone
-- exists in more than one batch, pick the most recent batch AI recipient row.
-- Future writes stamp the exact row at creation time.
UPDATE bc_crm_sequence_enrollments e
   SET source_batch_id = src.batch_id,
       source_batch_recipient_id = src.id
  FROM bc_crm_leads l
  JOIN LATERAL (
      SELECT r.id, r.batch_id
        FROM bc_batch_ai_recipients r
       WHERE r.admin_user_id = l.admin_user_id
         AND r.whatsapp_number = l.phone
       ORDER BY r.last_event_at DESC NULLS LAST, r.id DESC
       LIMIT 1
  ) src ON TRUE
 WHERE e.lead_id = l.id
   AND e.admin_user_id = l.admin_user_id
   AND e.mode IN ('ai_followup', 'agentic_followup')
   AND e.source_batch_id IS NULL;
