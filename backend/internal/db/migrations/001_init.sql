-- WhatsyITC — initial schema
-- All tables prefixed bc_ to avoid collisions with other services in the same DB.

CREATE TABLE IF NOT EXISTS bc_admin_users (
    id              BIGSERIAL PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    name            TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'admin', -- 'admin' | 'uploader' | 'approver' | 'viewer'
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS bc_retailers (
    id              BIGSERIAL PRIMARY KEY,
    retailer_code   TEXT NOT NULL UNIQUE,
    retailer_name   TEXT NOT NULL,
    whatsapp_number TEXT NOT NULL,
    city            TEXT,
    state           TEXT,
    is_opted_out    BOOLEAN NOT NULL DEFAULT FALSE,
    opted_out_at    TIMESTAMPTZ,
    opted_out_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bc_retailers_phone ON bc_retailers(whatsapp_number);
CREATE INDEX IF NOT EXISTS idx_bc_retailers_name  ON bc_retailers(retailer_name);
CREATE INDEX IF NOT EXISTS idx_bc_retailers_city  ON bc_retailers(city);

CREATE TABLE IF NOT EXISTS bc_templates (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    language_code   TEXT NOT NULL DEFAULT 'en',
    category        TEXT NOT NULL DEFAULT 'utility', -- 'utility' | 'marketing' | 'authentication'
    body            TEXT NOT NULL,
    variable_count  INT NOT NULL DEFAULT 0,
    sample_payload  JSONB,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bc_templates_name_lang ON bc_templates(name, language_code);

CREATE TABLE IF NOT EXISTS bc_upload_batches (
    id              BIGSERIAL PRIMARY KEY,
    file_name       TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type       TEXT NOT NULL,
    total_rows      INT NOT NULL DEFAULT 0,
    valid_rows      INT NOT NULL DEFAULT 0,
    invalid_rows    INT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'uploaded', -- uploaded|validated|approved|sending|completed|failed
    uploaded_by     BIGINT REFERENCES bc_admin_users(id),
    approved_by     BIGINT REFERENCES bc_admin_users(id),
    approved_at     TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bc_upload_batches_status      ON bc_upload_batches(status);
CREATE INDEX IF NOT EXISTS idx_bc_upload_batches_created_at  ON bc_upload_batches(created_at DESC);

CREATE TABLE IF NOT EXISTS bc_billing_records (
    id                BIGSERIAL PRIMARY KEY,
    batch_id          BIGINT NOT NULL REFERENCES bc_upload_batches(id) ON DELETE CASCADE,
    row_number        INT NOT NULL,
    retailer_code     TEXT,
    retailer_name     TEXT,
    whatsapp_number   TEXT,
    invoice_number    TEXT,
    billing_amount    NUMERIC(12,2),
    due_date          DATE,
    payment_link      TEXT,
    language          TEXT,
    raw_row           JSONB,
    is_valid          BOOLEAN NOT NULL DEFAULT FALSE,
    validation_errors JSONB,
    retailer_id       BIGINT REFERENCES bc_retailers(id),
    message_job_id    BIGINT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bc_billing_records_batch  ON bc_billing_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_bc_billing_records_valid  ON bc_billing_records(batch_id, is_valid);

CREATE TABLE IF NOT EXISTS bc_message_jobs (
    id                BIGSERIAL PRIMARY KEY,
    batch_id          BIGINT NOT NULL REFERENCES bc_upload_batches(id) ON DELETE CASCADE,
    billing_record_id BIGINT NOT NULL REFERENCES bc_billing_records(id) ON DELETE CASCADE,
    retailer_id       BIGINT REFERENCES bc_retailers(id),
    to_number         TEXT NOT NULL,
    template_name     TEXT NOT NULL,
    language_code     TEXT NOT NULL DEFAULT 'en',
    template_params   JSONB,
    status            TEXT NOT NULL DEFAULT 'queued', -- queued|sending|sent|delivered|read|failed
    attempts          INT NOT NULL DEFAULT 0,
    max_attempts      INT NOT NULL DEFAULT 3,
    last_error        TEXT,
    provider_msg_id   TEXT,
    queued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at           TIMESTAMPTZ,
    delivered_at      TIMESTAMPTZ,
    read_at           TIMESTAMPTZ,
    failed_at         TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bc_message_jobs_batch    ON bc_message_jobs(batch_id);
CREATE INDEX IF NOT EXISTS idx_bc_message_jobs_status   ON bc_message_jobs(status);
CREATE INDEX IF NOT EXISTS idx_bc_message_jobs_prov     ON bc_message_jobs(provider_msg_id);
CREATE INDEX IF NOT EXISTS idx_bc_message_jobs_retailer ON bc_message_jobs(retailer_id);

-- The FK is added in a separate ALTER (because of circular dependency with bc_message_jobs).
-- We guard it so re-running the migration file on an already-migrated DB is a no-op.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_bc_billing_records_message_job'
    ) THEN
        ALTER TABLE bc_billing_records
            ADD CONSTRAINT fk_bc_billing_records_message_job
            FOREIGN KEY (message_job_id) REFERENCES bc_message_jobs(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS bc_message_status_events (
    id              BIGSERIAL PRIMARY KEY,
    message_job_id  BIGINT NOT NULL REFERENCES bc_message_jobs(id) ON DELETE CASCADE,
    provider_msg_id TEXT,
    status          TEXT NOT NULL, -- sent|delivered|read|failed
    reason_code     TEXT,
    reason_text     TEXT,
    raw_payload     JSONB,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bc_status_events_job   ON bc_message_status_events(message_job_id);
CREATE INDEX IF NOT EXISTS idx_bc_status_events_time  ON bc_message_status_events(occurred_at DESC);

CREATE TABLE IF NOT EXISTS bc_audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    actor_id    BIGINT REFERENCES bc_admin_users(id),
    actor_email TEXT,
    action      TEXT NOT NULL,
    entity_type TEXT,
    entity_id   BIGINT,
    metadata    JSONB,
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bc_audit_logs_actor  ON bc_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_bc_audit_logs_action ON bc_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_bc_audit_logs_time   ON bc_audit_logs(created_at DESC);
