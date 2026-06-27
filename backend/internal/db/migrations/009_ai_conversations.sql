-- Migration 009 - AI conversation inbox state
--
-- Existing WhatsApp message rows already contain the thread history. These
-- tables add the AI inbox state that does not naturally live on message jobs:
-- manual takeover / handback plus human replies drafted from the AI inbox.

CREATE TABLE IF NOT EXISTS bc_ai_conversation_states (
    id                BIGSERIAL PRIMARY KEY,
    admin_user_id     BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    conversation_key  TEXT NOT NULL,
    phone             TEXT NOT NULL,
    retailer_id       BIGINT REFERENCES bc_retailers(id) ON DELETE SET NULL,
    status            TEXT NOT NULL DEFAULT 'active',
    handed_off_at     TIMESTAMPTZ,
    handoff_reason    TEXT,
    summary           TEXT,
    lead_id           BIGINT,
    lead_name         TEXT,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (admin_user_id, conversation_key)
);

CREATE INDEX IF NOT EXISTS idx_bc_ai_conversation_states_admin_status
    ON bc_ai_conversation_states (admin_user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS bc_ai_conversation_messages (
    id                BIGSERIAL PRIMARY KEY,
    admin_user_id     BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    conversation_key  TEXT NOT NULL,
    phone             TEXT NOT NULL,
    role              TEXT NOT NULL,
    content           TEXT NOT NULL,
    model_used        TEXT,
    provider          TEXT,
    tokens_in         INT,
    tokens_out        INT,
    cost_usd          DOUBLE PRECISION,
    latency_ms        INT,
    is_voice          BOOLEAN NOT NULL DEFAULT FALSE,
    tool_summary      TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_ai_conversation_messages_thread
    ON bc_ai_conversation_messages (admin_user_id, conversation_key, created_at);
