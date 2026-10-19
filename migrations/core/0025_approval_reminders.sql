-- APPROVE-004: owner-configured approval reminder intervals in business days and
-- the escalation contact used when an approver has no eligible delegate.
-- No row means the defaults: 1 business day, then every business day, escalate after 3.
CREATE TABLE lk_approval_reminder_settings (
 id TEXT PRIMARY KEY CHECK(id='installation'),
 first_after_days INTEGER NOT NULL CHECK(first_after_days BETWEEN 1 AND 30),
 repeat_every_days INTEGER NOT NULL CHECK(repeat_every_days BETWEEN 1 AND 30),
 escalate_after_days INTEGER NOT NULL CHECK(escalate_after_days BETWEEN 1 AND 60),
 escalation_contact_id TEXT,
 updated_by TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);

-- Each approver's US time zone for business days, and their named delegate.
CREATE TABLE lk_approver_preferences (
 operator_id TEXT PRIMARY KEY,
 timezone TEXT NOT NULL,
 delegate_id TEXT,
 updated_by TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);

-- Every reminder and escalation is a guarded outbox row before any provider call.
-- An automatic reminder or escalation exists at most once per pending request and slot,
-- so overlapping scheduled runs never send it twice.
CREATE TABLE lk_approval_reminders (
 id TEXT PRIMARY KEY,
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 version_id TEXT NOT NULL REFERENCES lk_versions(id),
 version_digest TEXT NOT NULL,
 approver_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('reminder','escalation','manual')),
 slot INTEGER,
 recipient_id TEXT NOT NULL,
 recipient_email TEXT NOT NULL,
 recipient_reason TEXT NOT NULL CHECK(recipient_reason IN ('approver','delegate','escalation_contact','owner')),
 review_url TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','suppressed','rejected','rate_limited','uncertain','cancelled')),
 provider TEXT,
 provider_message_id TEXT,
 code TEXT,
 requested_by TEXT NOT NULL,
 due_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 attempted_at INTEGER,
 attempt_id TEXT
);
CREATE UNIQUE INDEX lk_approval_reminders_slot ON lk_approval_reminders(agreement_id, version_id, approver_id, kind, slot) WHERE kind<>'manual';
CREATE INDEX lk_approval_reminders_agreement ON lk_approval_reminders(agreement_id, approver_id);
