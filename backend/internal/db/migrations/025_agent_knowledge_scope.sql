-- Migration 025 - Optional knowledge scope per AI agent.
--
-- By default an agent can retrieve from the whole workspace knowledge base.
-- When rows exist in this table, that agent is restricted to the selected
-- chunks only. This lets operators create product/category-specific agents
-- without duplicating knowledge or relying on prompt instructions alone.

CREATE TABLE IF NOT EXISTS bc_ai_agent_kb_chunks (
    admin_user_id BIGINT NOT NULL
        REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    agent_id BIGINT NOT NULL
        REFERENCES bc_ai_agents(id) ON DELETE CASCADE,
    kb_chunk_id BIGINT NOT NULL
        REFERENCES bc_ai_kb_chunks(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_id, kb_chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_bc_ai_agent_kb_chunks_admin_agent
    ON bc_ai_agent_kb_chunks (admin_user_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_bc_ai_agent_kb_chunks_chunk
    ON bc_ai_agent_kb_chunks (kb_chunk_id);
