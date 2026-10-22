-- Native personal-data minimization. Legal evidence is retained; holds fence every file removal door.
CREATE TABLE lk_legal_holds (
 agreement_id TEXT PRIMARY KEY REFERENCES lk_agreements(id), active INTEGER NOT NULL CHECK(active IN (0,1)),
 reason TEXT NOT NULL, set_by TEXT NOT NULL, set_at INTEGER NOT NULL,
 released_by TEXT, released_at INTEGER, release_reason TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE lk_erasures (
 id TEXT PRIMARY KEY, subject_hash TEXT NOT NULL, reason TEXT NOT NULL, verification TEXT NOT NULL,
 requested_by TEXT NOT NULL, at INTEGER NOT NULL, changed_records INTEGER NOT NULL
);
CREATE TABLE lk_retention_rules (
 id TEXT PRIMARY KEY CHECK(id='installation'), days INTEGER NOT NULL CHECK(days>=1),
 updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL
);
CREATE TABLE lk_retention_previews (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, rule_version INTEGER NOT NULL, candidates TEXT NOT NULL,
 created_at INTEGER NOT NULL, applied_at INTEGER
);
CREATE TRIGGER lk_held_agreement BEFORE DELETE ON lk_agreements
WHEN EXISTS(SELECT 1 FROM lk_legal_holds WHERE agreement_id=OLD.id AND active=1)
BEGIN SELECT RAISE(ABORT,'LOCKET_LEGAL_HOLD'); END;
CREATE TRIGGER lk_held_artifact BEFORE DELETE ON lk_artifacts
WHEN EXISTS(SELECT 1 FROM lk_legal_holds WHERE agreement_id=OLD.agreement_id AND active=1)
BEGIN SELECT RAISE(ABORT,'LOCKET_LEGAL_HOLD'); END;
CREATE TRIGGER lk_held_chunks BEFORE DELETE ON lk_artifact_chunks
WHEN EXISTS(SELECT 1 FROM lk_artifacts a JOIN lk_legal_holds h ON h.agreement_id=a.agreement_id WHERE a.id=OLD.artifact_id AND h.active=1)
BEGIN SELECT RAISE(ABORT,'LOCKET_LEGAL_HOLD'); END;
