// Playbook review findings and exact-version approvals (clauses 6 and 7).
import { may, requireRole } from './access'
import type { Ctx, Handler } from './commands'
import { canonical, fail, integer, json, list, oneOf, optionalText, parse, sha256, sql, text, type Role, type Sql } from './model'
import { agreementGuards, bump, currentVersion, invalidateApprovals, requireStatus, visibleAgreement, type AgreementRow, type VersionRow } from './records'

export interface Requirement {
  kind: 'commercial' | 'exception'
  deviationId: string | null
  label: string
  roles: Role[]
}

export async function activePlaybook(c: Pick<Ctx, 'db'>) {
  return c.db.prepare("SELECT * FROM lk_playbook_versions WHERE status='active'").first<any>()
}

/** The approvals the current version needs: commercial sign-off plus each open exception. */
export async function routing(db: D1Database, a: AgreementRow): Promise<Requirement[]> {
  const required: Requirement[] = [{ kind: 'commercial', deviationId: null, label: 'Commercial approval', roles: ['owner', 'approver'] }]
  if (!a.current_version_id) return required
  const deviations = (await db.prepare("SELECT id, clause_key, result, authority FROM lk_deviations WHERE version_id=? AND result!='met' ORDER BY created_at").bind(a.current_version_id).all<any>()).results
  for (const d of deviations)
    required.push({ kind: 'exception', deviationId: d.id, label: `${d.authority === 'counsel' ? 'Counsel' : 'Commercial'} exception: ${d.clause_key} (${d.result === 'breached' ? 'rule breached' : 'cannot determine'})`, roles: d.authority === 'counsel' ? ['owner', 'counsel'] : ['owner', 'approver'] })
  return required
}

/** Everything the decision rests on; a change makes earlier approvals stop counting. */
export async function decisionContext(db: D1Database, a: AgreementRow, v: VersionRow) {
  // A finding that a rule is met needs no approval and changes nothing a decision rests on (as in routing).
  const deviations = (await db.prepare("SELECT id, result FROM lk_deviations WHERE version_id=? AND result!='met' ORDER BY id").bind(v.id).all<any>()).results
  const context = { versionDigest: v.digest, valueCents: a.value_cents, partyId: a.party_id, deviations }
  return { context, digest: await sha256(canonical(context)) }
}

const addDeviation: Handler = async (c, p) => {
  requireRole(c.actor, may.review, 'record review findings')
  const a = await visibleAgreement(c, p.agreementId)
  return deviationOutcome(c, a, p, null)
}

/** Shared with agent proposals: every finding cites an exact passage of a version's text. */
export async function deviationOutcome(c: Ctx, a: AgreementRow, p: Record<string, unknown>, proposalId: string | null) {
  requireStatus(a, ['draft', 'in_review', 'approved'], 'take review findings')
  const v = await c.db.prepare('SELECT * FROM lk_versions WHERE id=? AND agreement_id=?').bind(p.versionId, a.id).first<VersionRow>()
  if (!v) fail('NOT_FOUND', 'That version is not on this agreement.', 404)
  if (v.text === null) fail('NO_TEXT', `Version ${v.number} has no text to cite. Upload a DOCX or supply the text with the version.`, 409)
  const playbook = await activePlaybook(c)
  if (!playbook) fail('NO_PLAYBOOK', 'Activate a clause playbook before recording review findings.', 409)
  const clauseKey = text(p, 'clauseKey', 40)
  const rule = parse<any[]>(playbook.rules).find(r => r.key === clauseKey)
  if (!rule) fail('INVALID', `Playbook v${playbook.number} has no rule for ${clauseKey}.`, 400, { field: 'clauseKey' })
  const result = oneOf(p, 'result', ['met', 'breached', 'undetermined'] as const)
  const start = integer(p, 'start', 0, v.text.length), end = integer(p, 'end', start + 1, v.text.length)
  const quote = text(p, 'quote', 20_000)
  if (v.text.slice(start, end) !== quote) fail('CITATION', `The quoted passage does not match version ${v.number} at characters ${start}–${end}.`, 400, { actual: v.text.slice(start, end) })
  const questions = list(p, 'questions', 20).map(q => (typeof q === 'string' && q.trim() ? q.trim().slice(0, 1000) : fail('INVALID', 'Questions must be text.')))
  const id = crypto.randomUUID()
  const writes: Sql[] = [
    sql('INSERT INTO lk_deviations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, a.id, v.id, playbook.id, clauseKey, result, start, end, quote, optionalText(p, 'proposedWording', 20_000), text(p, 'explanation', 4000), json(questions), rule.authority, proposalId, c.actor.id, c.now),
    bump(c, a, 'status=?', a.status === 'approved' && result !== 'met' ? 'in_review' : a.status),
  ]
  if (result !== 'met') writes.push(invalidateApprovals(c, a.id, `New review finding on ${clauseKey}`))
  return {
    allowed: may.prepare,
    result: { id, authority: rule.authority },
    writes,
    checks: [...agreementGuards(c, a), sql("(SELECT status FROM lk_playbook_versions WHERE id=?)='active'", playbook.id)],
    audit: [{ action: 'deviation.add', agreementId: a.id, summary: `${clauseKey}: ${result === 'met' ? 'rule met' : result === 'breached' ? 'rule breached' : 'cannot determine'} (playbook v${playbook.number})` }],
  }
}

const decide: Handler = async (c, p) => {
  const a = await visibleAgreement(c, p.agreementId)
  requireStatus(a, ['in_review'], 'take approvals (submit it for review first)')
  const v = await currentVersion(c, a)
  if (p.versionId !== v.id) fail('NOT_CURRENT', `Approve the current version (v${v.number}); the one you reviewed was replaced.`, 409)
  const kind = oneOf(p, 'kind', ['commercial', 'exception'] as const)
  const decision = oneOf(p, 'decision', ['approved', 'rejected'] as const)
  const required = await routing(c.db, a)
  const target = required.find(r => r.kind === kind && (kind === 'commercial' || r.deviationId === p.deviationId))
  if (!target) fail('NOT_REQUIRED', 'That approval is not part of this agreement’s route.', 409)
  requireRole(c.actor, target.roles, `decide ${target.label.toLowerCase()}`)
  if (c.actor.role !== 'owner' && a.requester_id === c.actor.id) fail('SELF_APPROVAL', 'The requester cannot approve their own request; ask another approver or the owner.', 403)
  const { context, digest } = await decisionContext(c.db, a, v)
  const live = (await c.db.prepare('SELECT kind, deviation_id, decision, context_digest FROM lk_approvals WHERE agreement_id=? AND version_id=? AND version_digest=? AND invalidated_at IS NULL').bind(a.id, v.id, v.digest).all<any>()).results
  const counted = live.filter(x => x.context_digest === digest)
  if (counted.some(x => x.kind === kind && (x.deviation_id ?? null) === (target.deviationId ?? null))) fail('ALREADY_DECIDED', `${target.label} is already decided for v${v.number}.`, 409)
  const id = crypto.randomUUID()
  const after = [...counted, { kind, deviation_id: target.deviationId, decision }]
  const satisfied = required.every(r => after.some(x => x.kind === r.kind && (x.deviation_id ?? null) === (r.deviationId ?? null) && x.decision === 'approved'))
  const rejected = after.some(x => x.decision === 'rejected')
  const status = satisfied && !rejected ? 'approved' : 'in_review'
  return {
    allowed: target.roles,
    result: { id, status, versionId: v.id, versionDigest: v.digest },
    writes: [
      sql('INSERT INTO lk_approvals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, a.id, v.id, v.digest, kind, target.deviationId, decision, c.actor.id, c.actor.role, json(context), digest, optionalText(p, 'reason', 2000), c.now, null, null),
      bump(c, a, 'status=?', status),
    ],
    checks: [...agreementGuards(c, a, p), sql('(SELECT digest FROM lk_versions WHERE id=?)=?', v.id, v.digest)],
    audit: [{ action: `approval.${decision}`, agreementId: a.id, summary: `${target.label} ${decision} on v${v.number}${status === 'approved' ? '; agreement approved' : ''}` }],
  }
}

export const reviewHandlers: Record<string, Handler> = {
  'deviation.add': addDeviation,
  'approval.decide': decide,
}
