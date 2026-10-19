// Read-only projection. Durable history and new renewal types are RENEW-007.
import { noticeDeadlineFor } from './business-days'
import { addDays, zonedInstant } from './dates'
import { daysUntil } from './display'
type Row = { id: string; [key: string]: any }
export interface Lifecycle {
  status: string; start: string | null; end: string | null; term: number
  deadline: { date: string; at: number; days: number } | null
  missing: string[]; terminationUnsent: boolean
}
export function localDate(at: number, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, last))
  return first.toISOString().slice(0, 10)
}
/** `roll` is the installation's US-001 business-day option for notice deadlines. */
export function lifecycle(a: Row, terms: Row[], renewals: Row[], notices: Row[], now: number, roll = false): Lifecycle {
  const confirmed = new Map(terms.filter(t => t.agreement_id === a.id && t.status === 'confirmed').map(t => [t.key, t.value as string]))
  const needed = ['effective_date', 'end_date', 'auto_renew', 'notice_days', 'governing_law', 'payment_terms']
  if (confirmed.get('auto_renew') === 'yes') needed.push('renewal_term_months')
  const missing = needed.filter(key => !confirmed.has(key))
  let start = confirmed.get('effective_date') ?? null, end = confirmed.get('end_date') ?? null, term = 1
  const result: Lifecycle = { status: 'terms_unconfirmed', start, end, term, deadline: null, missing, terminationUnsent: false }
  if (!['executed', 'imported'].includes(a.status)) return { ...result, status: 'not_executed' }
  const auto = confirmed.get('auto_renew'), days = confirmed.get('notice_days'), months = Number(confirmed.get('renewal_term_months'))
  if (!end || !auto || (auto === 'yes' && (!Number.isInteger(months) || months < 1 || days === undefined))) return result
  const zone = a.timezone, today = localDate(now, zone)
  const renewal = renewals.find(r => r.agreement_id === a.id)
  let deadline = days === undefined ? null : noticeDeadlineFor(end, Number(days), zone, roll)
  const renewalStart = addDays(end, 1)
  while (auto === 'yes' && deadline && deadline.at < now) {
    if (renewal?.decision === 'terminate' && renewal.decided_at <= deadline.at) break
    start = addMonths(renewalStart, (term - 1) * months)
    end = addDays(addMonths(renewalStart, term * months), -1)
    term++
    deadline = noticeDeadlineFor(end, Number(days), zone, roll)
  }
  const termination = renewal?.decision === 'terminate' && (!deadline || renewal.decided_at <= deadline.at)
  const sent = termination && notices.some(n => n.renewal_id === renewal.id && n.status === 'sent' && n.sent_at <= (deadline?.at ?? Infinity))
  const terminationUnsent = Boolean(termination && deadline && deadline.at < now && !sent)
  let status = auto === 'yes' && !termination ? 'auto_renewing' : 'active'
  if (start && today < start && term === 1) status = 'not_yet_in_effect'
  if (today > end) status = termination && sent ? 'terminated' : terminationUnsent ? 'termination_pending' : 'expired'
  return { status, start, end, term, missing, terminationUnsent, deadline: deadline && !['expired', 'terminated'].includes(status) ? { ...deadline, days: daysUntil(deadline.at, now, zone) } : null }
}
export function endInstant(end: string, zone: string) { return zonedInstant(end, '23:59:59', zone) }
