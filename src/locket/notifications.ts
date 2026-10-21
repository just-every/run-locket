// Person-scoped notifications. The business command inserts its events in the
// same guarded batch as the change; readers and senders repeat current access.
import type { Bindings } from '../auth.server'
import { authority, requireRole, visibleSql } from './access'
import { defaultZone, usZones } from './business-days'
import type { Ctx, Handler } from './commands'
import { bool, fail, oneOf, sql, text, type Actor, type Role, type Sql } from './model'

export const notificationPeople: Role[] = ['owner', 'counsel', 'approver', 'requester', 'viewer']
export type NotificationSource = 'approval_mail' | 'approval_reminder' | 'deadline'
export interface NotificationInput {
  key: string
  agreementId: string
  recipientId: string
  kind: string
  sourceKind?: NotificationSource | null
  sourceId?: string | null
}
export interface NotificationRow {
  id: string; event_key: string; agreement_id: string; recipient_id: string; kind: string; version_id: string | null; version_digest: string | null
  source_kind: NotificationSource | null; source_id: string | null; created_at: number; read_at: number | null
  in_app: number; email_status: string; provider: string | null; provider_message_id: string | null
  code: string | null; delivery_id: string | null
}
export interface NotificationPreferences { inApp: boolean; email: boolean; digest: boolean; timezone: string }

export const activeHumanSql = (id: string): Sql => sql(`EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active'
  AND (o.role='owner' OR COALESCE((SELECT r.role FROM lk_roles r WHERE r.operator_id=o.id),'viewer') IN ('owner','counsel','approver','requester','viewer')))`, id)
export const notificationReaderSql = (actor: Actor, agreementId: string, id: string): Sql[] => [activeHumanSql(id), visibleSql({ ...actor, id }, agreementId)]
export const notificationBind = (db: D1Database, statement: Sql) => db.prepare(statement.sql).bind(...statement.params)
export const notificationBatch = (db: D1Database, statements: Sql[]) => db.batch(statements.map(s => notificationBind(db, s)))
export async function notificationCheck(db: D1Database, checks: Sql[]): Promise<boolean> {
  return !!(await notificationBind(db, sql(`SELECT CASE WHEN ${checks.map(s => `(${s.sql})`).join(' AND ')} THEN 1 ELSE 0 END AS ok`, ...checks.flatMap(s => s.params))).first<{ ok: number }>())?.ok
}

export const preferenceSql = (id: string, field: 'email' | 'digest' | 'in_app'): Sql =>
  sql(`COALESCE((SELECT ${field} FROM lk_person_preferences WHERE operator_id=?),${field === 'digest' ? 0 : 1})`, id)
export const notificationZoneSql = (id: string): Sql => sql(`COALESCE((SELECT timezone FROM lk_person_preferences WHERE operator_id=?),
  (SELECT timezone FROM lk_installation_settings WHERE id='installation'),?)`, id, defaultZone)
export async function notificationPreferences(db: D1Database, id: string): Promise<NotificationPreferences> {
  const row = await db.prepare(`SELECT p.in_app,p.email,p.digest,COALESCE(p.timezone,s.timezone,?) AS timezone
    FROM oa_operators o LEFT JOIN lk_person_preferences p ON p.operator_id=o.id
    LEFT JOIN lk_installation_settings s ON s.id='installation' WHERE o.id=?`).bind(defaultZone, id)
    .first<{ in_app: number | null; email: number | null; digest: number | null; timezone: string }>()
  return { inApp: row?.in_app !== 0, email: row?.email !== 0, digest: row?.digest === 1, timezone: row?.timezone ?? defaultZone }
}

/** Safe inside the business batch: inactive people, agents and inaccessible
 * agreements produce no row; replaying an event never creates another item. */
export function notificationWrites(c: Ctx, input: NotificationInput): Sql[] {
  const checks = notificationReaderSql(c.actor, input.agreementId, input.recipientId)
  return [sql(`INSERT INTO lk_notifications(id,event_key,agreement_id,recipient_id,kind,source_kind,source_id,created_at,version_id,version_digest,in_app,email_status,code)
    SELECT ?,?,?,?,?,?,?,?,
      CASE WHEN ?='approval' THEN (SELECT current_version_id FROM lk_agreements WHERE id=?) ELSE NULL END,
      CASE WHEN ?='approval' THEN (SELECT v.digest FROM lk_agreements a JOIN lk_versions v ON v.id=a.current_version_id WHERE a.id=?) ELSE NULL END,
      COALESCE((SELECT in_app FROM lk_person_preferences WHERE operator_id=?),1),
      CASE WHEN COALESCE((SELECT email FROM lk_person_preferences WHERE operator_id=?),1)=0 THEN 'suppressed' ELSE 'pending' END,
      CASE WHEN COALESCE((SELECT email FROM lk_person_preferences WHERE operator_id=?),1)=0 THEN 'email_disabled' ELSE NULL END
    WHERE ${checks.map(s => `(${s.sql})`).join(' AND ')} ON CONFLICT DO NOTHING`,
    crypto.randomUUID(), input.key, input.agreementId, input.recipientId, input.kind, input.sourceKind ?? null, input.sourceId ?? null, c.now,
    input.kind, input.agreementId, input.kind, input.agreementId, input.recipientId, input.recipientId, input.recipientId, ...checks.flatMap(s => s.params))]
}

export function notificationLink(env: Bindings, row: Pick<NotificationRow, 'agreement_id' | 'kind'>): string {
  const section = /approval/.test(row.kind) ? 'review' : /^queue_/.test(row.kind) ? 'versions' : /signature/.test(row.kind) ? 'signature' : /obligation|deadline/.test(row.kind) ? 'terms' : 'versions'
  return `${new URL(env.AUTH_ORIGIN).origin}/app#agreement/${encodeURIComponent(row.agreement_id)}/${section}`
}

const setPreferences: Handler = async (c, p) => {
  requireRole(c.actor, notificationPeople, 'set notification preferences')
  if (p.operatorId !== undefined && p.operatorId !== c.actor.id) fail('FORBIDDEN', 'Set only your own notification preferences.', 403)
  for (const field of ['inApp', 'email', 'digest']) if (typeof p[field] !== 'boolean') fail('INVALID', `${field} must be true or false.`, 400, { field })
  const inApp = bool(p, 'inApp'), email = bool(p, 'email'), digest = bool(p, 'digest'), timezone = oneOf(p, 'timezone', usZones)
  return {
    allowed: notificationPeople, result: { inApp, email, digest, timezone },
    writes: [sql(`INSERT INTO lk_person_preferences(operator_id,timezone,updated_by,updated_at,digest,in_app,email) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(operator_id) DO UPDATE SET timezone=excluded.timezone,digest=excluded.digest,in_app=excluded.in_app,email=excluded.email,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    c.actor.id, timezone, c.actor.id, c.now, Number(digest), Number(inApp), Number(email))],
    checks: [activeHumanSql(c.actor.id)],
    audit: [{ action: 'notification.preferences', summary: 'Updated own notification channels, daily digest and time zone.' }],
  }
}

const markRead: Handler = async (c, p) => {
  requireRole(c.actor, notificationPeople, 'read notifications')
  const id = text(p, 'id', 200)
  const row = await c.db.prepare('SELECT agreement_id FROM lk_notifications WHERE id=? AND recipient_id=? AND in_app=1').bind(id, c.actor.id).first<{ agreement_id: string }>()
  if (!row || !(await notificationCheck(c.db, notificationReaderSql(c.actor, row.agreement_id, c.actor.id)))) fail('NOT_FOUND', 'No accessible notification has that identity.', 404)
  return {
    allowed: notificationPeople, result: { id, read: true },
    writes: [sql('UPDATE lk_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND recipient_id=?', c.now, id, c.actor.id)],
    checks: [...notificationReaderSql(c.actor, row.agreement_id, c.actor.id), sql('EXISTS(SELECT 1 FROM lk_notifications WHERE id=? AND recipient_id=? AND in_app=1)', id, c.actor.id)],
    audit: [{ action: 'notification.read', agreementId: row.agreement_id, summary: 'Marked own notification read.' }],
  }
}

export const notificationHandlers: Record<string, Handler> = { 'notification.preferences': setPreferences, 'notification.read': markRead }

/** No other person's preferences, delivery addresses or inaccessible records. */
export async function notificationState(env: Bindings, actor: Actor) {
  if (actor.role === 'agent') return { preferences: { inApp: false, email: false, digest: false, timezone: defaultZone }, items: [] }
  requireRole(actor, notificationPeople, 'read notifications')
  if (!(await notificationCheck(env.DB, [authority(actor, notificationPeople)]))) fail('AUTHORITY', 'Sign in with a current human session.', 403)
  const preferences = await notificationPreferences(env.DB, actor.id)
  const auth = authority(actor, notificationPeople)
  const items = (await notificationBind(env.DB, sql(`SELECT n.id,n.agreement_id,n.kind,n.created_at,n.read_at,n.email_status
    FROM lk_notifications n JOIN lk_agreements a ON a.id=n.agreement_id
    WHERE n.recipient_id=? AND n.in_app=1 AND COALESCE((SELECT in_app FROM lk_person_preferences WHERE operator_id=?),1)=1
    AND (${auth.sql}) AND (a.restricted=0 OR (SELECT CASE WHEN o.role='owner' THEN 'owner' ELSE COALESCE(r.role,'viewer') END
      FROM oa_operators o LEFT JOIN lk_roles r ON r.operator_id=o.id WHERE o.id=?) IN ('owner','counsel')
      OR a.requester_id=? OR a.owner_id=? OR EXISTS(SELECT 1 FROM lk_access g WHERE g.agreement_id=a.id AND g.operator_id=?))
    ORDER BY n.created_at DESC,n.id`, actor.id, actor.id, ...auth.params, actor.id, actor.id, actor.id, actor.id))
    .all<Pick<NotificationRow, 'id' | 'agreement_id' | 'kind' | 'created_at' | 'read_at' | 'email_status'>>()).results
  return { preferences, items: items.map(row => ({ ...row, link: notificationLink(env, row) })) }
}
