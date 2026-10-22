-- Counterparty capabilities carry only a hash. Source originals stay unchanged.
ALTER TABLE lk_comments ADD COLUMN external_author_name TEXT;
ALTER TABLE lk_comments ADD COLUMN external_author_email TEXT;
CREATE TABLE lk_version_audiences (
 version_id TEXT PRIMARY KEY REFERENCES lk_versions(id), audience TEXT NOT NULL CHECK(audience IN ('internal','external')),
 revision INTEGER NOT NULL DEFAULT 1, changed_by TEXT NOT NULL, changed_at INTEGER NOT NULL
);
CREATE TABLE lk_comment_audiences (
 comment_id TEXT PRIMARY KEY REFERENCES lk_comments(id), audience TEXT NOT NULL CHECK(audience IN ('internal','external')),
 revision INTEGER NOT NULL DEFAULT 1, changed_by TEXT NOT NULL, changed_at INTEGER NOT NULL
);
CREATE TABLE lk_exchanges (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), version_id TEXT NOT NULL REFERENCES lk_versions(id),
 party_id TEXT NOT NULL REFERENCES lk_parties(id), version_digest TEXT NOT NULL, artifact_id TEXT NOT NULL REFERENCES lk_artifacts(id), token_hash TEXT NOT NULL UNIQUE,
 sender_id TEXT NOT NULL, sender_session_id TEXT NOT NULL, sender_operator_version INTEGER NOT NULL,
 recipient_name TEXT NOT NULL, recipient_email TEXT NOT NULL, contact_consent TEXT NOT NULL,
 expires_at INTEGER NOT NULL, revoked_at INTEGER, created_at INTEGER NOT NULL, opened_at INTEGER,
 channel TEXT NOT NULL CHECK(channel IN ('link','email')), status TEXT NOT NULL,
 provider TEXT, provider_message_id TEXT, attempt_id TEXT, revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX lk_exchanges_agreement ON lk_exchanges(agreement_id);
CREATE TABLE lk_exchange_commands (
 id TEXT PRIMARY KEY, exchange_id TEXT NOT NULL REFERENCES lk_exchanges(id), digest TEXT NOT NULL,
 result TEXT NOT NULL, created_at INTEGER NOT NULL
);
