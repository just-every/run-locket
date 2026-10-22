-- AGENT-007: human-recorded outcomes and immutable measured recommendations.
CREATE TABLE lk_negotiation_outcomes (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 version_id TEXT NOT NULL REFERENCES lk_versions(id), version_digest TEXT NOT NULL,
 deviation_id TEXT NOT NULL UNIQUE REFERENCES lk_deviations(id),
 approval_id TEXT NOT NULL REFERENCES lk_approvals(id), playbook_version_id TEXT NOT NULL REFERENCES lk_playbook_versions(id),
 clause_key TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('accepted','rejected')),
 start INTEGER NOT NULL, end INTEGER NOT NULL, quote TEXT NOT NULL,
 evidence TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at INTEGER NOT NULL
);
CREATE TABLE lk_playbook_issues (
 id TEXT PRIMARY KEY, outcome_id TEXT NOT NULL REFERENCES lk_negotiation_outcomes(id),
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 kind TEXT NOT NULL CHECK(kind IN ('dispute','missed_obligation','credit','none_observed')),
 description TEXT NOT NULL, evidence TEXT NOT NULL, obligation_id TEXT REFERENCES lk_obligations(id),
 recorded_by TEXT NOT NULL, recorded_at INTEGER NOT NULL
);
CREATE TABLE lk_playbook_recommendations (
 id TEXT PRIMARY KEY, source_playbook_id TEXT NOT NULL REFERENCES lk_playbook_versions(id),
 clause_key TEXT NOT NULL, wording TEXT NOT NULL, analysis TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('proposed','approved','rejected')),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 decided_by TEXT, decided_at INTEGER, reason TEXT,
 new_playbook_id TEXT REFERENCES lk_playbook_versions(id)
);
CREATE TABLE lk_playbook_applications (
 id TEXT PRIMARY KEY REFERENCES lk_playbook_versions(id),
 recommendation_id TEXT NOT NULL UNIQUE REFERENCES lk_playbook_recommendations(id),
 source_playbook_id TEXT NOT NULL REFERENCES lk_playbook_versions(id),
 scope TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at INTEGER NOT NULL
);
CREATE INDEX lk_outcomes_source ON lk_negotiation_outcomes(playbook_version_id,clause_key);
CREATE INDEX lk_issues_outcome ON lk_playbook_issues(outcome_id);
