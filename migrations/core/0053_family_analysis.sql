-- Version-bound analysis and explicit counsel operational choices.
CREATE TABLE lk_family_analyses (
 id TEXT PRIMARY KEY,
 root_id TEXT NOT NULL REFERENCES lk_agreements(id),
 revision INTEGER NOT NULL,
 facts TEXT NOT NULL,
 sources TEXT NOT NULL,
 source_digest TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('prepared','pending','resolved')),
 conflicts TEXT NOT NULL DEFAULT '[]',
 choices TEXT NOT NULL DEFAULT '[]',
 prepared_by TEXT NOT NULL,
 prepared_at INTEGER NOT NULL,
 analyzed_at INTEGER,
 resolved_by TEXT,
 resolved_at INTEGER,
 reason TEXT,
 UNIQUE(root_id,revision)
);
CREATE TABLE lk_family_obligation_sources (
 obligation_id TEXT PRIMARY KEY REFERENCES lk_obligations(id),
 root_id TEXT NOT NULL REFERENCES lk_agreements(id),
 analysis_id TEXT NOT NULL REFERENCES lk_family_analyses(id),
 term_key TEXT NOT NULL,
 offset_days INTEGER NOT NULL,
 selected_by TEXT NOT NULL,
 selected_at INTEGER NOT NULL
);
