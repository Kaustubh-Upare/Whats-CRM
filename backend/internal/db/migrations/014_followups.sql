-- Migration 014 - Smart Follow-Up (Phase 7)
--
-- Phase 5 sequence worker already runs on bc_crm_sequence_enrollments
-- (template-driven: worker reads message_template verbatim). Phase 7
-- adds an `ai_followup` mode where the worker instead calls the
-- orchestrator's GenerateFollowUp (LLM generates the body, references
-- the lead's last chat topic, picks cheap-tier model).
--
-- This migration is idempotent (ADD COLUMN IF NOT EXISTS, CREATE
-- TABLE IF NOT EXISTS) so it can be re-run on a populated DB safely.
--
-- What gets added:
--   1. mode + pause metadata on bc_crm_sequence_enrollments so the
--      Runs panel can surface "Paused · customer replied" without
--      joining bc_audit_log.
--   2. checkin_enabled per enrollment + a new bc_crm_followup_checkins
--      table for the "still interested?" message 2h after pause.
--   3. Phone lookup index on bc_crm_leads so the webhook pause hook
--      (adminID + phone -> enrollments) is cheap.
--   4. source on bc_ai_conversation_messages so the inbox can badge
--      follow-up sends differently from live AI replies.

-- ============================================================================
-- 1. Mode + pause metadata on the enrollment.
-- ============================================================================

-- mode: 'template' = today's behavior, render message_template.
--       'ai_followup' = Phase 7, worker calls orchestrator.GenerateFollowUp.
-- Default 'template' so existing rows are unaffected.
ALTER TABLE bc_crm_sequence_enrollments
    ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'template';

ALTER TABLE bc_crm_sequence_enrollments
    DROP CONSTRAINT IF EXISTS bc_crm_seq_enrollments_mode_chk;
ALTER TABLE bc_crm_sequence_enrollments
    ADD CONSTRAINT bc_crm_seq_enrollments_mode_chk
    CHECK (mode IN ('template', 'ai_followup'));

-- Pause metadata. The worker previously wrote the pause reason into
-- bc_audit_log only; today the Runs panel reads it from the row so
-- admins can see "why did this enrollment stop" in one query.
ALTER TABLE bc_crm_sequence_enrollments
    ADD COLUMN IF NOT EXISTS pause_reason   TEXT,
    ADD COLUMN IF NOT EXISTS paused_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pause_detail   TEXT,
    ADD COLUMN IF NOT EXISTS checkin_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================================
-- 2. Phone lookup index for the pause hook.
-- ============================================================================

-- The webhook's inbound flow does:
--   UPDATE ... FROM bc_crm_leads WHERE phone = $1
-- Without this index, that join scans all leads for the admin.
CREATE INDEX IF NOT EXISTS idx_bc_crm_leads_admin_phone
    ON bc_crm_leads (admin_user_id, phone);

-- ============================================================================
-- 3. Source on conversation messages.
-- ============================================================================

-- Distinguishes live AI replies from AI follow-up sends so the inbox
-- can render a different badge. New values: 'orchestrator' (default),
-- 'followup', 'followup_checkin'.
ALTER TABLE bc_ai_conversation_messages
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'orchestrator';

-- ============================================================================
-- 4. Check-in queue (one row per "still interested?" message).
-- ============================================================================

-- When a customer replies to a smart follow-up and checkin_enabled=true,
-- the webhook inserts one row here with send_after = now() + 2h. The
-- worker polls this table in the same tick as enrollments. A second
-- inbound within the window cancels the row (status='cancelled',
-- cancel_reason='replied_again') so we never send the check-in to
-- someone who already re-engaged.
CREATE TABLE IF NOT EXISTS bc_crm_followup_checkins (
    id              BIGSERIAL PRIMARY KEY,
    admin_user_id   BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    enrollment_id   BIGINT NOT NULL REFERENCES bc_crm_sequence_enrollments(id) ON DELETE CASCADE,
    lead_id         BIGINT NOT NULL,
    phone           TEXT NOT NULL,
    send_after      TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    cancel_reason   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial index: the worker only ever queries pending rows.
CREATE INDEX IF NOT EXISTS idx_bc_crm_followup_checkins_due
    ON bc_crm_followup_checkins (send_after)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_bc_crm_followup_checkins_lead
    ON bc_crm_followup_checkins (lead_id, status);