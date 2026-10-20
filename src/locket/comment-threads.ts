import { may, requireRole } from './access'
import type { Handler } from './commands'
import { fail, integer, sql, text } from './model'
import { agreementGuards, visibleAgreement } from './records'

export const resolveComment: Handler = async (c, p) => {
  requireRole(c.actor, may.review, 'resolve comment threads')
  const a = await visibleAgreement(c, p.agreementId)
  const id = text(p, 'commentId', 100), revision = integer(p, 'revision', 1)
  const root = await c.db.prepare('SELECT * FROM lk_comments WHERE id=? AND agreement_id=? AND parent_id IS NULL').bind(id, a.id).first<any>()
  if (!root) fail('NOT_FOUND', 'That comment thread is not on this agreement.', 404)
  if (root.revision !== revision) fail('STALE', 'This thread changed. Reload before resolving.', 409)
  return { allowed: may.review, result: { commentId: id }, writes: [sql('UPDATE lk_comments SET resolved_by=?, resolved_at=?, revision=revision+1 WHERE id=?', c.actor.id, c.now, id)], checks: [...agreementGuards(c, a), sql('(SELECT revision FROM lk_comments WHERE id=?)=?', id, revision)], audit: [{ action: 'comment.resolve', agreementId: a.id, summary: `Resolved comment thread on version ${root.version_id}` }] }
}
