import { runChatNotifications } from './chat-notifications'
// Notification routing and provider claims. An interrupted or uncertain claim
// remains durable and is never automatically resent.
import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { auditSql, guardSql, type Ctx } from './commands'
import { sql, type Actor, type Sql } from './model'
import { notificationSourceChecks, notificationSourceOutcome } from './notification-sources'
import { activeHumanSql, notificationBatch, notificationCheck, notificationLink, notificationPreferences,
  notificationReaderSql, notificationWrites, notificationZoneSql, preferenceSql, type NotificationInput, type NotificationRow, type NotificationSource } from './notifications'

const scheduler: Actor = { id: 'locket-scheduler', name: 'Locket scheduler', email: '', role: 'viewer', sessionId: '', operatorVersion: 0 }
const localMail = (env: Bindings) => env.AUTH_LOCAL === 'true' || (env as { RER_DEMO?: string }).RER_DEMO === '1'
const guardedFailure = (error: unknown) => /LOCKET_GUARD|UNIQUE constraint failed: lk_notification_deliveries/.test(String(error))
const waiting = "email_status IN ('pending','immediate','digest') AND delivery_id IS NULL"

/** Called after a legacy sender has won its original authority/version claim.
 * Its immediate provider call stays in that sender; daily digests move here. */
export async function routeNotification(c: Ctx, input: NotificationInput): Promise<{ status: 'immediate' | 'deferred' | 'suppressed'; id: string }> {
  await notificationBatch(c.db, notificationWrites(c, input))
  let row = await c.db.prepare('SELECT * FROM lk_notifications WHERE event_key=? AND recipient_id=?').bind(input.key, input.recipientId).first<NotificationRow>()
  if (!row) return { status: 'suppressed', id: '' }
  const readers = notificationReaderSql(c.actor, row.agreement_id, row.recipient_id)
  const email = preferenceSql(row.recipient_id, 'email'), digest = preferenceSql(row.recipient_id, 'digest')
  const readable = readers.map(s => `(${s.sql})`).join(' AND ')
  await notificationBatch(c.db, [sql(`UPDATE lk_notifications SET
    email_status=CASE WHEN NOT(${readable}) THEN 'cancelled' WHEN (${email.sql})=0 THEN 'suppressed'
      WHEN (${digest.sql})=1 THEN 'digest' ELSE 'immediate' END,
    code=CASE WHEN NOT(${readable}) THEN 'recipient_changed' WHEN (${email.sql})=0 THEN 'email_disabled' ELSE NULL END
    WHERE id=? AND ${waiting}`,
  ...readers.flatMap(s => s.params), ...email.params, ...digest.params, ...readers.flatMap(s => s.params), ...email.params, row.id)])
  row = (await c.db.prepare('SELECT * FROM lk_notifications WHERE id=?').bind(row.id).first<NotificationRow>())!
  return { id: row.id, status: row.email_status === 'immediate' ? 'immediate' : row.email_status === 'digest' ? 'deferred' : 'suppressed' }
}

/** The original outbox reports its real immediate outcome. A handoff's local
 * suppression is not a final email outcome for the waiting digest event. */
export async function notificationOutcome(env: Bindings, sourceKind: NotificationSource, sourceId: string, status: string, provider: string | null = null, messageId: string | null = null) {
  if (status === 'development') status = 'suppressed'
  await env.DB.prepare(`UPDATE lk_notifications SET email_status=?,provider=?,provider_message_id=?
    WHERE source_kind=? AND source_id=? AND email_status='immediate' AND delivery_id IS NULL`)
    .bind(status, provider, messageId, sourceKind, sourceId).run()
}

interface Candidate { row: NotificationRow; checks: Sql[] }
interface Delivery { id: string; recipient_id: string; recipient_email: string; kind: 'immediate' | 'digest'; local_date: string | null; timezone: string; attempt_id: string }

function localDay(now: number, zone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' })
    .formatToParts(new Date(now)).map(p => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

async function stopWaiting(c: Ctx, row: NotificationRow, status: 'cancelled' | 'suppressed', code: string) {
  const own = sql(`EXISTS(SELECT 1 FROM lk_notifications WHERE id=? AND ${waiting})`, row.id)
  const audit = auditSql(c, { action: `notification.email.${status}`, agreementId: row.agreement_id,
    summary: status === 'cancelled' ? 'Notification email cancelled after access or source state changed.' : 'Notification email suppressed by the recipient’s preferences; no email was sent.' }, 'scheduler')
  await notificationBatch(c.db, [
    ...notificationSourceOutcome(row, status, null, null, code, own, null),
    sql(`INSERT INTO lk_audit SELECT ${audit.params.map(() => '?').join(',')} WHERE ${own.sql}`, ...audit.params, ...own.params),
    sql(`UPDATE lk_notifications SET email_status=?,code=? WHERE id=? AND ${waiting}`, status, code, row.id),
  ])
}

/** Preserve the legacy deadline digest's signed provider evidence and alternate
 * bounce handling. Other notification kinds share the same one claimed email. */
function deadlineDigest(c: Ctx, delivery: Delivery, items: Candidate[]): Sql[] {
  if (delivery.kind !== 'digest' || !items.some(item => item.row.source_kind === 'deadline')) return []
  return [sql(`INSERT INTO lk_deadline_reminders(id,agreement_id,subject_kind,subject_id,deadline_date,deadline_at,kind,offset_days,
    recipient_id,recipient_email,recipient_reason,timezone,due_at,status,created_at,attempted_at,attempt_id)
    VALUES(?,NULL,'digest',?,?,?,'digest',0,?,?,'digest',?,?,'sending',?,?,?)`,
  delivery.id, delivery.recipient_id, delivery.local_date, c.now, delivery.recipient_id, delivery.recipient_email, delivery.timezone, c.now, c.now, c.now, delivery.attempt_id)]
}

function message(env: Bindings, delivery: Delivery, items: Candidate[]) {
  // Labels and authenticated record links only. Never title, parties, monetary
  // values, comment text or a provider-facing copy of business content.
  const labels: Record<string, string> = {
    assignment: 'An agreement assignment is waiting in Locket.', mention: 'You were mentioned in Locket.',
    approval: 'An approval is waiting in Locket.', approval_request: 'An approval is waiting in Locket.',
    approval_reminder: 'An approval reminder is waiting in Locket.', signature: 'A signature event is recorded in Locket.',
    signature_event: 'A signature event is recorded in Locket.', deadline: 'A deadline notification is waiting in Locket.',
    overdue_obligation: 'An obligation notification is waiting in Locket.',
  }
  const lines = [delivery.kind === 'digest' ? 'Your daily Locket notifications. Sign in to review them.' : 'A notification is waiting in Locket. Sign in to review it.',
    ...items.flatMap(({ row }) => [labels[row.kind] ?? 'An agreement update is waiting in Locket.', notificationLink(env, row)])]
  return { subject: delivery.kind === 'digest' ? 'Your daily Locket notifications' : 'New notification in Locket', text: lines.join('\n\n'),
    html: lines.map(line => `<p>${line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`).join('') }
}

async function finishDelivery(c: Ctx, delivery: Delivery, items: Candidate[], status: string, provider: string | null, messageId: string | null, code: string | null) {
  const owns = sql("EXISTS(SELECT 1 FROM lk_notification_deliveries WHERE id=? AND status='sending' AND attempt_id=?)", delivery.id, delivery.attempt_id)
  const legacyDigest = delivery.kind === 'digest' && items.some(item => item.row.source_kind === 'deadline') ? delivery.id : null
  const writes: Sql[] = []
  for (const { row } of items) {
    const ownItem = sql(`(${owns.sql}) AND EXISTS(SELECT 1 FROM lk_notifications WHERE id=? AND delivery_id=? AND email_status='sending')`, ...owns.params, row.id, delivery.id)
    writes.push(...notificationSourceOutcome(row, status, provider, messageId, code, ownItem, legacyDigest))
    if (row.source_kind === 'deadline' && legacyDigest) {
      const deadlineAudit = auditSql({ ...c, commandId: delivery.id }, { action: `deadline.digest.${status}`, agreementId: row.agreement_id,
        summary: `Deadline notification in shared daily digest ${delivery.id}: ${status === 'accepted' ? 'the mail provider accepted it; mailbox delivery is unconfirmed' : status === 'suppressed' ? 'suppressed locally; no email was sent' : status === 'uncertain' ? 'the provider outcome is unknown; it will not be resent automatically' : status}.` }, 'scheduler')
      writes.push(sql(`INSERT INTO lk_audit SELECT ${deadlineAudit.params.map(() => '?').join(',')} WHERE ${ownItem.sql}`, ...deadlineAudit.params, ...ownItem.params))
    }
    const audit = auditSql({ ...c, commandId: delivery.id }, { action: `notification.email.${status}`, agreementId: row.agreement_id,
      summary: status === 'accepted' ? 'Mail provider accepted a notification; mailbox delivery is unconfirmed.' : status === 'suppressed' ? 'Notification email suppressed locally; no email was sent.' : status === 'uncertain' ? 'Notification email outcome unknown; it will not be resent automatically.' : `Notification email outcome: ${status}.` }, 'scheduler')
    writes.push(sql(`INSERT INTO lk_audit SELECT ${audit.params.map(() => '?').join(',')} WHERE ${ownItem.sql}`, ...audit.params, ...ownItem.params),
      sql(`UPDATE lk_notifications SET email_status=?,provider=?,provider_message_id=?,code=? WHERE id=? AND delivery_id=? AND email_status='sending' AND (${owns.sql})`,
        status, provider, messageId, code, row.id, delivery.id, ...owns.params))
  }
  if (legacyDigest) writes.push(sql(`UPDATE lk_deadline_reminders SET status=?,provider=?,provider_message_id=?,code=?
    WHERE id=? AND status='sending' AND attempt_id=? AND (${owns.sql})`, status, provider, messageId, code, legacyDigest, delivery.attempt_id, ...owns.params))
  writes.push(sql("UPDATE lk_notification_deliveries SET status=?,provider=?,provider_message_id=?,code=? WHERE id=? AND status='sending' AND attempt_id=?",
    status, provider, messageId, code, delivery.id, delivery.attempt_id))
  await notificationBatch(c.db, writes)
}

async function send(c: Ctx, recipient: string, kind: 'immediate' | 'digest', timezone: string, date: string | null, items: Candidate[]) {
  if (!items.length) return
  const person = await c.db.prepare("SELECT email FROM oa_operators WHERE id=? AND status='active'").bind(recipient).first<{ email: string }>()
  if (!person) return
  const delivery: Delivery = { id: crypto.randomUUID(), recipient_id: recipient, recipient_email: person.email, kind, local_date: date, timezone, attempt_id: crypto.randomUUID() }
  const zone = notificationZoneSql(recipient), digest = preferenceSql(recipient, 'digest'), email = preferenceSql(recipient, 'email')
  const checks = [activeHumanSql(recipient), sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND email=?)", recipient, person.email),
    sql(`(${zone.sql})=?`, ...zone.params, timezone), sql(`(${email.sql})=1 AND (${digest.sql})=?`, ...email.params, ...digest.params, Number(kind === 'digest')),
    ...(kind === 'digest' ? [sql("NOT EXISTS(SELECT 1 FROM lk_notification_deliveries WHERE recipient_id=? AND local_date=? AND kind='digest')", recipient, date),
      ...(items.some(item => item.row.source_kind === 'deadline') ? [sql("NOT EXISTS(SELECT 1 FROM lk_deadline_reminders WHERE recipient_id=? AND deadline_date=? AND kind='digest')", recipient, date)] : [])] : []),
  ]
  // Keep each guarded statement within D1's binding limit, while all source,
  // recipient and one-use checks still commit in one atomic batch.
  const guards = [checks, ...items.map(({ row, checks }) => [
    ...notificationReaderSql(c.actor, row.agreement_id, recipient), ...checks,
    sql(`EXISTS(SELECT 1 FROM lk_notifications WHERE id=? AND recipient_id=? AND email_status IN ('immediate','digest') AND delivery_id IS NULL)`, row.id, recipient),
  ])].map(checks => ({ id: crypto.randomUUID(), checks }))
  try {
    await notificationBatch(c.db, [...guards.map(guard => guardSql(guard.id, guard.checks)),
      sql(`INSERT INTO lk_notification_deliveries(id,recipient_id,recipient_email,kind,local_date,timezone,status,created_at,attempted_at,attempt_id)
        VALUES(?,?,?,?,?,?,'sending',?,?,?)`, delivery.id, recipient, person.email, kind, date, timezone, c.now, c.now, delivery.attempt_id),
      ...deadlineDigest(c, delivery, items),
      ...items.map(({ row }) => sql(`UPDATE lk_notifications SET email_status='sending',delivery_id=? WHERE id=? AND ${waiting}`, delivery.id, row.id)),
      ...guards.map(guard => sql('DELETE FROM lk_guard WHERE id=?', guard.id)),
    ])
  } catch (error) {
    if (guardedFailure(error)) return
    throw error
  }
  if (localMail(c.env)) return finishDelivery(c, delivery, items, 'suppressed', 'development', null, null)
  const sender = operatorMail(c.env)
  if (!sender || !c.env.MAIL_FROM) return finishDelivery(c, delivery, items, 'rejected', null, null, 'mail_unavailable')
  try {
    const sent = await sender.send({ deliveryId: delivery.id, from: c.env.MAIL_FROM, to: [person.email], ...message(c.env, delivery, items), headers: {} })
    return finishDelivery(c, delivery, items, sent.status === 'development' ? 'suppressed' : sent.status, sent.provider, sent.providerMessageId, sent.code ?? null)
  } catch {
    return finishDelivery(c, delivery, items, 'uncertain', c.env.MAIL_PROVIDER ?? null, null, 'provider_outcome_unknown')
  }
}

/** Called after commands and by the scheduler. No past events are manufactured;
 * each own-zone digest is claimed once after 9am, with every item reauthorized. */
export async function runNotifications(env: Bindings, now: number, includeDigests = true) {
  const c: Ctx = { env, db: env.DB, actor: scheduler, now, commandId: crypto.randomUUID() }
  const rows = (await env.DB.prepare(`SELECT * FROM lk_notifications WHERE ${waiting} ORDER BY created_at,id`).all<NotificationRow>()).results
  const groups = new Map<string, Candidate[]>()
  for (let row of rows) {
    // Immediate bridges belong exclusively to their original one-use sender.
    if (row.source_kind && row.email_status !== 'digest') continue
    const source = await notificationSourceChecks(c, row)
    if (!source.ready) continue
    const checks = [...notificationReaderSql(c.actor, row.agreement_id, row.recipient_id), ...source.checks]
    if (!(await notificationCheck(c.db, checks))) { await stopWaiting(c, row, 'cancelled', 'source_or_recipient_changed'); continue }
    const preferences = await notificationPreferences(c.db, row.recipient_id)
    if (!preferences.email) { await stopWaiting(c, row, 'suppressed', 'email_disabled'); continue }
    if (!row.source_kind) {
      await routeNotification(c, { key: row.event_key, agreementId: row.agreement_id, recipientId: row.recipient_id, kind: row.kind })
      row = (await c.db.prepare('SELECT * FROM lk_notifications WHERE id=?').bind(row.id).first<NotificationRow>())!
      if (!['digest', 'immediate'].includes(row.email_status)) continue
    }
    const item = { row, checks: source.checks }
    if (!preferences.digest) await send(c, row.recipient_id, 'immediate', preferences.timezone, null, [item])
    else groups.set(row.recipient_id, [...(groups.get(row.recipient_id) ?? []), item])
  }
  await runChatNotifications(env,now)
  if (!includeDigests) return
  for (const [recipient, items] of groups) {
    const preferences = await notificationPreferences(c.db, recipient)
    const day = localDay(now, preferences.timezone)
    if (day.hour >= 9) await send(c, recipient, 'digest', preferences.timezone, day.date, items)
  }
}
