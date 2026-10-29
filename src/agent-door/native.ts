import { ToolRefusal, type ToolContext } from '../modules/agent-door/index.ts'
import type { Bindings } from '../auth.server'
import { nativeActor } from './people'
import { runCommand, type Handler } from '../locket/commands'
import { Problem, sha256, canonical, type Actor } from '../locket/model'

/** Door metadata is server-owned and never read from MCP arguments. */
export async function agentActor(env: Bindings, ctx: ToolContext): Promise<Actor> {
  const actor = await nativeActor(env, ctx.person.id)
  const state = await env.DB.prepare('SELECT envelope,local_revision FROM agent_door_state WHERE id=1').first<{ envelope: string | null; local_revision: number }>()
  return { ...actor, agentAdmission: {
    agent: { id: ctx.agent.id, name: ctx.agent.name }, consent: ctx.consent ?? null,
    operationId: ctx.operationId, envelope: state?.envelope ?? null, localRevision: state?.local_revision ?? 0,
    approvers: ctx.approvers.map(person => ({ ...person })),
  } }
}

export async function nativeCall<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() } catch (error) {
    if (error instanceof Problem) throw new ToolRefusal(error.code, 'The native service refused this call.')
    throw error
  }
}

export async function command(env: Bindings, ctx: ToolContext, type: string, payload: Record<string, unknown>, handler: Handler) {
  const digest = await sha256(JSON.stringify([ctx.agent.id, ctx.person.id, ctx.clientId ?? null, ctx.idempotencyKey, type]))
  const commandId = `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`
  const actor = await agentActor(env, ctx)
  const admission = await env.DB.prepare(`SELECT row,evidence FROM agent_door_audit WHERE agent=?
    AND json_extract(row,'$.operation_id')=? AND json_extract(row,'$.sponsor.id')=?
    AND json_extract(row,'$.outcome')='running' ORDER BY sequence DESC LIMIT 1`)
    .bind(ctx.agent.id, ctx.operationId, ctx.person.id).first<{ row: string; evidence: string | null }>()
  const envelope = actor.agentAdmission!.envelope ? JSON.parse(actor.agentAdmission!.envelope!) : null
  const policy = envelope?.document ?? JSON.parse((await env.DB.prepare('SELECT local_document FROM agent_door_state WHERE id=1').first<{ local_document: string | null }>())?.local_document ?? 'null')
  if (!admission?.evidence || canonical(JSON.parse(admission.evidence).document) !== canonical(policy)) throw new ToolRefusal('policy_changed')
  return nativeCall(() => runCommand(env, actor, { commandId, type, payload }, { [type]: handler }))
}
