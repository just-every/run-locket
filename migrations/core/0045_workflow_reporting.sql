-- Record only observed working-stage starts and queue service-level intervals.
-- No backfill invents stage timing or a historical reopening deadline.
CREATE TABLE lk_workflow_stages (
  id TEXT PRIMARY KEY,
  agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  at INTEGER NOT NULL,
  command_id TEXT NOT NULL
);
CREATE INDEX lk_workflow_stages_agreement ON lk_workflow_stages(agreement_id,at);
CREATE TABLE lk_workflow_service_levels (
  agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
  generation INTEGER NOT NULL,
  team_id TEXT,
  started_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  closed_at INTEGER,
  outcome TEXT,
  PRIMARY KEY(agreement_id,generation)
);
