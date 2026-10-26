CREATE TABLE lk_accounting_schedules (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 obligation_id TEXT NOT NULL UNIQUE REFERENCES lk_obligations(id),
 agreement_version INTEGER NOT NULL, origin TEXT NOT NULL, payload TEXT NOT NULL,
 citation TEXT NOT NULL, amount_cents INTEGER NOT NULL, due_date TEXT NOT NULL,
 prepared_by TEXT NOT NULL, prepared_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','sending','pending','accepted','uncertain','refused','cancelled')),
 remote_id TEXT, sent_at INTEGER, checked_at INTEGER
);
