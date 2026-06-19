-- Webhook log: every Meta webhook hit is recorded here in full.
-- Useful for debugging, auditing, and showing a live "incoming payload" feed
-- in the admin UI.
CREATE TABLE IF NOT EXISTS bc_webhook_logs (
    id              BIGSERIAL PRIMARY KEY,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_ip       TEXT,
    user_agent      TEXT,
    event_kind      TEXT NOT NULL,                -- 'status' | 'message' | 'unknown' | 'error'
    payload         JSONB NOT NULL,                -- raw body verbatim
    parsed_messages  INT NOT NULL DEFAULT 0,        -- count of inbound messages found
    parsed_statuses  INT NOT NULL DEFAULT 0,        -- count of status updates found
    parse_error     TEXT
);

CREATE INDEX IF NOT EXISTS bc_webhook_logs_received_at_idx
    ON bc_webhook_logs (received_at DESC);

CREATE INDEX IF NOT EXISTS bc_webhook_logs_event_kind_idx
    ON bc_webhook_logs (event_kind, received_at DESC);