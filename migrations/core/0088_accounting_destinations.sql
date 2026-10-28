CREATE TABLE lk_accounting_destinations (
 provider TEXT PRIMARY KEY CHECK(provider='pantry'),
 origin TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 configured_by TEXT NOT NULL, configured_at INTEGER NOT NULL
);
-- Legacy proposals have no destination consent revision and cannot be sent.
ALTER TABLE lk_accounting_schedules ADD COLUMN destination_revision INTEGER NOT NULL DEFAULT 0;

-- Retain stale unsent drafts as cancelled when the owner prepares fresh consent.
CREATE TABLE lk_accounting_revised_schedules (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 obligation_id TEXT NOT NULL REFERENCES lk_obligations(id),
 agreement_version INTEGER NOT NULL, origin TEXT NOT NULL, payload TEXT NOT NULL,
 citation TEXT NOT NULL, amount_cents INTEGER NOT NULL, due_date TEXT NOT NULL,
 prepared_by TEXT NOT NULL, prepared_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','sending','pending','accepted','uncertain','refused','cancelled')),
 remote_id TEXT, sent_at INTEGER, checked_at INTEGER,
 destination_revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO lk_accounting_revised_schedules SELECT * FROM lk_accounting_schedules;
DROP TABLE lk_accounting_schedules;
ALTER TABLE lk_accounting_revised_schedules RENAME TO lk_accounting_schedules;
CREATE UNIQUE INDEX lk_accounting_active_occurrence ON lk_accounting_schedules(obligation_id,due_date) WHERE status<>'cancelled';
