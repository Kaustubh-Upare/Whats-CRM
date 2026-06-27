-- Migration 010 - CRM phase 4
--
-- Adds the persistence layer for the React CRM pages already present in the
-- admin UI. All rows are scoped to admin_user_id, matching the rest of the
-- workspace isolation model.

CREATE TABLE IF NOT EXISTS bc_crm_pipelines (
    id            BIGSERIAL PRIMARY KEY,
    admin_user_id BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    is_default    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bc_crm_pipelines_default
    ON bc_crm_pipelines (admin_user_id)
    WHERE is_default;

CREATE TABLE IF NOT EXISTS bc_crm_pipeline_stages (
    id            BIGSERIAL PRIMARY KEY,
    admin_user_id BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    pipeline_id   BIGINT NOT NULL REFERENCES bc_crm_pipelines(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    color         TEXT NOT NULL DEFAULT '#94a3b8',
    position      INT NOT NULL DEFAULT 1,
    automations   JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_crm_pipeline_stages_pipeline
    ON bc_crm_pipeline_stages (pipeline_id, position);

CREATE TABLE IF NOT EXISTS bc_crm_leads (
    id              BIGSERIAL PRIMARY KEY,
    admin_user_id   BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL DEFAULT '',
    phone           TEXT NOT NULL,
    email           TEXT NOT NULL DEFAULT '',
    source          TEXT NOT NULL DEFAULT 'manual',
    status          TEXT NOT NULL DEFAULT 'new',
    score           INT NOT NULL DEFAULT 0,
    interest        TEXT NOT NULL DEFAULT '',
    budget          TEXT NOT NULL DEFAULT '',
    timeline        TEXT NOT NULL DEFAULT '',
    location        TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT '',
    owner_user_id   BIGINT REFERENCES bc_admin_users(id) ON DELETE SET NULL,
    tags            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    conversation_id BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bc_crm_leads_admin_phone
    ON bc_crm_leads (admin_user_id, phone);

CREATE INDEX IF NOT EXISTS idx_bc_crm_leads_admin_status
    ON bc_crm_leads (admin_user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS bc_crm_lead_facts (
    admin_user_id BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    lead_id       BIGINT NOT NULL REFERENCES bc_crm_leads(id) ON DELETE CASCADE,
    fact_key      TEXT NOT NULL,
    fact_value    TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT 'manual',
    confidence    DOUBLE PRECISION NOT NULL DEFAULT 1,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lead_id, fact_key)
);

CREATE TABLE IF NOT EXISTS bc_crm_lead_activities (
    id            BIGSERIAL PRIMARY KEY,
    admin_user_id BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    lead_id       BIGINT NOT NULL REFERENCES bc_crm_leads(id) ON DELETE CASCADE,
    type          TEXT NOT NULL,
    content       TEXT NOT NULL,
    user_id       BIGINT REFERENCES bc_admin_users(id) ON DELETE SET NULL,
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_crm_lead_activities_lead
    ON bc_crm_lead_activities (lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bc_crm_tasks (
    id            BIGSERIAL PRIMARY KEY,
    admin_user_id BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    lead_id       BIGINT NOT NULL REFERENCES bc_crm_leads(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    due_at        TIMESTAMPTZ,
    status        TEXT NOT NULL DEFAULT 'pending',
    assignee_id   BIGINT REFERENCES bc_admin_users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bc_crm_tasks_lead
    ON bc_crm_tasks (lead_id, status, due_at);

CREATE TABLE IF NOT EXISTS bc_crm_deals (
    id                  BIGSERIAL PRIMARY KEY,
    admin_user_id       BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    lead_id             BIGINT NOT NULL REFERENCES bc_crm_leads(id) ON DELETE CASCADE,
    pipeline_id         BIGINT NOT NULL REFERENCES bc_crm_pipelines(id) ON DELETE CASCADE,
    stage_id            BIGINT NOT NULL REFERENCES bc_crm_pipeline_stages(id) ON DELETE RESTRICT,
    name                TEXT NOT NULL,
    value               NUMERIC(14,2),
    currency            TEXT NOT NULL DEFAULT 'INR',
    probability         INT NOT NULL DEFAULT 10,
    expected_close_date DATE,
    owner_user_id       BIGINT REFERENCES bc_admin_users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_crm_deals_lead
    ON bc_crm_deals (lead_id);

CREATE INDEX IF NOT EXISTS idx_bc_crm_deals_stage
    ON bc_crm_deals (stage_id);

CREATE TABLE IF NOT EXISTS bc_crm_sequences (
    id             BIGSERIAL PRIMARY KEY,
    admin_user_id  BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    trigger_event  TEXT NOT NULL DEFAULT 'manual',
    trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bc_crm_sequence_steps (
    id               BIGSERIAL PRIMARY KEY,
    admin_user_id    BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    sequence_id      BIGINT NOT NULL REFERENCES bc_crm_sequences(id) ON DELETE CASCADE,
    position         INT NOT NULL DEFAULT 1,
    delay_minutes    INT NOT NULL DEFAULT 0,
    message_template TEXT NOT NULL,
    condition        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_bc_crm_sequence_steps_sequence
    ON bc_crm_sequence_steps (sequence_id, position);

CREATE TABLE IF NOT EXISTS bc_crm_sequence_enrollments (
    id            BIGSERIAL PRIMARY KEY,
    admin_user_id BIGINT NOT NULL REFERENCES bc_admin_users(id) ON DELETE CASCADE,
    sequence_id   BIGINT NOT NULL REFERENCES bc_crm_sequences(id) ON DELETE CASCADE,
    lead_id       BIGINT NOT NULL REFERENCES bc_crm_leads(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ,
    UNIQUE (sequence_id, lead_id)
);
