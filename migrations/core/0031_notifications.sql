-- NOTIFY-001: channel preferences extend the existing person-owned reminder row.
-- Existing digest/timezone, delegates and bounce alternates remain intact.
ALTER TABLE lk_person_preferences ADD COLUMN in_app INTEGER NOT NULL DEFAULT 1 CHECK(in_app IN (0,1));
ALTER TABLE lk_person_preferences ADD COLUMN email INTEGER NOT NULL DEFAULT 1 CHECK(email IN (0,1));

-- Only new business events are inserted. No historical activity is backfilled.
CREATE TABLE lk_notifications (
 id TEXT PRIMARY KEY,
 event_key TEXT NOT NULL,
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 recipient_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 version_id TEXT REFERENCES lk_versions(id),
 version_digest TEXT,
 source_kind TEXT CHECK(source_kind IS NULL OR source_kind IN ('approval_mail','approval_reminder','deadline')),
 source_id TEXT,
 created_at INTEGER NOT NULL,
 read_at INTEGER,
 in_app INTEGER NOT NULL CHECK(in_app IN (0,1)),
 email_status TEXT NOT NULL CHECK(email_status IN ('pending','immediate','digest','sending','accepted','suppressed','rejected','rate_limited','uncertain','cancelled')),
 provider TEXT,
 provider_message_id TEXT,
 code TEXT,
 delivery_id TEXT REFERENCES lk_notification_deliveries(id),
 UNIQUE(event_key,recipient_id),
 CHECK((source_kind IS NULL)=(source_id IS NULL))
);
CREATE INDEX lk_notifications_recipient ON lk_notifications(recipient_id,created_at);
CREATE INDEX lk_notifications_waiting ON lk_notifications(email_status,recipient_id);
CREATE UNIQUE INDEX lk_notifications_source ON lk_notifications(source_kind,source_id,recipient_id) WHERE source_kind IS NOT NULL;

-- One single-use provider claim per immediate event or person/local-day digest.
-- A sending or uncertain claim is never automatically resent.
CREATE TABLE lk_notification_deliveries (
 id TEXT PRIMARY KEY,
 recipient_id TEXT NOT NULL,
 recipient_email TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('immediate','digest')),
 local_date TEXT,
 timezone TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('sending','accepted','suppressed','rejected','rate_limited','uncertain','cancelled')),
 provider TEXT,
 provider_message_id TEXT,
 code TEXT,
 created_at INTEGER NOT NULL,
 attempted_at INTEGER NOT NULL,
 attempt_id TEXT NOT NULL,
 CHECK((kind='digest')=(local_date IS NOT NULL))
);
CREATE UNIQUE INDEX lk_notification_deliveries_day ON lk_notification_deliveries(recipient_id,local_date) WHERE kind='digest';
CREATE INDEX lk_notifications_delivery ON lk_notifications(delivery_id);
