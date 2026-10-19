-- Reviewed bulk scheduling is durable; no row is evidence of email delivery.
CREATE TABLE lk_bulk_reminder_previews (
 id TEXT PRIMARY KEY,
 actor_id TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 owner_version INTEGER NOT NULL,
 snapshot TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 applied_at INTEGER
);
CREATE TABLE lk_reminder_schedules (
 id TEXT PRIMARY KEY,
 agreement_id TEXT NOT NULL UNIQUE REFERENCES lk_agreements(id),
 agreement_version INTEGER NOT NULL,
 owner_id TEXT NOT NULL,
 deadline_date TEXT NOT NULL,
 deadline_at INTEGER NOT NULL,
 timezone TEXT NOT NULL,
 term_start TEXT,
 term_end TEXT NOT NULL,
 term_number INTEGER NOT NULL,
 offsets TEXT NOT NULL,
 reminders TEXT NOT NULL,
 preview_id TEXT NOT NULL REFERENCES lk_bulk_reminder_previews(id),
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX lk_reminder_schedules_owner ON lk_reminder_schedules(owner_id);
