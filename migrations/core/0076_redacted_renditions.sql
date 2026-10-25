-- Separate immutable files; approval never rewrites an original.
CREATE TABLE lk_redacted_renditions (
 id TEXT PRIMARY KEY,
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES lk_versions(id) ON DELETE CASCADE,
 original_id TEXT NOT NULL REFERENCES lk_artifacts(id) ON DELETE CASCADE,
 artifact_id TEXT NOT NULL UNIQUE REFERENCES lk_artifacts(id) ON DELETE CASCADE,
 original_sha256 TEXT NOT NULL,
 rendition_sha256 TEXT NOT NULL,
 text TEXT NOT NULL,
 roles TEXT NOT NULL DEFAULT '[]',
 policy_version INTEGER,
 approved_by TEXT,
 approved_at INTEGER,
 revision INTEGER NOT NULL DEFAULT 1
);
