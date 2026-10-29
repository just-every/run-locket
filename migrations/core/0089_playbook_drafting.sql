-- PLAY-002: one consented source snapshot, one provider attempt, counsel decisions.
CREATE TABLE lk_playbook_drafts (
 id TEXT PRIMARY KEY,
 revision INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','uncertain','failed','proposed','approved')),
 source_playbook_id TEXT REFERENCES lk_playbook_versions(id),
 scope TEXT NOT NULL,
 sources TEXT NOT NULL,
 source_digest TEXT NOT NULL,
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 prompt_version TEXT NOT NULL,
 settings_version INTEGER NOT NULL,
 simulated INTEGER NOT NULL,
 proposals TEXT NOT NULL DEFAULT '[]',
 failure TEXT,
 requested_by TEXT NOT NULL,
 session_id TEXT,
 created_at INTEGER NOT NULL,
 approved_by TEXT,
 approved_at INTEGER,
 reason TEXT,
 new_playbook_id TEXT UNIQUE REFERENCES lk_playbook_versions(id)
);
CREATE TABLE lk_playbook_draft_applications (
 id TEXT PRIMARY KEY REFERENCES lk_playbook_versions(id),
 draft_id TEXT NOT NULL UNIQUE REFERENCES lk_playbook_drafts(id),
 source_playbook_id TEXT REFERENCES lk_playbook_versions(id),
 scope TEXT NOT NULL,
 approved_by TEXT NOT NULL,
 approved_at INTEGER NOT NULL
);
