-- Migration 005 — Google OAuth + soft-delete for WABA credentials
--
-- Goals
--   1. Add bc_admin_users.google_id so users can sign in via Google OAuth
--      alongside the existing email/password flow. Unique + nullable —
--      password-only accounts have NULL, OAuth-only accounts have NULL
--      password_hash, hybrid accounts have both.
--   2. Soft-delete for bc_whatsapp_credentials: removed_at + removed_by
--      columns. The row stays in place so the user can see what they
--      previously entered (without leaking secrets) and restore it.
--      has_active_credentials is replaced by an EXISTS check that filters
--      out removed rows.
--   3. Add bc_credentials_history so every save/restore/remove is recorded
--      with actor + timestamp + a tiny metadata blob. Useful for the
--      audit log view and for showing the user "you last saved on X".
--
-- Backwards compat
--   - existing rows have removed_at = NULL, so the credentials checks
--     that now filter "removed_at IS NULL" naturally consider them active.
--   - existing users have google_id = NULL, so email/password login
--     continues to work.

-- ============================================================================
-- 1. Google OAuth on bc_admin_users
-- ============================================================================
ALTER TABLE bc_admin_users
    ADD COLUMN IF NOT EXISTS google_id    TEXT,
    ADD COLUMN IF NOT EXISTS avatar_url   TEXT,
    ADD COLUMN IF NOT EXISTS oauth_provider TEXT;

-- Allow password_hash to be NULL for OAuth-only accounts. We keep the
-- column NOT NULL on the assumption that there are no NULLs in production
-- today; the cast happens here so a fresh migration on a populated DB
-- doesn't break. (If your deployment has any rows with password_hash = '',
-- normalise them to NULL first.)
ALTER TABLE bc_admin_users
    ALTER COLUMN password_hash DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bc_admin_users_google_id
    ON bc_admin_users (google_id)
    WHERE google_id IS NOT NULL;

-- ============================================================================
-- 2. Soft-delete for bc_whatsapp_credentials
-- ============================================================================
ALTER TABLE bc_whatsapp_credentials
    ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS removed_by BIGINT REFERENCES bc_admin_users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS last_known_phone_number_id TEXT,
    ADD COLUMN IF NOT EXISTS last_known_waba_id         TEXT,
    ADD COLUMN IF NOT EXISTS last_known_api_version     TEXT,
    ADD COLUMN IF NOT EXISTS last_seen_is_verified      BOOLEAN;

-- Replace the previous "any row counts as configured" semantics. The
-- store layer must now read "configured = removed_at IS NULL".
COMMENT ON COLUMN bc_whatsapp_credentials.removed_at IS
    'When non-null, the user removed these credentials. The encrypted blobs stay on disk so they can be restored; UI shows last_known_* as a read-only recap.';

-- ============================================================================
-- 3. Credentials history (audit trail of every change)
-- ============================================================================
CREATE TABLE IF NOT EXISTS bc_credentials_history (
    id              BIGSERIAL PRIMARY KEY,
    admin_user_id   BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,        -- 'created' | 'updated' | 'removed' | 'restored'
    phone_number_id TEXT,
    waba_id         TEXT,
    api_version     TEXT,
    is_verified     BOOLEAN,
    actor_id        BIGINT REFERENCES bc_admin_users(id) ON DELETE SET NULL,
    ip_address      TEXT,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_credentials_history_admin
    ON bc_credentials_history (admin_user_id, created_at DESC);