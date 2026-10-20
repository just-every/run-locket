import { routeNotification, notificationOutcome } from './notification-dispatch'
// RENEW-002 delivery: the hourly run sends each open deadline's latest due
// reminder once, batches a digest person's reminders into one daily email,
// escalates an undecided renewal at 30 days to the agreement's approver and the
// owner, and retries a bounced message once to an alternate recipient. Each send
// is claimed once after re-checking that the deadline is still open and the
// recipient may read it. Provider acceptance is never reported as delivery.
import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { auditSql, guardSql, type Ctx } from './commands'
import { defaultZone } from './business-days'
import { dueAt, escalationOffset, isReader, openDeadlines, overdueEscalationDays, overdueObligations, preferenceOf, readerSql, stillOpenSql, type Deadline } from './deadline-reminders'
import { sql, type Actor, type Sql } from './model'

export interface ReminderRow {
  id: string; agreement_id: string | null; subject_kind: 'renewal' | 'obligation' | 'digest'; subject_id: string; deadline_date: string; deadline_at: number
  kind: 'reminder' | 'escalation' | 'alternate' | 'digest'; offset_days: number; recipient_id: string; recipient_email: string; recipient_reason: string
  timezone: string; due_at: number; status: string; provider: string | null; provider_message_id: string | null; digest_id: string | null; retry_of: string | null; attempt_id: string | null
}

/** A reminder goes out at most a day late (after downtime); one longer past, such as an offset already past when the deadline appeared, is never sent. */
const lateLimitMs = 86_400_000
const scheduler: Actor = { id: 'locket-scheduler', name: 'Locket scheduler', email: '', role: 'viewer', sessionId: '', operatorVersion: 0 }
const localMail = (env: Bindings) => env.AUTH_LOCAL === 'true' || (env as { RER_DEMO?: string }).RER_DEMO === '1'
const outcome: Record<string, string> = {
  accepted: 'the mail provider accepted it; mailbox delivery is unconfirmed',
  suppressed: 'suppressed in local development or demo; no email was sent',
  rejected: 'the mail provider did not accept it',
  rate_limited: 'the mail provider rate limited it; no acceptance is confirmed',
  uncertain: 'the mail provider outcome is unknown; it will not be resent automatically',
  cancelled: 'not sent: the deadline was decided, completed or moved, or the recipient can no longer read it',
}
const read = (db: D1Database, id: string) => db.prepare('SELECT * FROM lk_deadline_reminders WHERE id=?').bind(id).first<ReminderRow>()
const run = (db: D1Database, statements: Sql[]) => db.batch(statements.map(s => db.prepare(s.sql).bind(...s.params)))

function link(env: Bindings, r: Pick<ReminderRow, 'subject_kind' | 'agreement_id'>) {
  const origin = new URL(env.AUTH_ORIGIN).origin
  return r.subject_kind === 'renewal' ? `${origin}/app#renewals` : `${origin}/app#agreement/${encodeURIComponent(r.agreement_id!)}/terms`
}
/** Generic text only: a deadline kind, its days away and a signed-in link; never titles, parties or values. */
function line(env: Bindings, r: ReminderRow) {
  const what = r.subject_kind === 'renewal' ? `A renewal notice deadline is ${r.offset_days} days away` : r.offset_days < 0 ? `An obligation is ${-r.offset_days} day${r.offset_days === -1 ? '' : 's'} overdue` : `An obligation is due in ${r.offset_days} days`
  return `${what}: ${link(env, r)}`
}
function message(env: Bindings, r: ReminderRow, items: ReminderRow[]) {
  const html = (lines: string[]) => lines.map(l => `<p>${l.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</p>`).join('')
  let lines: string[], subject: string
  if (r.kind === 'digest') { subject = `Your Locket deadlines today (${items.length})`; lines = ['Your daily digest of deadline reminders in Locket. Sign in to review each one.', ...items.map(i => line(env, i))] }
  else if (r.kind === 'escalation' && r.subject_kind === 'obligation') { subject = 'Escalated overdue obligation in Locket'; lines = [`An obligation in Locket is ${-r.offset_days} days overdue and not marked done. You receive this as the agreement's ${r.recipient_reason}. Sign in to review it.`, link(env, r)] }
  else if (r.kind === 'escalation') { subject = 'Escalated renewal deadline in Locket'; lines = [`A renewal notice deadline in Locket is ${r.offset_days} days away and no renewal decision is recorded. You receive this as the agreement's ${r.recipient_reason}. Sign in to decide.`, link(env, r)] }
  else { subject = r.subject_kind === 'renewal' ? 'Renewal notice deadline in Locket' : r.offset_days < 0 ? 'Overdue obligation in Locket' : 'Obligation due in Locket'; lines = [...(r.kind === 'alternate' ? ['A reminder to someone else bounced, so Locket sends it to you as the alternate recipient.'] : []), `${line(env, r)}`, 'Sign in to Locket to review it.'] }
  return { subject, text: lines.join('\n\n'), html: html(lines) }
}

async function names(db: D1Database, ids: string[]) {
  const rows = (await db.prepare(`SELECT id, display_name FROM oa_operators WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string; display_name: string }>()).results
  return (id: string) => rows.find(r => r.id === id)?.display_name ?? 'a former member'
}
function summary(r: ReminderRow, status: string, name: (id: string) => string, via?: ReminderRow) {
  const what = r.subject_kind === 'renewal' ? 'renewal notice deadline' : 'obligation due date'
  const lead = r.kind === 'escalation' && r.offset_days < 0 ? `Escalated the obligation ${-r.offset_days} days overdue to ${name(r.recipient_id)} (${r.recipient_reason})`
    : r.kind === 'escalation' ? `Escalated the undecided ${what} (${r.offset_days} days) to ${name(r.recipient_id)} (${r.recipient_reason})`
    : r.offset_days < 0 ? `Overdue obligation notice (${-r.offset_days} day${r.offset_days === -1 ? '' : 's'}) to ${name(r.recipient_id)} (${r.recipient_reason})${via ? ' in their daily digest' : ''}`
    : r.kind === 'alternate' ? `Retried a bounced ${r.offset_days}-day ${what} reminder to ${name(r.recipient_id)} (${r.recipient_reason})`
    : `${r.offset_days}-day ${what} reminder to ${name(r.recipient_id)} (${r.recipient_reason})${via ? ' in their daily digest' : ''}`
  return `${lead}: ${outcome[status] ?? status}.`
}

/** Claim and send one queued message (a reminder, escalation, alternate or digest). */
export async function deliver(c: Ctx, id: string) {
  let row = await read(c.db, id)
  if (!row || row.status !== 'queued') return
  const items = row.kind === 'digest' ? (await c.db.prepare("SELECT * FROM lk_deadline_reminders WHERE digest_id=? AND status='in_digest' ORDER BY deadline_at").bind(id).all<ReminderRow>()).results : []
  const attempt = crypto.randomUUID()
  const name = await names(c.db, [row.recipient_id, ...items.map(i => i.recipient_id)])
  const finish = async (status: string, provider: string | null, messageId: string | null, code: string | null) => {
    await notificationOutcome(c.env, 'deadline', id, status, provider, messageId)
    const token = status === 'cancelled' ? null : attempt
    const audited = row!.kind === 'digest' ? items : [row!]
    const audits = audited.map(r => auditSql({ ...c, commandId: id }, { action: `deadline.${row!.kind}.${status}`, agreementId: r.agreement_id, summary: summary(r, status, name, row!.kind === 'digest' ? row! : undefined) }, 'scheduler'))
    await c.db.batch([
      c.db.prepare('UPDATE lk_deadline_reminders SET status=?,provider=?,provider_message_id=?,code=? WHERE id=? AND status=? AND attempt_id IS ?').bind(status, provider, messageId, code, id, status === 'cancelled' ? 'queued' : 'sending', token),
      ...audits.map(a => c.db.prepare(`INSERT INTO lk_audit SELECT ${a.params.map(() => '?').join(',')} WHERE EXISTS(SELECT 1 FROM lk_deadline_reminders WHERE id=? AND status=? AND attempt_id IS ?)`).bind(...a.params, id, status, token)),
    ])
  }
  const checks = row.kind === 'digest' ? readerSql(c, null, row.recipient_id) : [stillOpenSql(row.subject_kind, row.subject_id, row.deadline_date), ...readerSql(c, row.agreement_id, row.recipient_id)]
  const guard = crypto.randomUUID()
  try {
    await run(c.db, [guardSql(guard, checks), sql("UPDATE lk_deadline_reminders SET status='sending',attempted_at=?,attempt_id=? WHERE id=? AND status='queued'", c.now, attempt, id), sql('DELETE FROM lk_guard WHERE id=?', guard)])
  } catch (error) {
    const text = String((error as Error)?.message)
    if (!text.includes('LOCKET_GUARD') && !text.includes('CHECK constraint')) throw error
    return finish('cancelled', null, null, 'deadline_or_recipient_changed')
  }
  row = (await read(c.db, id))!
  if (row.attempt_id !== attempt) return
  const routed = await routeNotification(c, {key:id,agreementId:row.agreement_id!,recipientId:row.recipient_id,kind:'deadline',sourceKind:'deadline',sourceId:id})
  if (routed.status !== 'immediate') return finish('suppressed', null, null, routed.status === 'deferred' ? 'daily_digest' : 'notification_preferences')
  if (localMail(c.env)) return finish('suppressed', 'development', null, null)
  const sender = operatorMail(c.env)
  if (!sender || !c.env.MAIL_FROM) return finish('rejected', null, null, 'mail_unavailable')
  try {
    const sent = await sender.send({ deliveryId: id, from: c.env.MAIL_FROM, to: [row.recipient_email], ...message(c.env, row, items), headers: {} })
    return finish(sent.status === 'development' ? 'suppressed' : sent.status, sent.provider, sent.providerMessageId, sent.code ?? null)
  } catch {
    return finish('uncertain', c.env.MAIL_PROVIDER ?? null, null, 'provider_outcome_unknown')
  }
}

type Insert = Omit<ReminderRow, 'id' | 'status' | 'provider' | 'provider_message_id' | 'attempt_id' | 'digest_id' | 'retry_of'> & { status: 'queued' | 'in_digest'; retry_of?: string | null }
async function insert(c: Ctx, r: Insert) {
  const id = crypto.randomUUID()
  await c.db.prepare('INSERT INTO lk_deadline_reminders(id,agreement_id,subject_kind,subject_id,deadline_date,deadline_at,kind,offset_days,recipient_id,recipient_email,recipient_reason,timezone,due_at,status,retry_of,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
    .bind(id, r.agreement_id, r.subject_kind, r.subject_id, r.deadline_date, r.deadline_at, r.kind, r.offset_days, r.recipient_id, r.recipient_email, r.recipient_reason, r.timezone, r.due_at, r.status, r.retry_of ?? null, c.now).run()
  return c.db.prepare('SELECT * FROM lk_deadline_reminders WHERE subject_kind=? AND subject_id=? AND deadline_date=? AND kind=? AND offset_days=? AND recipient_id=? AND (retry_of IS ? OR kind<>\'alternate\') ORDER BY created_at LIMIT 1')
    .bind(r.subject_kind, r.subject_id, r.deadline_date, r.kind, r.offset_days, r.recipient_id, r.retry_of ?? null).first<ReminderRow>()
}

const emailOf = async (db: D1Database, id: string) => (await db.prepare('SELECT email FROM oa_operators WHERE id=?').bind(id).first<{ email: string }>())?.email ?? null
const ownerId = async (db: D1Database) => (await db.prepare("SELECT id FROM oa_operators WHERE role='owner' AND status='active' ORDER BY created_at LIMIT 1").first<{ id: string }>())?.id ?? null

/** The recipient, or the owner when the recipient can no longer read the agreement. */
async function recipient(c: Ctx, d: Deadline) {
  if (await isReader(c, d.agreementId, d.recipientId)) return { id: d.recipientId, reason: d.reason }
  const owner = await ownerId(c.db)
  return owner ? { id: owner, reason: 'owner' } : null
}

async function remind(c: Ctx, d: Deadline) {
  const to = await recipient(c, d), email = to && (await emailOf(c.db, to.id))
  if (!to || !email) return
  const pref = await preferenceOf(c.db, to.id), zone = pref?.timezone ?? d.zone
  const due = d.offsets.map(offset => ({ offset, at: dueAt(d.deadlineDate, offset, zone) })).filter(x => x.at <= c.now && x.at > c.now - lateLimitMs).sort((a, b) => b.at - a.at)[0]
  if (!due) return
  const row = await insert(c, { agreement_id: d.agreementId, subject_kind: d.subjectKind, subject_id: d.subjectId, deadline_date: d.deadlineDate, deadline_at: d.deadlineAt, kind: 'reminder', offset_days: due.offset, recipient_id: to.id, recipient_email: email, recipient_reason: to.reason, timezone: zone, due_at: due.at, status: 'queued' })
  if (row?.status === 'queued') await deliver(c, row.id)
}

/** An undecided renewal escalates at 30 days to the agreement's commercial approver and the owner. */
async function escalate(c: Ctx, d: Deadline) {
  if (d.subjectKind !== 'renewal') return
  const approver = (await c.db.prepare("SELECT actor_id FROM lk_approvals WHERE agreement_id=? AND kind='commercial' AND decision='approved' AND invalidated_at IS NULL ORDER BY at DESC LIMIT 1").bind(d.agreementId).first<{ actor_id: string }>())?.actor_id
  const owner = await ownerId(c.db)
  const targets = [[approver, 'approver'], [owner, 'owner']].filter(([id], i, all) => id && all.findIndex(([x]) => x === id) === i) as [string, string][]
  for (const [id, reason] of targets) {
    const email = await emailOf(c.db, id)
    if (!email || !(await isReader(c, d.agreementId, id))) continue
    const zone = (await preferenceOf(c.db, id))?.timezone ?? d.zone, at = dueAt(d.deadlineDate, escalationOffset, zone)
    if (at > c.now) continue
    const row = await insert(c, { agreement_id: d.agreementId, subject_kind: d.subjectKind, subject_id: d.subjectId, deadline_date: d.deadlineDate, deadline_at: d.deadlineAt, kind: 'escalation', offset_days: escalationOffset, recipient_id: id, recipient_email: email, recipient_reason: reason, timezone: zone, due_at: at, status: 'queued' })
    if (row?.status === 'queued') await deliver(c, row.id)
  }
}

/** OBL-002: the day after an obligation was due its owner is told at 9:00; the configured days later (default 3) its
 * responsible person and the agreement's commercial approver (the owner when none approved it) are. Done ends both. */
async function overdue(c: Ctx, d: Deadline & { responsibleId: string }, days: number) {
  await remind(c, d)
  const approver = (await c.db.prepare("SELECT actor_id FROM lk_approvals WHERE agreement_id=? AND kind='commercial' AND decision='approved' AND invalidated_at IS NULL ORDER BY at DESC LIMIT 1").bind(d.agreementId).first<{ actor_id: string }>())?.actor_id
  const owner = await ownerId(c.db), offset = -(1 + days)
  const targets = [[d.responsibleId, 'responsible person'], [approver ?? owner, approver ? 'approver' : 'owner']].filter(([id], i, all) => id && all.findIndex(([x]) => x === id) === i) as [string, string][]
  for (const [id, reason] of targets) {
    const email = await emailOf(c.db, id)
    if (!email || !(await isReader(c, d.agreementId, id))) continue
    const zone = (await preferenceOf(c.db, id))?.timezone ?? d.zone, at = dueAt(d.deadlineDate, offset, zone)
    if (at > c.now) continue
    const row = await insert(c, { agreement_id: d.agreementId, subject_kind: d.subjectKind, subject_id: d.subjectId, deadline_date: d.deadlineDate, deadline_at: d.deadlineAt, kind: 'escalation', offset_days: offset, recipient_id: id, recipient_email: email, recipient_reason: reason, timezone: zone, due_at: at, status: 'queued' })
    if (row?.status === 'queued') await deliver(c, row.id)
  }
}

/** One scheduled run (hourly Cron Trigger). */
export async function runDeadlineReminders(env: Bindings, now: number) {
  const c: Ctx = { env, db: env.DB, actor: scheduler, now, commandId: crypto.randomUUID() }
  for (const d of await openDeadlines(env.DB, now)) {
    await remind(c, d)
    await escalate(c, d)
  }
  const days = await overdueEscalationDays(env.DB)
  for (const d of await overdueObligations(env.DB, now)) await overdue(c, d, days)
}

/** A bounced message is retried once: to the bounced person's alternate, else the agreement's responsible person, else the owner. */
export async function retryBounced(env: Bindings, bounced: ReminderRow, now: number) {
  const c: Ctx = { env, db: env.DB, actor: scheduler, now, commandId: crypto.randomUUID() }
  const items = bounced.kind === 'digest' ? (await env.DB.prepare('SELECT * FROM lk_deadline_reminders WHERE digest_id=?').bind(bounced.id).all<ReminderRow>()).results : bounced.kind === 'alternate' ? [] : [bounced]
  const alternate = (await preferenceOf(env.DB, bounced.recipient_id))?.alternate_id ?? null, owner = await ownerId(env.DB)
  for (const item of items) {
    const responsible = (await env.DB.prepare('SELECT owner_id FROM lk_agreements WHERE id=?').bind(item.agreement_id).first<{ owner_id: string }>())?.owner_id ?? null
    for (const [id, reason] of [[alternate, 'alternate recipient'], [responsible, 'responsible person'], [owner, 'owner']] as [string | null, string][]) {
      if (!id || id === bounced.recipient_id || !(await isReader(c, item.agreement_id, id))) continue
      const email = await emailOf(env.DB, id)
      if (!email) continue
      const row = await insert(c, { ...item, kind: 'alternate', recipient_id: id, recipient_email: email, recipient_reason: reason, status: 'queued', retry_of: item.id })
      if (row?.status === 'queued') await deliver(c, row.id)
      break
    }
  }
}
