-- Migration 007 — make template (name, language_code) UNIQUE per admin user
--
-- Why
--   The original migration 001 declared a global unique index on
--   (name, language_code). With per-admin credentials now in place, two
--   different Google / email-password admins are independent workspaces —
--   both should be able to create their own "billing_summary_v1" without
--   colliding. The previous global unique would 409 the second user.
--
-- What this does
--   1. Drop the global unique index from migration 001.
--   2. Add a per-admin unique partial index that scopes uniqueness to
--      admin_user_id. Each admin gets their own namespace for
--      (name, language_code) tuples.
--   3. NULL admin_user_id rows (legacy) are excluded — they're owned by
--      the seed-time backfill which assigns them to the first admin.

DROP INDEX IF EXISTS uq_bc_templates_name_lang;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bc_templates_admin_name_lang
    ON bc_templates (admin_user_id, name, language_code)
    WHERE admin_user_id IS NOT NULL;