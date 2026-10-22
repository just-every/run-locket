import { agentDraft, preparedNoticeText, sourceOf, sourceChecks } from './notice-agent'
import { prepareCustomFields, applyCustomFields, customProposalAuthority } from './custom-proposals'
// Agent work: an agent (or any preparer) records an evidence-backed proposal;
// a person with the matching authority approves or rejects it. Approval applies
// it through the same checks as the person doing the work themselves, and the
// proposal keeps who prepared it, who decided and what it produced.
import { may, requireRole } from './access'
import { agreementHandlers } from './agreements'
import { refuseErasedAddress } from './erasure-addresses'
import type { Ctx, Handler, Outcome } from './commands'
import { fail, json, list, object, oneOf, parse, sql, type Role } from './model'
import { confirmTermsWrites, noticeDraft, termProposal } from './obligations'
import { bump, visibleAgreement } from './records'
import { termLabel, termValue } from './display'
import { deviationOutcome } from './review'
import { seesIntake } from './views'

const kinds = ['intake', 'review', 'family', 'terms', 'renewal', 'custom_fields'] as const
type Kind = (typeof kinds)[number]

/** Who may approve each kind of prepared work. */
export const deciders: Record<Kind, Role[]> = {
  custom_fields: ['owner', 'counsel', 'approver', 'requester', 'viewer'],
  intake: ['owner', 'counsel', 'approver', 'requester'],
  review: ['owner', 'counsel'],
  family: ['owner', 'counsel'],
  terms: ['owner', 'counsel', 'approver'],
  renewal: ['owner', 'approver'],
}

const prepare: Handler = async (c, p) => {
  requireRole(c.actor, may.prepare, 'prepare proposals')
  const kind = oneOf(p, 'kind', kinds)
  let payload = object(p.payload, 'payload')
  if (kind === 'custom_fields') payload = await prepareCustomFields(c, payload)
  if (kind === 'renewal' && (c.actor.role === 'agent' || payload.sourceId)) {
    const { s } = await sourceOf(c, payload.sourceId)
    const r = await c.db.prepare('SELECT end_date FROM lk_renewals WHERE id=?').bind(s.renewal_id).first<any>()
    Object.assign(payload, { sourceId:s.id,renewalId:s.renewal_id,recipient:s.recipient,body:preparedNoticeText(s,r.end_date) })
  }
  const evidence = list(p, 'evidence', 50).map(e => (typeof e === 'string' && e.trim() ? e.trim().slice(0, 4000) : fail('INVALID', 'Evidence entries must be text.')))
  if (!evidence.length) fail('INVALID', 'A proposal states its evidence (where each value came from).')
  const assumptions = typeof p.assumptions === 'string' ? p.assumptions.slice(0, 4000) : ''
  let agreementId: string | null = null
  if (kind !== 'intake') agreementId = (await visibleAgreement(c, payload.agreementId ?? (await renewalAgreement(c, payload.renewalId)))).id
  const id = crypto.randomUUID()
  return {
    allowed: may.prepare,
    result: { id, status: 'pending' },
    writes: [sql('INSERT INTO lk_proposals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', id, kind, agreementId, json(payload), json(evidence), assumptions, c.actor.id, c.now, 'pending', null, null, null, null)],
    audit: [{ action: 'proposal.prepare', agreementId, summary: `Prepared ${kind} proposal for review` }],
  }
}
async function renewalAgreement(c: Ctx, renewalId: unknown) {
  if (renewalId === undefined) return undefined
  return (await c.db.prepare('SELECT agreement_id FROM lk_renewals WHERE id=?').bind(renewalId).first<{ agreement_id: string }>())?.agreement_id
}

/** Applies an approved proposal by reusing the ordinary command logic as the deciding person. */
async function apply(c: Ctx, kind: Kind, payload: Record<string, unknown>, proposalId: string): Promise<Outcome> {
  if (kind === 'intake') {
    // A stored proposal may predate erasure; delegated writes repeat the same
    // live-address check and carry its fence into the approval transaction.
    const checks=await refuseErasedAddress(c,'request.create',payload)
    const out=await agreementHandlers['request.create'](c,payload)
    return {...out,checks:[...(out.checks??[]),...checks]}
  }
  if (kind === 'family') return agreementHandlers['family.link'](c, { ...payload, version: (await visibleAgreement(c, payload.agreementId)).version })
  if (kind === 'review') {
    const a = await visibleAgreement(c, payload.agreementId)
    const findings = list(payload, 'findings', 30).map(f => object(f, 'finding'))
    if (!findings.length) fail('INVALID', 'A review proposal lists at least one finding.')
    const outs: Outcome[] = []
    for (const f of findings) outs.push(await deviationOutcome(c, a, { ...f, versionId: payload.versionId }, proposalId))
    // One agreement-version bump for the whole set; each finding keeps its own row.
    const writes = outs.flatMap(o => o.writes.filter(w => !w.sql.startsWith('UPDATE lk_agreements')))
    const reopen = a.status === 'approved' && findings.some(f => f.result !== 'met')
    return { allowed: deciders.review, result: { deviations: outs.map(o => (o.result as { id: string }).id) }, writes: [...writes, bump(c, a, 'status=?', reopen ? 'in_review' : a.status)], checks: outs[0].checks, audit: outs.flatMap(o => o.audit) }
  }
  if (kind === 'terms') {
    const a = await visibleAgreement(c, payload.agreementId)
    const terms = list(payload, 'terms', 20).map(t => object(t, 'term'))
    if (!terms.length) fail('INVALID', 'A terms proposal lists at least one term.')
    const proposed = []
    for (const t of terms) proposed.push(await termProposal(c, a, t, proposalId))
    if (new Set(proposed.map(t => t.key)).size !== proposed.length) fail('INVALID', 'A terms proposal names each term once.')
    const confirm = await confirmTermsWrites(c, a, proposed.map(t => ({ id: t.id, key: t.key, value: t.write.params[3] as string })))
    return {
      allowed: deciders.terms,
      result: { confirmed: proposed.map(t => t.id) },
      writes: [...proposed.map(t => t.write), ...confirm.writes, bump(c, a)],
      checks: [sql('(SELECT version FROM lk_agreements WHERE id=?)=?', a.id, a.version), ...confirm.checks],
      audit: [{ action: 'term.confirm', agreementId: a.id, summary: `Confirmed from proposal: ${proposed.map(t => `${termLabel[t.key].toLowerCase()}: ${termValue(t.key, String(t.write.params[3]))}`).join('; ')}${confirm.summary ? '; ' + confirm.summary : ''}` }],
    }
  }
  if (payload.sourceId) {
    const { s, a } = await sourceOf(c,payload.sourceId)
    const { n, writes } = await agentDraft(c,s,'email',null,proposalId)
    return {allowed:deciders.renewal,result:{noticeId:n.id,status:'draft'},writes:[...writes,bump(c,a)],checks:[...sourceChecks(s),sql('(SELECT version FROM lk_agreements WHERE id=?)=?',a.id,a.version)],audit:[{action:'notice.prepare',agreementId:a.id,summary:'Accepted cited prepared draft; exact schedule approval still required.'}]}
  }
  const n = await noticeDraft(c, payload.renewalId, payload, proposalId)
  return { allowed: deciders.renewal, result: { noticeId: n.id, status: 'draft' }, writes: [...n.writes, bump(c, n.a)], checks: [sql('(SELECT version FROM lk_agreements WHERE id=?)=?', n.a.id, n.a.version)], audit: [{ action: 'notice.prepare', agreementId: n.a.id, summary: `Accepted prepared ${n.r.decision} notice draft; it still needs sending approval` }] }
}

const decide: Handler = async (c, p) => {
  const proposal = await c.db.prepare('SELECT * FROM lk_proposals WHERE id=?').bind(p.proposalId).first<any>()
  if (!proposal) fail('NOT_FOUND', 'No such proposal.', 404)
  if (proposal.agreement_id) await visibleAgreement(c, proposal.agreement_id)
  else if (!seesIntake(c.actor, proposal)) fail('NOT_FOUND', 'No such proposal.', 404)
  const kind = proposal.kind as Kind
  const customAuthority = kind === 'custom_fields' ? await customProposalAuthority(c, parse(proposal.payload)) : null
  const allowed = customAuthority?.allowed ?? deciders[kind]
  requireRole(c.actor, allowed, `decide ${kind} proposals`)
  if (proposal.status !== 'pending') fail('STATUS', `This proposal is already ${proposal.status}.`, 409)
  if (proposal.prepared_by === c.actor.id && c.actor.role !== 'owner') fail('SELF_APPROVAL', 'Someone other than the preparer must decide this proposal.', 403)
  const decision = oneOf(p, 'decision', ['approve', 'reject'] as const)
  const reason = typeof p.reason === 'string' ? p.reason.slice(0, 2000) : null
  const pending = sql("(SELECT status FROM lk_proposals WHERE id=?)='pending'", proposal.id)
  if (decision === 'reject')
    return { allowed, result: { id: proposal.id, status: 'rejected' }, writes: [sql("UPDATE lk_proposals SET status='rejected', decided_by=?, decided_at=?, decision_reason=? WHERE id=?", c.actor.id, c.now, reason, proposal.id)], checks: [pending, ...(customAuthority?.checks ?? [])], audit: [{ action: 'proposal.reject', agreementId: proposal.agreement_id, summary: `Rejected ${kind} proposal` }] }
  const payload = parse(proposal.payload)
  if (kind === 'renewal' && !payload.sourceId) {
    const preparer = await c.db.prepare('SELECT role FROM lk_roles WHERE operator_id=?').bind(proposal.prepared_by).first<{role:string}>()
    if (preparer?.role === 'agent') fail('CITATION','Prepare a new notice from a person-selected source before accepting it.',409)
  }
  const out = kind === 'custom_fields' ? await applyCustomFields(c, payload, proposal.id, proposal.prepared_by, p.values) : await apply(c, kind, payload, proposal.id)
  // An approved intake now belongs to the agreement it created, and is seen exactly as that agreement is.
  const agreementId = kind === 'intake' ? (out.result as { id: string }).id : proposal.agreement_id
  return {
    allowed: kind === 'custom_fields' ? out.allowed : deciders[kind],
    result: { id: proposal.id, status: 'approved', outcome: out.result },
    writes: [...out.writes, sql("UPDATE lk_proposals SET status='approved', decided_by=?, decided_at=?, decision_reason=?, outcome=?, agreement_id=? WHERE id=?", c.actor.id, c.now, reason, json(out.result), agreementId, proposal.id)],
    checks: [pending, ...(out.checks ?? [])],
    audit: [{ action: 'proposal.approve', agreementId, summary: `Approved ${kind} proposal` }, ...out.audit],
  }
}

export const proposalHandlers: Record<string, Handler> = {
  'proposal.prepare': prepare,
  'proposal.decide': decide,
}
