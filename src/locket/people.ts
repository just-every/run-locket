// Locket roles for invited operators. Invitations and sign-in stay with Base's
// native operator auth; the native owner is always Locket's owner.
import { may, requireRole } from './access'
import type { Handler } from './commands'
import { fail, oneOf, sql, text } from './model'
import { roleLabel } from './display'

const setRole: Handler = async (c, p) => {
  requireRole(c.actor, may.manageRoles, 'assign roles')
  const operatorId = text(p, 'operatorId', 64)
  const role = oneOf(p, 'role', ['counsel', 'approver', 'requester', 'viewer', 'agent'] as const)
  const operator = await c.db.prepare('SELECT display_name, role FROM oa_operators WHERE id=?').bind(operatorId).first<{ display_name: string; role: string }>()
  if (!operator) fail('NOT_FOUND', 'No invited operator has that identity.', 404)
  if (operator.role === 'owner') fail('OWNER', 'The installation owner always holds the owner role.', 409)
  return {
    allowed: may.manageRoles,
    result: { operatorId, role },
    writes: [sql('INSERT INTO lk_roles VALUES(?,?,?,?) ON CONFLICT(operator_id) DO UPDATE SET role=excluded.role, updated_by=excluded.updated_by, updated_at=excluded.updated_at', operatorId, role, c.actor.id, c.now)],
    audit: [{ action: 'role.set', summary: `${operator.display_name} is now ${roleLabel[role]}` }],
  }
}

export const peopleHandlers: Record<string, Handler> = { 'role.set': setRole }
