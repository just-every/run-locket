import { may, requireRole } from './access'
import { PDF, storeArtifact } from './artifacts'
import type { Ctx, Handler } from './commands'
import { fail, sql } from './model'
import { textPdf } from './pdf'
import { agreementGuards, bump, visibleAgreement } from './records'

export async function frozenLetter(c: Ctx, n: { id: string; agreement_id: string; recipient: string; body: string }) {
  const stored = await storeArtifact({ filename: 'notice.pdf', mediaType: PDF, bytes: textPdf('Notice', `To: ${n.recipient}\n\n${n.body}`, 'Locket notice letter') }, { agreementId: n.agreement_id, role: 'rendition', provenance: { kind: 'notice_letter', noticeId: n.id }, actorId: c.actor.id, at: c.now })
  return { digest: stored.sha256, writes: [...stored.writes, sql('INSERT INTO lk_notice_letters VALUES(?,?,?,?,?)', n.id, n.agreement_id, stored.id, stored.sha256, n.recipient)] }
}

export const prepareLetter: Handler = async (c, p) => {
  requireRole(c.actor, may.review, 'prepare a notice letter')
  const n = await c.db.prepare('SELECT * FROM lk_notices WHERE id=?').bind(p.noticeId).first<any>()
  if (!n) fail('NOT_FOUND', 'No such notice.', 404)
  const a = await visibleAgreement(c, n.agreement_id)
  if (n.status !== 'draft') fail('STATUS', 'Only a draft can acquire a new letter. Prepare a new notice for a new approval.', 409)
  if (await c.db.prepare('SELECT id FROM lk_notice_letters WHERE id=?').bind(n.id).first()) fail('STATUS', 'This notice already has its frozen letter.', 409)
  const letter = await frozenLetter(c, n)
  return { allowed: may.review, result: { id: n.id, pdfDigest: letter.digest }, writes: [...letter.writes, bump(c, a)], checks: [...agreementGuards(c, a), sql("(SELECT status FROM lk_notices WHERE id=?)='draft'", n.id)], audit: [{ action: 'notice.letter', agreementId: a.id, summary: 'Prepared the frozen notice PDF for review before approval.' }] }
}
