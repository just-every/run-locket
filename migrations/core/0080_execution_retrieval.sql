-- Owner-authorized, exact-package retrieval; no signature evidence is fabricated.
CREATE TABLE lk_execution_retrievals (
 id TEXT PRIMARY KEY,
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id) ON DELETE CASCADE,
 package_id TEXT NOT NULL UNIQUE REFERENCES lk_packages(id) ON DELETE CASCADE,
 actor TEXT NOT NULL,
 connection_version INTEGER NOT NULL,
 status TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL,
 lease_until INTEGER,
 last_error TEXT,
 execution_id TEXT REFERENCES lk_executions(id),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
