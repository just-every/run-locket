import assert from 'node:assert/strict'
import test from 'node:test'
import { installation } from './harness.mjs'
import { file, pdf } from './files.mjs'

const agreement = async (client, id) => (await client.state()).agreements.find(a => a.id === id)
const textCheck = result => result.checks.find(c => c.check === 'text')
async function sent(h, label, { pages = 1, restricted = false } = {}) {
  const text = `Agreement ${label}. Liability cap is USD 100000.`
  const approved = pdf(text, pages)
  const request = await h.owner.command('request.create', { title: label, type: 'nda', restricted, party: { name: `${label} counterparty`, kind: 'customer' }, file: file('approved.pdf', approved), text })
  let a = await agreement(h.owner, request.id)
  await h.owner.command('agreement.submit', { agreementId: a.id, version: a.version })
  a = await agreement(h.owner, a.id)
  await h.owner.command('approval.decide', { agreementId: a.id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' })
  a = await agreement(h.owner, a.id)
  const pkg = await h.owner.command('package.prepare', { agreementId: a.id, version: a.version, provider: 'docusign', recipients: [{ name: 'Alex', email: 'alex@example.test', action: 'sign' }] })
  a = await agreement(h.owner, a.id)
  const envelopeId = `ENV-${a.id}`
  await h.owner.command('package.sent', { agreementId: a.id, version: a.version, packageId: pkg.packageId, envelopeId })
  a = await agreement(h.owner, a.id)
  const payload = signed => ({ agreementId: a.id, version: a.version, envelopeId, executedOn: '2026-10-20', documentConfirmed: true, signers: [{ name: 'Alex', email: 'alex@example.test' }], signed: file('returned.pdf', signed), certificate: file('certificate.pdf', pdf(`Provider certificate ${label}`)) })
  return { a, approved, text, pkg, payload }
}

// A valid PDF page containing only graphics: preserve the object lengths and
// xref offsets while replacing the text drawing stream with a filled rectangle.
function graphicsPdf() {
  return Buffer.from(pdf('Scanned page without a text layer').toString('latin1').replace(/stream\n([^]*?)\nendstream/g, (_, stream) => `stream\n${'q 0 g 20 20 100 100 re f Q'.padEnd(stream.length, ' ')}\nendstream`), 'latin1')
}

test('AGENT-006 changed liability text holds execution until counsel accepts; evidence and archive retain comparison', async t => {
  const h = await installation(); t.after(() => h.close())
  const counsel = await h.invite('counsel@example.test', 'counsel')
  const f = await sent(h, 'Changed liability', { restricted: true })
  const returned = pdf(f.text.replace('100000', '1000000'))
  const result = await h.owner.command('execution.record', f.payload(returned))
  assert.equal(result.status, 'needs_review')
  const check = textCheck(result)
  assert.equal(check.ok, false)
  assert.equal(check.comparison.status, 'changed')
  assert.equal(check.comparison.approvedPages, 1)
  assert.equal(check.comparison.signedPages, 1)
  assert.deepEqual(check.comparison.differences, [{ page: 1, approved: `${f.text} - page 1`, signed: `${f.text.replace('100000', '1000000')} - page 1` }])
  assert.equal((await agreement(h.owner, f.a.id)).status, 'out_for_signature')
  await h.owner.command('term.propose', { agreementId: f.a.id, key: 'end_date', value: '2027-12-31', citation: { page: 1, quote: 'Liability cap' } }, { error: 'NOT_EXECUTED' })
  await h.owner.command('obligation.add', { agreementId: f.a.id, ownerId: counsel.id, description: 'Pay the revised amount', recurrence: 'none', citation: { page: 1, quote: 'Liability cap' } }, { error: 'NOT_EXECUTED' })
  let state = await h.owner.state()
  assert.equal(state.terms.filter(x => x.agreement_id === f.a.id).length, 0)
  assert.equal(state.obligations.filter(x => x.agreement_id === f.a.id).length, 0)
  const execution = state.executions.find(e => e.id === result.executionId)
  assert.deepEqual(JSON.parse(execution.checks), result.checks)
  for (const [id, bytes] of [[f.pkg.pdfArtifactId, f.approved], [execution.signed_artifact_id, returned]]) {
    const response = await h.owner.request(`/api/locket/files/${id}`)
    assert.equal(response.status, 200)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
  }
  const current = await agreement(counsel, f.a.id)
  await counsel.command('execution.resolve', { agreementId: f.a.id, version: current.version, executionId: result.executionId, reason: '' }, { error: 'INVALID' })
  const reason = 'Counsel reviewed the changed liability cap and accepts the negotiated increase.'
  await counsel.command('execution.resolve', { agreementId: f.a.id, version: current.version, executionId: result.executionId, reason })
  state = await h.owner.state()
  assert.equal(state.agreements.find(a => a.id === f.a.id).status, 'executed')
  const accepted = state.executions.find(e => e.id === result.executionId)
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.resolved_by, counsel.id)
  assert.equal(accepted.resolution, reason)
  assert.deepEqual(JSON.parse(accepted.checks), result.checks)
  assert.ok(state.audit.some(e => e.agreement_id === f.a.id && e.action === 'execution.accept' && e.actor_id === counsel.id && e.summary.includes(reason)))
  const archive = await (await h.owner.request('/api/locket/export')).json()
  assert.deepEqual(JSON.parse(archive.records.lk_executions.find(e => e.id === result.executionId).checks), result.checks)
  assert.equal(archive.records.lk_executions.find(e => e.id === result.executionId).resolution, reason)
  assert.deepEqual(Buffer.from(archive.files.find(f => f.id === execution.signed_artifact_id).base64, 'base64'), returned)
})

test('AGENT-006 unchanged PDF text executes automatically, including whitespace-only differences', async t => {
  const h = await installation(); t.after(() => h.close())
  for (const whitespace of [false, true]) {
    const f = await sent(h, whitespace ? 'Whitespace only' : 'Clean signed return')
    const bytes = whitespace ? pdf(f.text.replace('Liability cap', 'Liability   cap')) : f.approved
    const result = await h.owner.command('execution.record', f.payload(bytes))
    assert.equal(result.status, 'reconciled')
    assert.equal(textCheck(result).ok, true)
    assert.equal(textCheck(result).comparison.status, 'matched')
    assert.deepEqual(textCheck(result).comparison.differences, [])
    assert.equal((await agreement(h.owner, f.a.id)).status, 'executed')
    assert.ok((await h.owner.state()).audit.some(e => e.action === 'execution.record' && e.agreement_id === f.a.id))
  }
})

test('AGENT-006 missing pages and PDFs without readable text never silently execute', async t => {
  const h = await installation(); t.after(() => h.close())
  const missing = await sent(h, 'Missing second page', { pages: 2 })
  const result = await h.owner.command('execution.record', missing.payload(pdf(missing.text)))
  assert.equal(result.status, 'needs_review')
  const comparison = textCheck(result).comparison
  assert.equal(comparison.status, 'changed')
  assert.equal(comparison.approvedPages, 2)
  assert.equal(comparison.signedPages, 1)
  assert.ok(comparison.differences.some(d => d.page === 2 && d.approved.includes('Liability cap') && d.signed === ''))
  assert.equal((await agreement(h.owner, missing.a.id)).status, 'out_for_signature')
  for (const [label, bytes] of [['Graphics only', graphicsPdf()], ['Unreadable PDF', Buffer.from('%PDF-1.4\nnot a readable document\n%%EOF')]]) {
    const f = await sent(h, label)
    const held = await h.owner.command('execution.record', f.payload(bytes))
    assert.equal(held.status, 'needs_review')
    assert.equal(textCheck(held).ok, false)
    assert.equal(textCheck(held).comparison.status, 'unreadable')
    assert.ok(textCheck(held).comparison.reason)
    assert.equal((await agreement(h.owner, f.a.id)).status, 'out_for_signature')
  }
})

test('AGENT-006 authority, restricted evidence and stale revisions remain enforced', async t => {
  const h = await installation(); t.after(() => h.close())
  const viewer = await h.invite('viewer@example.test', 'viewer')
  const agent = await h.invite('agent@example.test', 'agent')
  const requester = await h.invite('requester@example.test', 'requester')
  const counsel = await h.invite('resolver@example.test', 'counsel')
  const f = await sent(h, 'Authority and stale revision')
  const payload = f.payload(pdf(f.text.replace('100000', '100001')))
  await viewer.command('execution.record', payload, { error: 'FORBIDDEN' })
  await agent.command('execution.record', payload, { error: 'FORBIDDEN' })
  // The revision before the signature handoff is no longer current.
  await h.owner.command('execution.record', { ...payload, version: f.a.version - 1 }, { error: 'STALE' })
  assert.equal((await h.owner.state()).executions.filter(e => e.agreement_id === f.a.id).length, 0)
  const result = await h.owner.command('execution.record', payload)
  let a = await agreement(h.owner, f.a.id)
  const resolve = { agreementId: a.id, version: a.version, executionId: result.executionId, reason: 'Reviewed changed cap.' }
  for (const client of [viewer, agent, requester]) await client.command('execution.resolve', resolve, { error: 'FORBIDDEN' })
  await counsel.command('execution.resolve', { ...resolve, version: a.version - 1 }, { error: 'STALE' })
  assert.equal((await agreement(h.owner, f.a.id)).status, 'out_for_signature')
  await counsel.command('execution.resolve', resolve)
  const hidden = await sent(h, 'Restricted comparison', { restricted: true })
  const held = await h.owner.command('execution.record', hidden.payload(pdf(hidden.text.replace('100000', '900000'))))
  const state = await viewer.state()
  assert.ok(!state.agreements.some(a => a.id === hidden.a.id))
  assert.ok(!state.executions.some(e => e.id === held.executionId))
  const evidence = (await h.owner.state()).executions.find(e => e.id === held.executionId)
  assert.equal((await viewer.request(`/api/locket/files/${evidence.signed_artifact_id}`)).status, 404)
})
