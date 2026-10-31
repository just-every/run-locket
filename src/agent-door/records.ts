import type { Bindings } from '../auth.server'
import { state } from '../locket/views'
import type { Actor } from '../locket/model'
import { ToolRefusal, type ClassAndFacts } from '../modules/agent-door/index.ts'
import { nativeCall } from './native'

export const recordKinds = {
  agreements: 'agreements', versions: 'versions', files: 'artifacts', counterparties: 'parties',
  templates: 'templates', playbooks: 'playbooks', findings: 'deviations', obligations: 'obligations',
  renewals: 'renewals', notices: 'notices', reports: 'reports',
} as const
export type RecordKind = keyof typeof recordKinds
export type NativeRecord = Record<string, unknown>

/** Use the exact native workspace visibility and field projection, then select a
 * single record. Never return opaque provider, queue or credential state. */
export async function records(env: Bindings, actor: Actor, kind: RecordKind): Promise<NativeRecord[]> {
  const workspace = await nativeCall(() => state(env, actor))
  const rows = workspace[recordKinds[kind]] as NativeRecord[]
  // The native state door owns record visibility and hidden-field redaction.
  // Copy its complete projected row so resource and person reads cannot drift
  // as native fields evolve. These families contain no file bytes or credentials.
  return rows.map(row => ({ ...row }))
}
export async function record(env: Bindings, actor: Actor, kind: RecordKind, id: string) {
  const row = (await records(env, actor, kind)).find(row => row.id === id)
  if (!row) throw new ToolRefusal('resource_unavailable')
  return row
}

/** Classification reads the record's own fields, never a caller-provided risk. */
export function classification(value: unknown): ClassAndFacts[] {
  const sensitive = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.some(sensitive)
    if (!v || typeof v !== 'object') return typeof v === 'string' && /\b\d{2}-\d{7}\b|\b\d{3}-\d{2}-\d{4}\b/.test(v)
    return Object.entries(v).some(([key, item]) => /^(tax_id|taxId|bank_account|ssn)$/.test(key) && Boolean(item) || sensitive(item))
  }
  return [{ class: 'standard', facts: { measure: 1 } }, ...(sensitive(value) ? [{ class: 'sensitive' as const, facts: { measure: 1, kind: 'tax_identifier' } }] : [])]
}

/** A reader grant exposes this agreement's currently visible native content,
 * including its counterparty and document text, rather than just its title. */
export async function disclosureClasses(env: Bindings, actor: Actor, id: string) {
  const workspace = await nativeCall(() => state(env, actor))
  const agreement = workspace.agreements.find(row => row.id === id)
  if (!agreement) throw new ToolRefusal('resource_unavailable')
  return classification({ agreement, party: workspace.parties.find(row => row.id === agreement.party_id),
    versions: workspace.versions.filter(row => row.agreement_id === id),
    customValues: workspace.customValues.filter(row => row.agreement_id === id),
  })
}

/** Audit-safe native readback for callers checking whether a write took effect.
 * Revisions and relationship IDs cover every declared mutation without returning
 * private titles, document text, evidence, addresses or audit-read timestamps. */
export async function nativeWitness(env: Bindings, actor: Actor) {
  const workspace = await nativeCall(() => state(env, actor))
  const sort = <T>(rows: T[]) => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return {
    count: workspace.agreements.length,
    agreements: sort(workspace.agreements.map(row => ({ id: row.id, version: row.version }))),
    people: sort(workspace.operators.map(row => ({ id: row.id, role: row.role, status: row.status }))),
    grants: sort(workspace.access.map(row => ({ agreementId: row.agreement_id, operatorId: row.operator_id }))),
    proposals: sort(workspace.proposals.map(row => ({ id: row.id, status: row.status }))),
  }
}
