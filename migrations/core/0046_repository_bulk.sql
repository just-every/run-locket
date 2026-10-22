-- Reviewed repository operations retain their before/after values and outcomes.
CREATE TABLE lk_repository_bulk (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, status TEXT NOT NULL,
 version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 definitions TEXT NOT NULL DEFAULT '[]', reverting INTEGER NOT NULL DEFAULT 0,
 proposed_by TEXT, evidence TEXT NOT NULL DEFAULT '[]', assumptions TEXT NOT NULL DEFAULT '',
 decided_by TEXT, decided_at INTEGER
);
CREATE TABLE lk_repository_bulk_items (
 operation_id TEXT NOT NULL REFERENCES lk_repository_bulk(id), ordinal INTEGER NOT NULL,
 agreement_id TEXT NOT NULL, snapshot TEXT NOT NULL, changes TEXT NOT NULL DEFAULT '{}',
 outcome TEXT NOT NULL DEFAULT 'selected', reason TEXT, applied_version INTEGER,
 PRIMARY KEY(operation_id,ordinal), UNIQUE(operation_id,agreement_id)
);
CREATE INDEX lk_repository_bulk_actor ON lk_repository_bulk(actor_id,created_at);
-- Empty means existing type/department grants. An assigned group additionally
-- requires current membership; it never bypasses restricted or policy access.
CREATE TABLE lk_agreement_groups (
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 audience_id TEXT NOT NULL REFERENCES lk_intake_audiences(id),
 PRIMARY KEY(agreement_id,audience_id)
);
