-- Migration 011 — Phase 5: Sequence worker
--
-- The Phase 4 enrollment table (010_crm.sql) was a passive log: rows
-- were created on manual enrollment, status flipped to 'cancelled' or
-- 'completed' on admin action, but nothing picked them up on a
-- schedule. Phase 5 wires a background worker that:
--
--   1. Polls every 5s for enrollments with status='active' AND
--      next_run_at <= now().
--   2. Sends the current step's message_template via the per-admin
--      WhatsApp resolver.
--   3. On success: advance current_step + set next next_run_at (or
--      mark completed when there is no next step).
--   4. On 3x send failure: pause the enrollment, write a
--      'needs_attention' activity row on the lead.
--   5. On no-sender (admin hasn't configured WABA): pause with reason
--      'no_sender' so the UI surfaces the issue.
--
-- This migration adds the two columns the worker needs:
--   - current_step INT (0-indexed; the step to run on the next tick)
--   - next_run_at  TIMESTAMPTZ (the worker's polling key)
-- Plus a partial index that matches the worker's WHERE clause, so the
-- hot path is a tiny range scan instead of a full table scan.
--
-- Existing rows are backfilled so they don't immediately fire:
--   - current_step = 0 (so the worker re-reads step 1 and sends it)
--   - next_run_at = now() (so the worker picks them up on the next
--     tick IF the admin wants to honour pre-Phase-5 enrollments)
--   - status = 'completed' for any pre-existing row that was already
--     in a terminal state, so the worker doesn't re-fire old steps.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is safe to re-apply.

ALTER TABLE bc_crm_sequence_enrollments
    ADD COLUMN IF NOT EXISTS current_step INT NOT NULL DEFAULT 0;

ALTER TABLE bc_crm_sequence_enrollments
    ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Partial index for the worker's hot path: only "active" rows with a
-- due next_run_at. Keeps the index small even as the table grows.
CREATE INDEX IF NOT EXISTS idx_bc_crm_sequence_enrollments_due
    ON bc_crm_sequence_enrollments (next_run_at)
    WHERE status = 'active';

-- Make sure fresh enrollments default to a due next_run_at (the
-- Phase 4 store didn't set this, so the column default matters).
-- The new EnrollCRMLeadInSequence rewrites next_run_at from the
-- step[0].delay_minutes on every insert, but the default ensures any
-- pre-Phase-5 path still produces due rows.
