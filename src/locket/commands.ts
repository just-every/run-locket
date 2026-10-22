import { syncRulePending } from './approval-rules'
import { hiddenFields, policyVersionCheck, repositoryPolicy, requireFullFields } from './repository-access'
import { commandNotifications } from './notification-events'
import { workflowWrites } from './workflow-history'
import { runNotifications } from './notification-dispatch'
// One consequential write = one D1 batch: guard (session, role, record
// versions) → writes → durable command outcome → audit → guard release.
// Retrying the same commandId with the same payload returns the first outcome.
import type { Bindings } from '../auth.server'
import { authority } from './access'
import { authorizeBulkPreviewResult } from './bulk-reminders'
import { dispatchNotice } from './notice-mail'
import { dispatchApprovalMail } from './approval-mail'
import { deliverReminder } from './approval-reminder-dispatch'
import { canonical, fail, json, object, Problem, sha256, sql, type Actor, type Role, type Sql } from './model'

export interface Ctx {
  env: Bindings
  db: D1Database
  actor: Actor
  now: number
  commandId: string
  request?: Request
}
export interface AuditEntry {
  action: string
  agreementId?: string | null
  summary: string
}
export interface Outcome {
  allowed: readonly Role[]
  result: unknown
  writes: Sql[]
  checks?: Sql[]
  audit: AuditEntry[]
}
export type Handler = (c: Ctx, payload: Record<string, unknown>) => Promise<Outcome>

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const auditSql = (c: Ctx, entry: AuditEntry, principalRole: string = c.actor.role): Sql =>
  sql('INSERT INTO lk_audit VALUES(?,?,?,?,?,?,?,?,?)', crypto.randomUUID(), c.now, c.actor.id, c.actor.name, principalRole, entry.action, entry.agreementId ?? null, entry.summary, c.commandId)

export function guardSql(id: string, conditions: Sql[]): Sql {
  return sql(
    `INSERT INTO lk_guard VALUES(?, CASE WHEN ${conditions.map(c => `(${c.sql})`).join(' AND ')} THEN 1 ELSE 0 END)`,
    id,
    ...conditions.flatMap(c => c.params),
  )
}

const bind = (db: D1Database, s: Sql) => db.prepare(s.sql).bind(...s.params)

/** Commit statements behind the guard; distinguish lost authority from stale records. */
export async function commit(c: Ctx, allowed: readonly Role[], checks: Sql[], statements: Sql[]): Promise<void> {
  const guardId = crypto.randomUUID()
  const batch = [guardSql(guardId, [authority(c.actor, allowed), ...checks]), ...statements, sql('DELETE FROM lk_guard WHERE id=?', guardId)]
  try {
    await c.db.batch(batch.map(s => bind(c.db, s)))
  } catch (error) {
    const message = String((error as Error)?.message ?? error)
    if (message.includes('LOCKET_LEGAL_HOLD')) fail('LEGAL_HOLD', 'Counsel must release the legal hold before deleting this agreement or its files.', 409)
    if (message.includes('LOCKET_REQUIRED_FIELDS')) fail('FIELDS', 'Fill all custom fields required at this stage before continuing.', 409)
    if (!message.includes('LOCKET_GUARD') && !message.includes('CHECK constraint')) throw error
    const auth = authority(c.actor, allowed)
    const ok = await c.db.prepare(`SELECT CASE WHEN ${auth.sql} THEN 1 ELSE 0 END AS ok`).bind(...auth.params).first<{ ok: number }>()
    if (!ok?.ok) fail('AUTHORITY', 'Your session or role changed before this action was saved. Sign in again or ask the owner for access.', 403)
    fail('STALE', 'These records changed since you loaded them. Reload and review before trying again.', 409)
  }
}

export async function runCommand(env: Bindings, actor: Actor, body: unknown, handlers: Record<string, Handler>, request?: Request): Promise<unknown> {
  const input = object(body, 'request')
  const commandId = input.commandId, type = input.type
  if (typeof commandId !== 'string' || !uuid.test(commandId)) fail('INVALID', 'commandId must be a UUID.')
  if (typeof type !== 'string' || !handlers[type]) fail('UNKNOWN_COMMAND', `Unknown command ${String(type)}.`)
  const payload = object(input.payload)
  const c: Ctx = { env, db: env.DB, actor, now: Date.now(), commandId, request }
  const completed = async (result: unknown) => {
    await syncRulePending(env,c.now)
    if (type === 'renewal.bulk.preview') await authorizeBulkPreviewResult(c, result)
    if (type === 'approval.email') await dispatchApprovalMail(c)
    if (type === 'approval.remind') await deliverReminder(c, commandId, true)
    if (type === 'notice.email') await dispatchNotice(c)
    await runNotifications(env, c.now, false)
    return result
  }
  const digest = await sha256(canonical({ type, payload }))
  if(!/^(view\.|notification\.|preferences\.)/.test(type))await requireFullFields(c.db,actor)
  const prior = await env.DB.prepare('SELECT digest, actor_id, result FROM lk_commands WHERE id=?').bind(commandId).first<{ digest: string; actor_id: string; result: string }>()
  if (prior) {
    if (prior.digest !== digest || prior.actor_id !== actor.id) fail('IDEMPOTENCY', 'This command identity was already used for different content.', 409)
    return completed(JSON.parse(prior.result))
  }
  if(typeof payload.agreementId==='string')await requireFullFields(c.db,actor)
  const policy=await repositoryPolicy(c.db)
  const out = await handlers[type](c, payload)
  out.checks=[...(out.checks??[]),policyVersionCheck(policy.version)]
  const notifications = await commandNotifications(c, type, payload, out)
  const workflow = await workflowWrites(c, out.audit)
  try {
    await commit(c, out.allowed, out.checks ?? [], [
      ...out.writes,
      ...workflow,
      ...notifications,
      sql('INSERT INTO lk_commands VALUES(?,?,?,?,?,?)', commandId, type, actor.id, digest, json(out.result), c.now),
      ...out.audit.map(entry => auditSql(c, entry)),
    ])
  } catch (error) {
    // A concurrent retry of the same command may have won the race.
    if (!(error instanceof Problem) && String((error as Error)?.message).includes('UNIQUE constraint failed')) {
      const won = await env.DB.prepare('SELECT digest, actor_id, result FROM lk_commands WHERE id=?').bind(commandId).first<{ digest: string; actor_id: string; result: string }>()
      if (won?.digest === digest && won.actor_id === actor.id) return completed(JSON.parse(won.result))
    }
    throw error
  }
  return completed(out.result)
}

/** A signed customer-site assertion is a separate principal, never a Base role.
 * Its handler supplies current-version, expiration and one-use nonce checks. */
export async function runSiteCommand(c: Ctx, out: Outcome, digest: string): Promise<unknown> {
  if (!out.checks?.length) fail('AUTH', 'A site acceptance requires guarded evidence.', 403)
  const guardId = crypto.randomUUID()
  const batch = [guardSql(guardId, out.checks), ...out.writes,
    sql('INSERT INTO lk_commands VALUES(?,?,?,?,?,?)', c.commandId, 'clickwrap.accept', c.actor.id, digest, json(out.result), c.now),
    ...out.audit.map(entry => auditSql(c, entry, 'site_asserted')), sql('DELETE FROM lk_guard WHERE id=?', guardId)]
  try { await c.db.batch(batch.map(s => bind(c.db, s))) }
  catch (error) {
    const prior = await c.db.prepare('SELECT actor_id,digest,result FROM lk_commands WHERE id=?').bind(c.commandId).first<{ actor_id: string; digest: string; result: string }>()
    if (prior) {
      if (prior.actor_id === c.actor.id && prior.digest === digest) return JSON.parse(prior.result)
      fail('IDEMPOTENCY', 'This command identity was already used for different content.', 409)
    }
    if (String(error).includes('LOCKET_GUARD') || String(error).includes('CHECK constraint') || String(error).includes('lk_clickwrap_acceptances.nonce')) fail('STALE', 'This link expired, was already accepted, or the terms changed. Return to the website for a new link.', 409)
    throw error
  }
  return out.result
}
