// How Locket words its records for people: dates, deadlines, term names with
// units, signing services, roles and audit actions. The screens and the audit
// summaries the server writes read the same formatters, so a moment reads the
// same everywhere: weekday, date, time and zone (ET, never America/New_York).

/** A zone's short name as people say it: EDT and EST read ET, CDT and CST read CT. */
const zoneName = (name: string) => name.replace(/^([ECMP])[SD]T$/, '$1T')
function parts(ms: number, options: Intl.DateTimeFormatOptions) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', options).formatToParts(new Date(ms)).map(p => [p.type, p.value]))
}

/** A calendar date (YYYY-MM-DD) with its weekday: Tue Jan 12, 2027. */
export function day(iso: string | null | undefined) {
  if (!iso) return '—'
  const p = parts(Date.parse(iso + 'T12:00:00Z'), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return `${p.weekday} ${p.month} ${p.day}, ${p.year}`
}
/** A calendar date as quoted contract text writes it: January 12, 2027. */
export const writtenDay = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
/** The calendar date of a moment, in the reader's zone or a named one: Sun Oct 18, 2026. */
export function dayOf(ms: number | null | undefined, zone?: string) {
  if (!ms) return '—'
  const p = parts(ms, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: zone })
  return `${p.weekday} ${p.month} ${p.day}, ${p.year}`
}
/** A moment the one way Locket writes it, with its zone: Thu Oct 8, 5:40 pm ET (with the year when asked). Without a
 * zone it is the reader's own. */
export function stamp(ms: number | null | undefined, { year = false, zone }: { year?: boolean; zone?: string } = {}) {
  if (!ms) return '—'
  const p = parts(ms, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone, timeZoneName: 'short' })
  return `${p.weekday} ${p.month} ${p.day}${year ? `, ${p.year}` : ''}, ${p.hour}:${p.minute} ${p.dayPeriod.toLowerCase()} ${zoneName(p.timeZoneName)}`
}
/** A moment's time of day with its zone: 10:41 am ET. */
export function clock(ms: number, zone?: string) {
  const p = parts(ms, { hour: 'numeric', minute: '2-digit', timeZone: zone, timeZoneName: 'short' })
  return `${p.hour}:${p.minute} ${p.dayPeriod.toLowerCase()} ${zoneName(p.timeZoneName)}`
}
/** A moment in the reader's zone, with the year: Fri Oct 9, 2026, 10:41 am ET. */
export const when = (ms: number | null | undefined) => stamp(ms, { year: true })
/** A moment in a named zone, with the year: Fri Nov 13, 2026, 11:59 pm ET. */
export const deadline = (ms: number, zone: string) => stamp(ms, { year: true, zone })

/** Calendar days from one moment's date to another's in a zone: Sun Oct 18 to Mon Nov 2 (ET) is 15, whatever the hour. */
export function daysUntil(ms: number, from: number, zone: string) {
  const date = (at: number) => { const p = parts(at, { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: zone }); return Date.UTC(+p.year, +p.month - 1, +p.day) }
  return Math.round((date(ms) - date(from)) / 86_400_000)
}
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const roleLabel: Record<string, string> = { owner: 'Owner', counsel: 'Counsel', approver: 'Approver', requester: 'Requester', viewer: 'Viewer', agent: 'Agent' }

export const providers: [string, string][] = [['docusign', 'DocuSign'], ['adobe-acrobat-sign', 'Adobe Acrobat Sign'], ['dropbox-sign', 'Dropbox Sign'], ['pandadoc', 'PandaDoc'], ['documenso', 'Documenso'], ['docuseal', 'DocuSeal'], ['paper', 'Paper (wet ink)'], ['other', 'Other']]
export const providerName = (id: string) => providers.find(p => p[0] === id)?.[1] ?? id

export const termLabel: Record<string, string> = {
  effective_date: 'Effective date',
  end_date: 'End date',
  auto_renew: 'Auto-renews',
  renewal_term_months: 'Renewal term',
  notice_days: 'Notice period',
  governing_law: 'Governing law',
  payment_terms: 'Payment terms',
}
/** A confirmed term's value with its unit. */
export function termValue(key: string, value: string) {
  if (key.endsWith('_date')) return day(value)
  if (key === 'notice_days') return plural(Number(value), 'day')
  if (key === 'renewal_term_months') return plural(Number(value), 'month')
  if (key === 'auto_renew') return value === 'yes' ? 'Yes' : 'No'
  return value
}

/** Audit actions as people name them; the action key stays for search and the export. */
export const actionLabel: Record<string, string> = {
  'request.create': 'Request created',
  'request.update': 'Details changed',
  'requirement.add': 'Attachment required',
  'requirement.attach': 'Attachment added',
  'requirement.waive': 'Attachment waived',
  'agreement.submit': 'Submitted for review',
  'version.add': 'Version added',
  'version.rendition': 'Signing PDF attached',
  'comment.add': 'Comment',
  'family.link': 'Agreements linked',
  'access.grant': 'Access granted',
  'access.revoke': 'Access removed',
  'legacy.import': 'Signed file imported',
  'party.save': 'Counterparty saved',
  'deviation.add': 'Finding recorded',
  'approval.approved': 'Approved',
  'approval.rejected': 'Approval rejected',
  'package.prepare': 'Package prepared',
  'package.sent': 'Sent for signature',
  'package.void': 'Package voided',
  'execution.record': 'Execution recorded',
  'execution.accept': 'Execution accepted',
  'term.propose': 'Term proposed',
  'term.confirm': 'Term confirmed',
  'term.reject': 'Term rejected',
  'obligation.add': 'Obligation proposed',
  'obligation.confirm': 'Obligation confirmed',
  'obligation.reject': 'Obligation rejected',
  'obligation.done': 'Obligation done',
  'renewal.decide': 'Renewal decided',
  'notice.prepare': 'Notice drafted',
  'notice.approve': 'Notice approved',
  'notice.sent': 'Notice sent',
  'proposal.prepare': 'Proposal prepared',
  'proposal.approve': 'Proposal approved',
  'proposal.reject': 'Proposal rejected',
  'template.create': 'Template drafted',
  'template.revise': 'Template revised',
  'template.approve': 'Template approved',
  'template.retire': 'Template retired',
  'playbook.draft': 'Playbook drafted',
  'playbook.activate': 'Playbook activated',
  'import.preview': 'Dry run',
  'import.apply': 'Archive moved in',
  'import.undo': 'Move-in undone',
  'role.set': 'Role changed',
}
