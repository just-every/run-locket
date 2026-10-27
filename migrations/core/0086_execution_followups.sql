-- Separate decisions for extraction, exact filing destinations and CRM writes.
CREATE TABLE lk_execution_followups (
 id TEXT PRIMARY KEY,
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id) ON DELETE CASCADE,
 package_id TEXT NOT NULL REFERENCES lk_packages(id) ON DELETE CASCADE,
 actor TEXT NOT NULL,
 binding TEXT NOT NULL,
 kind TEXT NOT NULL,
 destination TEXT NOT NULL,
 status TEXT NOT NULL,
 outcome TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX lk_execution_followup_once ON lk_execution_followups(package_id,kind,destination)
 WHERE status IN ('waiting','uncertain','completed');

CREATE TABLE lk_execution_destinations (
 kind TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 configured_by TEXT NOT NULL,
 configured_at INTEGER NOT NULL
);
