// Locket roles for invited operators. Invitations and sign-in stay with Base's
// native operator auth; the native owner is always Locket's owner.
import { may, requireRole, roleSql } from './access'
import type { Handler } from './commands'
import { canonical, fail, oneOf, sha256, sql, text } from './model'
import { roleLabel } from './display'

interface RoleSnapshot {
  display_name: string; native_role: string; version: number; status: string; role: string; changed_at: number
}
export const roleRevision = (row: RoleSnapshot) => sha256(canonical({
  display_name: row.display_name, native_role: row.native_role, version: row.version,
  status: row.status, role: row.role, changed_at: row.changed_at,
}))

/** Bind a role decision to the current native person and role assignment. */
export async function roleSnapshot(db: D1Database, operatorId: string) {
  const row = await db.prepare("SELECT o.display_name, o.role AS native_role, o.version, o.status, COALESCE(r.role,'viewer') AS role, COALESCE(r.updated_at,0) AS changed_at FROM oa_operators o LEFT JOIN lk_roles r ON r.operator_id=o.id WHERE o.id=?")
    .bind(operatorId).first<RoleSnapshot>()
  if (!row) fail('NOT_FOUND', 'No invited operator has that identity.', 404)
  return { ...row, revision: await roleRevision(row) }
}

const setRole: Handler = async (c, p) => {
  requireRole(c.actor, may.manageRoles, 'assign roles')
  const operatorId = text(p, 'operatorId', 64)
  if(await c.db.prepare('SELECT id FROM lk_workforce_users WHERE id=?').bind(operatorId).first())fail('WORKFORCE_MANAGED','Manage this role through the approved workforce groups.',409)
  const role = oneOf(p, 'role', ['counsel', 'approver', 'requester', 'viewer', 'agent'] as const)
  const operator = await roleSnapshot(c.db, operatorId)
  if (operator.native_role === 'owner') fail('OWNER', 'The installation owner always holds the owner role.', 409)
  if (p.expectedRevision !== undefined && p.expectedRevision !== operator.revision) fail('STALE', 'This role changed since you loaded it. Reload and review before trying again.', 409)
  return {
    allowed: may.manageRoles,
    result: { operatorId, role },
    checks: [
      sql('EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=?)', operatorId, operator.version),
      sql('COALESCE((SELECT updated_at FROM lk_roles WHERE operator_id=?),0)=?', operatorId, operator.changed_at),
      sql(roleSql + '=?', operatorId, operator.role),
    ],
    writes: [sql('INSERT INTO lk_roles VALUES(?,?,?,?) ON CONFLICT(operator_id) DO UPDATE SET role=excluded.role, updated_by=excluded.updated_by, updated_at=excluded.updated_at', operatorId, role, c.actor.id, Math.max(c.now, operator.changed_at + 1))],
    audit: [{ action: 'role.set', summary: `${operator.display_name} is now ${roleLabel[role]}` }],
  }
}

export const peopleHandlers: Record<string, Handler> = { 'role.set': setRole }
