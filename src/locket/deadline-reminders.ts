// RENEW-002: which renewal and obligation deadlines are open, who is reminded,
// at which offsets and when. Reminders go out at 9:00 on (deadline date − offset)
// in the recipient's US time zone, or the deadline's own zone until they choose one.
import type { Bindings } from '../auth.server'
import { may, requireRole, visibleSql } from './access'
import type { Ctx, Handler } from './commands'
import { addDays, noticeDeadline, zonedInstant } from './dates'
import { fail, integer, json, list, sql, type Actor } from './model'

export const defaultOffsets = [90, 60, 30, 7]
export const escalationOffset = 30

export interface Deadline {
  subjectKind: 'renewal' | 'obligation'; subjectId: string; agreementId: string
  deadlineDate: string; deadlineAt: number; zone: string; recipientId: string; reason: string; offsets: number[]
}

export async function deadlineOffsets(db: D1Database): Promise<number[]> {
  const row = await db.prepare('SELECT offsets FROM lk_deadline_reminder_settings WHERE id=?').bind('installation').first<{ offsets: string }>()
  return row ? JSON.parse(row.offsets) : defaultOffsets
}

/** Open deadlines: undecided renewals and confirmed obligations with a due date, before their deadline passes. */
export async function openDeadlines(db: D1Database, now: number): Promise<Deadline[]> {
  const offsets = await deadlineOffsets(db)
  const renewals = (await db.prepare(`SELECT r.id, r.agreement_id, r.deadline_date, r.deadline_at, r.timezone, a.owner_id, s.owner_id AS schedule_owner, s.offsets AS schedule_offsets
    FROM lk_renewals r JOIN lk_agreements a ON a.id=r.agreement_id LEFT JOIN lk_reminder_schedules s ON s.agreement_id=r.agreement_id AND s.deadline_at=r.deadline_at
    WHERE r.decision IS NULL AND r.deadline_at>?`).bind(now).all<any>()).results
  const obligations = (await db.prepare(`SELECT o.id, o.agreement_id, o.due_date, o.owner_id, a.timezone FROM lk_obligations o JOIN lk_agreements a ON a.id=o.agreement_id
    WHERE o.status='confirmed' AND o.due_date IS NOT NULL`).all<any>()).results
  return [
    ...renewals.map(r => ({ subjectKind: 'renewal' as const, subjectId: r.id, agreementId: r.agreement_id, deadlineDate: r.deadline_date, deadlineAt: r.deadline_at, zone: r.timezone,
      recipientId: r.schedule_owner ?? r.owner_id, reason: r.schedule_owner ? 'reminder owner' : 'responsible person', offsets: r.schedule_offsets ? JSON.parse(r.schedule_offsets) : offsets })),
    ...obligations.map(o => ({ subjectKind: 'obligation' as const, subjectId: o.id, agreementId: o.agreement_id, deadlineDate: o.due_date, deadlineAt: noticeDeadline(o.due_date, 0, o.timezone).at, zone: o.timezone,
      recipientId: o.owner_id, reason: 'obligation owner', offsets })).filter(o => o.deadlineAt > now),
  ]
}

/** OBL-002: owner-configured days from an overdue obligation's first notice to its escalation; no row means 3. */
export async function overdueEscalationDays(db: D1Database): Promise<number> {
  return (await db.prepare('SELECT overdue_escalation_days AS days FROM lk_deadline_reminder_settings WHERE id=?').bind('installation').first<{ days: number }>())?.days ?? 3
}
/** OBL-002: confirmed obligations whose due date has ended in the agreement's zone and are not done. */
export async function overdueObligations(db: D1Database, now: number) {
  const rows = (await db.prepare(`SELECT o.id, o.agreement_id, o.due_date, o.owner_id, a.timezone, a.owner_id AS responsible_id FROM lk_obligations o JOIN lk_agreements a ON a.id=o.agreement_id
    WHERE o.status='confirmed' AND o.due_date IS NOT NULL`).all<any>()).results
  return rows.map(o => ({ subjectKind: 'obligation' as const, subjectId: o.id, agreementId: o.agreement_id, deadlineDate: o.due_date, deadlineAt: noticeDeadline(o.due_date, 0, o.timezone).at, zone: o.timezone,
    recipientId: o.owner_id, reason: 'obligation owner', offsets: [-1], responsibleId: o.responsible_id as string })).filter(o => o.deadlineAt <= now)
}

/** SQL: the deadline is still open with the same date (decision, completion or a moved date ends its reminders). */
export function stillOpenSql(kind: string, subjectId: string, deadlineDate: string) {
  return kind === 'renewal'
    ? sql('EXISTS(SELECT 1 FROM lk_renewals WHERE id=? AND decision IS NULL AND deadline_date=?)', subjectId, deadlineDate)
    : sql("EXISTS(SELECT 1 FROM lk_obligations WHERE id=? AND status='confirmed' AND due_date=?)", subjectId, deadlineDate)
}

/** SQL: an active member other than an agent who may read the agreement. */
export function readerSql(c: Pick<Ctx, 'actor'>, agreementId: string | null, id: string) {
  const active = sql(`EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND (o.role='owner' OR COALESCE((SELECT r.role FROM lk_roles r WHERE r.operator_id=o.id),'viewer')<>'agent'))`, id)
  return agreementId ? [active, visibleSql({ ...c.actor, id }, agreementId)] : [active]
}
export async function isReader(c: Ctx, agreementId: string | null, id: string) {
  const checks = readerSql(c, agreementId, id)
  return !!(await c.db.prepare(`SELECT CASE WHEN ${checks.map(s => `(${s.sql})`).join(' AND ')} THEN 1 ELSE 0 END AS ok`).bind(...checks.flatMap(s => s.params)).first<{ ok: number }>())?.ok
}

export async function preferenceOf(db: D1Database, id: string) {
  return db.prepare('SELECT timezone, digest, alternate_id FROM lk_person_preferences WHERE operator_id=?').bind(id).first<{ timezone: string; digest: number; alternate_id: string | null }>()
}
export const dueAt = (deadlineDate: string, offset: number, zone: string) => zonedInstant(addDays(deadlineDate, -offset), '09:00:00', zone)

const configure: Handler = async (c, p) => {
  requireRole(c.actor, may.manageRoles, 'set deadline reminder offsets')
  const escalateDays = p.overdueEscalationDays === undefined ? await overdueEscalationDays(c.db) : integer(p, 'overdueEscalationDays', 1, 60)
  const offsets = list(p, 'offsets', 12).map(value => integer({ value }, 'value', 0, 730))
  if (!offsets.length || new Set(offsets).size !== offsets.length) fail('INVALID', 'Choose between 1 and 12 different offsets in days before the deadline.', 400, { field: 'offsets' })
  offsets.sort((a, b) => b - a)
  return {
    allowed: may.manageRoles,
    result: { offsets },
    writes: [sql('INSERT INTO lk_deadline_reminder_settings(id,offsets,updated_by,updated_at,overdue_escalation_days) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET offsets=excluded.offsets, overdue_escalation_days=excluded.overdue_escalation_days, updated_by=excluded.updated_by, updated_at=excluded.updated_at', 'installation', json(offsets), c.actor.id, c.now, escalateDays)],
    audit: [{ action: 'deadline.reminders.configure', summary: `Deadline reminders ${offsets.join(', ')} days before each renewal notice deadline and obligation due date; an overdue obligation escalates ${escalateDays} day${escalateDays === 1 ? '' : 's'} after its owner is told.` }],
  }
}
export const deadlineReminderHandlers: Record<string, Handler> = { 'deadline.reminders.configure': configure }

/** Workspace view: offsets, the messages for visible agreements (no addresses) and their provider events. */
export async function deadlineReminderState(env: Bindings, actor: Actor, visible: Set<string>) {
  requireRole(actor, may.read, 'read deadline reminders')
  const rows = (await env.DB.prepare('SELECT id, agreement_id, subject_kind, subject_id, deadline_date, kind, offset_days, recipient_id, recipient_reason, timezone, due_at, status, provider, code, digest_id, retry_of, created_at FROM lk_deadline_reminders ORDER BY due_at DESC, created_at DESC').all<any>()).results
  const sent = rows.filter(r => r.agreement_id ? visible.has(r.agreement_id) : actor.role === 'owner' || r.recipient_id === actor.id)
  const ids = new Set([...sent.map(r => r.id), ...sent.map(r => r.digest_id).filter(Boolean)])
  const events = (await env.DB.prepare('SELECT id, reminder_id, status, occurred_at, recorded_at FROM lk_deadline_reminder_events ORDER BY occurred_at').all<any>()).results.filter(e => ids.has(e.reminder_id))
  return { offsets: await deadlineOffsets(env.DB), overdueEscalationDays: await overdueEscalationDays(env.DB), sent, events }
}
