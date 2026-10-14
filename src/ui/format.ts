import type { LocketState, Row } from './api'
export { actionLabel, day, dayOf, deadline, plural, providerName, providers, roleLabel, termLabel, termValue, when } from '../locket/display'

export const statusLabel: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  out_for_signature: 'Out for signature',
  executed: 'Executed',
  imported: 'Imported',
  cancelled: 'Cancelled',
}
export const typeLabel: Record<string, string> = { customer: 'Customer', supplier: 'Supplier', nda: 'NDA', amendment: 'Amendment', order_form: 'Order form', other: 'Other' }
export const words = (value: string) => value.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return '$' + (cents / 100).toLocaleString('en-AU', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })
}

export const personName = (state: LocketState, id: string | null | undefined) => (id ? state.operators.find(o => o.id === id)?.name ?? 'Former member' : '—')
export const partyName = (state: LocketState, id: string) => state.parties.find(p => p.id === id)?.name ?? '—'
export const versionsOf = (state: LocketState, agreementId: string) => state.versions.filter(v => v.agreement_id === agreementId).sort((a, b) => a.number - b.number)
export const currentVersion = (state: LocketState, a: Row) => state.versions.find(v => v.id === a.current_version_id) ?? null
export const renewalOf = (state: LocketState, agreementId: string) => state.renewals.find(r => r.agreement_id === agreementId) ?? null
export const parse = <T = any>(value: unknown): T => (typeof value === 'string' ? JSON.parse(value) : (value as T))
export const can = (state: LocketState, ...roles: string[]) => roles.includes(state.actor.role)
