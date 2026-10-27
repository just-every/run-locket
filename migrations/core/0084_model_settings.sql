CREATE TABLE lk_model_settings (
 id TEXT PRIMARY KEY CHECK(id='installation'),
 configuration TEXT NOT NULL,
 version INTEGER NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE lk_model_outputs (
 id TEXT PRIMARY KEY,
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES lk_versions(id),
 task TEXT NOT NULL,
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 prompt_version TEXT NOT NULL,
 playbook_version TEXT NOT NULL,
 input_digests TEXT NOT NULL,
 settings_version INTEGER NOT NULL,
 simulated INTEGER NOT NULL,
 status TEXT NOT NULL,
 content TEXT,
 input_tokens INTEGER,
 output_tokens INTEGER,
 estimated_usd_micros INTEGER,
 requested_by TEXT NOT NULL,
 accepted_by TEXT,
 accepted_at INTEGER,
 created_at INTEGER NOT NULL
);
CREATE TABLE lk_model_usage (
 id TEXT PRIMARY KEY,
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 simulated INTEGER NOT NULL,
 input_tokens INTEGER,
 output_tokens INTEGER,
 estimated_usd_micros INTEGER,
 created_at INTEGER NOT NULL
);
