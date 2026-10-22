import { requireRole } from './access'
import type { Ctx, Handler } from './commands'
import { fail, oneOf, optionalText, sql, text, type Role } from './model'
import { agreementGuards, visibleAgreement } from './records'

export const recommendationReviewers: Role[] = ['counsel']
const recorders: Role[] = ['owner', 'counsel']

/** A recorded counterparty decision is separate from internal exception approval.
 * Text resemblance, proposed wording and a signature alone never imply acceptance. */
const recordOutcome: Handler = async (c, p) => {
  requireRole(c.actor, recorders, 'record counterparty negotiation outcomes')
  const a = await visibleAgreement(c, p.agreementId)
  const d = await c.db.prepare('SELECT * FROM lk_deviations WHERE id=? AND agreement_id=?').bind(text(p, 'deviationId', 100), a.id).first<any>()
  const v = await c.db.prepare('SELECT * FROM lk_versions WHERE id=? AND agreement_id=?').bind(p.versionId, a.id).first<any>()
  if (!d || !v) fail('NOT_FOUND', 'The finding and document version must belong to this agreement.', 404)
  if (d.result === 'met' || d.version_id !== v.id || v.id !== a.current_version_id) fail('NOT_CURRENT', 'Record the outcome against the current version and its exception finding.', 409)
  if (!v.text || v.text.slice(d.start_offset, d.end_offset) !== d.quote) fail('CITATION', 'The finding no longer matches its exact document passage.', 409)
  const approval = await c.db.prepare("SELECT * FROM lk_approvals WHERE id=? AND agreement_id=? AND deviation_id=? AND version_id=? AND version_digest=? AND kind='exception' AND decision='approved' AND invalidated_at IS NULL").bind(text(p, 'approvalId', 100), a.id, d.id, v.id, v.digest).first<any>()
  if (!approval) fail('APPROVAL', 'An unwithdrawn approval of this exact exception and version is required.', 409)
  if (await c.db.prepare('SELECT 1 FROM lk_negotiation_outcomes WHERE deviation_id=?').bind(d.id).first()) fail('ALREADY_RECORDED', 'This finding already has an immutable negotiation outcome.', 409)
  const id = crypto.randomUUID(), outcome = oneOf(p, 'outcome', ['accepted', 'rejected'] as const)
  return {
    allowed: recorders, result: { id },
    writes: [sql('INSERT INTO lk_negotiation_outcomes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, a.id, v.id, v.digest, d.id, approval.id, d.playbook_version_id, d.clause_key, outcome, d.start_offset, d.end_offset, d.quote, text(p, 'evidence', 4000), c.actor.id, c.now)],
    checks: [...agreementGuards(c, a, p), sql('(SELECT digest FROM lk_versions WHERE id=?)=?', v.id, v.digest), sql('(SELECT invalidated_at FROM lk_approvals WHERE id=?) IS NULL', approval.id)],
    audit: [{ action: 'negotiation.outcome.record', agreementId: a.id, summary: `Recorded counterparty ${outcome} outcome for ${d.clause_key} on v${v.number}; exception approval ${approval.id}` }],
  }
}

const recordIssue: Handler = async (c, p) => {
  requireRole(c.actor, recorders, 'record later operational observations')
  const a = await visibleAgreement(c, p.agreementId)
  const outcome = await c.db.prepare("SELECT * FROM lk_negotiation_outcomes WHERE id=? AND agreement_id=? AND outcome='accepted'").bind(text(p, 'outcomeId', 100), a.id).first<any>()
  if (!outcome) fail('NOT_FOUND', 'Choose an accepted negotiation outcome on this agreement.', 404)
  if (c.now < outcome.recorded_at) fail('INVALID', 'A later observation cannot predate the recorded outcome.')
  const kind = oneOf(p, 'kind', ['dispute', 'missed_obligation', 'credit', 'none_observed'] as const)
  const obligationId = optionalText(p, 'obligationId', 100)
  const checks = agreementGuards(c, a, p)
  if (kind === 'missed_obligation') {
    if (!obligationId) fail('INVALID', 'Choose the missed obligation.')
    const obligation = await c.db.prepare("SELECT * FROM lk_obligations WHERE id=? AND agreement_id=? AND status='confirmed' AND due_date IS NOT NULL").bind(obligationId, a.id).first<any>()
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: a.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(c.now)
    if (!obligation || obligation.due_date >= today) fail('EVIDENCE', 'The obligation must be confirmed, unfinished and past its due date.', 409)
    checks.push(sql("EXISTS(SELECT 1 FROM lk_obligations WHERE id=? AND status='confirmed' AND due_date=?)", obligationId, obligation.due_date))
  } else if (obligationId) fail('INVALID', 'An obligation source belongs only to a missed-obligation observation.')
  const id = crypto.randomUUID()
  return {
    allowed: recorders, result: { id }, checks,
    writes: [sql('INSERT INTO lk_playbook_issues VALUES(?,?,?,?,?,?,?,?,?)', id, outcome.id, a.id, kind, text(p, 'description', 4000), text(p, 'evidence', 4000), obligationId, c.actor.id, c.now)],
    audit: [{ action: 'playbook.issue.record', agreementId: a.id, summary: `Recorded ${kind.replace(/_/g, ' ')} observation against ${outcome.clause_key} outcome ${outcome.id}` }],
  }
}

export const playbookEvidenceHandlers: Record<string, Handler> = {
  'negotiation.outcome.record': recordOutcome,
  'playbook.issue.record': recordIssue,
}

/** Detailed evidence remains counsel-only, including in workspace state. */
export async function playbookRecommendationState(c: Pick<Ctx, 'db' | 'actor'>) {
  if (!recommendationReviewers.includes(c.actor.role)) return { outcomes: [], issues: [], recommendations: [], applications: [] }
  const [outcomes, issues, recommendations, applications] = await Promise.all([
    c.db.prepare('SELECT * FROM lk_negotiation_outcomes ORDER BY recorded_at,id').all<any>(),
    c.db.prepare('SELECT * FROM lk_playbook_issues ORDER BY recorded_at,id').all<any>(),
    c.db.prepare('SELECT * FROM lk_playbook_recommendations ORDER BY created_at DESC,id').all<any>(),
    c.db.prepare('SELECT * FROM lk_playbook_applications ORDER BY approved_at,id').all<any>(),
  ])
  return { outcomes: outcomes.results, issues: issues.results, recommendations: recommendations.results, applications: applications.results }
}
