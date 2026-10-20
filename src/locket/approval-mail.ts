import { routeNotification, notificationOutcome } from './notification-dispatch'
import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { may, requireRole, roleSql, visibleSql } from './access'
import { auditSql, commit, type Ctx, type Handler } from './commands'
import { fail, Problem, sql, text, type Sql } from './model'
import { agreementGuards, currentVersion, requireStatus, visibleAgreement } from './records'
import { decisionContext } from './review'

interface MailRow {
  id: string; agreement_id: string; agreement_version: number; version_id: string; version_digest: string
  recipient_id: string; recipient_email: string; review_url: string; status: string
  provider: string | null; provider_message_id: string | null; code: string | null; attempt_id: string | null
}

const localMail = (c: Ctx) => c.env.AUTH_LOCAL === 'true' || (c.env as { RER_DEMO?: string }).RER_DEMO === '1'

/** The recipient must be able to make this agreement's commercial decision (also APPROVE-004 reminders). */
export function recipientGuard(c: Ctx, agreementId: string, recipientId: string, email: string): Sql[] {
  return [
    sql(`EXISTS(SELECT 1 FROM oa_operators o JOIN lk_agreements a ON a.id=? WHERE o.id=? AND o.status='active' AND o.email=? AND ${roleSql} IN ('owner','approver') AND (${roleSql}='owner' OR a.requester_id<>o.id))`, agreementId, recipientId, email, recipientId, recipientId),
    visibleSql({ ...c.actor, id: recipientId }, agreementId),
  ]
}

export const emailApproval: Handler = async (c, p) => {
  requireRole(c.actor, may.review, 'email an approval link')
  const a = await visibleAgreement(c, p.agreementId)
  requireStatus(a, ['in_review'], 'request an approval by email')
  const v = await currentVersion(c, a)
  if (p.versionId !== v.id) fail('NOT_CURRENT', 'The version changed. Reload before emailing an approval link.', 409)
  const context = await decisionContext(c.db, a, v)
  const decided = await c.db.prepare("SELECT id FROM lk_approvals WHERE agreement_id=? AND version_id=? AND version_digest=? AND context_digest=? AND kind='commercial' AND invalidated_at IS NULL").bind(a.id, v.id, v.digest, context.digest).first()
  if (decided) fail('ALREADY_DECIDED', 'Commercial approval is already decided for this version.', 409)
  const recipientId = text(p, 'recipientId', 100)
  const recipient = await c.db.prepare('SELECT email FROM oa_operators WHERE id=?').bind(recipientId).first<{ email: string }>()
  if (!recipient) fail('RECIPIENT', 'Choose an active commercial approver with access to this agreement.', 400)
  const recipientChecks = recipientGuard(c, a.id, recipientId, recipient.email)
  const eligible = await c.db.prepare(`SELECT CASE WHEN ${recipientChecks.map(s => `(${s.sql})`).join(' AND ')} THEN 1 ELSE 0 END AS ok`).bind(...recipientChecks.flatMap(s => s.params)).first<{ ok: number }>()
  if (!eligible?.ok) fail('RECIPIENT', 'Choose an active commercial approver with access to this agreement.', 400)
  if (!localMail(c) && (!operatorMail(c.env) || !c.env.MAIL_FROM)) fail('MAIL_UNAVAILABLE', 'Configure outbound mail before emailing an approval link.', 503)
  const origin = new URL(c.env.AUTH_ORIGIN).origin
  const reviewUrl = `${origin}/app#agreement/${encodeURIComponent(a.id)}/review`
  return {
    allowed: may.review,
    result: { id: c.commandId, status: 'queued', recipientId, reviewUrl },
    writes: [sql("INSERT INTO lk_approval_mail(id,agreement_id,agreement_version,version_id,version_digest,recipient_id,recipient_email,review_url,status,created_at) VALUES(?,?,?,?,?,?,?,?,'queued',?) ON CONFLICT(id) DO NOTHING", c.commandId, a.id, a.version, v.id, v.digest, recipientId, recipient.email, reviewUrl, c.now)],
    checks: [...agreementGuards(c, a, p), ...recipientChecks, sql('(SELECT digest FROM lk_versions WHERE id=?)=?', v.id, v.digest)],
    audit: [{ action: 'approval.email.requested', agreementId: a.id, summary: `Requested an approval email for v${v.number}.` }],
  }
}

function receipt(row: MailRow) {
  return { id: row.id, status: row.status, recipientId: row.recipient_id, reviewUrl: row.review_url, provider: row.provider, providerMessageId: row.provider_message_id, code: row.code }
}

/** Called only after the command batch commits, including a retry of a queued
 * command. The one-use claim prevents duplicate provider calls. Sending means
 * in progress or interrupted, never proof of acceptance or mailbox delivery. */
export async function dispatchApprovalMail(c: Ctx): Promise<unknown> {
  let row = await c.db.prepare('SELECT * FROM lk_approval_mail WHERE id=?').bind(c.commandId).first<MailRow>()
  if (!row) fail('NOT_FOUND', 'No approval email request has that identity.', 404)
  if (row.status !== 'queued') return receipt(row)
  const attempt = crypto.randomUUID()
  const finish = async (status: string, provider: string | null, providerMessageId: string | null, code: string | null) => {
    await notificationOutcome(c.env, 'approval_mail', c.commandId, status, provider, providerMessageId)
    const cancelled = status === 'cancelled'
    const token = cancelled ? null : attempt
    const audit = auditSql(c, { action: `approval.email.${status}`, agreementId: row!.agreement_id, summary: status === 'accepted' ? 'Mail provider accepted the approval email; mailbox delivery is unconfirmed.' : status === 'suppressed' ? 'Approval email suppressed in local development or demo; no email was sent.' : `Approval email outcome: ${status}.` })
    await c.db.batch([
      c.db.prepare('UPDATE lk_approval_mail SET status=?,provider=?,provider_message_id=?,code=? WHERE id=? AND status=? AND attempt_id IS ?').bind(status, provider, providerMessageId, code, c.commandId, cancelled ? 'queued' : 'sending', token),
      c.db.prepare(`INSERT INTO lk_audit SELECT ${audit.params.map(() => '?').join(',')} WHERE EXISTS(SELECT 1 FROM lk_approval_mail WHERE id=? AND status=? AND attempt_id IS ?)`).bind(...audit.params, c.commandId, status, token),
    ])
    return receipt((await c.db.prepare('SELECT * FROM lk_approval_mail WHERE id=?').bind(c.commandId).first<MailRow>())!)
  }
  try {
    await commit(c, may.review, [
      visibleSql(c.actor, row.agreement_id),
      sql("EXISTS(SELECT 1 FROM lk_agreements a JOIN lk_versions v ON v.id=a.current_version_id WHERE a.id=? AND a.version=? AND a.status='in_review' AND v.id=? AND v.digest=?)", row.agreement_id, row.agreement_version, row.version_id, row.version_digest),
      ...recipientGuard(c, row.agreement_id, row.recipient_id, row.recipient_email),
    ], [sql("UPDATE lk_approval_mail SET status='sending',attempted_at=?,attempt_id=? WHERE id=? AND status='queued'", Date.now(), attempt, c.commandId)])
  } catch (error) {
    if (!(error instanceof Problem)) throw error
    return finish('cancelled', null, null, 'authority_or_record_changed')
  }
  row = (await c.db.prepare('SELECT * FROM lk_approval_mail WHERE id=?').bind(c.commandId).first<MailRow>())!
  if (row.attempt_id !== attempt) return receipt(row)
  const routed = await routeNotification(c, {key:c.commandId,agreementId:row.agreement_id!,recipientId:row.recipient_id,kind:'approval',sourceKind:'approval_mail',sourceId:c.commandId})
  if (routed.status !== 'immediate') return finish('suppressed', null, null, routed.status === 'deferred' ? 'daily_digest' : 'notification_preferences')
  if (localMail(c)) return finish('suppressed', 'development', null, null)
  const sender = operatorMail(c.env)
  if (!sender || !c.env.MAIL_FROM) return finish('rejected', null, null, 'mail_unavailable')
  try {
    const sent = await sender.send({ deliveryId: c.commandId, from: c.env.MAIL_FROM, to: [row.recipient_email], subject: 'Approval requested in Locket', text: `An agreement is ready for your review in Locket. Sign in to review the current version and record your decision.\n\n${row.review_url}`, html: `<p>An agreement is ready for your review in Locket. Sign in to review the current version and record your decision.</p><p><a href="${row.review_url.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">Review in Locket</a></p>`, headers: {} })
    return finish(sent.status === 'development' ? 'suppressed' : sent.status, sent.provider, sent.providerMessageId, sent.code ?? null)
  } catch {
    return finish('uncertain', c.env.MAIL_PROVIDER ?? null, null, 'provider_outcome_unknown')
  }
}

/** Delivery state is a separate snapshot; the command acknowledgement never changes.
 * Called only after runCommand has checked this command identity and principal. */
export async function approvalMailReceipt(env: Bindings, commandId: string) {
  const row = await env.DB.prepare('SELECT * FROM lk_approval_mail WHERE id=?').bind(commandId).first<MailRow>()
  if (!row) fail('NOT_FOUND', 'No approval email request has that identity.', 404)
  return receipt(row)
}
