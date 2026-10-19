-- Frozen letters, one-use outbound claims and separately attributed delivery evidence.
CREATE TABLE lk_notice_letters (
  id TEXT PRIMARY KEY REFERENCES lk_notices(id), agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
  artifact_id TEXT NOT NULL REFERENCES lk_artifacts(id), sha256 TEXT NOT NULL, recipient TEXT NOT NULL
);
CREATE TABLE lk_notice_dispatches (
  id TEXT PRIMARY KEY, notice_id TEXT NOT NULL UNIQUE REFERENCES lk_notices(id),
  agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), agreement_version INTEGER NOT NULL,
  actor_id TEXT NOT NULL, recipient TEXT NOT NULL, pdf_artifact_id TEXT NOT NULL REFERENCES lk_artifacts(id), pdf_sha256 TEXT NOT NULL,
  sender TEXT NOT NULL, subject TEXT NOT NULL, message_text TEXT NOT NULL, status TEXT NOT NULL,
  provider TEXT, provider_message_id TEXT UNIQUE, code TEXT, attempt_id TEXT, created_at INTEGER NOT NULL, attempted_at INTEGER
);
CREATE TABLE lk_notice_events (
  id TEXT PRIMARY KEY, notice_id TEXT NOT NULL REFERENCES lk_notices(id), agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
  status TEXT NOT NULL, occurred_at INTEGER NOT NULL, source TEXT NOT NULL, detail TEXT NOT NULL,
  fingerprint TEXT NOT NULL, recorded_at INTEGER NOT NULL
);
CREATE TABLE lk_notice_tracking (
  id TEXT PRIMARY KEY REFERENCES lk_notices(id), agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
  tracking_number TEXT NOT NULL, status TEXT NOT NULL, delivered_at INTEGER, detail TEXT NOT NULL
);
