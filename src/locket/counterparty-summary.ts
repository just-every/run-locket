// REPO-010: what a counterparty's page totals, from the agreements the reader may
// see. Contracted value is the USD value (US-001) of executed and imported
// agreements. Annual value is each one's value over the term it covers (confirmed
// effective date to confirmed end date, both inclusive) scaled to 365 days and
// rounded half up to the cent; one without a value or without both dates is
// listed as not counted. Agreements group by family (REPO-008), and the next
// notice deadline is the earliest current one (RENEW-007, US-001 rolling).
import { lifecycle } from './lifecycle'

type Row = { id: string; [key: string]: any }
export interface CounterpartySummary {
  totalCents: number; annualCents: number; unvalued: string[]; undated: string[]
  families: { rootId: string; ids: string[] }[]
  nextDeadline: { agreementId: string; date: string; at: number; timezone: string } | null
}

const dayMs = 86_400_000
const contracted = (a: Row) => ['executed', 'imported'].includes(a.status)

export function counterpartySummaries(w: { agreements: Row[]; terms: Row[]; renewals: Row[]; notices: Row[]; parties: Row[] }, now: number, roll: boolean): Record<string, CounterpartySummary> {
  const byId = new Map(w.agreements.map(a => [a.id, a]))
  const rootOf = (a: Row) => { const seen = new Set<string>(); let r = a; while (r.parent_id && byId.has(r.parent_id) && !seen.has(r.id)) { seen.add(r.id); r = byId.get(r.parent_id)! } return r.id }
  const confirmed = (id: string, key: string) => w.terms.find(t => t.agreement_id === id && t.key === key && t.status === 'confirmed')?.value as string | undefined
  const out: Record<string, CounterpartySummary> = {}
  for (const party of w.parties) {
    const mine = w.agreements.filter(a => a.party_id === party.id)
    const s: CounterpartySummary = { totalCents: 0, annualCents: 0, unvalued: [], undated: [], families: [], nextDeadline: null }
    for (const a of mine.filter(contracted)) {
      if (a.value_cents === null) { s.unvalued.push(a.id); continue }
      s.totalCents += a.value_cents
      const start = confirmed(a.id, 'effective_date'), end = confirmed(a.id, 'end_date')
      const days = start && end ? (Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / dayMs + 1 : 0
      if (days < 1) { s.undated.push(a.id); continue }
      s.annualCents += Math.floor((a.value_cents * 365 * 2 + days) / (days * 2))
    }
    for (const a of mine) {
      const root = rootOf(a), family = s.families.find(f => f.rootId === root)
      if (family) family.ids.push(a.id)
      else s.families.push({ rootId: root, ids: [a.id] })
      const d = lifecycle(a, w.terms, w.renewals, w.notices, now, roll).deadline
      if (d && d.at >= now && (!s.nextDeadline || d.at < s.nextDeadline.at)) s.nextDeadline = { agreementId: a.id, date: d.date, at: d.at, timezone: a.timezone }
    }
    out[party.id] = s
  }
  return out
}
