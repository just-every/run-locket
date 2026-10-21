import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { installation } from './harness.mjs'
import { base, minute, timedRequests, request, submit, approve, dispatch, find } from './analytics-fixture.mjs'
import { file, pdf } from './files.mjs'

test('REPORT-001 measures twenty public request journeys, period throughput, repeat-stage timing and scoped waiting work', async t => {
  const h = await installation(); t.after(() => h.close())
  const ids = await timedRequests(h)
  const read = async (client = h.owner, query = '') => {
    const r = await client.request('/api/locket/analytics' + query); assert.equal(r.status, 200); return r.json()
  }
  let out = await read()
  assert.equal(out.groups[0].opened, 20); assert.equal(out.groups[0].completed, 20)
  assert.deepEqual(out.groups[0].completedIds.sort(), [...ids].sort())
  for (const [stage, multiplier] of [['draft', 1], ['in_review', 2], ['out_for_signature', 3]]) {
    const s = out.stages.find(s => s.stage === stage)
    assert.equal(s.count, 20); assert.equal(s.medianMs, 10.5 * multiplier * minute); assert.equal(s.p90Ms, 18 * multiplier * minute)
  }
  assert.equal(out.stages.find(s => s.stage === 'approved').medianMs, minute)
  const day = await read(h.owner, '?from=2026-10-22&to=2026-10-22')
  assert.equal(day.groups[0].opened, 5); assert.equal(day.groups[0].completed, 5)
  assert.deepEqual((await read(h.owner, '?type=supplier')).groups, [])
  assert.equal((await h.owner.request('/api/locket/analytics?from=2026-02-30')).status, 400)
  assert.equal((await h.owner.request('/api/locket/analytics?from=2026-10-24&to=2026-10-22')).status, 400)
  assert.equal((await h.request('/api/locket/analytics')).status, 401)

  await h.setTime(base + 3000 * minute)
  const pending = await request(h.owner, 'Insurance NDA approval')
  const original = await find(h.owner, pending.id), commandId = randomUUID()
  const payload = { agreementId: pending.id, version: original.version }
  await h.owner.command('agreement.submit', payload, { commandId })
  await h.owner.command('agreement.submit', payload, { commandId })
  await h.owner.command('agreement.submit', payload, { error: 'STATUS' })
  const a = await find(h.owner, pending.id), ownerId = (await h.owner.state()).actor.id
  await h.owner.command('approval.email', { agreementId: a.id, version: a.version, versionId: a.current_version_id, recipientId: ownerId })
  await h.setTime(base + 3010 * minute)
  const sent = await request(h.owner, 'Hosting NDA signature'); await submit(h.owner, sent.id); await approve(h.owner, sent.id); await dispatch(h.owner, sent.id)
  const hidden = await request(h.owner, 'Confidential acquisition', { restricted: true })
  await submit(h.owner, hidden.id); await approve(h.owner, hidden.id); await dispatch(h.owner, hidden.id)
  await h.setTime(base + 3040 * minute)
  out = await read()
  assert.equal(out.approvalWaits.find(p => p.agreementId === pending.id).elapsedMs, 40 * minute)
  assert.equal(out.signatureWaits.find(p => p.agreementId === sent.id).elapsedMs, 30 * minute)
  const viewer = await h.invite('performance-viewer@example.test', 'viewer')
  const visible = await read(viewer)
  assert.ok(!JSON.stringify(visible).includes(hidden.id))
  assert.equal(visible.groups[0].opened, 22)
  await h.owner.command('access.set', { agreementId: hidden.id, operatorId: viewer.id, grant: 'grant' })
  assert.ok((await read(viewer)).signatureWaits.some(p => p.agreementId === hidden.id))
  await h.owner.command('access.set', { agreementId: hidden.id, operatorId: viewer.id, grant: 'revoke' })
  assert.ok(!(await read(viewer)).signatureWaits.some(p => p.agreementId === hidden.id))

  // A revision reopens review; only a completed new visit adds a sample.
  let p = await find(h.owner, pending.id); await approve(h.owner, p.id)
  p = await find(h.owner, pending.id)
  await h.owner.command('version.upload', { agreementId: p.id, version: p.version, kind: 'counterparty', file: file('revised.pdf', pdf('Revised confidentiality agreement.')), text: 'Revised confidentiality agreement.' })
  await h.setTime(base + 3047 * minute); await approve(h.owner, p.id)
  out = await read()
  assert.equal(out.stages.find(s => s.stage === 'in_review').count, 24)
  assert.ok(!out.approvalWaits.some(w => w.agreementId === p.id))
  const archive = await (await h.owner.request('/api/locket/export')).json()
  const events = archive.records.lk_workflow_history.filter(e => e.agreement_id === pending.id)
  assert.equal(events.filter(e => e.to_status === 'in_review').length, 2)
  assert.ok(events.some(e => e.command_id === commandId))
  assert.ok((await h.owner.state()).audit.some(e => e.agreement_id === hidden.id && e.action === 'agreement.view'))
})
