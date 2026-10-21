CREATE TABLE lk_approval_rule_drafts (
 id TEXT PRIMARY KEY CHECK(id='installation'), definition TEXT NOT NULL, version INTEGER NOT NULL,
 previewed_version INTEGER, published_id TEXT
);
CREATE TABLE lk_approval_rule_versions (
 id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, definition TEXT NOT NULL,
 published_by TEXT NOT NULL, published_at INTEGER NOT NULL
);
CREATE TABLE lk_approval_rule_snapshots (
 agreement_id TEXT PRIMARY KEY REFERENCES lk_agreements(id), ruleset_id TEXT REFERENCES lk_approval_rule_versions(id), captured_at INTEGER NOT NULL
);
CREATE TABLE lk_approval_inputs (
 agreement_id TEXT PRIMARY KEY REFERENCES lk_agreements(id), risk TEXT NOT NULL,
 data_processing INTEGER NOT NULL CHECK(data_processing IN (0,1)), recorded_by TEXT NOT NULL, recorded_at INTEGER NOT NULL
);
CREATE TABLE lk_approval_absences (
 operator_id TEXT PRIMARY KEY, away INTEGER NOT NULL CHECK(away IN (0,1)),
 delegate_id TEXT, version INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE lk_approval_rule_decisions (
 approval_id TEXT PRIMARY KEY REFERENCES lk_approvals(id), rule_id TEXT NOT NULL,
 approver_id TEXT NOT NULL, acted_as TEXT NOT NULL, absence_version INTEGER NOT NULL
);
CREATE TABLE lk_rule_pending (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL, agreement_version INTEGER NOT NULL,
 version_id TEXT NOT NULL, version_digest TEXT NOT NULL, context_digest TEXT NOT NULL,
 step_id TEXT NOT NULL, approver_id TEXT NOT NULL, recipient_id TEXT, escalation_id TEXT,
 requested_at INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)),
 absence_version INTEGER NOT NULL, policy_version INTEGER NOT NULL
);
CREATE TABLE lk_rule_reminder_events (
 id TEXT PRIMARY KEY, pending_id TEXT NOT NULL REFERENCES lk_rule_pending(id),
 agreement_id TEXT NOT NULL, kind TEXT NOT NULL, slot INTEGER NOT NULL, recipient_id TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE TRIGGER lk_approval_rule_versions_immutable BEFORE UPDATE ON lk_approval_rule_versions BEGIN SELECT RAISE(ABORT,'Published approval rules are immutable'); END;

-- Explicit MOBILE-001 mail links can name a current configured step.
ALTER TABLE lk_approval_mail ADD COLUMN rule_pending_id TEXT;
