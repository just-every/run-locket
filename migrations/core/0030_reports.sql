CREATE TABLE lk_reports (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, definition TEXT NOT NULL, group_field TEXT NOT NULL,
 frequency TEXT NOT NULL, format TEXT NOT NULL, recipients TEXT NOT NULL, first_at INTEGER NOT NULL, first_local TEXT NOT NULL, timezone TEXT NOT NULL,
 next_at INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE lk_report_deliveries (
 id TEXT PRIMARY KEY, report_id TEXT NOT NULL, due_at INTEGER NOT NULL, recipient_id TEXT NOT NULL,
 status TEXT NOT NULL, provider_message_id TEXT, detail TEXT, created_at INTEGER NOT NULL,
 UNIQUE(report_id,due_at,recipient_id)
);
