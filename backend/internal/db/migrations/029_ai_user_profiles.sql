-- Migration 029 - AI workspace user profiles.
--
-- The bulk workspace already owns the canonical contact row in
-- bc_retailers. AI workspace needs an easy user directory with optional
-- context columns from arbitrary CSV/XLSX uploads. Keep those extra fields in
-- a small profile table keyed to the retailer so conversations, opt-outs,
-- follow-ups, and existing retailer links keep working unchanged.

CREATE TABLE IF NOT EXISTS bc_ai_user_profiles (
    id             BIGSERIAL PRIMARY KEY,
    admin_user_id  BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    retailer_id    BIGINT NOT NULL REFERENCES bc_retailers(id) ON DELETE CASCADE,
    phone          TEXT NOT NULL,
    display_name   TEXT NOT NULL DEFAULT '',
    source         TEXT NOT NULL DEFAULT 'manual',
    extra_fields   JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_imported_at TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (admin_user_id, retailer_id)
);

CREATE INDEX IF NOT EXISTS idx_bc_ai_user_profiles_admin_phone
    ON bc_ai_user_profiles (admin_user_id, phone);

CREATE INDEX IF NOT EXISTS idx_bc_ai_user_profiles_updated
    ON bc_ai_user_profiles (admin_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bc_ai_user_profiles_extra_fields
    ON bc_ai_user_profiles USING GIN (extra_fields);

CREATE OR REPLACE FUNCTION bc_ai_user_profiles_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bc_ai_user_profiles_touch ON bc_ai_user_profiles;
CREATE TRIGGER trg_bc_ai_user_profiles_touch
  BEFORE UPDATE ON bc_ai_user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION bc_ai_user_profiles_touch_updated_at();
