-- Native provenance belongs to the command transaction and survives key expiry.
CREATE TABLE lk_agent_commands (
 command_id TEXT PRIMARY KEY REFERENCES lk_commands(id) DEFERRABLE INITIALLY DEFERRED,
 operation_id TEXT NOT NULL, agent_id TEXT NOT NULL, agent_name TEXT NOT NULL,
 sponsor_id TEXT NOT NULL, sponsor_name TEXT NOT NULL, consent TEXT,
 approvers TEXT NOT NULL
);
