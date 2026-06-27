-- Migration 013 - AI orchestrator support tables (Phase 6)
--
-- Migrations 008/009/011/012 already provide the conversation inbox
-- (bc_ai_conversation_states / bc_ai_conversation_messages), the KB
-- (bc_ai_kb_chunks), and the agent config (bc_ai_agent_configs).
-- This migration adds the four tables the orchestrator's tool loop
-- needs to actually drive the agent: leads, lead facts, handoffs,
-- and LLM metrics.
--
-- Naming convention follows 008-012: plural table names, admin_user_id
-- everywhere, multi-tenant isolation enforced at the SQL layer.
--
-- All statements are idempotent so re-running this migration on a
-- populated DB is a safe no-op.

-- ============================================================================
-- 1. AI leads (per admin) — populated by the capture_lead tool.
-- ============================================================================

CREATE TABLE IF NOT EXISTS bc_ai_leads (
    id              BIGSERIAL PRIMARY KEY,
    admin_user_id   BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    phone           TEXT NOT NULL,
    name            TEXT NOT NULL DEFAULT '',
    email           TEXT NOT NULL DEFAULT '',
    source          TEXT NOT NULL DEFAULT 'whatsapp_ai',
    status          TEXT NOT NULL DEFAULT 'new',
    score           INT NOT NULL DEFAULT 0,
    interest        TEXT NOT NULL DEFAULT '',
    budget          TEXT NOT NULL DEFAULT '',
    timeline        TEXT NOT NULL DEFAULT '',
    location        TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT '',
    owner_user_id   BIGINT REFERENCES bc_admin_users(id) ON DELETE SET NULL,
    tags            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (admin_user_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_bc_ai_leads_admin_status
    ON bc_ai_leads (admin_user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bc_ai_leads_admin_score
    ON bc_ai_leads (admin_user_id, score DESC);

-- ============================================================================
-- 2. Lead facts (durable memory) — populated by capture_lead.
-- ============================================================================

CREATE TABLE IF NOT EXISTS bc_ai_lead_facts (
    admin_user_id  BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    phone          TEXT NOT NULL,
    fact_key       TEXT NOT NULL,
    fact_value     TEXT NOT NULL,
    source         TEXT NOT NULL DEFAULT 'ai_extracted',
    confidence     DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (admin_user_id, phone, fact_key)
);

CREATE INDEX IF NOT EXISTS idx_bc_ai_lead_facts_lookup
    ON bc_ai_lead_facts (admin_user_id, phone);

-- ============================================================================
-- 3. Handoffs (transitions between AI / human / system) — tracks
--    every transfer_to_human call and every opt-out flip so admins
--    can see why a conversation left the AI loop.
-- ============================================================================

CREATE TABLE IF NOT EXISTS bc_ai_handoffs (
    id               BIGSERIAL PRIMARY KEY,
    conversation_key TEXT NOT NULL,
    admin_user_id    BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    from_actor       TEXT NOT NULL,
    to_actor         TEXT NOT NULL,
    reason           TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_ai_handoffs_admin_created
    ON bc_ai_handoffs (admin_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bc_ai_handoffs_admin_conv
    ON bc_ai_handoffs (admin_user_id, conversation_key);

-- ============================================================================
-- 4. LLM metrics (per call) — every ChatRequest + its tokens/cost.
--    Drives the AI dashboard's cost card + the per-model breakdown.
-- ============================================================================

CREATE TABLE IF NOT EXISTS bc_ai_llm_metrics (
    id                BIGSERIAL PRIMARY KEY,
    admin_user_id     BIGINT REFERENCES bc_admin_users(id) ON DELETE SET NULL,
    conversation_key  TEXT,
    provider          TEXT NOT NULL,
    model             TEXT NOT NULL,
    input_tokens      INT NOT NULL DEFAULT 0,
    output_tokens     INT NOT NULL DEFAULT 0,
    cost_usd          NUMERIC(12, 6) NOT NULL DEFAULT 0,
    latency_ms        INT NOT NULL DEFAULT 0,
    intent            TEXT,
    confidence        DOUBLE PRECISION,
    retrieved_chunks  INT NOT NULL DEFAULT 0,
    tool_calls        INT NOT NULL DEFAULT 0,
    failover_from     TEXT,
    error_message     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_ai_llm_metrics_admin_time
    ON bc_ai_llm_metrics (admin_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bc_ai_llm_metrics_model
    ON bc_ai_llm_metrics (model, created_at DESC);

-- ============================================================================
-- 5. Phase 6 columns on existing tables (orchestrator + tools need them).
-- ============================================================================

-- conversation_messages: add the orchestrator's tool_calls +
-- retrieved_chunk_ids + conversation_id. The live 009 schema has
-- conversation_key (admin-scoped thread id) and tool_summary (a
-- pre-formatted string the inbox UI uses). The orchestrator writes
-- the raw tool argument JSON in `tool_calls` for replay, and
-- retrieved_chunk_ids for the citation banner.
ALTER TABLE bc_ai_conversation_messages
    ADD COLUMN IF NOT EXISTS conversation_id BIGINT,
    ADD COLUMN IF NOT EXISTS tool_calls JSONB,
    ADD COLUMN IF NOT EXISTS retrieved_chunk_ids BIGINT[];

-- conversation_states: add last_message_at for the inbox sort + a
-- last_message_preview for the conversation list row.
ALTER TABLE bc_ai_conversation_states
    ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS last_message_preview TEXT;

-- llm_metrics: the live schema has conversation_key, not
-- conversation_id. The orchestrator writes both, but the legacy
-- backend used conversation_id; we add a free-form text column to
-- keep the orchestrator's INSERT simple.
ALTER TABLE bc_ai_llm_metrics
    ADD COLUMN IF NOT EXISTS conversation_key TEXT;

-- kb_chunks: add embedding + content_tsv so retrieval (Phase 7
-- polish) can do hybrid search. For Phase 6 we use simple
-- keyword/LIKE matching against the title + content, so the agent
-- can still find relevant chunks. Embedding writes are out of
-- scope for this session; the columns are there for the future.
ALTER TABLE bc_ai_kb_chunks
    ADD COLUMN IF NOT EXISTS content_tsv tsvector
        GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_bc_ai_kb_chunks_tsv
    ON bc_ai_kb_chunks USING gin (content_tsv);

-- conversation_states: add the per-role counters the orchestrator
-- updates on every message. Cheap fields; helps the inbox surface
-- "AI handled 8 messages, human replied 1 time" without joining
-- bc_ai_conversation_messages.
ALTER TABLE bc_ai_conversation_states
    ADD COLUMN IF NOT EXISTS ai_handled_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS human_handled_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_message_role TEXT,
    ADD COLUMN IF NOT EXISTS last_message_direction TEXT;
