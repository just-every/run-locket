// Authority is checked in every handler from the current session, not by the
// screens: signed-out, cross-site, revoked, demoted and wrong-role requests fail,
// and a retried command can never apply twice.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { installation } from './harness.mjs'
import { file, find, library, pdf, submitted, team } from './setup.mjs'

test('sessions, roles, idempotent commands and stale writes are enforced by the server', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const viewer = await h.invite('viewer@example.test', 'viewer')
  const agent = await h.invite('agent@example.test', 'agent')
  const lib = await library(h, tm)

  // Signed out and cross-site requests are refused before any work.
  assert.equal((await h.request('/api/locket/state')).status, 401)
  assert.equal((await h.request('/api/locket/commands', { method: 'POST', body: { commandId: randomUUID(), type: 'party.save', payload: { name: 'X', kind: 'other' } } })).status, 401)
  const crossSite = await h.owner.request('/api/locket/commands', { method: 'POST', headers: { origin: 'https://attacker.example' }, body: { commandId: randomUUID(), type: 'party.save', payload: { name: 'X', kind: 'other' } } })
  assert.equal(crossSite.status, 403)

  // Viewers read; agents prepare; neither writes agreements or approves.
  const id = await submitted(h, tm, lib)
  const a = await find(viewer, id)
  await viewer.command('request.create', { title: 'x', type: 'nda', party: { name: 'y', kind: 'other' } }, { error: 'FORBIDDEN' })
  await agent.command('request.create', { title: 'x', type: 'nda', party: { name: 'y', kind: 'other' } }, { error: 'FORBIDDEN' })
  await agent.command('approval.decide', { agreementId: id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' }, { error: 'FORBIDDEN' })
  await agent.command('role.set', { operatorId: agent.id, role: 'counsel' }, { error: 'FORBIDDEN' })
  await tm.counsel.command('role.set', { operatorId: viewer.id, role: 'approver' }, { error: 'FORBIDDEN' })
  const intake = await agent.command('proposal.prepare', { kind: 'intake', payload: { title: 'Prepared NDA', type: 'nda', party: { name: 'Prepared Co', kind: 'partner' } }, evidence: ['Email from Prepared Co asking for an NDA'] })
  await agent.command('proposal.decide', { proposalId: intake.id, decision: 'approve' }, { error: 'FORBIDDEN' })
  assert.equal((await h.owner.state()).agreements.length, 1)

  // The same command identity returns its first outcome; different content is refused.
  const commandId = randomUUID()
  const first = await tm.requester.command('party.save', { name: 'Idempotent Pty Ltd', kind: 'customer' }, { commandId })
  const again = await tm.requester.command('party.save', { name: 'Idempotent Pty Ltd', kind: 'customer' }, { commandId })
  assert.deepEqual(again, first)
  assert.equal((await h.owner.state()).parties.filter(p => p.name === 'Idempotent Pty Ltd').length, 1)
  await tm.requester.command('party.save', { name: 'Other', kind: 'customer' }, { commandId, error: 'IDEMPOTENCY' })
  await tm.approver.command('party.save', { name: 'Idempotent Pty Ltd', kind: 'customer' }, { commandId, error: 'IDEMPOTENCY' })

  // A decision made against an earlier snapshot of the agreement is refused.
  await tm.approver.command('approval.decide', { agreementId: id, version: a.version - 1, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' }, { error: 'STALE' })

  // A demoted approver loses authority on the next request; a revoked session is refused.
  await h.owner.command('role.set', { operatorId: tm.approver.id, role: 'viewer' })
  await tm.approver.command('approval.decide', { agreementId: id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' }, { error: 'FORBIDDEN' })
  const out = await tm.requester.request('/auth/signout', { method: 'POST', body: {} })
  assert.ok(out.status < 400)
  const revoked = await tm.requester.request('/api/locket/commands', { method: 'POST', body: { commandId: randomUUID(), type: 'requirement.add', payload: { agreementId: id, label: 'x' } } })
  assert.equal(revoked.status, 401)
  assert.equal((await tm.requester.request('/api/locket/files/' + (await h.owner.state()).artifacts[0].id)).status, 401)

  // The owner remains able to work, and the record of who did what is intact.
  await h.owner.command('requirement.attach', { agreementId: id, requirementId: (await h.owner.state()).requirements.find(r => r.agreement_id === id).id, file: file('again.pdf', pdf('again')) })
  const audit = (await h.owner.state()).audit.filter(x => x.agreement_id === id)
  assert.ok(audit.some(x => x.action === 'agreement.submit' && x.actor_role === 'requester'))
})

test('a restricted request prepared by an agent stays hidden, counterparty included, from everyone outside it', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const viewer = await h.invite('viewer@example.test', 'viewer')
  const agent = await h.invite('agent@example.test', 'agent')
  const outsiders = [viewer, tm.requester, tm.approver]
  const mentions = async client => JSON.stringify(await client.state()).includes('Falcon')
  const prepared = await agent.command('proposal.prepare', { kind: 'intake', payload: { title: 'Project Falcon acquisition NDA', type: 'nda', party: { name: 'Falcon Holdings', kind: 'other' }, value: '2500000', restricted: true }, evidence: ['Board minute 14'] })
  // Pending: only its preparer, the owner and counsel know it exists.
  for (const outsider of outsiders) assert.equal(await mentions(outsider), false)
  assert.ok((await agent.state()).proposals.some(p => p.id === prepared.id))
  await tm.requester.command('proposal.decide', { proposalId: prepared.id, decision: 'approve' }, { error: 'NOT_FOUND' })
  // Approved: the agreement, its proposal and its new counterparty follow the agreement's own visibility.
  const decided = await tm.counsel.command('proposal.decide', { proposalId: prepared.id, decision: 'approve' })
  for (const outsider of outsiders) assert.equal(await mentions(outsider), false)
  const s = await tm.counsel.state()
  assert.equal(s.agreements.find(a => a.id === decided.outcome.id).restricted, 1)
  assert.equal(s.proposals.find(p => p.id === prepared.id).agreement_id, decided.outcome.id)
  assert.ok(s.parties.some(p => p.name === 'Falcon Holdings'))
  await tm.counsel.command('access.set', { agreementId: decided.outcome.id, operatorId: viewer.id, grant: 'grant' })
  assert.equal(await mentions(viewer), true)
})

test('only the owner or counsel change whether an agreement is restricted', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const viewer = await h.invite('viewer@example.test', 'viewer')
  const made = await h.owner.command('request.create', { title: 'synthetic-locket-1 board paper', type: 'nda', party: { name: 'synthetic-locket-1 party', kind: 'other' }, restricted: true })
  await h.owner.command('access.set', { agreementId: made.id, operatorId: tm.requester.id, grant: 'grant' })
  // A person granted access keeps editing the details, but the restriction stays.
  let a = await find(tm.requester, made.id)
  await tm.requester.command('request.update', { agreementId: a.id, version: a.version, restricted: false }, { error: 'FORBIDDEN' })
  await tm.requester.command('request.update', { agreementId: a.id, version: a.version, title: 'synthetic-locket-1 revised paper', restricted: true })
  assert.deepEqual((await viewer.state()).agreements, [])
  // Counsel lifts it; a requester cannot put it back.
  a = await find(tm.counsel, made.id)
  await tm.counsel.command('request.update', { agreementId: a.id, version: a.version, restricted: false })
  assert.deepEqual((await viewer.state()).agreements.map(x => [x.id, x.title]), [[made.id, 'synthetic-locket-1 revised paper']])
  a = await find(tm.requester, made.id)
  await tm.requester.command('request.update', { agreementId: a.id, version: a.version, restricted: true }, { error: 'FORBIDDEN' })
  assert.equal((await find(viewer, made.id)).restricted, 0)
})

test('a counterparty known only through restricted agreements is never matched, chosen or edited from outside them', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const details = { name: 'synthetic-locket-2 Holdings', kind: 'other', email: 'synthetic-locket-2@example.test', registeredAddress: '2 Synthetic Lane', contacts: [{ name: 'Synthetic Contact', email: 'synthetic-locket-2-contact@example.test' }] }
  const secret = await tm.counsel.command('request.create', { title: 'synthetic-locket-2 confidential matter', type: 'nda', party: details, restricted: true })
  const party = (await tm.counsel.state()).parties.find(p => p.name === details.name)
  const mentions = async () => JSON.stringify(await tm.requester.state()).includes('synthetic-locket-2')
  assert.equal(await mentions(), false)
  await tm.requester.command('request.create', { title: 'Ordinary request', type: 'nda', party: { name: 'SYNTHETIC-LOCKET-2 holdings', kind: 'other' } }, { error: 'PARTY_UNAVAILABLE' })
  await tm.requester.command('request.create', { title: 'Ordinary request', type: 'nda', partyId: party.id }, { error: 'INVALID' })
  await tm.requester.command('party.save', { id: party.id, version: party.version, name: details.name, kind: 'other', email: 'synthetic-locket-2-changed@example.test' }, { error: 'NOT_FOUND' })
  assert.equal(await mentions(), false)
  const s = await tm.counsel.state()
  assert.deepEqual(s.agreements.map(a => a.party_id), [party.id])
  assert.equal(s.parties.find(p => p.id === party.id).email, details.email)
  // Someone inside the agreement still reuses the recorded counterparty by name.
  await tm.counsel.command('access.set', { agreementId: secret.id, operatorId: tm.requester.id, grant: 'grant' })
  const follow = await tm.requester.command('request.create', { title: 'synthetic-locket-2 follow-on', type: 'nda', party: { name: 'SYNTHETIC-LOCKET-2 holdings', kind: 'other' }, restricted: true })
  assert.equal((await find(tm.requester, follow.id)).party_id, party.id)
})
