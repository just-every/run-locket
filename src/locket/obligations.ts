import { sourceChecks } from './notice-agent'
import { notificationWrites } from './notifications'
// Confirmed terms and obligations from the executed document, the renewal
// queue and notices (clauses 10 and 11). Nothing an agent or importer
// proposes drives a deadline until a person confirms it against the signed text.
// Preparing or approving a notice is never evidence that it was sent.
import { may, requireRole } from './access'
import { fileInput, storeArtifact } from './artifacts'
import type { Ctx, Handler } from './commands'
import { noticeDeadlineFor } from './business-days'
import { installationSettings } from './installation'
import { frozenLetter } from './notice-letters'
import { initialTracking } from './notice-tracking'
import { day, deadline as zoned, termLabel, termValue as termText } from './display'
import { date, fail, integer, json, object, oneOf, optionalDate, optionalText, sql, text, type Sql } from './model'
import { agreementGuards, bump, visibleAgreement, type AgreementRow } from './records'
import { riskLevels } from './obligation-risk'

export const termKeys = ['effective_date', 'end_date', 'auto_renew', 'renewal_term_months', 'notice_days', 'governing_law', 'payment_terms'] as const
type TermKey = (typeof termKeys)[number]

function termValue(key: TermKey, p: Record<string, unknown>): string {
  if (key === 'effective_date' || key === 'end_date') return date(p, 'value')
  if (key === 'auto_renew') return oneOf(p, 'value', ['yes', 'no'] as const)
  if (key === 'renewal_term_months') return String(integer({ value: Number(p.value) }, 'value', 1, 120))
  if (key === 'notice_days') return String(integer({ value: Number(p.value) }, 'value', 0, 730))
  return text(p, 'value', 2000)
}

/** A citation points into the executed agreement: the version text or a signed-PDF page. */
async function citation(c: Ctx, a: AgreementRow, value: unknown) {
  const cite = object(value, 'citation')
  const quote = text(cite, 'quote', 4000)
  const page = cite.page === undefined || cite.page === null ? null : integer(cite, 'page', 1, 5000)
  const version = a.current_version_id ? await c.db.prepare('SELECT number, text FROM lk_versions WHERE id=?').bind(a.current_version_id).first<{ number: number; text: string | null }>() : null
  if (version?.text) {
    if (!version.text.includes(quote)) fail('CITATION', `The quoted words are not in the executed text of version ${version.number}.`, 400)
    return { source: 'version-text', versionId: a.current_version_id, quote, page }
  }
  if (page === null) fail('CITATION', 'This agreement has no text rendition; cite the signed PDF page number with the quoted words.', 400)
  return { source: 'signed-pdf-page', versionId: a.current_version_id, quote, page }
}

function requireEffective(a: AgreementRow) {
  if (!['executed', 'imported'].includes(a.status)) fail('NOT_EXECUTED', `${a.reference} is ${a.status.replace(/_/g, ' ')}; terms come from the executed agreement.`, 409)
}

/** Builds a term proposal (used directly and by approved agent proposals). */
export async function termProposal(c: Ctx, a: AgreementRow, p: Record<string, unknown>, proposalId: string | null) {
  requireEffective(a)
  const key = oneOf(p, 'key', termKeys)
  const id = crypto.randomUUID()
  return { id, key, write: sql('INSERT INTO lk_terms VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', id, a.id, key, termValue(key, p), json(await citation(c, a, p.citation)), 'proposed', c.actor.id, proposalId, null, null, null, optionalText(p, 'reason', 1000), c.now) }
}

const proposeTerm: Handler = async (c, p) => {
  requireRole(c.actor, may.review, 'propose terms')
  const a = await visibleAgreement(c, p.agreementId)
  const t = await termProposal(c, a, p, null)
  return { allowed: may.review, result: { id: t.id }, writes: [t.write, bump(c, a)], checks: agreementGuards(c, a), audit: [{ action: 'term.propose', agreementId: a.id, summary: `Proposed ${termLabel[t.key].toLowerCase()}` }] }
}

/** Renewal row from confirmed terms; re-deciding is required when the dates move. */
export async function renewalWrites(c: Ctx, a: AgreementRow, confirmed: Map<string, string>): Promise<{ writes: Sql[]; summary: string | null }> {
  const end = confirmed.get('end_date'), days = confirmed.get('notice_days')
  if (!end || days === undefined) return { writes: [sql('DELETE FROM lk_renewals WHERE agreement_id=? AND decision IS NULL AND NOT EXISTS(SELECT 1 FROM lk_notices n WHERE n.agreement_id=lk_renewals.agreement_id)', a.id)], summary: null }
  const deadline = noticeDeadlineFor(end, Number(days), a.timezone, (await installationSettings(c.db)).rollNoticeDeadlines)
  const autoRenew = confirmed.get('auto_renew') === 'yes' ? 1 : 0
  return {
    writes: [
      sql(
        `INSERT INTO lk_renewals VALUES(?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,?)
         ON CONFLICT(agreement_id) DO UPDATE SET
           decision=CASE WHEN lk_renewals.end_date=excluded.end_date AND lk_renewals.notice_days=excluded.notice_days THEN lk_renewals.decision ELSE NULL END,
           decided_by=CASE WHEN lk_renewals.end_date=excluded.end_date AND lk_renewals.notice_days=excluded.notice_days THEN lk_renewals.decided_by ELSE NULL END,
           decided_at=CASE WHEN lk_renewals.end_date=excluded.end_date AND lk_renewals.notice_days=excluded.notice_days THEN lk_renewals.decided_at ELSE NULL END,
           end_date=excluded.end_date, notice_days=excluded.notice_days, deadline_date=excluded.deadline_date, deadline_at=excluded.deadline_at,
           timezone=excluded.timezone, auto_renew=excluded.auto_renew, updated_at=excluded.updated_at`,
        crypto.randomUUID(), a.id, end, Number(days), deadline.date, deadline.at, a.timezone, autoRenew, c.now,
      ),
    ],
    summary: `Notice deadline ${zoned(deadline.at, a.timezone)}`,
  }
}

async function confirmedTerms(c: Ctx, agreementId: string): Promise<Map<string, string>> {
  const rows = (await c.db.prepare("SELECT key, value FROM lk_terms WHERE agreement_id=? AND status='confirmed'").bind(agreementId).all<{ key: string; value: string }>()).results
  return new Map(rows.map(r => [r.key, r.value]))
}

/** Confirming terms supersedes earlier confirmed values of the same keys and keeps them in history. */
export async function confirmTermsWrites(c: Ctx, a: AgreementRow, terms: { id: string; key: string; value: string }[]) {
  const confirmed = await confirmedTerms(c, a.id)
  const writes: Sql[] = [], checks: Sql[] = [], superseded: string[] = []
  for (const term of terms) {
    const previous = await c.db.prepare("SELECT id FROM lk_terms WHERE agreement_id=? AND key=? AND status='confirmed'").bind(a.id, term.key).first<{ id: string }>()
    confirmed.set(term.key, term.value)
    if (previous) {
      writes.push(sql("UPDATE lk_terms SET status='superseded' WHERE id=?", previous.id))
      checks.push(sql("(SELECT status FROM lk_terms WHERE id=?)='confirmed'", previous.id))
      superseded.push(previous.id)
    } else checks.push(sql("NOT EXISTS(SELECT 1 FROM lk_terms WHERE agreement_id=? AND key=? AND status='confirmed')", a.id, term.key))
    writes.push(sql("UPDATE lk_terms SET status='confirmed', confirmed_by=?, confirmed_at=?, supersedes_id=? WHERE id=?", c.actor.id, c.now, previous?.id ?? null, term.id))
  }
  const renewal = await renewalWrites(c, a, confirmed)
  return { writes: [...writes, ...renewal.writes], checks, summary: renewal.summary, superseded }
}

const decideTerm: Handler = async (c, p) => {
  requireRole(c.actor, may.confirmTerms, 'confirm terms')
  const a = await visibleAgreement(c, p.agreementId)
  requireEffective(a)
  const term = await c.db.prepare('SELECT * FROM lk_terms WHERE id=? AND agreement_id=?').bind(p.termId, a.id).first<any>()
  if (!term || term.status !== 'proposed') fail('STATUS', 'Only a proposed term can be confirmed or rejected.', 409)
  const decision = oneOf(p, 'decision', ['confirm', 'reject'] as const)
  if (decision === 'reject')
    return { allowed: may.confirmTerms, result: { id: term.id, status: 'rejected' }, writes: [sql("UPDATE lk_terms SET status='rejected', confirmed_by=?, confirmed_at=?, reason=? WHERE id=?", c.actor.id, c.now, optionalText(p, 'reason', 1000), term.id), bump(c, a)], checks: [...agreementGuards(c, a), sql("(SELECT status FROM lk_terms WHERE id=?)='proposed'", term.id)], audit: [{ action: 'term.reject', agreementId: a.id, summary: `Rejected proposed ${termLabel[term.key].toLowerCase()}` }] }
  const out = await confirmTermsWrites(c, a, [term])
  return {
    allowed: may.confirmTerms,
    result: { id: term.id, status: 'confirmed', superseded: out.superseded[0] ?? null },
    writes: [...out.writes, bump(c, a)],
    checks: [...agreementGuards(c, a), sql("(SELECT status FROM lk_terms WHERE id=?)='proposed'", term.id), ...out.checks],
    audit: [{ action: 'term.confirm', agreementId: a.id, summary: `Confirmed ${termLabel[term.key].toLowerCase()}: ${termText(term.key, term.value)}${out.superseded.length ? ' (corrects an earlier value)' : ''}${out.summary ? '; ' + out.summary : ''}` }],
  }
}

const addObligation: Handler = async (c, p) => {
  requireRole(c.actor, may.review, 'record obligations')
  const a = await visibleAgreement(c, p.agreementId)
  requireEffective(a)
  const ownerId = text(p, 'ownerId', 64)
  if (!(await c.db.prepare("SELECT 1 AS ok FROM oa_operators WHERE id=? AND status='active'").bind(ownerId).first())) fail('INVALID', 'The obligation owner must be an active member.', 400)
  const id = crypto.randomUUID()
  const evidence = p.evidence === undefined ? 'none' : oneOf(p, 'evidence', evidenceKinds), risk = p.risk === undefined ? 'medium' : oneOf(p, 'risk', riskLevels)
  return {
    allowed: may.review,
    result: { id },
    writes: [sql('INSERT INTO lk_obligations(id,agreement_id,description,owner_id,due_date,recurrence,citation,status,created_by,confirmed_by,done_by,done_at,created_at,evidence,risk) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, a.id, text(p, 'description', 2000), ownerId, optionalDate(p, 'dueDate'), oneOf(p, 'recurrence', ['none', 'monthly', 'quarterly', 'annually'] as const), json(await citation(c, a, p.citation)), 'proposed', c.actor.id, null, null, null, c.now, evidence, risk), bump(c, a)],
    checks: agreementGuards(c, a),
    audit: [{ action: 'obligation.add', agreementId: a.id, summary: 'Proposed an obligation' }],
  }
}

const evidenceKinds = ['none', 'file', 'link', 'note'] as const
const evidenceWords: Record<string, string> = { file: 'a file (such as a certificate of insurance)', link: 'a link', note: 'a note' }
/** OBL-002: the evidence an obligation's type requires before it is done; any other evidence given is kept too. */
async function evidenceFor(c: Ctx, a: AgreementRow, o: { id: string; evidence: string }, p: Record<string, unknown>) {
  const link = optionalText(p, 'link', 2000), note = optionalText(p, 'note', 4000)
  if (link && !/^https?:\/\/[^\s]+$/i.test(link)) fail('INVALID', 'The evidence link must start with https:// or http://.', 400, { field: 'link' })
  const stored = p.file ? await storeArtifact(fileInput(p.file, 'file'), { agreementId: a.id, role: 'attachment', provenance: { obligationEvidence: o.id }, actorId: c.actor.id, at: c.now }) : null
  const given = { file: stored, link, note }[o.evidence as 'file' | 'link' | 'note']
  if (o.evidence !== 'none' && !given) fail('EVIDENCE', `Marking this obligation done needs ${evidenceWords[o.evidence]} as evidence.`, 409, { evidence: o.evidence })
  return { writes: stored?.writes ?? [], artifactId: stored?.id ?? null, link, note }
}

const updateObligation: Handler = async (c, p) => {
  const a = await visibleAgreement(c, p.agreementId)
  const o = await c.db.prepare('SELECT * FROM lk_obligations WHERE id=? AND agreement_id=?').bind(p.obligationId, a.id).first<any>()
  if (!o) fail('NOT_FOUND', 'That obligation is not on this agreement.', 404)
  const action = oneOf(p, 'action', ['confirm', 'reject', 'done'] as const)
  if (action === 'done') {
    if (o.status !== 'confirmed') fail('STATUS', 'Only a confirmed obligation can be marked done.', 409)
    if (c.actor.id !== o.owner_id) requireRole(c.actor, may.confirmTerms, 'complete someone else’s obligation')
  } else {
    requireRole(c.actor, may.confirmTerms, 'confirm obligations')
    if (o.status !== 'proposed') fail('STATUS', 'Only a proposed obligation can be confirmed or rejected.', 409)
  }
  const status = action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'done'
  const writes: Sql[] = []
  if (action === 'done') {
    const proof = await evidenceFor(c, a, o, p)
    writes.push(...proof.writes, sql("UPDATE lk_obligations SET status='done', done_by=?, done_at=?, evidence_artifact_id=?, evidence_link=?, evidence_note=? WHERE id=?", c.actor.id, c.now, proof.artifactId, proof.link, proof.note, o.id))
  } else writes.push(sql('UPDATE lk_obligations SET status=?, confirmed_by=? WHERE id=?', status, c.actor.id, o.id))
  if (action === 'confirm') writes.push(...notificationWrites(c,{key:c.commandId,agreementId:a.id,recipientId:o.owner_id,kind:'assignment'}))
  return { allowed: action === 'done' ? may.review : may.confirmTerms, result: { id: o.id, status }, writes: [...writes, bump(c, a)], checks: [...agreementGuards(c, a), sql('(SELECT status FROM lk_obligations WHERE id=?)=?', o.id, o.status)], audit: [{ action: `obligation.${action}`, agreementId: a.id, summary: `${status[0].toUpperCase() + status.slice(1)} obligation: ${o.description.slice(0, 80)}` }] }
}

async function renewalOf(c: Ctx, id: unknown) {
  const r = await c.db.prepare('SELECT * FROM lk_renewals WHERE id=?').bind(id).first<any>()
  if (!r) fail('NOT_FOUND', 'No such renewal.', 404)
  return { r, a: await visibleAgreement(c, r.agreement_id) }
}

const decideRenewal: Handler = async (c, p) => {
  requireRole(c.actor, may.renewalDecision, 'decide renewals')
  const { r, a } = await renewalOf(c, p.renewalId)
  const decision = oneOf(p, 'decision', ['renew', 'renegotiate', 'terminate'] as const)
  return {
    allowed: may.renewalDecision,
    result: { renewalId: r.id, decision },
    writes: [sql('UPDATE lk_renewals SET decision=?, decided_by=?, decided_at=?, decision_reason=? WHERE id=?', decision, c.actor.id, c.now, optionalText(p, 'reason', 2000), r.id), bump(c, a)],
    checks: [...agreementGuards(c, a), sql('(SELECT end_date FROM lk_renewals WHERE id=?)=?', r.id, r.end_date)],
    audit: [{ action: 'renewal.decide', agreementId: a.id, summary: `Decided to ${decision} (term ends ${day(r.end_date)})` }],
  }
}

export async function noticeDraft(c: Ctx, renewalId: unknown, p: Record<string, unknown>, proposalId: string | null) {
  const { r, a } = await renewalOf(c, renewalId)
  if (!r.decision) fail('NO_DECISION', 'Decide renew, renegotiate or terminate before preparing a notice.', 409)
  const id = crypto.randomUUID()
  const recipient = text(p, 'recipient', 300), body = text(p, 'body', 20_000)
  const letter = await frozenLetter(c, { id, agreement_id: a.id, recipient, body })
  return { id, a, r, writes: [sql('INSERT INTO lk_notices VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, r.id, a.id, recipient, body, c.actor.id, proposalId, 'draft', null, null, null, null, null, null, c.now), ...letter.writes] }
}

const prepareNotice: Handler = async (c, p) => {
  requireRole(c.actor, may.review, 'prepare notices')
  const n = await noticeDraft(c, p.renewalId, p, null)
  return { allowed: may.review, result: { id: n.id, status: 'draft' }, writes: [...n.writes, bump(c, n.a)], checks: agreementGuards(c, n.a), audit: [{ action: 'notice.prepare', agreementId: n.a.id, summary: `Prepared a ${n.r.decision} notice draft` }] }
}

async function noticeOf(c: Ctx, id: unknown) {
  const n = await c.db.prepare('SELECT * FROM lk_notices WHERE id=?').bind(id).first<any>()
  if (!n) fail('NOT_FOUND', 'No such notice.', 404)
  return { n, a: await visibleAgreement(c, n.agreement_id) }
}

export const approveNotice = async (c: Ctx, p: Record<string, unknown>, scheduled = false) => {
  requireRole(c.actor, may.renewalDecision, 'approve notices for sending')
  const { n, a } = await noticeOf(c, p.noticeId)
  if (n.status !== 'draft') fail('STATUS', `This notice is already ${n.status}.`, 409)
  if (!scheduled && await c.db.prepare('SELECT id FROM lk_notice_plans WHERE id=?').bind(n.id).first()) fail('APPROVAL', 'Approve this prepared draft with its exact method, PDF and local schedule.', 409)
  // The drafter is whoever prepared the text: the proposal's preparer when it came through one.
  const drafter = n.proposal_id ? (await c.db.prepare('SELECT prepared_by FROM lk_proposals WHERE id=?').bind(n.proposal_id).first<{ prepared_by: string }>())?.prepared_by : null
  if (c.actor.role !== 'owner' && (n.prepared_by === c.actor.id || drafter === c.actor.id)) fail('SELF_APPROVAL', 'Another approver or the owner must approve a notice you prepared.', 403)
  const letter = await c.db.prepare('SELECT sha256 FROM lk_notice_letters WHERE id=?').bind(n.id).first<{ sha256: string }>()
  if (!letter) fail('LETTER', 'Prepare and review the PDF letter before approval.', 409)
  return { allowed: may.renewalDecision, result: { id: n.id, status: 'approved', pdfDigest: letter.sha256 }, writes: [sql("UPDATE lk_notices SET status='approved', approved_by=?, approved_at=? WHERE id=?", c.actor.id, c.now, n.id), bump(c, a)], checks: [...agreementGuards(c, a), sql("(SELECT status FROM lk_notices WHERE id=?)='draft'", n.id)], audit: [{ action: 'notice.approve', agreementId: a.id, summary: 'Approved notice for sending (not yet sent)' }] }
}

/** Separate evidence that the approved notice actually went out. */
const recordSent: Handler = async (c, p) => {
  requireRole(c.actor, may.signature, 'record that a notice was sent')
  const { n, a } = await noticeOf(c, p.noticeId)
  if (n.status !== 'approved') fail('STATUS', n.status === 'draft' ? 'Approve the notice before recording that it was sent.' : 'This notice is already recorded as sent.', 409)
  const plan = await c.db.prepare('SELECT * FROM lk_notice_plans WHERE id=?').bind(n.id).first<any>()
  const source = plan ? await c.db.prepare('SELECT * FROM lk_notice_sources WHERE id=?').bind(plan.source_id).first<any>() : null
  const sentAt = text(p, 'sentAt', 40)
  const at = Date.parse(sentAt)
  if (Number.isNaN(at)) fail('INVALID', 'sentAt must be a date and time.', 400)
  const method = oneOf(p, 'method', ['email', 'post', 'courier', 'hand', 'portal'] as const)
  if (plan && (plan.status !== 'ready' || method !== plan.method || at < plan.send_at || at > c.now || at >= source.deadline_at)) fail('APPROVAL', 'Record only the approved method after its scheduled time and before the deadline.', 409)
  const writes: Sql[] = initialTracking(c, p, n, method)
  let evidenceId: string | null = null
  if (p.evidence) {
    const stored = await storeArtifact(fileInput(p.evidence, 'evidence'), { agreementId: a.id, role: 'notice_evidence', provenance: { notice: n.id, method }, actorId: c.actor.id, at: c.now })
    writes.push(...stored.writes)
    evidenceId = stored.id
  }
  writes.push(sql("UPDATE lk_notices SET status='sent', sent_method=?, sent_at=?, sent_recorded_by=?, evidence_artifact_id=? WHERE id=?", method, at, c.actor.id, evidenceId, n.id), bump(c, a))
  return { allowed: may.signature, result: { id: n.id, status: 'sent' }, writes, checks: [...agreementGuards(c, a), sql("(SELECT status FROM lk_notices WHERE id=?)='approved'", n.id), sql('NOT EXISTS(SELECT 1 FROM lk_notice_dispatches WHERE notice_id=?)', n.id), ...(source ? sourceChecks(source) : [])], audit: [{ action: 'notice.sent', agreementId: a.id, summary: `Recorded notice sent by ${method} on ${zoned(at, a.timezone)}${evidenceId ? ' with evidence' : ''}` }] }
}

export const obligationHandlers: Record<string, Handler> = {
  'term.propose': proposeTerm,
  'term.decide': decideTerm,
  'obligation.add': addObligation,
  'obligation.update': updateObligation,
  'renewal.decide': decideRenewal,
  'notice.prepare': prepareNotice,
  'notice.approve': approveNotice,
  'notice.sent': recordSent,
}
