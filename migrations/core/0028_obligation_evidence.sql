-- OBL-002: what an obligation needs before it is done, its risk rating, the
-- evidence recorded when it was done, and the owner's overdue escalation delay.
ALTER TABLE lk_obligations ADD COLUMN evidence TEXT NOT NULL DEFAULT 'none' CHECK(evidence IN ('none','file','link','note'));
ALTER TABLE lk_obligations ADD COLUMN risk TEXT NOT NULL DEFAULT 'medium' CHECK(risk IN ('low','medium','high'));
ALTER TABLE lk_obligations ADD COLUMN evidence_artifact_id TEXT REFERENCES lk_artifacts(id);
ALTER TABLE lk_obligations ADD COLUMN evidence_link TEXT;
ALTER TABLE lk_obligations ADD COLUMN evidence_note TEXT;
ALTER TABLE lk_deadline_reminder_settings ADD COLUMN overdue_escalation_days INTEGER NOT NULL DEFAULT 3 CHECK(overdue_escalation_days BETWEEN 1 AND 60);
