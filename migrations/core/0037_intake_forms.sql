-- Draft edits are mutable; publication and request snapshots are immutable.
CREATE TABLE lk_intake_forms (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, definition TEXT NOT NULL,
 version INTEGER NOT NULL, published_version_id TEXT, created_by TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE lk_intake_form_versions (
 id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES lk_intake_forms(id), number INTEGER NOT NULL,
 definition TEXT NOT NULL, published_by TEXT NOT NULL, published_at INTEGER NOT NULL,
 UNIQUE(form_id,number)
);
CREATE TABLE lk_request_forms (
 agreement_id TEXT PRIMARY KEY REFERENCES lk_agreements(id), form_version_id TEXT NOT NULL REFERENCES lk_intake_form_versions(id),
 answers TEXT NOT NULL, route TEXT NOT NULL, matched_rule TEXT, reviewer_id TEXT NOT NULL,
 approval_role TEXT NOT NULL CHECK(approval_role IN ('approver','counsel'))
);
CREATE TRIGGER lk_intake_published_immutable BEFORE UPDATE ON lk_intake_form_versions BEGIN SELECT RAISE(ABORT,'Published form versions are immutable'); END;
CREATE TRIGGER lk_request_form_immutable BEFORE UPDATE ON lk_request_forms BEGIN SELECT RAISE(ABORT,'Request form snapshots are immutable'); END;
