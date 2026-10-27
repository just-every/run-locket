-- Renewed consent creates a new retained decision; earlier decisions never revive.
CREATE TABLE lk_execution_retrievals_next (
 id TEXT PRIMARY KEY,
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id) ON DELETE CASCADE,
 package_id TEXT NOT NULL REFERENCES lk_packages(id) ON DELETE CASCADE,
 actor TEXT NOT NULL,
 connection_version INTEGER NOT NULL,
 status TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL,
 lease_until INTEGER,
 last_error TEXT,
 execution_id TEXT REFERENCES lk_executions(id),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 binding TEXT,
 outcomes TEXT NOT NULL DEFAULT '[]'
);
INSERT INTO lk_execution_retrievals_next
 (id,agreement_id,package_id,actor,connection_version,status,attempts,next_attempt_at,lease_until,last_error,execution_id,created_at,updated_at)
 SELECT id,agreement_id,package_id,actor,connection_version,status,attempts,next_attempt_at,lease_until,last_error,execution_id,created_at,updated_at FROM lk_execution_retrievals;
DROP TABLE lk_execution_retrievals;
ALTER TABLE lk_execution_retrievals_next RENAME TO lk_execution_retrievals;
CREATE UNIQUE INDEX lk_retrieval_active_package ON lk_execution_retrievals(package_id)
 WHERE status IN ('waiting','retrying','retrieving');
