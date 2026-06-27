-- 016_batch_ai_followup_modes.sql
--
-- Adds a third value to bc_crm_sequence_enrollments.mode so the
-- per-batch AI follow-up flow on /admin/ai/followups can offer
-- an "agent decides timing" mode (in addition to today's
-- 'template' and 'ai_followup').
--
-- The new value, 'agentic_followup', is what the
-- EnableAIWithScheduleModal writes when the admin picks
-- "Use your intelligence". The sequence worker (worker/sequence.go)
-- branches on this value and forwards it to the orchestrator's
-- GenerateFollowUp, which prompts the LLM to decide whether a
-- follow-up is appropriate right now (and may return "" to mean
-- "skip this tick").
--
-- No other schema changes. The per-lead primitive already carries
-- cadence_days, max_messages, tone, and goal on
-- bc_crm_sequence_steps.

ALTER TABLE bc_crm_sequence_enrollments
    DROP CONSTRAINT IF EXISTS bc_crm_seq_enrollments_mode_chk;

ALTER TABLE bc_crm_sequence_enrollments
    ADD CONSTRAINT bc_crm_seq_enrollments_mode_chk
    CHECK (mode IN ('template', 'ai_followup', 'agentic_followup'));
