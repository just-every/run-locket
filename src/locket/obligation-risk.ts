// OBL-002: risk ratings. Each obligation is rated low, medium or high. One that
// is confirmed and past the end of its due date in the agreement's zone is
// overdue, which raises its rating one level (high stays high). An agreement's
// risk is the highest raised rating among its open obligations, and a
// counterparty's the highest among the agreements the reader may see.
import { zonedInstant } from './dates'

export const riskLevels = ['low', 'medium', 'high'] as const
export type Risk = (typeof riskLevels)[number]
type Row = { id: string; [key: string]: any }

const raise = (r: Risk): Risk => riskLevels[Math.min(riskLevels.indexOf(r) + 1, 2)]
const highest = (rs: Risk[]): Risk | null => (rs.length ? rs.reduce((a, b) => (riskLevels.indexOf(b) > riskLevels.indexOf(a) ? b : a)) : null)

export interface RiskView {
  obligations: Record<string, { rated: Risk; risk: Risk; overdue: boolean }>
  agreements: Record<string, { risk: Risk; overdue: number } | null>
  parties: Record<string, { risk: Risk; overdue: number } | null>
}

export function risks(w: { agreements: Row[]; obligations: Row[] }, now: number): RiskView {
  const zone = new Map(w.agreements.map(a => [a.id, a.timezone as string]))
  const obligations: RiskView['obligations'] = {}
  for (const o of w.obligations) {
    if (o.status !== 'confirmed' || !zone.has(o.agreement_id)) continue
    const overdue = Boolean(o.due_date) && now > zonedInstant(o.due_date, '23:59:59', zone.get(o.agreement_id)!)
    obligations[o.id] = { rated: o.risk, risk: overdue ? raise(o.risk) : o.risk, overdue }
  }
  const roll = (ids: string[]) => {
    const open = ids.map(id => obligations[id]).filter(Boolean)
    const risk = highest(open.map(o => o.risk))
    return risk ? { risk, overdue: open.filter(o => o.overdue).length } : null
  }
  const agreements: RiskView['agreements'] = Object.fromEntries(w.agreements.map(a => [a.id, roll(w.obligations.filter(o => o.agreement_id === a.id).map(o => o.id))]))
  const parties: RiskView['parties'] = {}
  for (const party of new Set(w.agreements.map(a => a.party_id as string))) {
    const rolled = w.agreements.filter(a => a.party_id === party).map(a => agreements[a.id]).filter(Boolean) as { risk: Risk; overdue: number }[]
    const risk = highest(rolled.map(r => r.risk))
    parties[party] = risk ? { risk, overdue: rolled.reduce((n, r) => n + r.overdue, 0) } : null
  }
  return { obligations, agreements, parties }
}
