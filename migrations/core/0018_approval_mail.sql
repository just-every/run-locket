-- A guarded request is durable before any provider call. A claimed attempt is
-- never automatically resent: an interrupted provider call has an unknown outcome.
CREATE TABLE lk_approval_mail (
 id TEXT PRIMARY KEY,
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 agreement_version INTEGER NOT NULL,
 version_id TEXT NOT NULL REFERENCES lk_versions(id),
 version_digest TEXT NOT NULL,
 recipient_id TEXT NOT NULL,
 recipient_email TEXT NOT NULL,
 review_url TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','suppressed','rejected','rate_limited','uncertain','cancelled')),
 provider TEXT,
 provider_message_id TEXT,
 code TEXT,
 created_at INTEGER NOT NULL,
 attempted_at INTEGER,
 attempt_id TEXT
);
