import type { Ctx } from './commands'
import { json, sql, type Actor } from './model'

/** Authenticated admission is the only source of agent identity. */
export const actorLabel = (actor: Actor) => actor.agentAdmission
  ? `${actor.agentAdmission.agent.name} for ${actor.name}` : actor.name

export function agentCommandWrites(c: Ctx) {
  const admission = c.actor.agentAdmission
  return admission ? [sql(`INSERT INTO lk_agent_commands
    (command_id,operation_id,agent_id,agent_name,sponsor_id,sponsor_name,consent,approvers)
    VALUES(?,?,?,?,?,?,?,?)`, c.commandId, admission.operationId, admission.agent.id,
  admission.agent.name, c.actor.id, c.actor.name, admission.consent, json(admission.approvers))] : []
}

/** The proposal and its command provenance commit in the same guarded batch. */
export function proposalPreparerWrites(c: Ctx, proposalId: string) {
  return c.actor.agentAdmission ? [sql('INSERT INTO lk_proposal_agents(proposal_id,command_id) VALUES(?,?)', proposalId, c.commandId)] : []
}

export async function preparedProposals(db: D1Database) {
  return (await db.prepare(`SELECT p.*,a.command_id AS prepared_command_id,
    a.operation_id AS prepared_operation_id,a.agent_id AS prepared_agent_id,
    a.agent_name AS prepared_agent_name,a.sponsor_id AS prepared_sponsor_id,
    a.sponsor_name AS prepared_sponsor_name,
    CASE WHEN a.command_id IS NOT NULL THEN a.agent_name || ' for ' || a.sponsor_name END AS prepared_label
    FROM lk_proposals p LEFT JOIN lk_proposal_agents binding ON binding.proposal_id=p.id
    LEFT JOIN lk_agent_commands a ON a.command_id=binding.command_id
    ORDER BY p.prepared_at DESC`).all<any>()).results
}
