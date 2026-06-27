-- Migration 004 — per-user WhatsApp credentials + admin-user scoping
--
-- Goals
--   1. Add bc_whatsapp_credentials (one row per admin) with AES-GCM-encrypted
--      access_token and verify_token. phone_number_id and waba_id stay in
--      plaintext so we can look them up by phone number when Meta calls
--      our webhook.
--   2. Add admin_user_id (nullable, FK to bc_admin_users) to every row that
--      is owned by a specific admin: retailers, billing_records,
--      message_jobs, templates, webhook_logs. (bc_upload_batches already
--      has uploaded_by; bc_audit_logs already has actor_id — both are
--      reused for filtering, no new column.)
--   3. Replace the global unique on bc_retailers.whatsapp_number
--      (added in migration 003) with a per-admin compound unique, so
--      two different admins can legitimately have retailers that
--      share the same phone number.
--
-- All new admin_user_id columns are intentionally nullable: existing
-- rows in the production DB will be backfilled by cmd/seed to the
-- first admin, so no data is lost. The store layer treats NULL
-- admin_user_id as "system / pre-migration" and shows those rows to
-- every admin (preserves behaviour for legacy data).

-- ============================================================================
-- 1. Credentials table
-- ============================================================================
CREATE TABLE IF NOT EXISTS bc_whatsapp_credentials (
    admin_user_id      BIGINT PRIMARY KEY REFERENCES bc_admin_users(id) ON DELETE CASCADE,

    -- Public identifiers (used to look up the admin from a webhook payload).
    phone_number_id    TEXT        NOT NULL,
    waba_id            TEXT,                          -- optional, used for inbound routing later
    api_version        TEXT        NOT NULL DEFAULT 'v25.0',

    -- Encrypted secrets. Stored as separate columns so the nonce can
    -- be sent/updated independently if we ever rotate. cipher is
    -- AES-GCM(plaintext) with a fresh random 12-byte nonce per write.
    access_token_enc   BYTEA       NOT NULL,
    access_token_nonce BYTEA       NOT NULL,
    verify_token_enc   BYTEA       NOT NULL,
    verify_token_nonce BYTEA       NOT NULL,

    -- Last-known verification state, refreshed by the "Test connection"
    -- button in Settings. is_verified=true means a successful round-trip
    -- to graph.facebook.com with this token.
    is_verified        BOOLEAN     NOT NULL DEFAULT FALSE,
    verified_at        TIMESTAMPTZ,
    last_error         TEXT,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bc_whatsapp_credentials_phone_idx
    ON bc_whatsapp_credentials (phone_number_id);

CREATE INDEX IF NOT EXISTS bc_whatsapp_credentials_verified_idx
    ON bc_whatsapp_credentials (is_verified, verified_at DESC);

-- ============================================================================
-- 2. admin_user_id columns on owned tables
-- ============================================================================
ALTER TABLE bc_retailers
    ADD COLUMN IF NOT EXISTS admin_user_id BIGINT
    REFERENCES bc_admin_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bc_retailers_admin
    ON bc_retailers (admin_user_id);

ALTER TABLE bc_billing_records
    ADD COLUMN IF NOT EXISTS admin_user_id BIGINT
    REFERENCES bc_admin_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bc_billing_records_admin
    ON bc_billing_records (admin_user_id);

ALTER TABLE bc_message_jobs
    ADD COLUMN IF NOT EXISTS admin_user_id BIGINT
    REFERENCES bc_admin_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bc_message_jobs_admin
    ON bc_message_jobs (admin_user_id);

ALTER TABLE bc_templates
    ADD COLUMN IF NOT EXISTS admin_user_id BIGINT
    REFERENCES bc_admin_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bc_templates_admin
    ON bc_templates (admin_user_id);

ALTER TABLE bc_webhook_logs
    ADD COLUMN IF NOT EXISTS admin_user_id BIGINT
    REFERENCES bc_admin_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bc_webhook_logs_admin
    ON bc_webhook_logs (admin_user_id);

-- ============================================================================
-- 3. Per-admin uniques on bc_retailers
--    Drop the global unique on whatsapp_number (added in 003) and the
--    implicit unique on retailer_code (column-level UNIQUE) so two admins
--    can independently have the same phone number / retailer code. Add
--    compound uniques scoped to admin_user_id; NULL admin_user_id is
--    allowed multiple times via a partial index.
-- ============================================================================

-- 3a. retailer_code: drop the column-level UNIQUE (which was implicit on
--     the column definition in 001) and replace with a partial index.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'bc_retailers_retailer_code_key'
    ) THEN
        ALTER TABLE bc_retailers DROP CONSTRAINT bc_retailers_retailer_code_key;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bc_retailers_admin_code
    ON bc_retailers (admin_user_id, retailer_code)
    WHERE admin_user_id IS NOT NULL;

-- 3b. whatsapp_number: drop the global unique added in 003.
DROP INDEX IF EXISTS bc_retailers_whatsapp_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bc_retailers_admin_phone
    ON bc_retailers (admin_user_id, whatsapp_number)
    WHERE admin_user_id IS NOT NULL;
