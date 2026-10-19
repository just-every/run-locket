// APPROVE-004: who is waiting on which approval, when they are reminded and to
// whom it escalates. A pending approval is a non-cancelled approval request
// (MOBILE-001) naming an active commercial approver, on the agreement's current
// version while it is in review and has no live commercial decision.
import type { Bindings } from '../auth.server'
import { may, requireRole } from './access'
import { recipientGuard } from './approval-mail'
import { addBusinessDays, defaultZone } from './business-days'
import type { Ctx, Handler } from './commands'
import { fail, integer, optionalText, sql, text, type Actor, type Sql } from './model'
import { agreementGuards, currentVersion, requireStatus, visibleAgreement } from './records'

export const manualGapMs = 4 * 3_600_000
export const defaults = { firstAfterDays: 1, repeatEveryDays: 1, escalateAfterDays: 3, escalationContactId: null as string | null }
export type Settings = typeof defaults

export interface Pending {
  agreementId: string; versionId: string; versionDigest: string; approverId: string; approverEmail: string; requestedAt: number
}

export async function reminderSettings(db: D1Database): Promise<Settings> {
  const row = await db.prepare('SELECT * FROM lk_approval_reminder_settings WHERE id=?').bind('installation').first<any>()
  return row ? { firstAfterDays: row.first_after_days, repeatEveryDays: row.repeat_every_days, escalateAfterDays: row.escalate_after_days, escalationContactId: row.escalation_contact_id } : defaults
}

export async function approverZone(db: D1Database, operatorId: string): Promise<string> {
  return (await db.prepare('SELECT timezone FROM lk_person_preferences WHERE operator_id=?').bind(operatorId).first<{ timezone: string }>())?.timezone ?? defaultZone
}

export const commercialSql = `(SELECT CASE WHEN o.role='owner' THEN 'owner' ELSE COALESCE((SELECT r.role FROM lk_roles r WHERE r.operator_id=o.id),'viewer') END) IN ('owner','approver')`

/** Pending approvals, optionally for one agreement. */
export async function pendingApprovals(db: D1Database, agreementId: string | null = null): Promise<Pending[]> {
  const rows = await db.prepare(`SELECT m.agreement_id, m.version_id, m.version_digest, m.recipient_id, o.email, MIN(m.created_at) AS requested_at
    FROM lk_approval_mail m JOIN lk_agreements a ON a.id=m.agreement_id JOIN lk_versions v ON v.id=a.current_version_id JOIN oa_operators o ON o.id=m.recipient_id
    WHERE m.status<>'cancelled' AND a.status='in_review' AND v.id=m.version_id AND v.digest=m.version_digest AND o.status='active' AND ${commercialSql}
      AND NOT EXISTS(SELECT 1 FROM lk_approvals x WHERE x.agreement_id=a.id AND x.version_id=v.id AND x.version_digest=v.digest AND x.kind='commercial' AND x.invalidated_at IS NULL)
      AND (? IS NULL OR m.agreement_id=?)
    GROUP BY m.agreement_id, m.version_id, m.version_digest, m.recipient_id, o.email ORDER BY requested_at`).bind(agreementId, agreementId).all<any>()
  return rows.results.map(r => ({ agreementId: r.agreement_id, versionId: r.version_id, versionDigest: r.version_digest, approverId: r.recipient_id, approverEmail: r.email, requestedAt: r.requested_at }))
}

/** SQL: this pending approval still waits (same version, in review, undecided, approver still commercial). */
export function stillPendingSql(p: Pick<Pending, 'agreementId' | 'versionId' | 'versionDigest' | 'approverId'>): Sql {
  return sql(`EXISTS(SELECT 1 FROM lk_agreements a JOIN lk_versions v ON v.id=a.current_version_id JOIN oa_operators o ON o.id=?
    WHERE a.id=? AND a.status='in_review' AND v.id=? AND v.digest=? AND o.status='active' AND ${commercialSql}
      AND EXISTS(SELECT 1 FROM lk_approval_mail m WHERE m.agreement_id=a.id AND m.version_id=v.id AND m.recipient_id=o.id AND m.status<>'cancelled')
      AND NOT EXISTS(SELECT 1 FROM lk_approvals x WHERE x.agreement_id=a.id AND x.version_id=v.id AND x.version_digest=v.digest AND x.kind='commercial' AND x.invalidated_at IS NULL))`,
    p.approverId, p.agreementId, p.versionId, p.versionDigest)
}

/** Reminder n (1-based) is due n-1 repeats after the first; escalation once. Same local time, business days only. */
export function schedule(p: Pending, s: Settings, zone: string, now: number) {
  const due = (n: number) => addBusinessDays(p.requestedAt, s.firstAfterDays + (n - 1) * s.repeatEveryDays, zone)
  let slot = 0
  while (slot < 1000 && due(slot + 1) <= now) slot++
  return { slot, slotDueAt: slot ? due(slot) : null, nextReminderAt: due(slot + 1), escalateAt: addBusinessDays(p.requestedAt, s.escalateAfterDays, zone) }
}

async function eligible(c: Ctx, agreementId: string, id: string, email: string) {
  const checks = recipientGuard(c, agreementId, id, email)
  const row = await c.db.prepare(`SELECT CASE WHEN ${checks.map(s => `(${s.sql})`).join(' AND ')} THEN 1 ELSE 0 END AS ok`).bind(...checks.flatMap(s => s.params)).first<{ ok: number }>()
  return !!row?.ok
}

export type Reason = 'approver' | 'delegate' | 'escalation_contact' | 'owner'
/** The approver's delegate, else the escalation contact, else the owner: the first who may decide this agreement. */
export async function escalationTarget(c: Ctx, p: Pending, s: Settings): Promise<{ id: string; email: string; reason: Reason } | null> {
  const delegate = (await c.db.prepare('SELECT delegate_id FROM lk_person_preferences WHERE operator_id=?').bind(p.approverId).first<{ delegate_id: string | null }>())?.delegate_id ?? null
  const owner = (await c.db.prepare("SELECT id FROM oa_operators WHERE role='owner' AND status='active' ORDER BY created_at LIMIT 1").first<{ id: string }>())?.id ?? null
  for (const [id, reason] of [[delegate, 'delegate'], [s.escalationContactId, 'escalation_contact'], [owner, 'owner']] as [string | null, Reason][]) {
    if (!id || id === p.approverId) continue
    const person = await c.db.prepare('SELECT email FROM oa_operators WHERE id=?').bind(id).first<{ email: string }>()
    if (person && (await eligible(c, p.agreementId, id, person.email))) return { id, email: person.email, reason }
  }
  return null
}

/** Active owners and approvers: the people who can hold, receive or delegate a commercial approval. */
export async function requireCommercial(db: D1Database, id: string, field: string) {
  const ok = await db.prepare(`SELECT 1 AS ok FROM oa_operators o WHERE o.id=? AND o.status='active' AND ${commercialSql}`).bind(id).first()
  if (!ok) fail('INVALID', 'Choose an active owner or approver.', 400, { field })
}
export const commercialCheck = (id: string) => sql(`EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND ${commercialSql})`, id)

const configure: Handler = async (c, p) => {
  requireRole(c.actor, may.manageRoles, 'set approval reminder intervals')
  const first = integer(p, 'firstAfterDays', 1, 30), repeat = integer(p, 'repeatEveryDays', 1, 30), escalate = integer(p, 'escalateAfterDays', 1, 60)
  const contact = optionalText(p, 'escalationContactId', 100)
  if (contact) await requireCommercial(c.db, contact, 'escalationContactId')
  return {
    allowed: may.manageRoles,
    result: { firstAfterDays: first, repeatEveryDays: repeat, escalateAfterDays: escalate, escalationContactId: contact },
    writes: [sql('INSERT INTO lk_approval_reminder_settings VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET first_after_days=excluded.first_after_days, repeat_every_days=excluded.repeat_every_days, escalate_after_days=excluded.escalate_after_days, escalation_contact_id=excluded.escalation_contact_id, updated_by=excluded.updated_by, updated_at=excluded.updated_at', 'installation', first, repeat, escalate, contact, c.actor.id, c.now)],
    checks: contact ? [commercialCheck(contact)] : [],
    audit: [{ action: 'approval.reminders.configure', summary: `Approval reminders: first after ${first} business day${first === 1 ? '' : 's'}, then every ${repeat}; escalate after ${escalate}.` }],
  }
}

/** "Remind approver": anyone working on the agreement, at most once every 4 hours per approver. */
const remind: Handler = async (c, p) => {
  requireRole(c.actor, may.review, 'remind an approver')
  const a = await visibleAgreement(c, p.agreementId)
  requireStatus(a, ['in_review'], 'remind its approver')
  const v = await currentVersion(c, a)
  const approverId = text(p, 'approverId', 100)
  const pending = (await pendingApprovals(c.db, a.id)).find(x => x.approverId === approverId && x.versionId === v.id)
  if (!pending) fail('NOT_PENDING', 'That person has no pending approval request on the current version.', 409)
  const last = await c.db.prepare("SELECT MAX(created_at) AS at FROM lk_approval_reminders WHERE agreement_id=? AND approver_id=? AND kind='manual'").bind(a.id, approverId).first<{ at: number | null }>()
  if (last?.at && c.now - last.at < manualGapMs) fail('TOO_SOON', 'This approver was reminded less than 4 hours ago.', 429, { availableAt: last.at + manualGapMs })
  const reviewUrl = `${new URL(c.env.AUTH_ORIGIN).origin}/app#agreement/${encodeURIComponent(a.id)}/review`
  return {
    allowed: may.review,
    result: { id: c.commandId, status: 'queued', approverId },
    writes: [sql("INSERT INTO lk_approval_reminders(id,agreement_id,version_id,version_digest,approver_id,kind,slot,recipient_id,recipient_email,recipient_reason,review_url,status,requested_by,due_at,created_at) VALUES(?,?,?,?,?,'manual',NULL,?,?,'approver',?,'queued',?,?,?)", c.commandId, a.id, v.id, v.digest, approverId, approverId, pending.approverEmail, reviewUrl, c.actor.id, c.now, c.now)],
    checks: [...agreementGuards(c, a, p), stillPendingSql(pending), sql("NOT EXISTS(SELECT 1 FROM lk_approval_reminders WHERE agreement_id=? AND approver_id=? AND kind='manual' AND created_at>?)", a.id, approverId, c.now - manualGapMs)],
    audit: [{ action: 'approval.remind', agreementId: a.id, summary: `Asked Locket to remind the approver on v${v.number}.` }],
  }
}

export const approvalReminderHandlers: Record<string, Handler> = {
  'approval.reminders.configure': configure,
  'approval.remind': remind,
}

/** What the workspace shows: settings, preferences, and each visible pending approval's schedule. */
export async function approvalReminderState(env: Bindings, actor: Actor, visible: Set<string>, now: number) {
  const db = env.DB, settings = await reminderSettings(db)
  const preferences = (await db.prepare('SELECT operator_id, timezone, delegate_id, digest, alternate_id FROM lk_person_preferences').all<any>()).results
  const pending = []
  for (const p of (await pendingApprovals(db)).filter(x => visible.has(x.agreementId))) {
    const zone = preferences.find(x => x.operator_id === p.approverId)?.timezone ?? defaultZone
    const s = schedule(p, settings, zone, now)
    const last = await db.prepare("SELECT MAX(created_at) AS at FROM lk_approval_reminders WHERE agreement_id=? AND approver_id=? AND kind='manual'").bind(p.agreementId, p.approverId).first<{ at: number | null }>()
    const manualAvailableAt = last?.at && now - last.at < manualGapMs ? last.at + manualGapMs : null
    pending.push({ agreementId: p.agreementId, versionId: p.versionId, approverId: p.approverId, requestedAt: p.requestedAt, timezone: zone, nextReminderAt: s.nextReminderAt, escalateAt: s.escalateAt, manualAvailableAt })
  }
  const sent = (await db.prepare('SELECT id, agreement_id, version_id, approver_id, kind, slot, recipient_id, recipient_reason, status, provider, code, requested_by, due_at, created_at FROM lk_approval_reminders ORDER BY created_at DESC').all<any>()).results.filter(r => visible.has(r.agreement_id))
  return {
    settings,
    preferences: actor.role === 'owner' ? preferences : preferences.filter(x => x.operator_id === actor.id),
    pending,
    sent,
  }
}
