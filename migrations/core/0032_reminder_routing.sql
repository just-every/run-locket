-- NOTIFY-001 / APPROVE-004: owner-managed routing never creates or changes
-- the person's delivery preferences, including their unset/default zone.
CREATE TABLE lk_reminder_routing (
 operator_id TEXT PRIMARY KEY,
 delegate_id TEXT,
 alternate_id TEXT,
 updated_by TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
INSERT INTO lk_reminder_routing
 SELECT operator_id,delegate_id,alternate_id,updated_by,updated_at
 FROM lk_person_preferences WHERE delegate_id IS NOT NULL OR alternate_id IS NOT NULL;
ALTER TABLE lk_person_preferences DROP COLUMN delegate_id;
ALTER TABLE lk_person_preferences DROP COLUMN alternate_id;
