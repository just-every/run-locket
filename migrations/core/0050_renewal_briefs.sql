CREATE TABLE lk_accounting_links (
 agreement_id TEXT PRIMARY KEY REFERENCES lk_agreements(id), vendor_id TEXT NOT NULL,
 linked_by TEXT NOT NULL, linked_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE lk_renewal_brief_settings (
 agreement_id TEXT PRIMARY KEY REFERENCES lk_agreements(id), lead_days INTEGER NOT NULL CHECK(lead_days BETWEEN 1 AND 3650),
 decision_maker_id TEXT NOT NULL, configured_by TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, last_error TEXT
);
CREATE TABLE lk_renewal_briefs (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), renewal_id TEXT NOT NULL,
 deadline_at INTEGER NOT NULL, source_digest TEXT NOT NULL, sources TEXT NOT NULL, content TEXT NOT NULL,
 artifact_id TEXT NOT NULL REFERENCES lk_artifacts(id), prepared_at INTEGER NOT NULL, request_id TEXT,
 UNIQUE(renewal_id,deadline_at,source_digest)
);
CREATE TABLE lk_price_caps (
 id TEXT PRIMARY KEY, agreement_id TEXT UNIQUE NOT NULL REFERENCES lk_agreements(id), value TEXT NOT NULL, citation TEXT NOT NULL,
 confirmed_by TEXT NOT NULL, confirmed_at INTEGER NOT NULL
);
