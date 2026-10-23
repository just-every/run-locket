PRAGMA defer_foreign_keys = ON;
CREATE TABLE lk_terms_renewal (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 key TEXT NOT NULL CHECK(key IN ('effective_date','end_date','auto_renew','renewal_term_months','notice_days','governing_law','payment_terms','renewal_type','renewals_allowed','initial_term_months') OR key LIKE 'custom:%'),
 value TEXT NOT NULL, citation TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('proposed','confirmed','rejected','superseded')),
 proposed_by TEXT NOT NULL, proposal_id TEXT, confirmed_by TEXT, confirmed_at INTEGER,
 supersedes_id TEXT, reason TEXT, created_at INTEGER NOT NULL
);
INSERT INTO lk_terms_renewal SELECT * FROM lk_terms;
DROP TABLE lk_terms;
ALTER TABLE lk_terms_renewal RENAME TO lk_terms;
PRAGMA defer_foreign_keys = OFF;
ALTER TABLE lk_renewals ADD COLUMN term_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lk_renewals ADD COLUMN generation_id TEXT;
ALTER TABLE lk_renewals ADD COLUMN decisions TEXT NOT NULL DEFAULT '{}';
ALTER TABLE lk_renewals ADD COLUMN termination_date TEXT;
ALTER TABLE lk_renewals ADD COLUMN evergreen_lead_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE lk_notices ADD COLUMN term_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lk_notices ADD COLUMN generation_id TEXT;
CREATE TABLE lk_renewal_generations (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), source_digest TEXT NOT NULL,
 sources TEXT NOT NULL, created_at INTEGER NOT NULL, superseded_at INTEGER
);
CREATE UNIQUE INDEX lk_renewal_generation_current ON lk_renewal_generations(agreement_id) WHERE superseded_at IS NULL;
CREATE TABLE lk_renewal_history (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), generation_id TEXT NOT NULL REFERENCES lk_renewal_generations(id),
 term_number INTEGER NOT NULL, start_date TEXT, end_date TEXT NOT NULL, deadline_date TEXT, deadline_at INTEGER,
 decision TEXT, decided_by TEXT, decided_at INTEGER, derived_at INTEGER NOT NULL, derived_at_import INTEGER NOT NULL, committed INTEGER NOT NULL,
 UNIQUE(generation_id,term_number)
);
CREATE TABLE lk_renewal_settings (
 agreement_id TEXT PRIMARY KEY REFERENCES lk_agreements(id), evergreen_lead_days INTEGER NOT NULL, configured_by TEXT NOT NULL, configured_at INTEGER NOT NULL
);
CREATE TABLE lk_renewal_terminations (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), generation_id TEXT, term_number INTEGER NOT NULL,
 resolution TEXT NOT NULL CHECK(resolution IN ('early_termination','renewed','notice_recorded')),
 effective_date TEXT, citation TEXT, notice_id TEXT, recorded_by TEXT NOT NULL, recorded_at INTEGER NOT NULL, reason TEXT NOT NULL
);
CREATE TABLE lk_calendar_connections (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('google','outlook')),
 calendar_id TEXT NOT NULL, token TEXT, last_error TEXT, created_at INTEGER NOT NULL, UNIQUE(operator_id,provider,calendar_id)
);
CREATE TABLE lk_calendar_events (
 id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES lk_calendar_connections(id), agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 event_key TEXT NOT NULL, provider_event_id TEXT NOT NULL, deadline_at INTEGER NOT NULL, synchronized_at INTEGER NOT NULL,
 UNIQUE(connection_id,event_key)
);
