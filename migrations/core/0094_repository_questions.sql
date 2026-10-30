-- Immutable, asker-scoped repository answers; provider usage shares the model ledger.
CREATE TABLE lk_repository_questions (
 id TEXT PRIMARY KEY,
 requested_by TEXT NOT NULL,
 question TEXT NOT NULL,
 sources TEXT NOT NULL,
 input_digests TEXT NOT NULL,
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 prompt_version TEXT NOT NULL,
 settings_version INTEGER NOT NULL,
 simulated INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','uncertain','proposed','accepted')),
 content TEXT,
 input_tokens INTEGER,
 output_tokens INTEGER,
 estimated_usd_micros INTEGER,
 accepted_by TEXT,
 accepted_at INTEGER,
 created_at INTEGER NOT NULL
);
CREATE INDEX lk_repository_questions_asker ON lk_repository_questions(requested_by,created_at);
