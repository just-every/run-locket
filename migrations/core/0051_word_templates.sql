CREATE TABLE lk_word_templates (
 id TEXT PRIMARY KEY REFERENCES lk_template_versions(id), source_artifact_id TEXT NOT NULL REFERENCES lk_artifacts(id),
 source_text TEXT NOT NULL, marks TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 preview_revision INTEGER, preview_artifact_id TEXT REFERENCES lk_artifacts(id)
);
