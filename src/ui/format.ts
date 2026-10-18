import type { LocketState, Row } from './api'
export { actionLabel, day, dayOf, deadline, plural, providerName, providers, roleLabel, termLabel, termValue, when } from '../locket/display'

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

/** A zone's short name as people say it: EDT and EST read ET, CDT and CST read CT. */
const zoneName = (name: string) => name.replace(/^([ECMP])[SD]T$/, '$1T')
function parts(ms: number, options: Intl.DateTimeFormatOptions) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', options).formatToParts(new Date(ms)).map(p => [p.type, p.value]))
}
/** A moment the way the workspace writes it: Thu Oct 15, 5:40 pm ET (with the year when asked). */
export function stamp(ms: number | null | undefined, { year = false, zone }: { year?: boolean; zone?: string } = {}) {
  if (!ms) return '—'
  const p = parts(ms, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone, timeZoneName: 'short' })
  return `${p.weekday} ${p.month} ${p.day}${year ? `, ${p.year}` : ''}, ${p.hour}:${p.minute} ${p.dayPeriod.toLowerCase()} ${zoneName(p.timeZoneName)}`
}
/** A moment's day: Mon Oct 12. */
export function weekday(ms: number | null | undefined, zone?: string) {
  if (!ms) return '—'
  const p = parts(ms, { weekday: 'short', month: 'short', day: 'numeric', timeZone: zone })
  return `${p.weekday} ${p.month} ${p.day}`
}
/** A calendar date (YYYY-MM-DD) with its weekday: Fri Oct 23, 2026. */
export function longDay(iso: string | null | undefined) {
  if (!iso) return '—'
  const p = parts(Date.parse(iso + 'T12:00:00Z'), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return `${p.weekday} ${p.month} ${p.day}, ${p.year}`
}
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'
/** Whether a person is an agent: their findings and proposals carry Locket's mark. */
export const isAgent = (state: LocketState, id: string | null | undefined) => state.operators.find(o => o.id === id)?.role === 'agent'
