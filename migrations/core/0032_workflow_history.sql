-- Observed transitions only. No invented start times for pre-existing stages.
CREATE TABLE lk_workflow_history (
 id TEXT PRIMARY KEY,
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 from_status TEXT,
 to_status TEXT NOT NULL,
 at INTEGER NOT NULL,
 command_id TEXT NOT NULL
);
CREATE INDEX lk_workflow_history_agreement ON lk_workflow_history(agreement_id,at);
