// Who may do what. Every handler calls `require` before reading or writing, and
// every write repeats the same session/role check in SQL inside its atomic batch.
import { operatorAuth, type Bindings } from '../auth.server'
import { fail, sql, type Actor, type Role, type Sql } from './model'

export async function currentActor(request: Request, env: Bindings): Promise<Actor> {
  const session = await operatorAuth(env).getSession(request)
  if (!session) fail('AUTH', 'Sign in with a current session.', 401)
  const row = await env.DB.prepare('SELECT role FROM lk_roles WHERE operator_id=?').bind(session.operator.id).first<{ role: Role }>()
  const native = session.operator.role === 'owner'
  return {
    id: session.operator.id,
    name: session.operator.displayName,
    email: session.operator.email,
    role: native ? 'owner' : (row?.role ?? 'viewer'),
    sessionId: session.id,
    operatorVersion: session.operator.version,
  }
}

/** The role SQL computes for an operator id: the native owner is always owner. */
export const roleSql = `(SELECT CASE WHEN o.role='owner' THEN 'owner' ELSE COALESCE((SELECT r.role FROM lk_roles r WHERE r.operator_id=o.id),'viewer') END FROM oa_operators o WHERE o.id=?)`

/** Scalar SQL: the actor's session is still current and their current role is allowed. */
export function authority(actor: Actor, allowed: readonly Role[]): Sql {
  return sql(
    `EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND o.id=? AND o.status='active' AND s.operator_version=o.version AND s.revoked_at IS NULL AND s.expires_at>?) AND ${roleSql} IN (${allowed.map(() => '?').join(',')})`,
    actor.sessionId,
    actor.id,
    Date.now(),
    actor.id,
    ...allowed,
  )
}

export function requireRole(actor: Actor, allowed: readonly Role[], action: string): void {
  if (!allowed.includes(actor.role)) fail('FORBIDDEN', `Your role (${actor.role}) cannot ${action}.`, 403)
}

/** Roles that see every agreement, including restricted ones. */
export const fullReaders: Role[] = ['owner', 'counsel']

export interface Visible {
  restricted: number
  requester_id: string
  owner_id: string
  id: string
}
export function canSee(actor: Actor, agreement: Visible, grants: Set<string>): boolean {
  if (!agreement.restricted || fullReaders.includes(actor.role)) return true
  return agreement.requester_id === actor.id || agreement.owner_id === actor.id || grants.has(agreement.id)
}
/** SQL twin of canSee for one agreement, evaluated inside the write batch. */
export function visibleSql(actor: Actor, agreementId: string): Sql {
  return sql(
    `EXISTS(SELECT 1 FROM lk_agreements a WHERE a.id=? AND (a.restricted=0 OR ${roleSql} IN ('owner','counsel') OR a.requester_id=? OR a.owner_id=? OR EXISTS(SELECT 1 FROM lk_access g WHERE g.agreement_id=a.id AND g.operator_id=?)))`,
    agreementId,
    actor.id,
    actor.id,
    actor.id,
    actor.id,
  )
}
/** The same current-role visibility check for a set, with a fixed parameter count. */
export function visibleSetSql(actor: Actor, ids: string[]): Sql {
  return sql(`NOT EXISTS(SELECT 1 FROM json_each(?) selected LEFT JOIN lk_agreements a ON a.id=selected.value
    WHERE a.id IS NULL OR NOT(a.restricted=0 OR ${roleSql} IN ('owner','counsel') OR a.requester_id=? OR a.owner_id=?
      OR EXISTS(SELECT 1 FROM lk_access g WHERE g.agreement_id=a.id AND g.operator_id=?)))`, JSON.stringify(ids), actor.id, actor.id, actor.id, actor.id)
}
export async function grantsFor(env: Bindings, actor: Actor): Promise<Set<string>> {
  const rows = await env.DB.prepare('SELECT agreement_id FROM lk_access WHERE operator_id=?').bind(actor.id).all<{ agreement_id: string }>()
  return new Set(rows.results.map(r => r.agreement_id))
}

// Write permissions by command family. Agents never appear outside proposal.prepare.
export const may = {
  manageRoles: ['owner'] as Role[],
  grantAccess: ['owner', 'counsel'] as Role[],
  intake: ['owner', 'counsel', 'approver', 'requester'] as Role[],
  library: ['owner', 'counsel'] as Role[],
  review: ['owner', 'counsel', 'approver', 'requester'] as Role[],
  commercialApproval: ['owner', 'approver'] as Role[],
  signature: ['owner', 'approver', 'requester'] as Role[],
  resolveExecution: ['owner', 'counsel'] as Role[],
  confirmTerms: ['owner', 'counsel', 'approver'] as Role[],
  renewalDecision: ['owner', 'approver'] as Role[],
  prepare: ['owner', 'counsel', 'approver', 'requester', 'agent'] as Role[],
  imports: ['owner'] as Role[],
  export: ['owner'] as Role[],
  read: ['owner', 'counsel', 'approver', 'requester', 'viewer', 'agent'] as Role[],
}
