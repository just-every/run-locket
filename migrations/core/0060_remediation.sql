-- Immutable confirmed requirements and exact owner-approved remediation occurrences.
CREATE TABLE lk_remediation_requirements (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), obligation_id TEXT NOT NULL REFERENCES lk_obligations(id),
 kind TEXT NOT NULL CHECK(kind IN ('coi','document')), requirement TEXT NOT NULL, citation TEXT NOT NULL, source TEXT NOT NULL,
 confirmed_by TEXT NOT NULL, created_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE lk_remediation_requests (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), requirement_id TEXT NOT NULL REFERENCES lk_remediation_requirements(id),
 recipient TEXT NOT NULL, source TEXT NOT NULL, digest TEXT NOT NULL, prepared_by TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','approved','cancelled')),
 approved_by TEXT, operator_version INTEGER, sender TEXT, approved_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE lk_remediation_occurrences (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), request_id TEXT NOT NULL REFERENCES lk_remediation_requests(id),
 send_at INTEGER NOT NULL, subject TEXT NOT NULL, message_text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 attempt_id TEXT, attempted_at INTEGER, provider_message_id TEXT, outcome_code TEXT
);
CREATE TABLE lk_remediation_evidence (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), requirement_id TEXT NOT NULL REFERENCES lk_remediation_requirements(id),
 artifact_id TEXT NOT NULL REFERENCES lk_artifacts(id), sha256 TEXT NOT NULL, assessment TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('rejected','needs_confirmation','matched','confirmed')),
 recorded_by TEXT NOT NULL, recorded_at INTEGER NOT NULL, confirmed_by TEXT, confirmed_at INTEGER, confirmation TEXT
);
CREATE INDEX lk_remediation_due ON lk_remediation_occurrences(status,send_at);
CREATE UNIQUE INDEX lk_remediation_active ON lk_remediation_requirements(obligation_id) WHERE active=1;
