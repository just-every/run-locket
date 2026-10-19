import type { LocketState, Row } from './api'
export { actionLabel, clock, day, dayOf, deadline, plural, providerName, providers, roleLabel, stamp, termLabel, termValue, when } from '../locket/display'

export const statusLabel: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  out_for_signature: 'Out for signature',
  executed: 'Executed',
  imported: 'Imported',
  cancelled: 'Canceled',
}
export const typeLabel: Record<string, string> = { customer: 'Customer', supplier: 'Supplier', nda: 'NDA', amendment: 'Amendment', order_form: 'Order form', other: 'Other' }
export const words = (value: string) => value.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })
}

export const personName = (state: LocketState, id: string | null | undefined) => (id ? state.operators.find(o => o.id === id)?.name ?? 'Former member' : '—')
export const partyName = (state: LocketState, id: string) => state.parties.find(p => p.id === id)?.name ?? '—'
export const versionsOf = (state: LocketState, agreementId: string) => state.versions.filter(v => v.agreement_id === agreementId).sort((a, b) => a.number - b.number)
export const currentVersion = (state: LocketState, a: Row) => state.versions.find(v => v.id === a.current_version_id) ?? null
export const renewalOf = (state: LocketState, agreementId: string) => state.renewals.find(r => r.agreement_id === agreementId) ?? null
export const parse = <T = any>(value: unknown): T => (typeof value === 'string' ? JSON.parse(value) : (value as T))
export const can = (state: LocketState, ...roles: string[]) => roles.includes(state.actor.role)

/** A label cut to about `max` characters at a word, for chips and seals; the element's title carries it whole. */
export function brief(label: string, max = 24) {
  if (label.length <= max) return label
  const cut = label.slice(0, max), space = cut.lastIndexOf(' ')
  return (space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:(·-]+$/, '') + '…'
}
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'
/** Whether a person is an agent: their findings and proposals carry Locket's mark. */
export const isAgent = (state: LocketState, id: string | null | undefined) => state.operators.find(o => o.id === id)?.role === 'agent'
