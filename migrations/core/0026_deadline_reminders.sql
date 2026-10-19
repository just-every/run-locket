-- RENEW-002: one preferences row per person (US time zone for reminders and
-- approval business days, delegate, daily digest, alternate recipient).
ALTER TABLE lk_approver_preferences RENAME TO lk_person_preferences;
ALTER TABLE lk_person_preferences ADD COLUMN digest INTEGER NOT NULL DEFAULT 0 CHECK(digest IN (0,1));
ALTER TABLE lk_person_preferences ADD COLUMN alternate_id TEXT;

-- Owner-configured reminder offsets in days before a deadline. No row means 90, 60, 30, 7.
CREATE TABLE lk_deadline_reminder_settings (
 id TEXT PRIMARY KEY CHECK(id='installation'),
 offsets TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);

-- Every renewal/obligation reminder, escalation, alternate retry and daily digest
-- is a guarded outbox row before any provider call. A reminder or escalation for a
-- deadline, offset and recipient exists once; a bounced message is retried once.
CREATE TABLE lk_deadline_reminders (
 id TEXT PRIMARY KEY,
 agreement_id TEXT REFERENCES lk_agreements(id),
 subject_kind TEXT NOT NULL CHECK(subject_kind IN ('renewal','obligation','digest')),
 subject_id TEXT NOT NULL,
 deadline_date TEXT NOT NULL,
 deadline_at INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('reminder','escalation','alternate','digest')),
 offset_days INTEGER NOT NULL,
 recipient_id TEXT NOT NULL,
 recipient_email TEXT NOT NULL,
 recipient_reason TEXT NOT NULL,
 timezone TEXT NOT NULL,
 due_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','in_digest','sending','accepted','suppressed','rejected','rate_limited','uncertain','cancelled')),
 provider TEXT,
 provider_message_id TEXT UNIQUE,
 code TEXT,
 digest_id TEXT,
 retry_of TEXT UNIQUE,
 created_at INTEGER NOT NULL,
 attempted_at INTEGER,
 attempt_id TEXT
);
CREATE UNIQUE INDEX lk_deadline_reminders_slot ON lk_deadline_reminders(subject_kind, subject_id, deadline_date, kind, offset_days, recipient_id) WHERE kind IN ('reminder','escalation','digest');
CREATE INDEX lk_deadline_reminders_agreement ON lk_deadline_reminders(agreement_id);
CREATE INDEX lk_deadline_reminders_digest ON lk_deadline_reminders(digest_id);

-- Provider delivery, bounce and complaint events for those messages, signed bytes kept.
CREATE TABLE lk_deadline_reminder_events (
 id TEXT PRIMARY KEY,
 reminder_id TEXT NOT NULL REFERENCES lk_deadline_reminders(id),
 agreement_id TEXT REFERENCES lk_agreements(id),
 status TEXT NOT NULL,
 occurred_at INTEGER NOT NULL,
 detail TEXT NOT NULL,
 fingerprint TEXT,
 recorded_at INTEGER NOT NULL
);
