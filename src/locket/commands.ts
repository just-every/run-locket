import { runExecutionFollowups } from './execution-followups'
import { completeModelCommand } from './model-settings'
import { authorizeAccountingComparison } from './accounting-comparison'
import { dispatchBillingProposal } from './proposal-handoffs'
import { runExecutionRetrievals } from './execution-retrieval'
import { authorizeAccountingScheduleCheck, dispatchAccountingSchedule } from './accounting-schedules'
import { alertConnectionFailure } from './connection-health'
import { authorizeErasureResult } from './privacy-access'
import { integrationCommandChecks, scopedTokenResult } from './scoped-tokens'
import { dispatchSignature } from './signature-send'
import { authorizeSignatureResult } from './signature-results'
import { runApprovalChannels } from './approval-channel-automatic'
import { authorizeChannelResult } from './approval-channel-requests'
import { authorizeOutcomeReportResult } from './outcome-report'
import { dispatchOutcomeReports } from './outcome-report-dispatch'
import { authorizeReconciliationResult } from './reconciliation-records'
import { authorizeRemediationResult } from './remediation'
import { dispatchRemediation } from './remediation-mail'
import { dispatchReconciliation } from './reconciliation-mail'
import { authorizeServiceResult } from './service-level-records'
import { dispatchServiceClaim } from './service-level-mail'
import { familyCommandChecks } from './family-analysis-guard'
import { refuseErasedAddress } from './erasure-addresses'
import { exchangeResult, exchangeTokens } from './exchange'
import { dispatchExchange } from './exchange-mail'
import { authorizeRepositoryBulkResult } from './repository-bulk'
import { syncRulePending } from './approval-rules'
import { fullFieldsCheck, hiddenFields, policyVersionCheck, repositoryPolicy, requireFullFields } from './repository-access'
import { commandNotifications } from './notification-events'
import { workflowWrites } from './workflow-history'
import { runNotifications } from './notification-dispatch'
// One consequential write = one D1 batch: guard (session, role, record
// versions) → writes → durable command outcome → audit → guard release.
// Retrying the same commandId with the same payload returns the first outcome.
import type { Bindings } from '../auth.server'
import { authority, requireRole } from './access'
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
  renditionChecks?: Sql[]
  erasureChecks?: Sql[]
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
  sql('INSERT INTO lk_audit VALUES(?,?,?,?,?,?,?,?,?)', crypto.randomUUID(), c.now, c.actor.id, c.actor.agentAdmission ? `${c.actor.agentAdmission.agent.name} for ${c.actor.name}` : c.actor.name, principalRole, entry.action, entry.agreementId ?? null, entry.summary, c.commandId)

export function guardSql(id: string, conditions: Sql[]): Sql {
  // Keep all predicates while avoiding SQLite's expression-depth limit as
  // schema-derived custody plans acquire more child tables.
  const conjunction = (parts: string[]): string => parts.length === 0 ? '1' : parts.length === 1 ? `(${parts[0]})` : `(${conjunction(parts.slice(0, Math.floor(parts.length / 2)))} AND ${conjunction(parts.slice(Math.floor(parts.length / 2)))})`
  return sql(
    `INSERT INTO lk_guard VALUES(?, CASE WHEN ${conjunction(conditions.map(c => c.sql))} THEN 1 ELSE 0 END)`,
    id,
    ...conditions.flatMap(c => c.params),
  )
}

const bind = (db: D1Database, s: Sql) => db.prepare(s.sql).bind(...s.params)

/** Commit statements behind the guard; distinguish lost authority from stale records. */
export async function commit(c: Ctx, allowed: readonly Role[], checks: Sql[], statements: Sql[]): Promise<void> {
  const guardId = crypto.randomUUID()
  // Bound each statement's expression depth and binds. All guards run before
  // any writes in the same D1 transaction, so one failed predicate rolls it back.
  const guards = [authority(c.actor, allowed), ...checks].map((check, index) => ({ id: `${guardId}:${index}`, check }))
  const batch = [...guards.map(({ id, check }) => guardSql(id, [check])), ...statements,
    sql('DELETE FROM lk_guard WHERE id IN (SELECT value FROM json_each(?))', json(guards.map(guard => guard.id)))]
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
  if (typeof type !== 'string' || !Object.hasOwn(handlers, type)) fail('UNKNOWN_COMMAND', `Unknown command ${String(type)}.`)
  const payload = object(input.payload)
  const c: Ctx = { env, db: env.DB, actor, now: Date.now(), commandId, request }
  const integrationChecks=await integrationCommandChecks(c,type)
  const completed = async (result: unknown) => {
    if (type.startsWith('import.')) requireRole(c.actor, ['owner'], 'read move-in outcomes')
    result=await completeModelCommand(c,type,result)
    if(type==='accounting.compare')await authorizeAccountingComparison(c,payload)
    if(type==='proposal.import'||type.startsWith('billing.proposal.'))requireRole(c.actor,['owner'],'read proposal handoff outcomes')
    if(type==='billing.proposal.send')await dispatchBillingProposal(c,(result as {id:string}).id)
    if(type==='execution.retrieval.authorize')await runExecutionRetrievals(env,c.now,(result as {id:string}).id)
    if(type==='execution.followup.authorize')await runExecutionFollowups(env,c.now,(result as {id:string}).id)
    if(type==='accounting.schedule.send')await dispatchAccountingSchedule(c,(result as {id:string}).id)
    if(type==='accounting.schedule.check')await authorizeAccountingScheduleCheck(c,payload)
    if(type.startsWith('accounting.destination.'))requireRole(c.actor,['owner'],'read accounting destination outcomes')
    if(type==='notification.chat.identity')requireRole(c.actor,['owner'],'read chat identity outcomes')
    if(type==='token.create')result=await scopedTokenResult(c,result)
    if(type.startsWith('package.')||type.startsWith('signature.'))await authorizeSignatureResult(c,type,payload)
    if(type==='package.send')await dispatchSignature(c,(result as {id:string}).id)
    if(type.startsWith('approval.channel.'))await authorizeChannelResult(c,type,payload)
    if(type.startsWith('connection.'))requireRole(c.actor,['owner'],'read connection outcomes')
    if(type==='connection.check'){requireRole(c.actor,['owner'],'read connection checks');await alertConnectionFailure(env,(result as {id:string}).id)}
    await authorizeErasureResult(c,type,result)
    if(type.startsWith('outcome-report.'))await authorizeOutcomeReportResult(c,type,payload)
    if(type==='outcome-report.deliver')await dispatchOutcomeReports(env,c.now)
    if(type.startsWith('remediation.'))await authorizeRemediationResult(c,type,payload,result)
    if(type==='remediation.send')await dispatchRemediation(c,(result as {id:string}).id)
    if((type.startsWith('service-level.')||type.startsWith('service-performance.')))await authorizeServiceResult(c,type,payload,result)
    if(type==='service-level.email')await dispatchServiceClaim(c)
    if(/^playbook\.(recommend$|recommendation\.)/.test(type)) requireRole(c.actor,['counsel'],'read measured playbook recommendation outcomes')
    if(type.startsWith('reconciliation.')) await authorizeReconciliationResult(c,type,payload,result)
    if(type==='reconciliation.email') await dispatchReconciliation(c)
    if(type==='exchange.send'){
      await exchangeResult(c,result)
      const tokens=await exchangeTokens(c)
      const mailReceipt=await dispatchExchange(c,tokens.token,tokens.replyToken)
      result={...await exchangeResult(c,result),mailReceipt}
    }
    if(/^repository\.bulk\./.test(type))await authorizeRepositoryBulkResult(c,result)
    await syncRulePending(env,c.now)
    await runApprovalChannels(env,c.now)
    if (type === 'renewal.bulk.preview') await authorizeBulkPreviewResult(c, result)
    if (type === 'approval.email') await dispatchApprovalMail(c)
    if (type === 'approval.remind') await deliverReminder(c, commandId, true)
    if (type === 'notice.email') await dispatchNotice(c)
    await runNotifications(env, c.now, false)
    return result
  }
  const digest = await sha256(canonical({ type, payload }))
  if(type!=='agreement.hidden-value'&&!/^(view\.|notification\.|preferences\.)/.test(type))await requireFullFields(c.db,actor)
  const prior = await env.DB.prepare('SELECT digest, actor_id, result FROM lk_commands WHERE id=?').bind(commandId).first<{ digest: string; actor_id: string; result: string }>()
  if (prior) {
    if (prior.digest !== digest || prior.actor_id !== actor.id) fail('IDEMPOTENCY', 'This command identity was already used for different content.', 409)
    return completed(JSON.parse(prior.result))
  }
  if(type!=='agreement.hidden-value'&&typeof payload.agreementId==='string')await requireFullFields(c.db,actor)
  const policy=await repositoryPolicy(c.db)
  c.erasureChecks=await refuseErasedAddress(c,type,payload)
  const familyChecks = await familyCommandChecks(c, type, payload)
  const out = await handlers[type](c, payload)
  out.checks=[...(type!=='agreement.hidden-value'&&!/^(view\.|notification\.|preferences\.)/.test(type)?[fullFieldsCheck(actor)]:[]),...integrationChecks,...familyChecks,...(c.renditionChecks??[]),...(out.checks??[]),...(c.erasureChecks??[]),policyVersionCheck(policy.version)]
  const notifications = await commandNotifications(c, type, payload, out)
  const workflow = await workflowWrites(c, out.audit)
  try {
    await commit(c, out.allowed, out.checks ?? [], [
      ...out.writes,
      ...(actor.agentAdmission ? [sql('INSERT INTO lk_agent_commands(command_id,operation_id,agent_id,agent_name,sponsor_id,sponsor_name,consent,approvers) VALUES(?,?,?,?,?,?,?,?)', commandId, actor.agentAdmission.operationId, actor.agentAdmission.agent.id, actor.agentAdmission.agent.name, actor.id, actor.name, actor.agentAdmission.consent, json(actor.agentAdmission.approvers))] : []),
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
