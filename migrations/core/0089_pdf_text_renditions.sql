-- Embedded PDF text is derived custody, never an edit to an approved version.
CREATE TABLE lk_pdf_renditions (
 id TEXT PRIMARY KEY,
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES lk_versions(id) ON DELETE CASCADE,
 artifact_id TEXT NOT NULL UNIQUE REFERENCES lk_artifacts(id) ON DELETE CASCADE,
 source_sha256 TEXT NOT NULL,
 version_digest TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',
 processed_pages INTEGER NOT NULL DEFAULT 0,
 total_pages INTEGER,
 text TEXT NOT NULL DEFAULT '',
 pages TEXT NOT NULL DEFAULT '[]',
 error TEXT,
 revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX lk_pdf_renditions_pending ON lk_pdf_renditions(status,created_at);
