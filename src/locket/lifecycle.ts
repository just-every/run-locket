import { noticeDeadlineFor } from './business-days'
import { addDays, zonedInstant } from './dates'
import { daysUntil } from './display'
type Row = { id: string; [key: string]: any }
export interface DerivedTerm {
  term: number; start: string | null; end: string; deadline: { date: string; at: number } | null
  decision: string | null; decidedBy: string | null; decidedAt: number | null; committed: boolean; imported: boolean
}
export interface Lifecycle {
  status: string; start: string | null; end: string | null; term: number
  deadline: { date: string; at: number; days: number } | null
  missing: string[]; terminationUnsent: boolean; renewalType: string; remaining: number | null
  review: { date: string; at: number; dueAt: number } | null; chain: DerivedTerm[]
}
export function localDate(at: number, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number), first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, last))
  return first.toISOString().slice(0, 10)
}
export function endInstant(end: string, zone: string) { return zonedInstant(end, '23:59:59', zone) }
/** One deterministic calculation for both operational writes and every read consumer. */
export function lifecycle(a: Row, terms: Row[], renewals: Row[], notices: Row[], now: number, roll = false): Lifecycle {
  const confirmed = new Map(terms.filter(t => t.agreement_id === a.id && t.status === 'confirmed').map(t => [t.key, String(t.value)]))
  const get = (key: string) => confirmed.get(key)
  const type = get('renewal_type') ?? (get('auto_renew') === 'yes' ? 'auto_renew' : 'fixed')
  const needed = ['effective_date', 'notice_days', 'governing_law', 'payment_terms']
  if (!get('renewal_type')) needed.push('auto_renew')
  if (type !== 'evergreen' && !get('end_date') && !get('initial_term_months')) needed.push('end_date')
  if (['auto_renew', 'optional'].includes(type)) needed.push('renewal_term_months')
  const missing = needed.filter(key => !confirmed.has(key))
  let start = get('effective_date') ?? null
  let end = get('end_date') ?? (start && get('initial_term_months') ? addDays(addMonths(start, Number(get('initial_term_months'))), -1) : null)
  const limit = get('renewals_allowed') ? Number(get('renewals_allowed')) : null
  const r = renewals.find(row => row.agreement_id === a.id), zone = a.timezone, today = localDate(now, zone)
  const result: Lifecycle = { status: 'terms_unconfirmed', start, end, term: 1, deadline: null, missing, terminationUnsent: false, renewalType: type, remaining: limit, review: null, chain: [] }
  if (!['executed', 'imported'].includes(a.status)) return { ...result, status: 'not_executed' }
  const terminationDate = r?.termination_date as string | undefined
  if (type === 'evergreen') {
    if (!start) return result
    let years = Math.max(1, Number(today.slice(0, 4)) - Number(start.slice(0, 4)))
    let anniversary = addMonths(start, years * 12)
    if (endInstant(anniversary, zone) < now) anniversary = addMonths(start, ++years * 12)
    const review = { date: anniversary, at: endInstant(anniversary, zone), dueAt: zonedInstant(addDays(anniversary, -(r?.evergreen_lead_days ?? 30)), '09:00:00', zone) }
    return { ...result, end: terminationDate ? addDays(terminationDate,-1) : null, status: terminationDate && today >= terminationDate ? 'terminated' : today < start ? 'not_yet_in_effect' : 'active', review: terminationDate ? null : review }
  }
  const months = Number(get('renewal_term_months')), days = get('notice_days')
  if (!end || (['auto_renew', 'optional'].includes(type) && (!Number.isInteger(months) || months < 1 || days === undefined))) return result
  const anchor = addDays(end, 1), chain: DerivedTerm[] = []
  let term = 1, deadline = days === undefined ? null : noticeDeadlineFor(end, Number(days), zone, roll)
  let decisions: Record<string, any> = r?.decisions ? JSON.parse(r.decisions) : {}
  const sourceTerm = r?.term_number ?? 1
  if (r?.decision) decisions = { ...decisions, [sourceTerm]: { ...decisions[String(sourceTerm)], decision: r.decision, decidedBy: r.decided_by, decidedAt: r.decided_at } }
  const relevant = (number: number) => decisions[String(number)] ?? {}
  const sent = (number: number, at: number) => notices.some(n => n.renewal_id === r?.id && n.status === 'sent' && n.term_number === number && n.generation_id === r?.generation_id && n.sent_at <= at)
  while (true) {
    const decision = relevant(term)
    const stopped = decision.decision === 'terminate'
    const beforeImport = Boolean(deadline && deadline.at < a.created_at)
    const eligible = type === 'auto_renew' || type === 'optional' && (decision.confirmedRenewed === true || decision.decision === 'renew' && decision.decidedAt <= (deadline?.at ?? 0) && sent(term, deadline?.at ?? 0))
    const committed = Boolean(deadline && deadline.at < now && !stopped && eligible && (limit === null || term <= limit) && (!terminationDate || terminationDate > addDays(end, 1)))
    chain.push({ term, start, end, deadline, decision: decision.decision ?? null, decidedBy: decision.decidedBy ?? null, decidedAt: decision.decidedAt ?? null, committed, imported: beforeImport })
    if (!committed) break
    start = addMonths(anchor, (term - 1) * months)
    end = addDays(addMonths(anchor, term * months), -1)
    term++
    deadline = noticeDeadlineFor(end, Number(days), zone, roll)
  }
  const decision = relevant(term), terminating = decision.decision === 'terminate'
  const terminationSent = terminating && !!deadline && sent(term, deadline.at)
  const terminationUnsent = Boolean(terminating && deadline && now > deadline.at && !terminationSent && !terminationDate)
  let status = type === 'auto_renew' && !terminating && (limit === null || term <= limit) ? 'auto_renewing' : 'active'
  if (start && today < start && term === 1) status = 'not_yet_in_effect'
  if (today > end) status = terminating && terminationSent ? 'terminated' : terminationUnsent ? 'termination_pending' : 'expired'
  if (terminationDate && today >= terminationDate) status = 'terminated'
  return { ...result, start, end: terminationDate ? addDays(terminationDate, -1) : end, term, status, chain, remaining: limit === null ? null : Math.max(0, limit - term + 1), terminationUnsent,
    deadline: deadline && !['expired', 'terminated'].includes(status) && !terminationDate ? { ...deadline, days: daysUntil(deadline.at, now, zone) } : null }
}
