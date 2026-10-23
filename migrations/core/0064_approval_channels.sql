-- Channel destinations are owner bound; chat delivery requires personal opt-in.
-- No bearer credential or signed-in authority is stored in a notification link.
CREATE TABLE lk_approval_channel_settings (
 id TEXT PRIMARY KEY CHECK(id='installation'), automatic INTEGER NOT NULL CHECK(automatic IN (0,1)),
 version INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE lk_approval_channel_bindings (
 operator_id TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('slack','teams','nook')),
 destination TEXT NOT NULL, version INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(operator_id,channel)
);
CREATE TABLE lk_approval_channel_preferences (
 operator_id TEXT PRIMARY KEY, channels TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE lk_approval_channel_requests (
 id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 agreement_version INTEGER NOT NULL, version_id TEXT NOT NULL REFERENCES lk_versions(id), version_digest TEXT NOT NULL,
 context_digest TEXT NOT NULL, kind TEXT NOT NULL, deviation_id TEXT, rule_pending_id TEXT,
 recipient_id TEXT NOT NULL, recipient_email TEXT NOT NULL, requested_by TEXT NOT NULL,
 source TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE lk_approval_channel_deliveries (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES lk_approval_channel_requests(id),
 channel TEXT NOT NULL CHECK(channel IN ('email','slack','teams','nook','word','phone')),
 destination TEXT, binding_version INTEGER, preference_version INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','available','suppressed','rejected','rate_limited','uncertain','cancelled')),
 provider_message_id TEXT, code TEXT, attempt_id TEXT, attempted_at INTEGER, completed_at INTEGER,
 UNIQUE(request_id,channel)
);
CREATE INDEX lk_approval_channel_recipient ON lk_approval_channel_requests(recipient_id,created_at);
