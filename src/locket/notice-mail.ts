import { operatorMail } from '../mail.server.mjs'
import { may, requireRole, visibleSql } from './access'
import { readArtifactBytes } from './artifacts'
import { auditSql, commit, guardSql, type Ctx, type Handler } from './commands'
import { fail, Problem, sha256, sql, type Sql } from './model'
import { agreementGuards, visibleAgreement } from './records'

export interface Dispatch {
  id: string; notice_id: string; agreement_id: string; agreement_version: number; actor_id: string
  recipient: string; sender: string; pdf_artifact_id: string; pdf_sha256: string; subject: string; message_text: string
  status: string; provider: string | null; provider_message_id: string | null; code: string | null; attempt_id: string | null
}
const local = (c: Ctx) => c.env.AUTH_LOCAL === 'true' || (c.env as { RER_DEMO?: string }).RER_DEMO === '1'

export const emailNotice: Handler = async (c, p) => {
  requireRole(c.actor, may.signature, 'send an approved notice')
  const n = await c.db.prepare('SELECT * FROM lk_notices WHERE id=?').bind(p.noticeId).first<any>()
  if (!n) fail('NOT_FOUND', 'No such notice.', 404)
  const a = await visibleAgreement(c, n.agreement_id)
  if (await c.db.prepare('SELECT id FROM lk_notice_plans WHERE id=?').bind(n.id).first()) fail('APPROVAL', 'This notice sends only through its approved schedule.', 409)
  if (n.status !== 'approved') fail('STATUS', 'Approve the exact PDF and recipient before sending.', 409)
  const letter = await c.db.prepare('SELECT * FROM lk_notice_letters WHERE id=?').bind(n.id).first<any>()
  if (!letter) fail('LETTER', 'This older approval has no frozen PDF. Prepare and approve a new notice before emailing it.', 409)
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(letter.recipient)) fail('RECIPIENT', 'Prepare a notice addressed to one email address before email approval.', 400)
  if (!local(c) && (c.env.MAIL_PROVIDER !== 'resend' || !operatorMail(c.env) || !c.env.MAIL_FROM || !c.env.NOTICE_RESEND_WEBHOOK_SECRET)) fail('MAIL_UNAVAILABLE', 'Configure Resend mail and its notice webhook signing secret before sending notices.', 503)
  if (await c.db.prepare('SELECT id FROM lk_notice_dispatches WHERE notice_id=?').bind(n.id).first()) fail('STATUS', 'This notice already has a send request. Inspect its outcome before preparing another notice.', 409)
  return {
    allowed: may.signature, result: { id: c.commandId, noticeId: n.id, status: 'queued', pdfDigest: letter.sha256 },
    writes: [sql("INSERT INTO lk_notice_dispatches(id,notice_id,agreement_id,agreement_version,actor_id,recipient,pdf_artifact_id,pdf_sha256,sender,subject,message_text,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued',?)", c.commandId, n.id, a.id, a.version, c.actor.id, letter.recipient, letter.artifact_id, letter.sha256, c.env.MAIL_FROM ?? '', 'Contract notice', 'Please find the approved notice letter attached.', c.now)],
    checks: [...agreementGuards(c, a), sql("(SELECT status FROM lk_notices WHERE id=?)='approved'", n.id), sql('(SELECT sha256 FROM lk_notice_letters WHERE id=?)=?', n.id, letter.sha256)],
    audit: [{ action: 'notice.email.requested', agreementId: a.id, summary: 'Requested email of the exact approved PDF to its approved recipient; not yet sent.' }],
  }
}

/** Single-use provider claim. The immutable command result stays queued; state
 * exposes the provider outcome separately. Interrupted sends never auto-retry. */
export async function dispatchNotice(c: Ctx, scheduledChecks?: Sql[]) {
  let row = await c.db.prepare('SELECT * FROM lk_notice_dispatches WHERE id=?').bind(c.commandId).first<Dispatch>()
  if (!row || row.status !== 'queued') return
  const attempt = crypto.randomUUID()
  const finish = async (status: string, provider: string | null, messageId: string | null, code: string | null) => {
    const previous = status === 'cancelled' ? 'queued' : 'sending'
    const token = status === 'cancelled' ? null : attempt
    const audit = auditSql(c, { action: `notice.email.${status}`, agreementId: row!.agreement_id, summary: status === 'accepted' ? 'Mail provider accepted the approved notice PDF; delivery unconfirmed.' : status === 'suppressed' ? 'Notice email suppressed locally; no email was sent.' : `Notice email outcome: ${status}.` })
    const owns = "EXISTS(SELECT 1 FROM lk_notice_dispatches WHERE id=? AND status=? AND attempt_id IS ?)"
    await c.db.batch([
      ...(status === 'accepted' ? [c.db.prepare(`UPDATE lk_notices SET status='sent',sent_method='email',sent_at=?,sent_recorded_by=? WHERE id=? AND ${owns}`).bind(Date.now(), c.actor.id, row!.notice_id, c.commandId, previous, token)] : []),
      c.db.prepare(`INSERT INTO lk_audit SELECT ${audit.params.map(() => '?').join(',')} WHERE ${owns}`).bind(...audit.params, c.commandId, previous, token),
      c.db.prepare('UPDATE lk_notice_dispatches SET status=?,provider=?,provider_message_id=?,code=? WHERE id=? AND status=? AND attempt_id IS ?').bind(status, provider, messageId, code, c.commandId, previous, token),
    ])
  }
  try {
    const claimChecks = [visibleSql(c.actor, row.agreement_id), sql('EXISTS(SELECT 1 FROM lk_agreements WHERE id=? AND version=?)', row.agreement_id, row.agreement_version), sql("(SELECT status FROM lk_notices WHERE id=?)='approved'", row.notice_id), sql('(SELECT sha256 FROM lk_notice_letters WHERE id=?)=?', row.notice_id, row.pdf_sha256), sql("(SELECT status FROM lk_notice_dispatches WHERE id=?)='queued'", c.commandId)]
    const claim = sql("UPDATE lk_notice_dispatches SET status='sending',attempt_id=?,attempted_at=? WHERE id=? AND status='queued'", attempt, c.now, c.commandId)
    if (scheduledChecks) {
      const guard = crypto.randomUUID()
      await c.db.batch([guardSql(guard, [...claimChecks, ...scheduledChecks]), claim, sql('DELETE FROM lk_guard WHERE id=?', guard)].map(s => c.db.prepare(s.sql).bind(...s.params)))
    } else await commit(c, may.signature, claimChecks, [claim])
  } catch (error) {
    if (!(error instanceof Problem) && !/LOCKET_GUARD/.test(String(error))) throw error
    return finish('cancelled', null, null, 'authority_or_record_changed')
  }
  row = (await c.db.prepare('SELECT * FROM lk_notice_dispatches WHERE id=?').bind(c.commandId).first<Dispatch>())!
  if (row.attempt_id !== attempt) return
  if (local(c)) return finish('suppressed', 'development', null, null)
  const sender = operatorMail(c.env)
  if (!sender || c.env.MAIL_PROVIDER !== 'resend' || !c.env.MAIL_FROM || !c.env.NOTICE_RESEND_WEBHOOK_SECRET) return finish('rejected', null, null, 'mail_unavailable')
  const bytes = await readArtifactBytes(c.db, row.pdf_artifact_id)
  if (await sha256(bytes) !== row.pdf_sha256) return finish('rejected', null, null, 'pdf_digest_mismatch')
  if (scheduledChecks) {
    const source = await c.db.prepare('SELECT s.deadline_at FROM lk_notice_plans p JOIN lk_notice_sources s ON s.id=p.source_id WHERE p.id=?').bind(row.notice_id).first<{deadline_at:number}>()
    if (!source || Date.now() >= source.deadline_at) return finish('rejected', null, null, 'deadline_passed')
  }
  try {
    const message = { deliveryId: row.id, from: row.sender, to: [row.recipient], subject: row.subject, text: row.message_text, html: '<p>Please find the approved notice letter attached.</p>', headers: {}, attachments: [{ filename: 'notice.pdf', contentType: 'application/pdf', content: bytes, disposition: 'attachment' }] }
    const sent = await sender.send(message)
    return finish(sent.status === 'development' ? 'suppressed' : sent.status, sent.provider, sent.providerMessageId, sent.code ?? null)
  } catch {
    return finish('uncertain', c.env.MAIL_PROVIDER ?? null, null, 'provider_outcome_unknown')
  }
}
