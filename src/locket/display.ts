// How Locket words its records for people: dates, deadlines, term names with
// units, signing services, roles and audit actions. The screens and the audit
// summaries the server writes read the same formatters, so a moment reads the
// same everywhere.

const dateParts = { month: 'short', day: 'numeric', year: 'numeric' } as const

/** A calendar date (YYYY-MM-DD) as people read it: May 1, 2027. */
export const day = (iso: string | null | undefined) => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { ...dateParts, timeZone: 'UTC' }) : '—')
/** The local calendar date of a moment. */
export const dayOf = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleDateString('en-US', dateParts) : '—')
/** A moment in the reader's time zone, to the minute. */
export const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString('en-US', { ...dateParts, hour: 'numeric', minute: '2-digit' }) : '—')
/** A moment in a named time zone: May 1, 2027, 11:59 PM. */
export function deadline(ms: number, zone: string) {
  return new Date(ms).toLocaleString('en-US', { ...dateParts, hour: 'numeric', minute: '2-digit', timeZone: zone })
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
