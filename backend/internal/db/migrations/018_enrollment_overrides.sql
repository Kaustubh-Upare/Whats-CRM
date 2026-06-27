-- Migration 018 - Per-enrollment overrides for AI follow-up cadence/tone/goal/max_messages.
--
-- Phase 7 (migration 014) added cadence_days, max_messages, tone, goal to the
-- sequence step condition JSONB. The per-recipient detail page lets admins
-- tweak the plan for one retailer without restarting the whole sequence, so
-- we add per-enrollment override columns. NULL = fall back to the sequence
-- step's condition JSONB (default behavior).
--
-- This migration is idempotent (ADD COLUMN IF NOT EXISTS) so it can be
-- re-run on a populated DB safely.

ALTER TABLE bc_crm_sequence_enrollments
    ADD COLUMN IF NOT EXISTS override_cadence_days INT,
    ADD COLUMN IF NOT EXISTS override_max_messages INT,
    ADD COLUMN IF NOT EXISTS override_tone TEXT,
    ADD COLUMN IF NOT EXISTS override_goal TEXT;

-- Sanity-check constraints. Cadence and max_messages must be >= 1.
ALTER TABLE bc_crm_sequence_enrollments
    DROP CONSTRAINT IF EXISTS bc_crm_seq_enrollments_override_cadence_chk;
ALTER TABLE bc_crm_sequence_enrollments
    ADD CONSTRAINT bc_crm_seq_enrollments_override_cadence_chk
    CHECK (override_cadence_days IS NULL OR override_cadence_days >= 1);

ALTER TABLE bc_crm_sequence_enrollments
    DROP CONSTRAINT IF EXISTS bc_crm_seq_enrollments_override_max_chk;
ALTER TABLE bc_crm_sequence_enrollments
    ADD CONSTRAINT bc_crm_seq_enrollments_override_max_chk
    CHECK (override_max_messages IS NULL OR override_max_messages >= 1);

-- Tone is one of the supported values when set. Keep loose (free-text fallback
-- for 'custom' mode) so existing enrollments can pass through unchanged.
ALTER TABLE bc_crm_sequence_enrollments
    DROP CONSTRAINT IF EXISTS bc_crm_seq_enrollments_override_tone_chk;
ALTER TABLE bc_crm_sequence_enrollments
    ADD CONSTRAINT bc_crm_seq_enrollments_override_tone_chk
    CHECK (override_tone IS NULL OR override_tone IN ('friendly', 'professional', 'casual', 'urgent'));