-- Migration 027 - Vector embeddings for AI knowledge chunks.
--
-- The original KB search used keyword matching only. That is reliable for
-- exact words, but weak when a buyer asks the same thing differently. This
-- adds pgvector-backed embeddings so retrieval can use semantic similarity
-- while still falling back to keyword search for old/unembedded rows.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE bc_ai_kb_chunks
    ADD COLUMN IF NOT EXISTS embedding vector(1536),
    ADD COLUMN IF NOT EXISTS embedding_model TEXT,
    ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS embedding_error TEXT;

CREATE INDEX IF NOT EXISTS idx_bc_ai_kb_chunks_embedding_hnsw
    ON bc_ai_kb_chunks USING hnsw (embedding vector_cosine_ops)
    WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bc_ai_kb_chunks_embedding_missing
    ON bc_ai_kb_chunks (admin_user_id, updated_at DESC)
    WHERE embedding IS NULL;
