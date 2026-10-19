// APPROVE-004 delivery: the hourly scheduled run and the "Remind approver" send.
// Each reminder is a durable outbox row first; a one-use claim re-checks that the
// approval still waits and the recipient may still decide before any provider call.
// Sending means in progress or interrupted, never proof of acceptance or delivery.
import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { may, visibleSql } from './access'
import { recipientGuard } from './approval-mail'
import { escalationTarget, pendingApprovals, reminderSettings, approverZone, schedule, stillPendingSql, type Pending, type Reason } from './approval-reminders'
import { auditSql, commit, guardSql, type Ctx } from './commands'
import { Problem, sql, type Actor } from './model'

interface Row {
  id: string; agreement_id: string; version_id: string; version_digest: string; approver_id: string; kind: 'reminder' | 'escalation' | 'manual'; slot: number | null
  recipient_id: string; recipient_email: string; recipient_reason: Reason; review_url: string; status: string; provider: string | null; provider_message_id: string | null; code: string | null; attempt_id: string | null
}

const scheduler: Actor = { id: 'locket-scheduler', name: 'Locket scheduler', email: '', role: 'viewer', sessionId: '', operatorVersion: 0 }
const localMail = (env: Bindings) => env.AUTH_LOCAL === 'true' || (env as { RER_DEMO?: string }).RER_DEMO === '1'
const reasonLabel: Record<Reason, string> = { approver: 'approver', delegate: 'delegate', escalation_contact: 'escalation contact', owner: 'owner' }
const outcome: Record<string, string> = {
  accepted: 'the mail provider accepted it; mailbox delivery is unconfirmed',
  suppressed: 'suppressed in local development or demo; no email was sent',
  rejected: 'the mail provider did not accept it',
  rate_limited: 'the mail provider rate limited it; no acceptance is confirmed',
  uncertain: 'the mail provider outcome is unknown; it will not be resent automatically',
  cancelled: 'not sent: the approval was decided or withdrawn, or the recipient can no longer act',
}

function message(row: Row) {
  const link = row.review_url, html = (p: string) => `<p>${p}</p><p><a href="${link.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">Review in Locket</a></p>`
  if (row.kind === 'escalation') {
    const p = `An approval request in Locket has waited past its escalation time and is escalated to you as the approver's ${reasonLabel[row.recipient_reason]}. Sign in to review the current version and record a decision.`
    return { subject: 'Escalated approval in Locket', text: `${p}\n\n${link}`, html: html(p) }
  }
  const p = 'An agreement is still waiting for your approval in Locket. Sign in to review the current version and record your decision.'
  return { subject: 'Reminder: approval waiting in Locket', text: `${p}\n\n${link}`, html: html(p) }
}

async function names(db: D1Database, ...ids: string[]) {
  const rows = (await db.prepare(`SELECT id, display_name FROM oa_operators WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string; display_name: string }>()).results
  return (id: string) => rows.find(r => r.id === id)?.display_name ?? 'a former member'
}

function summary(row: Row, status: string, name: (id: string) => string) {
  const lead = row.kind === 'escalation' ? `Escalated ${name(row.approver_id)}'s pending approval to ${name(row.recipient_id)} (${reasonLabel[row.recipient_reason]})`
    : row.kind === 'manual' ? `Manual reminder to ${name(row.recipient_id)} (approver)`
    : `Reminder ${row.slot} to ${name(row.recipient_id)} (approver)`
  return `${lead}: ${outcome[status] ?? status}.`
}

const read = (db: D1Database, id: string) => db.prepare('SELECT * FROM lk_approval_reminders WHERE id=?').bind(id).first<Row>()
export const reminderReceipt = (row: Row) => ({ id: row.id, status: row.status, kind: row.kind, recipientId: row.recipient_id, provider: row.provider, providerMessageId: row.provider_message_id, code: row.code })

/** Claim and send one queued reminder. A person's manual reminder re-checks their session and role too. */
export async function deliverReminder(c: Ctx, id: string, person: boolean) {
  let row = await read(c.db, id)
  if (!row || row.status !== 'queued') return row && reminderReceipt(row)
  const attempt = crypto.randomUUID(), principal = person ? c.actor.role : 'scheduler'
  const name = await names(c.db, row.approver_id, row.recipient_id)
  const finish = async (status: string, provider: string | null, messageId: string | null, code: string | null) => {
    const token = status === 'cancelled' ? null : attempt
    const audit = auditSql({ ...c, commandId: id }, { action: `approval.${row!.kind === 'escalation' ? 'escalation' : 'reminder'}.${status}`, agreementId: row!.agreement_id, summary: summary(row!, status, name) }, principal)
    await c.db.batch([
      c.db.prepare('UPDATE lk_approval_reminders SET status=?,provider=?,provider_message_id=?,code=? WHERE id=? AND status=? AND attempt_id IS ?').bind(status, provider, messageId, code, id, status === 'cancelled' ? 'queued' : 'sending', token),
      c.db.prepare(`INSERT INTO lk_audit SELECT ${audit.params.map(() => '?').join(',')} WHERE EXISTS(SELECT 1 FROM lk_approval_reminders WHERE id=? AND status=? AND attempt_id IS ?)`).bind(...audit.params, id, status, token),
    ])
    return reminderReceipt((await read(c.db, id))!)
  }
  const checks = [
    stillPendingSql({ agreementId: row.agreement_id, versionId: row.version_id, versionDigest: row.version_digest, approverId: row.approver_id }),
    ...recipientGuard(c, row.agreement_id, row.recipient_id, row.recipient_email),
  ]
  const claim = sql("UPDATE lk_approval_reminders SET status='sending',attempted_at=?,attempt_id=? WHERE id=? AND status='queued'", c.now, attempt, id)
  try {
    if (person) await commit(c, may.review, [visibleSql(c.actor, row.agreement_id), ...checks], [claim])
    else {
      const guard = crypto.randomUUID()
      await c.db.batch([guardSql(guard, checks), claim, sql('DELETE FROM lk_guard WHERE id=?', guard)].map(s => c.db.prepare(s.sql).bind(...s.params)))
    }
  } catch (error) {
    if (!(error instanceof Problem) && !String((error as Error)?.message).includes('LOCKET_GUARD')) throw error
    return finish('cancelled', null, null, 'approval_or_recipient_changed')
  }
  row = (await read(c.db, id))!
  if (row.attempt_id !== attempt) return reminderReceipt(row)
  if (localMail(c.env)) return finish('suppressed', 'development', null, null)
  const sender = operatorMail(c.env)
  if (!sender || !c.env.MAIL_FROM) return finish('rejected', null, null, 'mail_unavailable')
  try {
    const sent = await sender.send({ deliveryId: id, from: c.env.MAIL_FROM, to: [row.recipient_email], ...message(row), headers: {} })
    return finish(sent.status === 'development' ? 'suppressed' : sent.status, sent.provider, sent.providerMessageId, sent.code ?? null)
  } catch {
    return finish('uncertain', c.env.MAIL_PROVIDER ?? null, null, 'provider_outcome_unknown')
  }
}

/** The automatic reminder or escalation for one slot exists once; a queued one left by an interrupted run is sent now. */
async function ensure(c: Ctx, p: Pending, kind: 'reminder' | 'escalation', slot: number, dueAt: number, to: { id: string; email: string; reason: Reason }) {
  const reviewUrl = `${new URL(c.env.AUTH_ORIGIN).origin}/app#agreement/${encodeURIComponent(p.agreementId)}/review`
  await c.db.prepare("INSERT INTO lk_approval_reminders(id,agreement_id,version_id,version_digest,approver_id,kind,slot,recipient_id,recipient_email,recipient_reason,review_url,status,requested_by,due_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued',?,?,?) ON CONFLICT DO NOTHING")
    .bind(crypto.randomUUID(), p.agreementId, p.versionId, p.versionDigest, p.approverId, kind, slot, to.id, to.email, to.reason, reviewUrl, scheduler.id, dueAt, c.now).run()
  const row = await c.db.prepare('SELECT id, status FROM lk_approval_reminders WHERE agreement_id=? AND version_id=? AND approver_id=? AND kind=? AND slot=?').bind(p.agreementId, p.versionId, p.approverId, kind, slot).first<{ id: string; status: string }>()
  if (row?.status === 'queued') await deliverReminder({ ...c, commandId: row.id }, row.id, false)
}

/** One scheduled run (hourly Cron Trigger): the latest due reminder per pending approval, then any due escalation. */
export async function runApprovalReminders(env: Bindings, now: number) {
  const c: Ctx = { env, db: env.DB, actor: scheduler, now, commandId: crypto.randomUUID() }
  const settings = await reminderSettings(env.DB)
  for (const p of await pendingApprovals(env.DB)) {
    const s = schedule(p, settings, await approverZone(env.DB, p.approverId), now)
    if (s.slotDueAt !== null) await ensure(c, p, 'reminder', s.slot, s.slotDueAt, { id: p.approverId, email: p.approverEmail, reason: 'approver' })
    if (s.escalateAt <= now) {
      const to = await escalationTarget(c, p, settings)
      if (to) await ensure(c, p, 'escalation', 0, s.escalateAt, to)
    }
  }
}

export async function reminderReceiptFor(env: Bindings, id: string) {
  const row = await read(env.DB, id)
  return row ? reminderReceipt(row) : null
}
