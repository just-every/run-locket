CREATE TABLE lk_proposal_sources (
 id TEXT PRIMARY KEY,
 agreement_id TEXT NOT NULL UNIQUE REFERENCES lk_agreements(id) ON DELETE CASCADE,
 origin TEXT NOT NULL,
 proposal_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 snapshot TEXT NOT NULL,
 imported_by TEXT NOT NULL,
 imported_at INTEGER NOT NULL,
 UNIQUE(origin,proposal_id,revision)
);
CREATE TABLE lk_billing_proposals (
 id TEXT PRIMARY KEY,
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES lk_versions(id),
 payload TEXT NOT NULL,
 terms_digest TEXT NOT NULL,
 status TEXT NOT NULL,
 receipt_id TEXT,
 last_error TEXT,
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
