import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { installation } from './harness.mjs'
import { file, pdf } from './files.mjs'

const find = async (client, id) => (await client.state()).agreements.find(a => a.id === id)
async function review(client, { restricted = false, title = 'Confidential acquisition 940271' } = {}) {
  const created = await client.command('request.create', { title, type: 'nda', restricted, value: '940271', party: { name: `Private party ${randomUUID()}`, kind: 'customer' }, file: file('nda.pdf', pdf('Mutual confidentiality agreement.')), text: 'Mutual confidentiality agreement.' })
  const a = await find(client, created.id)
  await client.command('agreement.submit', { agreementId: a.id, version: a.version })
  return find(client, a.id)
}
const payload = (a, recipientId) => ({ agreementId: a.id, version: a.version, versionId: a.current_version_id, recipientId })

test('MOBILE-001 emails a generic authenticated review link once, then records the exact version through the normal approval command', async t => {
  const h = await installation(); t.after(() => h.close())
  const requester = await h.invite('requester@example.test', 'requester')
  const approver = await h.invite('approver@example.test', 'approver')
  const a = await review(requester), state = await requester.state(), version = state.versions.find(v => v.id === a.current_version_id)
  const count = h.mails.length, commandId = randomUUID()
  const concurrent = await Promise.all([requester.command('approval.email', payload(a, approver.id), { commandId }), requester.command('approval.email', payload(a, approver.id), { commandId })])
  assert.ok(concurrent.every(result => ['sending', 'accepted'].includes(result.status)))
  const sent = await requester.command('approval.email', payload(a, approver.id), { commandId })
  assert.equal(sent.status, 'accepted')
  assert.ok(sent.providerMessageId)
  assert.equal(h.mails.length, count + 1)
  const received = h.mails.at(-1), link = received.text.match(/https?:\/\/[^\s]+/)[0]
  assert.deepEqual(received.to, ['approver@example.test'])
  assert.equal(link, `${h.origin}/app#agreement/${a.id}/review`)
  assert.equal(sent.reviewUrl, link)
  for (const content of [received.subject, received.text, received.html]) {
    assert.ok(!content.includes(a.title))
    assert.ok(!content.includes('940271'))
    assert.ok(!content.includes(version.digest))
  }
  assert.deepEqual(await requester.command('approval.email', payload(a, approver.id), { commandId }), sent)
  assert.equal(h.mails.length, count + 1)
  const unauthorized = await h.request('/api/locket/state')
  assert.equal(unauthorized.status, 401)
  const opened = await find(approver, new URL(link).hash.split('/')[1])
  const approved = await approver.command('approval.decide', { agreementId: opened.id, version: opened.version, versionId: opened.current_version_id, kind: 'commercial', decision: 'approved' })
  assert.equal(approved.versionDigest, version.digest)
  assert.equal(approved.status, 'approved')
  assert.ok((await requester.state()).audit.some(e => e.action === 'approval.email.accepted' && e.agreement_id === a.id))
  const archive = await (await h.owner.request('/api/locket/export')).json()
  assert.equal(archive.records.lk_approval_mail.find(r => r.id === commandId).provider_message_id, sent.providerMessageId)
  const stale = await review(requester)
  await requester.command('approval.email', payload(stale, approver.id))
  await requester.command('version.upload', { agreementId: stale.id, version: stale.version, kind: 'counterparty', file: file('new.pdf', pdf('Replaced confidentiality agreement.')), text: 'Replaced confidentiality agreement.' })
  await approver.command('approval.decide', { agreementId: stale.id, version: stale.version, versionId: stale.current_version_id, kind: 'commercial', decision: 'approved' }, { error: 'NOT_CURRENT' })
  assert.notEqual((await find(approver, stale.id)).current_version_id, stale.current_version_id)
})

test('approval email checks sender, recipient role, current version, self-approval and restricted visibility on the server', async t => {
  const h = await installation(); t.after(() => h.close())
  const requester = await h.invite('requester@example.test', 'requester'), approver = await h.invite('approver@example.test', 'approver')
  const viewer = await h.invite('viewer@example.test', 'viewer'), agent = await h.invite('agent@example.test', 'agent')
  const a = await review(requester), count = h.mails.length
  for (const sender of [viewer, agent]) await sender.command('approval.email', payload(a, approver.id), { error: 'FORBIDDEN' })
  for (const id of [viewer.id, requester.id, randomUUID()]) await requester.command('approval.email', payload(a, id), { error: 'RECIPIENT' })
  await requester.command('approval.email', { ...payload(a, approver.id), versionId: randomUUID() }, { error: 'NOT_CURRENT' })
  await requester.command('approval.email', { ...payload(a, approver.id), version: a.version + 1 }, { error: 'STALE' })
  const privateAgreement = await review(requester, { restricted: true })
  await requester.command('approval.email', payload(privateAgreement, approver.id), { error: 'RECIPIENT' })
  await approver.command('approval.email', payload(privateAgreement, approver.id), { error: 'NOT_FOUND' })
  await h.owner.command('role.set', { operatorId: approver.id, role: 'viewer' })
  await requester.command('approval.email', payload(a, approver.id), { error: 'RECIPIENT' })
  assert.equal(h.mails.length, count)
  const self = await h.invite('self@example.test', 'approver'), own = await review(self)
  await self.command('approval.email', payload(own, self.id), { error: 'RECIPIENT' })
  const ownerId = (await h.owner.state()).actor.id
  assert.equal((await requester.command('approval.email', payload(privateAgreement, ownerId))).status, 'accepted')
})

test('MOBILE-001 local suppression and uncertain provider outcomes never claim sending or resend on replay', async t => {
  const h = await installation({ bindings: { AUTH_LOCAL: 'true' } }); t.after(() => h.close())
  const a = await review(h.owner), ownerId = (await h.owner.state()).actor.id, commandId = randomUUID()
  const sent = await h.owner.command('approval.email', payload(a, ownerId), { commandId })
  assert.equal(sent.status, 'suppressed')
  assert.equal(sent.providerMessageId, null)
  assert.equal(h.mails.length, 0)
  assert.deepEqual(await h.owner.command('approval.email', payload(a, ownerId), { commandId }), sent)
  assert.ok((await h.owner.state()).audit.some(e => e.action === 'approval.email.suppressed'))
  const failed = await installation({ mailResponse: () => new Response('Provider unavailable', { status: 503 }) }); t.after(() => failed.close())
  const pending = await review(failed.owner), recipientId = (await failed.owner.state()).actor.id, failedId = randomUUID()
  const outcome = await failed.owner.command('approval.email', payload(pending, recipientId), { commandId: failedId })
  assert.equal(outcome.status, 'uncertain'); assert.equal(outcome.providerMessageId, null)
  assert.deepEqual(await failed.owner.command('approval.email', payload(pending, recipientId), { commandId: failedId }), outcome)
  assert.equal(failed.mails.length, 1)
  assert.ok((await failed.owner.state()).audit.some(e => e.action === 'approval.email.uncertain'))
})
