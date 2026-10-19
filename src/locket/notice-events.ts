import type { Bindings } from '../auth.server'
import { verifyWebhook } from '../modules/mail/src/events/verify.mjs'
import { fail, object, sha256, text } from './model'
import type { Dispatch } from './notice-mail'

/** Provider-authenticated HTTP door, deliberately outside session/Origin checks.
 * Exact signed bytes are retained. Event identity collisions cannot rewrite evidence. */
export async function noticeEventResponse(request: Request, env: Bindings): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/locket/notice-events/resend') return null
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const raw = new Uint8Array(await request.arrayBuffer())
  if (raw.length > 64 * 1024) fail('SIZE', 'Delivery event is too large.', 413)
  const now = Date.now()
  if (!env.NOTICE_RESEND_WEBHOOK_SECRET || !await verifyWebhook({ provider: 'resend', rawBody: raw, headers: request.headers, key: env.NOTICE_RESEND_WEBHOOK_SECRET, now })) fail('SIGNATURE', 'Invalid provider event signature.', 401)
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) } catch { fail('INVALID', 'Invalid event JSON.') }
  const event = object(parsed), data = object(event.data)
  const status = ({ 'email.delivered': 'delivered', 'email.bounced': 'bounced', 'email.delivery_delayed': 'deferred', 'email.failed': 'failed' } as Record<string, string>)[text(event, 'type', 60)]
  if (!status) fail('INVALID', 'Subscribe this endpoint to delivered, bounced, delayed and failed events only.')
  const messageId = text(data, 'email_id', 200)
  const row = await env.DB.prepare("SELECT * FROM lk_notice_dispatches WHERE provider='resend' AND provider_message_id=? AND status='accepted'").bind(messageId).first<Dispatch>()
  if (!row || !Array.isArray(data.to) || data.to.length !== 1 || data.to[0] !== row.recipient) fail('EVENT', 'Event does not match a notice message and recipient.', 409)
  const occurred = Date.parse(text(event, 'created_at', 60))
  if (!Number.isFinite(occurred) || occurred < 0 || occurred > now + 300_000) fail('INVALID', 'Invalid event time.')
  const id = text({ id: request.headers.get('svix-id') }, 'id', 512)
  const fingerprint = await sha256(raw)
  const previous = await env.DB.prepare('SELECT fingerprint FROM lk_notice_events WHERE id=?').bind(id).first<{ fingerprint: string }>()
  if (previous && previous.fingerprint !== fingerprint) fail('EVENT_COLLISION', 'A different event already has that provider identity.', 409)
  // The insert and attributed audit are atomic. An identical provider retry is a no-op.
  const detail = new TextDecoder().decode(raw)
  await env.DB.batch([
    env.DB.prepare("INSERT INTO lk_audit SELECT ?,?,'provider:resend','Resend','provider','notice.delivery',?,?,? WHERE NOT EXISTS(SELECT 1 FROM lk_notice_events WHERE id=?)").bind(crypto.randomUUID(), now, row.agreement_id, `Provider reported notice ${status}; not a legal-service determination.`, id, id),
    env.DB.prepare("INSERT INTO lk_notice_events VALUES(?,?,?,?,?,'provider',?,?,?) ON CONFLICT(id) DO UPDATE SET fingerprint=CASE WHEN fingerprint=excluded.fingerprint THEN fingerprint ELSE NULL END").bind(id, row.notice_id, row.agreement_id, status, occurred, detail, fingerprint, now),
  ])
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
}
