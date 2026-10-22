import { familyClear } from './family-analysis-guard'
import { agreementAccessSql } from './access'
// Bulk schedules track the existing lifecycle projection. RENEW-002 delivers from a
// schedule whose deadline matches the current one; its messages are the delivery record.
import { installationSettings } from './installation'
import type { Bindings } from '../auth.server'
import { canSee, grantsFor, may, requireRole, roleSql } from './access'
import { recordReads } from './audit'
import type { Ctx, Handler } from './commands'
import { addDays, zonedInstant } from './dates'
import { lifecycle } from './lifecycle'
import { canonical, fail, integer, json, list, sql, text, type Actor, type Sql } from './model'
import { bump, visibleAgreement, type AgreementRow } from './records'

type Row = { id: string; [key: string]: any }
export interface ReminderInstant { offsetDays: number; date: string; at: number }
export interface BulkDeadline {
  agreementId: string; version: number; reference: string; title: string; timezone: string
  lifecycle: string; start: string | null; end: string | null; term: number
  deadlineDate: string | null; deadlineAt: number | null
  reason: string | null; reminders: ReminderInstant[]
}
export interface BulkPreview {
  id: string; ownerId: string; offsets: number[]; createdAt: number; expiresAt: number
  tracked: BulkDeadline[]; skipped: BulkDeadline[]
}
interface Snapshot { ownerId: string; offsets: number[]; rows: BulkDeadline[] }
const all = async (db: D1Database, table: string, ids: string[]): Promise<Row[]> =>
  (await db.prepare(`SELECT * FROM ${table} WHERE agreement_id IN (SELECT value FROM json_each(?))`).bind(json(ids)).all<Row>()).results

function selection(p: Record<string, unknown>) {
  const ids = list(p, 'agreementIds', 100).map(value => text({ value }, 'value', 64))
  if (!ids.length || new Set(ids).size !== ids.length) fail('INVALID', 'Select between 1 and 100 different imported agreements.')
  return ids.sort()
}
function offsets(p: Record<string, unknown>) {
  const values = list(p, 'offsets', 12).map(value => integer({ value }, 'value', 0, 730))
  if (!values.length || new Set(values).size !== values.length) fail('INVALID', 'Choose different reminder offsets in days before the notice deadline.')
  return values.sort((a, b) => b - a)
}
async function projection(c: Ctx, ids: string[], days: number[]) {
  const agreements = await Promise.all(ids.map(id => visibleAgreement(c, id)))
  const [terms, renewals, notices] = await Promise.all(['lk_terms', 'lk_renewals', 'lk_notices'].map(table => all(c.db, table, ids)))
  const { rollNoticeDeadlines } = await installationSettings(c.db)
  const unblocked = new Map(await Promise.all(agreements.map(async a=>{const check=familyClear(a.id);return [a.id,!!(await c.db.prepare(`SELECT (${check.sql}) AS ok`).bind(...check.params).first<{ok:number}>())?.ok] as const})))
  const rows = agreements.map(a => {
    const current = lifecycle(a, terms, renewals, notices, c.now, rollNoticeDeadlines)
    const reason = !unblocked.get(a.id) ? 'Family governing terms need counsel review' : a.status !== 'imported' ? 'Not an imported agreement' : ['expired', 'terminated'].includes(current.status) ? current.status === 'expired' ? 'Expired' : 'Terminated' : current.missing.length ? `Missing confirmed terms: ${current.missing.join(', ')}` : !current.deadline ? 'No current notice deadline' : current.terminationUnsent ? 'Termination notice not recorded as sent' : null
    return {
      agreementId: a.id, version: a.version, reference: a.reference, title: a.title, timezone: a.timezone,
      lifecycle: current.status, start: current.start, end: current.end, term: current.term,
      deadlineDate: reason ? null : current.deadline!.date, deadlineAt: reason ? null : current.deadline!.at, reason,
      reminders: reason ? [] : days.map(offsetDays => {
        const date = addDays(current.deadline!.date, -offsetDays)
        return { offsetDays, date, at: zonedInstant(date, '09:00:00', a.timezone) }
      }),
    } satisfies BulkDeadline
  })
  return { agreements, rows }
}
// One JSON parameter keeps a 100-agreement guard below D1's bind limit.
function selectionGuard(actorId: string, agreements: AgreementRow[]): Sql {
  const access=agreementAccessSql(actorId)
  return sql(`NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN lk_agreements a ON a.id=json_extract(j.value,'$.id') WHERE a.id IS NULL OR a.version<>json_extract(j.value,'$.version') OR NOT(${access.sql}))`,json(agreements.map(a=>({id:a.id,version:a.version}))),...access.params)
}
function ownerGuard(id: string, version: number, agreements: AgreementRow[]) {
  const access = selectionGuard(id, agreements)
  return sql(`EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND version=?) AND (${access.sql})`, id, version, ...access.params)
}

const preview: Handler = async (c, p) => {
  requireRole(c.actor, may.renewalDecision, 'schedule renewal reminders')
  const ids = selection(p), days = offsets(p), ownerId = text(p, 'ownerId', 64)
  const owner = await c.db.prepare("SELECT version FROM oa_operators WHERE id=? AND status='active'").bind(ownerId).first<{ version: number }>()
  if (!owner) fail('INVALID', 'The reminder owner must be an active member.')
  const { agreements, rows } = await projection(c, ids, days)
  const assignedAccess = ownerGuard(ownerId, owner.version, agreements)
  const readable = await c.db.prepare(`SELECT CASE WHEN ${assignedAccess.sql} THEN 1 ELSE 0 END AS ok`).bind(...assignedAccess.params).first<{ ok: number }>()
  if (!readable?.ok) fail('INVALID', 'The reminder owner must have access to every selected agreement. Choose another member or update access first.')
  const id = crypto.randomUUID(), expiresAt = c.now + 30 * 60_000
  const snapshot: Snapshot = { ownerId, offsets: days, rows }
  const result: BulkPreview = { id, ownerId, offsets: days, createdAt: c.now, expiresAt, tracked: rows.filter(r => !r.reason), skipped: rows.filter(r => r.reason) }
  return {
    allowed: may.renewalDecision, result,
    checks: [selectionGuard(c.actor.id, agreements), assignedAccess],
    writes: [sql('INSERT INTO lk_bulk_reminder_previews VALUES(?,?,?,?,?,?,?,NULL)', id, c.actor.id, ownerId, owner.version, json(snapshot), c.now, expiresAt)],
    audit: rows.map(r => ({ action: 'renewal.bulk.preview', agreementId: r.agreementId, summary: r.reason ? `Skipped: ${r.reason}` : `Previewed term ${r.term} notice deadline ${r.deadlineDate} (${r.timezone}); ${days.join(', ')} days before, owner ${ownerId}. No reminder delivered.` })),
  }
}
const apply: Handler = async (c, p) => {
  requireRole(c.actor, may.renewalDecision, 'schedule renewal reminders')
  const id = text(p, 'previewId', 64)
  const saved = await c.db.prepare('SELECT * FROM lk_bulk_reminder_previews WHERE id=? AND actor_id=?').bind(id, c.actor.id).first<any>()
  if (!saved) fail('NOT_FOUND', 'No reminder preview you prepared has that identity.', 404)
  if (saved.applied_at !== null || saved.expires_at <= c.now) fail('STALE', 'This preview was applied or expired. Preview the selection again.', 409)
  const snapshot: Snapshot = JSON.parse(saved.snapshot)
  const { agreements, rows } = await projection(c, snapshot.rows.map(r => r.agreementId), snapshot.offsets)
  if (canonical(rows) !== canonical(snapshot.rows)) fail('STALE', 'Agreements or their current deadlines changed. Preview the selection again.', 409)
  const tracked = rows.filter(r => !r.reason)
  const writes: Sql[] = tracked.flatMap(r => {
    const a = agreements.find(a => a.id === r.agreementId)!
    return [sql(`INSERT INTO lk_reminder_schedules VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(agreement_id) DO UPDATE SET agreement_version=excluded.agreement_version, owner_id=excluded.owner_id, deadline_date=excluded.deadline_date, deadline_at=excluded.deadline_at, timezone=excluded.timezone, term_start=excluded.term_start, term_end=excluded.term_end, term_number=excluded.term_number, offsets=excluded.offsets, reminders=excluded.reminders, preview_id=excluded.preview_id, created_by=excluded.created_by, created_at=excluded.created_at`, crypto.randomUUID(), r.agreementId, r.version + 1, snapshot.ownerId, r.deadlineDate, r.deadlineAt, r.timezone, r.start, r.end, r.term, json(snapshot.offsets), json(r.reminders), id, c.actor.id, c.now), bump(c, a)]
  })
  return {
    allowed: may.renewalDecision,
    result: { previewId: id, scheduled: tracked.length, skipped: rows.length - tracked.length, deliveryStatus: 'not_delivered' },
    checks: [...tracked.map(row=>familyClear(row.agreementId)),selectionGuard(c.actor.id, agreements), ownerGuard(saved.owner_id, saved.owner_version, agreements), sql('EXISTS(SELECT 1 FROM lk_bulk_reminder_previews WHERE id=? AND actor_id=? AND applied_at IS NULL AND expires_at>?)', id, c.actor.id, c.now)],
    writes: [...writes, sql('UPDATE lk_bulk_reminder_previews SET applied_at=? WHERE id=?', c.now, id)],
    audit: rows.map(r => ({ action: 'renewal.bulk.apply', agreementId: r.agreementId, summary: r.reason ? `Skipped: ${r.reason}` : `Stored ${snapshot.offsets.join(', ')} day reminder schedule for term ${r.term}, notice deadline ${r.deadlineDate} (${r.timezone}), owner ${snapshot.ownerId}. No reminder delivered.` })),
  }
}
export const bulkReminderHandlers: Record<string, Handler> = { 'renewal.bulk.preview': preview, 'renewal.bulk.apply': apply }

/** Idempotent command responses must not replay restricted preview content after access changes. */
export async function authorizeBulkPreviewResult(c: Ctx, result: unknown) {
  requireRole(c.actor, may.renewalDecision, 'schedule renewal reminders')
  const preview = result as BulkPreview
  await Promise.all([...preview.tracked, ...preview.skipped].map(r => visibleAgreement(c, r.agreementId)))
}

/** State/endpoint reader: schedules inherit agreement access and audit rules. */
export async function bulkReminderSchedules(env: Bindings, actor: Actor) {
  requireRole(actor, may.read, 'read renewal schedules')
  const grants = await grantsFor(env, actor)
  const agreements = (await env.DB.prepare('SELECT * FROM lk_agreements').all<AgreementRow>()).results.filter(a => canSee(actor, a, grants))
  const byId = new Map(agreements.map(a => [a.id, a]))
  const rows = (await env.DB.prepare('SELECT * FROM lk_reminder_schedules ORDER BY deadline_at, agreement_id').all<Row>()).results.filter(r => byId.has(r.agreement_id))
  const ids = rows.map(r => r.agreement_id)
  const [terms, renewals, notices] = await Promise.all(['lk_terms', 'lk_renewals', 'lk_notices'].map(table => all(env.DB, table, ids)))
  const { rollNoticeDeadlines } = await installationSettings(env.DB)
  await recordReads(env, actor, rows.filter(r => byId.get(r.agreement_id)!.restricted).map(r => ({ action: 'agreement.view', agreementId: r.agreement_id, summary: 'Read restricted reminder schedule.' })))
  return rows.map(r => {
    const a = byId.get(r.agreement_id)!, current = lifecycle(a, terms, renewals, notices, Date.now(), rollNoticeDeadlines)
    const matches = a.version === r.agreement_version && current.deadline?.at === r.deadline_at && !current.missing.length && !current.terminationUnsent
    return { ...r, offsets: JSON.parse(r.offsets), reminders: JSON.parse(r.reminders), schedule_status: matches ? 'scheduled' : 'needs_review' }
  })
}
