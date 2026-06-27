-- Migration 019 - One-time, context-bound next-message drafts.
--
-- Operators can generate or manually edit the exact next follow-up message.
-- The draft is consumed only by the next successful sequence step. It is
-- bound to the latest AI-conversation message id at save time so the worker
-- can avoid sending an outdated draft after the conversation changes.

ALTER TABLE bc_crm_sequence_enrollments
    ADD COLUMN IF NOT EXISTS next_message_body TEXT,
    ADD COLUMN IF NOT EXISTS next_message_prompt TEXT,
    ADD COLUMN IF NOT EXISTS next_message_source TEXT,
    ADD COLUMN IF NOT EXISTS next_message_context_message_id BIGINT,
    ADD COLUMN IF NOT EXISTS next_message_history_limit INT,
    ADD COLUMN IF NOT EXISTS next_message_generated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS next_message_updated_at TIMESTAMPTZ;

ALTER TABLE bc_crm_sequence_enrollments
    DROP CONSTRAINT IF EXISTS bc_crm_seq_enrollments_next_message_source_chk;
ALTER TABLE bc_crm_sequence_enrollments
    ADD CONSTRAINT bc_crm_seq_enrollments_next_message_source_chk
    CHECK (
        next_message_source IS NULL
        OR next_message_source IN ('ai', 'manual')
    );

ALTER TABLE bc_crm_sequence_enrollments
    DROP CONSTRAINT IF EXISTS bc_crm_seq_enrollments_next_message_history_chk;
ALTER TABLE bc_crm_sequence_enrollments
    ADD CONSTRAINT bc_crm_seq_enrollments_next_message_history_chk
    CHECK (
        next_message_history_limit IS NULL
        OR next_message_history_limit IN (10, 20)
    );
