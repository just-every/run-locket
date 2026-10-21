-- Durable queue rules, assignment snapshots and reasoned cancellation history.
CREATE TABLE lk_queue_rules (
 type TEXT PRIMARY KEY, audience_id TEXT NOT NULL REFERENCES lk_intake_audiences(id),
 lead_id TEXT NOT NULL, business_days INTEGER NOT NULL CHECK(business_days BETWEEN 1 AND 60),
 cursor INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE lk_request_work (
 agreement_id TEXT PRIMARY KEY REFERENCES lk_agreements(id), assignee_id TEXT NOT NULL,
 team_id TEXT, lead_id TEXT NOT NULL, business_days INTEGER NOT NULL,
 due_at INTEGER NOT NULL, warning_at INTEGER NOT NULL, stage TEXT NOT NULL,
 generation INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE lk_request_cancellations (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 reason TEXT NOT NULL, note TEXT, stage TEXT NOT NULL, prior_status TEXT NOT NULL,
 canceled_by TEXT NOT NULL, canceled_at INTEGER NOT NULL,
 reopened_by TEXT, reopened_at INTEGER, reopen_reason TEXT
);
CREATE TABLE lk_queue_escalations (
 agreement_id TEXT NOT NULL, generation INTEGER NOT NULL, kind TEXT NOT NULL,
 at INTEGER NOT NULL, PRIMARY KEY(agreement_id,generation,kind)
);
