-- Separate personal consent for status messages; approval consent is unchanged.
CREATE TABLE lk_chat_preferences (
 operator_id TEXT PRIMARY KEY, channels TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE lk_chat_identities (
 channel TEXT NOT NULL CHECK(channel IN ('slack','teams','nook')), provider_id TEXT NOT NULL,
 operator_id TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(channel,provider_id), UNIQUE(channel,operator_id)
);
CREATE TABLE lk_chat_deliveries (
 id TEXT PRIMARY KEY, notification_id TEXT NOT NULL REFERENCES lk_notifications(id), channel TEXT NOT NULL,
 destination TEXT NOT NULL, binding_version INTEGER NOT NULL, preference_version INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','suppressed','rejected','rate_limited','uncertain','cancelled')),
 code TEXT, attempt_id TEXT, provider_message_id TEXT, attempted_at INTEGER, completed_at INTEGER,
 UNIQUE(notification_id,channel)
);
CREATE INDEX lk_chat_waiting ON lk_chat_deliveries(status);
CREATE TABLE lk_chat_intake_launches (
 token_hash TEXT PRIMARY KEY, callback_hash TEXT NOT NULL UNIQUE, operator_id TEXT NOT NULL, provider_id TEXT NOT NULL,
 identity_version INTEGER NOT NULL, expires_at INTEGER NOT NULL, agreement_id TEXT
);
