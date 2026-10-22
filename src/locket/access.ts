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
  const scoped=(grants as Set<string>&{visible?:Set<string>}).visible
  if(scoped)return scoped.has(agreement.id)
  if (!agreement.restricted || fullReaders.includes(actor.role)) return true
  return agreement.requester_id === actor.id || agreement.owner_id === actor.id || grants.has(agreement.id)
}
/** One SQL predicate is shared by reads, commands, notification claims and exports.
 * Group access intersects ACCESS-001. Explicit restricted grants never bypass it. */
export function agreementAccessSql(id:string, alias='a'):Sql{
 const role=roleSql
 return sql(`((${role}) IN ('owner','counsel') OR (
   (${alias}.restricted=0 OR ${alias}.requester_id=? OR ${alias}.owner_id=? OR EXISTS(SELECT 1 FROM lk_access explicit WHERE explicit.agreement_id=${alias}.id AND explicit.operator_id=?))
   AND (NOT EXISTS(SELECT 1 FROM lk_agreement_groups ag WHERE ag.agreement_id=${alias}.id) OR EXISTS(SELECT 1 FROM lk_agreement_groups ag JOIN lk_intake_members gm ON gm.audience_id=ag.audience_id WHERE ag.agreement_id=${alias}.id AND gm.operator_id=?))
   AND (NOT EXISTS(SELECT 1 FROM lk_repository_policy p WHERE p.id='installation' AND p.enabled=1)
     OR EXISTS(SELECT 1 FROM lk_repository_policy p,json_each(p.grants) g
       JOIN lk_intake_members member ON member.audience_id=json_extract(g.value,'$.audienceId')
       WHERE p.id='installation' AND p.enabled=1 AND member.operator_id=?
         AND EXISTS(SELECT 1 FROM json_each(json_extract(g.value,'$.types')) type WHERE type.value=${alias}.type)
         AND (json_array_length(json_extract(g.value,'$.departmentIds'))=0 OR EXISTS(SELECT 1 FROM json_each(json_extract(g.value,'$.departmentIds')) department
           WHERE department.value=COALESCE((SELECT d.department_id FROM lk_agreement_departments d WHERE d.agreement_id=${alias}.id),(SELECT json_extract(f.answers,'$.department') FROM lk_request_forms f WHERE f.agreement_id=${alias}.id))))))))`,id,id,id,id,id,id)
}
/** Same configured policy for a new agreement before its insert exists. */
export function newAgreementPolicySql(id:string,type:string,department:string):Sql{
 return sql(`((${roleSql}) IN ('owner','counsel') OR NOT EXISTS(SELECT 1 FROM lk_repository_policy p WHERE p.id='installation' AND p.enabled=1)
 OR EXISTS(SELECT 1 FROM lk_repository_policy p,json_each(p.grants) g JOIN lk_intake_members m ON m.audience_id=json_extract(g.value,'$.audienceId')
 WHERE p.id='installation' AND p.enabled=1 AND m.operator_id=? AND EXISTS(SELECT 1 FROM json_each(json_extract(g.value,'$.types')) t WHERE t.value=?)
 AND (json_array_length(json_extract(g.value,'$.departmentIds'))=0 OR EXISTS(SELECT 1 FROM json_each(json_extract(g.value,'$.departmentIds')) d WHERE d.value=?))))`,id,id,type,department)
}
export function visibleSql(actor: Actor, agreementId: string): Sql {
 const access=agreementAccessSql(actor.id)
 return sql(`EXISTS(SELECT 1 FROM lk_agreements a WHERE a.id=? AND (${access.sql}))`,agreementId,...access.params)
}
export function visibleSetSql(actor: Actor, ids: string[]): Sql {
 const access=agreementAccessSql(actor.id)
 return sql(`NOT EXISTS(SELECT 1 FROM json_each(?) selected LEFT JOIN lk_agreements a ON a.id=selected.value WHERE a.id IS NULL OR NOT(${access.sql}))`,JSON.stringify(ids),...access.params)
}
export async function grantsFor(env: Bindings, actor: Actor): Promise<Set<string>> {
 const access=agreementAccessSql(actor.id)
 const rows=await env.DB.prepare(`SELECT a.id FROM lk_agreements a WHERE ${access.sql}`).bind(...access.params).all<{id:string}>()
 const grants=new Set<string>() as Set<string>&{visible:Set<string>}
 grants.visible=new Set(rows.results.map(r=>r.id))
 return grants
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
