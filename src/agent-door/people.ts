import { operatorAuthPeople, type PeopleAdapter, type Person, ToolRefusal } from '../modules/agent-door/index.ts'
import { authConfig, operatorAuth, type Bindings } from '../auth.server'
import { roleSql } from '../locket/access'
import type { Actor, Role } from '../locket/model'
import { workforceSettings } from '../locket/workforce'

/** Business binds stable native IDs. Email never selects an account at admission. */
export function locketPeople(env: Bindings): PeopleAdapter {
  const native = operatorAuthPeople({ db: env.DB, allowList: authConfig(env).allowList, session: request => operatorAuth(env).getSession(request) })
  const policyRoles = new Map<string, 'owner' | 'editor' | null>()
  const businessMember: NonNullable<PeopleAdapter['businessMember']> = async person => {
    const member = await native.businessMember?.(person)
    if (!member) return null
    if (member.role === 'owner') return member
    // A removed Business roster entry remains historical attribution, even if
    // a local owner subsequently reactivates that operator for another purpose.
    const current = await env.DB.prepare("SELECT 1 FROM bs_team WHERE business_id=? AND operator_id=? AND state IN ('active','invited')")
      .bind(member.id, person.id).first()
    return current ? member : null
  }
  const person = async (id: string): Promise<Person | null> => {
    const current = await native.person(id)
    if (!current?.active) return null
    if (env.RER_OWNER_CLAIM_PUBLIC_KEYS && await env.DB.prepare("SELECT 1 FROM bs_team WHERE operator_id=? AND state IN ('inactive','conflict')").bind(id).first()) return null
    if (current.role !== 'owner' && await env.DB.prepare('SELECT id FROM lk_workforce_users WHERE id=?').bind(id).first() && !await workforceSettings(env)) return null
    policyRoles.set(id, (await businessMember(current))?.role ?? null)
    const role = await env.DB.prepare(`SELECT ${roleSql} AS role`).bind(id).first<{ role: Role }>()
    return { ...current, role: role?.role ?? 'viewer' }
  }
  return {
    person,
    async sponsor(claims) {
      const bound = await native.sponsor(claims)
      if (!bound || (await businessMember(bound))?.id !== claims.sub) return null
      return person(bound.id)
    },
    async session(request) { const signedIn = await native.session(request); return signedIn ? person(signedIn.id) : null },
    businessMember,
    businessRole: person => env.RER_OWNER_CLAIM_PUBLIC_KEYS ? policyRoles.get(person.id) ?? null : person.role === 'owner' ? 'owner' : null,
  }
}

export async function nativeActor(env: Bindings, id: string): Promise<Actor> {
  const person = await locketPeople(env).person(id)
  if (!person) throw new ToolRefusal('unauthenticated')
  const row = await env.DB.prepare('SELECT version FROM oa_operators WHERE id=?').bind(id).first<{ version: number }>()
  if (!row) throw new ToolRefusal('unauthenticated')
  return { id, name: person.name, email: person.email, role: person.role as Role, sessionId: '', operatorVersion: row.version }
}
