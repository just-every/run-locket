import { createHmac, randomBytes } from 'node:crypto'
import { file, pdf } from './files.mjs'

export const webhookKey = () => `whsec_${randomBytes(32).toString('base64')}`
export async function noticeFixture(owner, tag = 'Notice', { restricted = false } = {}) {
  const a = await owner.command('legacy.import', { title: `${tag} supplier agreement`, restricted, type: 'supplier', party: { name: 'Cardinal Supply', kind: 'supplier' }, sourceSystem: 'Historical archive', sourceId: crypto.randomUUID(), file: file('signed.pdf', pdf(`${tag}: The agreement ends December 31. Give 60 days notice.`)), text: `${tag}: The agreement ends December 31. Give 60 days notice.`, signed: true })
  for (const [key, value] of [['end_date', '2026-12-31'], ['notice_days', '60']]) {
    const t = await owner.command('term.propose', { agreementId: a.id, key, value, citation: { quote: 'Give 60 days notice.' } })
    await owner.command('term.decide', { agreementId: a.id, termId: t.id, decision: 'confirm' })
  }
  const renewal = (await owner.state()).renewals.find(r => r.agreement_id === a.id)
  await owner.command('renewal.decide', { renewalId: renewal.id, decision: 'terminate', reason: 'Supplier replacement approved.' })
  return { agreementId: a.id, renewalId: renewal.id }
}
export const prepare = (client, renewalId, recipient = 'notices@cardinal.example') => client.command('notice.prepare', { renewalId, recipient, body: 'We give notice of termination at the end of the current term, December 31, 2026.' })

export function signedEvent(key, messageId, { id = crypto.randomUUID(), type = 'email.delivered', to = 'notices@cardinal.example', timestamp = Math.floor(Date.now() / 1000), createdAt = new Date().toISOString() } = {}) {
  const raw = JSON.stringify({ type, created_at: createdAt, data: { email_id: messageId, to: [to] } })
  const signature = createHmac('sha256', Buffer.from(key.slice(6), 'base64')).update(`${id}.${timestamp}.${raw}`).digest('base64')
  return { raw, headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${signature}` } }
}
export const postEvent = (h, event) => h.mf.dispatchFetch(h.origin + '/api/locket/notice-events/resend', { method: 'POST', headers: event.headers, body: event.raw })
