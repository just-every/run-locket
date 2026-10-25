-- Operational success is distinct from a successful read-only probe.
ALTER TABLE lk_connection_health ADD COLUMN last_sync_at INTEGER;
CREATE TABLE lk_connection_expiries (
 id TEXT PRIMARY KEY, account TEXT NOT NULL, expires_at INTEGER,
 recorded_by TEXT NOT NULL, recorded_at INTEGER NOT NULL, version INTEGER NOT NULL,
 alert_id TEXT NOT NULL, alert_status TEXT, connection_version INTEGER NOT NULL
);

ALTER TABLE lk_calendar_connections ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
