// AGENT-003: selected-source preparation and explicit approval of a frozen schedule.
import { may, requireRole } from './access'
import type { Ctx, Handler } from './commands'
import { fail, sql, text } from './model'
import { noticeDraft, approveNotice } from './obligations'
import { agreementGuards, bump, visibleAgreement } from './records'
import { reportInstant, localMinute } from './report-schedule'

export async function sourceOf(c: Ctx, id: unknown) {
  if (typeof id !== 'string' || !id) fail('CITATION', 'A person-selected sourceId is required.')
  const s = await c.db.prepare('SELECT * FROM lk_notice_sources WHERE id=?').bind(id).first<any>()
  if (!s) fail('NOT_FOUND', 'No selected notice passage.', 404)
  const a = await visibleAgreement(c, s.agreement_id)
  return { s, a }
}
export function sourceChecks(s: any) {
  return [sql('EXISTS(SELECT 1 FROM lk_agreements WHERE id=? AND current_version_id=? AND party_id=? AND status IN (\'executed\',\'imported\'))', s.agreement_id, s.version_id, s.party_id),
    sql('EXISTS(SELECT 1 FROM lk_renewals WHERE id=? AND decision=? AND decided_at=? AND deadline_at=?)', s.renewal_id, s.decision, s.decided_at, s.deadline_at),
    sql('EXISTS(SELECT 1 FROM lk_parties WHERE id=? AND version=? AND merged_into IS NULL)', s.party_id, s.party_version)]
}
const selectSource: Handler = async (c, p) => {
  requireRole(c.actor, may.review, 'select the executed notice passage')
  const a = await visibleAgreement(c, p.agreementId)
  const r = await c.db.prepare('SELECT * FROM lk_renewals WHERE agreement_id=?').bind(a.id).first<any>()
  if (!['executed', 'imported'].includes(a.status) || !r?.decision || r.deadline_at <= c.now) fail('STATUS', 'Select a current executed agreement with a confirmed future deadline and recorded decision.', 409)
  const v = await c.db.prepare('SELECT text FROM lk_versions WHERE id=?').bind(a.current_version_id).first<any>()
  const quote = text(p, 'quote', 4000)
  if (!v?.text?.includes(quote)) fail('CITATION', 'Select an exact passage from the executed text rendition.')
  const party = await c.db.prepare('SELECT * FROM lk_parties WHERE id=?').bind(a.party_id).first<any>()
  if (!party?.email || !party.notice_address || party.merged_into) fail('RECIPIENT', 'Record the counterparty email and courier notice address before selecting its notice source.', 409)
  const id = crypto.randomUUID()
  return { allowed: may.review, result: { id }, writes: [sql('INSERT INTO lk_notice_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, a.id, r.id, a.current_version_id, quote, r.decision, r.deadline_at, r.decided_at, party.id, party.version, party.email, party.notice_address, c.actor.id, c.now)],
    checks: [...agreementGuards(c, a), ...sourceChecks({ ...r, agreement_id: a.id, version_id: a.current_version_id, party_id: party.id, party_version: party.version, renewal_id: r.id })],
    audit: [{ action: 'notice.source', agreementId: a.id, summary: 'Person selected an exact executed passage, confirmed decision/deadline and recorded notice addresses.' }] }
}
export function preparedNoticeText(s: any, endDate: string) {
  return `Prepared draft, not legal advice or proof of service.\n\nWe give notice of our recorded decision to ${s.decision} the agreement whose current term ends ${endDate}.\n\nSelected notice passage: “${s.quote}”\n\nPlease acknowledge receipt. Counsel must judge the adequacy of this notice.`
}
export async function agentDraft(c: Ctx, s: any, method: string, parent: string | null, proposalId: string | null = null) {
  const r = await c.db.prepare('SELECT end_date FROM lk_renewals WHERE id=?').bind(s.renewal_id).first<any>()
  const recipient = method === 'email' ? s.recipient : s.alternate_address
  const body = preparedNoticeText(s, r.end_date)
  const n = await noticeDraft(c, s.renewal_id, { recipient, body }, proposalId)
  return { n, writes: [...n.writes, ...(parent ? [sql('UPDATE lk_notices SET prepared_by=? WHERE id=?','locket-scheduler',n.id)] : []), sql("INSERT INTO lk_notice_plans(id,agreement_id,source_id,parent_notice_id,method,status) VALUES(?,?,?,?,?,'draft')", n.id, s.agreement_id, s.id, parent, method)] }
}
const prepareAgent: Handler = async (c, p) => {
  requireRole(c.actor, may.prepare, 'prepare a notice from a person-selected passage')
  const { s, a } = await sourceOf(c, p.sourceId)
  if (s.deadline_at <= c.now) fail('DEADLINE', 'This selected deadline has passed.', 409)
  const { n, writes } = await agentDraft(c, s, 'email', null)
  return { allowed: may.prepare, result: { id: n.id, status: 'draft' }, writes: [...writes, bump(c, a)], checks: [...agreementGuards(c, a), ...sourceChecks(s)], audit: [{ action: 'notice.agent.prepare', agreementId: a.id, summary: 'Prepared draft, not legal advice or proof of service; no sending authority.' }] }
}
const approveSchedule: Handler = async (c, p) => {
  requireRole(c.actor, may.renewalDecision, 'approve a notice schedule')
  const plan = await c.db.prepare('SELECT * FROM lk_notice_plans WHERE id=?').bind(p.noticeId).first<any>()
  if (!plan || plan.status !== 'draft') fail('STATUS', 'Only a prepared draft can acquire its exact sending approval.', 409)
  const { s, a } = await sourceOf(c, plan.source_id)
  const letter = await c.db.prepare('SELECT * FROM lk_notice_letters WHERE id=?').bind(plan.id).first<any>()
  if (p.pdfDigest !== letter.sha256 || p.recipient !== letter.recipient || p.method !== plan.method) fail('APPROVAL', 'Review the exact frozen PDF digest, recipient and proposed method.', 409)
  const local = text(p, 'sendLocal', 16)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) fail('INVALID', 'Choose a local sending date and time.')
  const at = reportInstant(local, a.timezone)
  if (localMinute(at, a.timezone) !== local || at <= c.now || at + 3_600_000 >= s.deadline_at) fail('DEADLINE', 'Choose a valid future time with more than one hour before the confirmed deadline.', 409)
  const watchAt = Math.min(at + 86_400_000, s.deadline_at - 3_600_000)
  const out = await approveNotice(c, p, true)
  return { ...out, result: { id: plan.id, status: 'scheduled', sendAt: at, watchAt, marginMs: s.deadline_at - at },
    writes: [...out.writes, sql("UPDATE lk_notice_plans SET status='scheduled',send_local=?,timezone=?,send_at=?,watch_at=?,approved_by=?,operator_version=?,agreement_version=?,pdf_sha256=?,recipient=? WHERE id=?", local, a.timezone, at, watchAt, c.actor.id, c.actor.operatorVersion, a.version + 1, letter.sha256, letter.recipient, plan.id)],
    checks: [...(out.checks ?? []), ...sourceChecks(s), sql("(SELECT status FROM lk_notice_plans WHERE id=?)='draft'", plan.id)],
    audit: [...out.audit, { action: 'notice.schedule', agreementId: a.id, summary: `Approved exact PDF, ${plan.method}, recipient and local send ${local} ${a.timezone}; ${(s.deadline_at-at)/3_600_000} hours lead margin.` }] }
}
const acknowledge: Handler = async (c, p) => {
  requireRole(c.actor, may.signature, 'record notice acknowledgment')
  const plan = await c.db.prepare('SELECT * FROM lk_notice_plans WHERE id=?').bind(p.noticeId).first<any>()
  if (!plan) fail('NOT_FOUND', 'No notice watch.', 404)
  const a = await visibleAgreement(c, plan.agreement_id)
  const n = await c.db.prepare('SELECT status FROM lk_notices WHERE id=?').bind(plan.id).first<any>()
  if (n.status !== 'sent' || plan.acknowledged_at) fail('STATUS', 'Record acknowledgment once, after sending.', 409)
  return { allowed: may.signature, result: { id: plan.id }, writes: [sql('UPDATE lk_notice_plans SET acknowledged_at=?,acknowledgment=? WHERE id=?', c.now, text(p, 'detail', 2000), plan.id)], checks: [...agreementGuards(c,a),sql('(SELECT acknowledged_at FROM lk_notice_plans WHERE id=?) IS NULL',plan.id)], audit: [{action:'notice.acknowledgment',agreementId:a.id,summary:'Person recorded recipient acknowledgment evidence; not proof of legal service.'}] }
}
export const noticeAgentHandlers: Record<string, Handler> = { 'notice.source': selectSource, 'notice.agent.prepare': prepareAgent, 'notice.schedule': approveSchedule, 'notice.acknowledge': acknowledge }
