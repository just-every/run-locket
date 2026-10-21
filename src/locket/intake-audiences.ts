// Intake launch audiences are owner-managed groups and departments, not grants
// to read agreements. All membership replacement writes use the command guard.
import { fullReaders, may, requireRole } from './access'
import type { Handler } from './commands'
import { fail, integer, list, oneOf, sql, text, type Actor } from './model'

export interface IntakeAudience {
  id: string
  name: string
  kind: 'group' | 'department'
  version: number
  memberIds: string[]
}
type AudienceRow = Omit<IntakeAudience, 'memberIds'>

/** Owners/counsel see definitions; everyone else sees only their memberships. */
export async function intakeAudiences(db: D1Database, actor: Actor): Promise<IntakeAudience[]> {
  const full = fullReaders.includes(actor.role)
  const rows = await db.prepare(`SELECT a.id,a.name,a.kind,a.version,m.operator_id
    FROM lk_intake_audiences a LEFT JOIN lk_intake_members m ON m.audience_id=a.id
    ${full ? '' : 'WHERE m.operator_id=?'}
    ORDER BY a.name COLLATE NOCASE,a.id,m.operator_id`)
    .bind(...(full ? [] : [actor.id]))
    .all<AudienceRow & { operator_id: string | null }>()
  const audiences = new Map<string, IntakeAudience>()
  for (const row of rows.results) {
    let audience = audiences.get(row.id)
    if (!audience) {
      audience = { id: row.id, name: row.name, kind: row.kind, version: row.version, memberIds: [] }
      audiences.set(row.id, audience)
    }
    if (row.operator_id) audience.memberIds.push(row.operator_id)
  }
  return [...audiences.values()]
}

const saveAudience: Handler = async (c, p) => {
  requireRole(c.actor, may.manageRoles, 'manage intake groups and departments')
  const name = text(p, 'name', 200)
  const kind = oneOf(p, 'kind', ['group', 'department'] as const)
  if (!Array.isArray(p.memberIds)) fail('INVALID', 'memberIds must be a list.', 400, { field: 'memberIds' })
  const memberIds = list(p, 'memberIds', 1000).map(id => text({ memberId: id }, 'memberId', 100))
  if (new Set(memberIds).size !== memberIds.length) fail('INVALID', 'Each member may appear only once.', 400, { field: 'memberIds' })
  const members = JSON.stringify(memberIds)
  const activeMembers = sql(`NOT EXISTS(SELECT 1 FROM json_each(?) member
    LEFT JOIN oa_operators o ON o.id=member.value WHERE o.id IS NULL OR o.status<>'active')`, members)
  const valid = await c.db.prepare(`SELECT CASE WHEN ${activeMembers.sql} THEN 1 ELSE 0 END AS ok`)
    .bind(...activeMembers.params).first<{ ok: number }>()
  if (!valid?.ok) fail('INVALID', 'Choose only active members.', 400, { field: 'memberIds' })

  const existingId = p.id === undefined ? null : text(p, 'id', 100)
  const id = existingId ?? crypto.randomUUID()
  const version = existingId ? integer(p, 'version', 1) : 0
  if (existingId) {
    const row = await c.db.prepare('SELECT version FROM lk_intake_audiences WHERE id=?').bind(id).first<{ version: number }>()
    if (!row) fail('NOT_FOUND', 'No such intake group or department.', 404)
    if (row.version !== version) fail('STALE', 'This intake group or department changed. Reload before editing.', 409)
  }
  return {
    allowed: may.manageRoles,
    result: { id, version: version + 1 },
    checks: [activeMembers, ...(existingId ? [sql('(SELECT version FROM lk_intake_audiences WHERE id=?)=?', id, version)] : [])],
    writes: [
      existingId
        ? sql('UPDATE lk_intake_audiences SET name=?,kind=?,version=version+1 WHERE id=?', name, kind, id)
        : sql('INSERT INTO lk_intake_audiences(id,name,kind,version) VALUES(?,?,?,1)', id, name, kind),
      ...(existingId ? [sql('DELETE FROM lk_intake_members WHERE audience_id=?', id)] : []),
      sql('INSERT INTO lk_intake_members(audience_id,operator_id) SELECT ?,value FROM json_each(?)', id, members),
    ],
    // Global audit is visible to other roles: never disclose names or the
    // membership roster there. The command runner attributes this to the actor.
    audit: [{ action: 'audience.save', summary: `${existingId ? 'Updated' : 'Created'} an intake ${kind} and recorded its membership.` }],
  }
}

export const intakeAudienceHandlers: Record<string, Handler> = { 'audience.save': saveAudience }
