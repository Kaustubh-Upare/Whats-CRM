-- Migration 006 — per-user workspace name
--
-- Goals
--   1. Give every admin row its own `workspace_name` so each Google /
--      email-password user sees their own brand label in the sidebar
--      and login screen (no more "WhatsyITC" generic for everyone).
--   2. Backfill NULL workspace_name rows to "<name>'s workspace" so the
--      first admin doesn't see an empty label post-migration.
--   3. Backfill any NULL admin_user_id rows across all owned tables to
--      the FIRST admin row id, so strict per-user scoping introduced in
--      the previous patch never leaves legacy data orphaned / invisible.
--      This is idempotent and safe to run multiple times.

-- ============================================================================
-- 1. Add the column
-- ============================================================================
ALTER TABLE bc_admin_users
    ADD COLUMN IF NOT EXISTS workspace_name TEXT;

-- Default it to "<name>'s workspace" for any row that doesn't have one.
-- Doing this in a DO block so we can reference `name` per row.
UPDATE bc_admin_users
SET workspace_name = COALESCE(NULLIF(workspace_name, ''), name || '''s workspace')
WHERE workspace_name IS NULL OR workspace_name = '';

-- ============================================================================
-- 2. Backfill NULL admin_user_id rows to the first admin
-- ============================================================================
DO $$
DECLARE
    first_admin_id BIGINT;
BEGIN
    SELECT id INTO first_admin_id
    FROM bc_admin_users
    ORDER BY id ASC
    LIMIT 1;

    IF first_admin_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE bc_retailers       SET admin_user_id = first_admin_id WHERE admin_user_id IS NULL;
    UPDATE bc_billing_records  SET admin_user_id = first_admin_id WHERE admin_user_id IS NULL;
    UPDATE bc_message_jobs    SET admin_user_id = first_admin_id WHERE admin_user_id IS NULL;
    UPDATE bc_templates       SET admin_user_id = first_admin_id WHERE admin_user_id IS NULL;
    UPDATE bc_webhook_logs    SET admin_user_id = first_admin_id WHERE admin_user_id IS NULL;
    UPDATE bc_upload_batches
        SET uploaded_by = first_admin_id WHERE uploaded_by IS NULL;
    UPDATE bc_audit_logs
        SET actor_id = first_admin_id
    WHERE actor_id IS NULL
      AND action NOT IN ('system.bootstrap', 'system.maintenance');
    UPDATE bc_admin_users
        SET workspace_name = 'System Workspace'
    WHERE id = first_admin_id
      AND (workspace_name IS NULL OR workspace_name = '');
END $$;