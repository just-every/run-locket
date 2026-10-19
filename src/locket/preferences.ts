// Each person's reminder preferences: their US time zone (approval business days
// under APPROVE-004, reminder times under RENEW-002), a delegate for approval
// escalations (owners and approvers only), a daily digest and an alternate
// recipient for bounced deadline reminders. People set their own; the owner may
// set anyone's.
import { requireRole } from './access'
import { commercialSql } from './approval-reminders'
import { usZones } from './business-days'
import type { Handler } from './commands'
import { bool, fail, oneOf, optionalText, sql, text, type Role } from './model'

const people: Role[] = ['owner', 'counsel', 'approver', 'requester', 'viewer']
const member = (id: string) => sql(`EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND (SELECT CASE WHEN o.role='owner' THEN 'owner' ELSE COALESCE((SELECT r.role FROM lk_roles r WHERE r.operator_id=o.id),'viewer') END)<>'agent')`, id)
const commercial = (id: string) => sql(`EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND ${commercialSql})`, id)

const setPreferences: Handler = async (c, p) => {
  requireRole(c.actor, people, 'set reminder preferences')
  const operatorId = text(p, 'operatorId', 100)
  if (c.actor.role !== 'owner' && operatorId !== c.actor.id) fail('FORBIDDEN', 'Only the owner sets another person’s preferences.', 403)
  const zone = oneOf(p, 'timezone', usZones), digest = bool(p, 'digest')
  const delegate = optionalText(p, 'delegateId', 100), alternate = optionalText(p, 'alternateId', 100)
  for (const [id, field] of [[delegate, 'delegateId'], [alternate, 'alternateId']] as const)
    if (id === operatorId) fail('INVALID', 'Choose someone else.', 400, { field })
  const check = async (s: ReturnType<typeof sql>, field: string, message: string) => {
    if (!(await c.db.prepare(`SELECT CASE WHEN ${s.sql} THEN 1 ELSE 0 END AS ok`).bind(...s.params).first<{ ok: number }>())?.ok) fail('INVALID', message, 400, { field })
  }
  await check(member(operatorId), 'operatorId', 'Choose an active member.')
  if (delegate) {
    await check(commercial(operatorId), 'delegateId', 'Only owners and approvers name an approval delegate.')
    await check(commercial(delegate), 'delegateId', 'A delegate must be an active owner or approver.')
  }
  if (alternate) await check(member(alternate), 'alternateId', 'The alternate recipient must be an active member.')
  const names = await c.db.prepare('SELECT id, display_name FROM oa_operators WHERE id IN (?,?,?)').bind(operatorId, delegate ?? operatorId, alternate ?? operatorId).all<{ id: string; display_name: string }>()
  const name = (id: string | null) => (id ? names.results.find(n => n.id === id)?.display_name ?? id : 'none')
  return {
    allowed: people,
    result: { operatorId, timezone: zone, delegateId: delegate, digest, alternateId: alternate },
    writes: [sql('INSERT INTO lk_person_preferences(operator_id,timezone,delegate_id,updated_by,updated_at,digest,alternate_id) VALUES(?,?,?,?,?,?,?) ON CONFLICT(operator_id) DO UPDATE SET timezone=excluded.timezone, delegate_id=excluded.delegate_id, digest=excluded.digest, alternate_id=excluded.alternate_id, updated_by=excluded.updated_by, updated_at=excluded.updated_at', operatorId, zone, delegate, c.actor.id, c.now, digest ? 1 : 0, alternate)],
    checks: [member(operatorId), ...(delegate ? [commercial(operatorId), commercial(delegate)] : []), ...(alternate ? [member(alternate)] : [])],
    audit: [{ action: 'preferences.set', summary: `${name(operatorId)}: time zone ${zone}; delegate ${name(delegate)}; ${digest ? 'daily digest' : 'one email per reminder'}; alternate ${name(alternate)}.` }],
  }
}

export const preferenceHandlers: Record<string, Handler> = { 'preferences.set': setPreferences }
