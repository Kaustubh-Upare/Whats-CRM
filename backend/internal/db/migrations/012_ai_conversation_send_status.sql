-- Migration 012 - Track manual AI inbox reply delivery
--
-- Human replies from /admin/ai/conversations are sent as free-form
-- WhatsApp text messages. Keep the local chat row even when Meta rejects
-- the send so the UI can show the exact failure to the admin.

ALTER TABLE bc_ai_conversation_messages
    ADD COLUMN IF NOT EXISTS provider_msg_id TEXT,
    ADD COLUMN IF NOT EXISTS send_status TEXT NOT NULL DEFAULT 'stored',
    ADD COLUMN IF NOT EXISTS send_error TEXT,
    ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bc_ai_conversation_messages_send_status
    ON bc_ai_conversation_messages (admin_user_id, send_status, created_at DESC);
