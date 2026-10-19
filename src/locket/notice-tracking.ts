import { may, requireRole } from './access'
import type { Ctx, Handler } from './commands'
import { fail, json, oneOf, optionalText, sql, text } from './model'
import { agreementGuards, bump, visibleAgreement } from './records'

export function initialTracking(c: Ctx, p: Record<string, unknown>, n: { id: string; agreement_id: string }, method: string) {
  const tracking = optionalText(p, 'trackingNumber', 200)
  if (!tracking) return [] // Older/manual sending remains available without a tracking receipt.
  if (!['post', 'courier'].includes(method)) fail('INVALID', 'Tracking numbers belong to mail or courier notices.')
  return [sql("INSERT INTO lk_notice_tracking VALUES(?,?,?,'unconfirmed',NULL,?)", n.id, n.agreement_id, tracking, 'Manually recorded sending; delivery unconfirmed.')]
}

export const trackNotice: Handler = async (c, p) => {
  requireRole(c.actor, may.signature, 'record notice delivery evidence')
  const n = await c.db.prepare('SELECT * FROM lk_notices WHERE id=?').bind(p.noticeId).first<any>()
  if (!n) fail('NOT_FOUND', 'No such notice.', 404)
  const a = await visibleAgreement(c, n.agreement_id)
  if (n.status !== 'sent' || !['post', 'courier'].includes(n.sent_method)) fail('STATUS', 'Manual tracking is for notices recorded as sent by mail or courier.', 409)
  const trackingNumber = text(p, 'trackingNumber', 200)
  const status = oneOf(p, 'status', ['unconfirmed', 'delivered'] as const)
  const detail = text(p, 'detail', 2000)
  const at = status === 'delivered' ? Date.parse(text(p, 'deliveredAt', 40)) : null
  if (status === 'delivered' && (!Number.isFinite(at) || at! < n.sent_at || at! > c.now)) fail('INVALID', 'Delivery time must be after sending and no later than now.')
  const previous = await c.db.prepare('SELECT * FROM lk_notice_tracking WHERE id=?').bind(n.id).first<any>()
  if (previous?.status === 'delivered') fail('STATUS', 'Delivered evidence is already recorded; its history cannot be replaced.', 409)
  const id = crypto.randomUUID()
  return { allowed: may.signature, result: { id: n.id, status }, writes: [
    sql('INSERT INTO lk_notice_tracking VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET tracking_number=excluded.tracking_number,status=excluded.status,delivered_at=excluded.delivered_at,detail=excluded.detail', n.id, a.id, trackingNumber, status, at, detail),
    sql('INSERT INTO lk_notice_events VALUES(?,?,?,?,?,?,?,?,?)', id, n.id, a.id, status, at ?? c.now, 'manual', detail, json({ trackingNumber, status, at, detail }), c.now), bump(c, a),
  ], checks: [...agreementGuards(c, a), sql("(SELECT status FROM lk_notices WHERE id=?)='sent'", n.id), sql("NOT EXISTS(SELECT 1 FROM lk_notice_tracking WHERE id=? AND status='delivered')", n.id)], audit: [{ action: 'notice.tracking', agreementId: a.id, summary: `Manually recorded ${status} tracking evidence; legal effectiveness is not determined.` }] }
}
