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

export const localMinute = (at, zone) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at).map(p => [p.type,p.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
export async function agentFixture(h, tag = 'Agent notice', restricted = false) {
  // Decision exactly 45 days before November 1, 23:59:59 Eastern.
  const deadline = Date.parse('2026-11-02T04:59:59Z'), now = deadline - 45 * 86400000
  await h.setTime(now)
  const f = await noticeFixture(h.owner, tag, { restricted })
  const s = await h.owner.state(), a = s.agreements.find(a=>a.id===f.agreementId), party=s.parties.find(p=>p.id===a.party_id)
  await h.owner.command('party.save',{id:party.id,version:party.version,name:party.name,kind:'supplier',email:'notices@cardinal.example',noticeAddress:'Cardinal Legal, 10 Main St, Raleigh NC',noticeMethod:'email',contacts:[],signatories:[]})
  const source=await h.owner.command('notice.source',{agreementId:a.id,quote:'Give 60 days notice.'})
  return {...f,sourceId:source.id,deadline,now,timezone:a.timezone}
}
export async function approveAgent(owner, id, at) {
  const s=await owner.state(),plan=s.noticePlans.find(p=>p.id===id),letter=s.noticeLetters.find(l=>l.id===id),a=s.agreements.find(a=>a.id===plan.agreement_id)
  return owner.command('notice.schedule',{noticeId:id,pdfDigest:letter.sha256,recipient:letter.recipient,method:plan.method,sendLocal:localMinute(at,a.timezone)})
}
