-- Keep the sponsor in prepared_by for native visibility and self-approval.
-- This binding retains the authenticated agent command separately.
CREATE TABLE lk_proposal_agents (
 proposal_id TEXT PRIMARY KEY REFERENCES lk_proposals(id) ON DELETE CASCADE,
 command_id TEXT NOT NULL UNIQUE REFERENCES lk_agent_commands(command_id) DEFERRABLE INITIALLY DEFERRED
);

-- Existing native receipts identify the exact proposal without inferring from
-- a name or timestamp. Human preparations have no agent receipt and stay human.
INSERT INTO lk_proposal_agents(proposal_id,command_id)
 SELECT p.id,a.command_id FROM lk_proposals p
 JOIN lk_commands c ON c.type='proposal.prepare' AND json_extract(c.result,'$.id')=p.id
 JOIN lk_agent_commands a ON a.command_id=c.id;
