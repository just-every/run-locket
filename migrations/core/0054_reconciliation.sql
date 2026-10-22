CREATE TABLE lk_reconciliation_settings (
 agreement_id TEXT PRIMARY KEY REFERENCES lk_agreements(id), counsel_id TEXT NOT NULL,
 finance_id TEXT NOT NULL, owner_id TEXT NOT NULL, consent_by TEXT NOT NULL,
 consent_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE lk_reconciliation_interpretations (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 settings_version INTEGER NOT NULL, source_agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 sources TEXT NOT NULL, cap_bps INTEGER NOT NULL CHECK(cap_bps BETWEEN 0 AND 100000),
 interpretation TEXT NOT NULL, citation TEXT NOT NULL, confirmed_by TEXT NOT NULL,
 confirmed_at INTEGER NOT NULL
);
CREATE TABLE lk_reconciliation_scans (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 interpretation_id TEXT NOT NULL REFERENCES lk_reconciliation_interpretations(id),
 settings_version INTEGER NOT NULL, link_version INTEGER NOT NULL, sources TEXT NOT NULL,
 content TEXT NOT NULL, scanned_by TEXT NOT NULL, scanned_at INTEGER NOT NULL
);
CREATE TABLE lk_reconciliation_findings (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 scan_id TEXT NOT NULL REFERENCES lk_reconciliation_scans(id), fingerprint TEXT NOT NULL, evidence_key TEXT NOT NULL,
 content TEXT NOT NULL, owner_id TEXT NOT NULL, counsel_id TEXT NOT NULL, finance_id TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN ('proposed','finance_confirmed','approved','rejected')),
 finance_by TEXT, finance_at INTEGER, finance_operator_version INTEGER, finance_note TEXT,
 recipient TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, message_text TEXT NOT NULL,
 message_digest TEXT, approved_by TEXT, approved_at INTEGER,
 rejected_by TEXT, rejected_at INTEGER, rejection_reason TEXT, created_at INTEGER NOT NULL,
 UNIQUE(agreement_id,fingerprint)
);
CREATE TABLE lk_reconciliation_dispatches (
 id TEXT PRIMARY KEY, finding_id TEXT UNIQUE NOT NULL REFERENCES lk_reconciliation_findings(id),
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), finding_version INTEGER NOT NULL,
 actor_id TEXT NOT NULL, recipient TEXT NOT NULL, sender TEXT NOT NULL,
 subject TEXT NOT NULL, message_text TEXT NOT NULL, message_digest TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','rejected','uncertain','rate_limited','suppressed','cancelled')),
 attempt_id TEXT, attempted_at INTEGER, provider_message_id TEXT, outcome_code TEXT,
 created_at INTEGER NOT NULL
);
CREATE INDEX lk_reconciliation_scans_agreement ON lk_reconciliation_scans(agreement_id,scanned_at);
CREATE INDEX lk_reconciliation_findings_agreement ON lk_reconciliation_findings(agreement_id,created_at);
CREATE INDEX lk_reconciliation_rejected ON lk_reconciliation_findings(agreement_id,evidence_key,status);
