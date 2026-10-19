import test from 'node:test'
import assert from 'node:assert/strict'
import { installation } from './harness.mjs'
import { file, pdf, library, team, submitted, find } from './setup.mjs'

import { portfolioFixture } from './portfolio-fixture.mjs'
const clock = Date.parse('2026-10-17T12:00:00Z')

test('REPORT-003 portfolio tiles match visible records and current-term deadlines, never proposed terms or hidden records', async t => {
  const h = await installation({ bindings: { TEST_NOW: String(clock) } }); t.after(() => h.close())
  const ids = await portfolioFixture(h.owner)
  const tm = await team(h), lib = await library(h, tm)
  const exceptionId = await submitted(h, tm, lib, { title: 'Accepted exception', value: '1200' })
  let s = await h.owner.state(), a = s.agreements.find(a => a.id === exceptionId), v = s.versions.find(v => v.id === a.current_version_id)
  const quote = 'Goods: Packaging.', start = v.text.indexOf(quote)
  const d = await h.owner.command('deviation.add', { agreementId: a.id, versionId: v.id, clauseKey: 'liability', result: 'breached', start, end: start + quote.length, quote, explanation: 'Nonstandard cap', questions: [] })
  a = await find(h.owner, a.id)
  await h.owner.command('approval.decide', { agreementId: a.id, version: a.version, versionId: v.id, kind: 'exception', deviationId: d.id, decision: 'approved' })
  const viewer = await h.invite('portfolio@example.test', 'viewer')
  const get = async client => { const r = await client.request('/api/locket/portfolio'); assert.equal(r.status, 200); return r.json() }
  let p = await get(viewer)
  assert.equal(p.now, clock)
  assert.deepEqual({ start: p.lifecycle[ids.old].start, end: p.lifecycle[ids.old].end, term: p.lifecycle[ids.old].term, date: p.lifecycle[ids.old].deadline.date, days: p.lifecycle[ids.old].deadline.days, status: p.lifecycle[ids.old].status }, { start: '2026-03-01', end: '2027-02-28', term: 5, date: '2026-12-30', days: 74, status: 'auto_renewing' })
  assert.equal(new Date(p.lifecycle[ids.old].deadline.at).toISOString(), '2026-12-31T04:59:59.000Z')
  assert.equal(p.lifecycle[ids.expired].status, 'expired')
  assert.equal(p.lifecycle[ids.expired].deadline, null)
  assert.equal(p.lifecycle[ids.future].status, 'not_yet_in_effect')
  assert.equal(p.lifecycle[ids.hidden], undefined)
  const tile = id => p.tiles.find(t => t.id === id)
  assert.deepEqual(tile('notice-90').agreementIds.sort(), [ids.old, ids.soon].sort())
  assert.deepEqual(tile('notice-60').agreementIds, [ids.soon])
  assert.deepEqual(tile('notice-30').agreementIds, [ids.soon])
  assert.deepEqual(tile('renewal-30').agreementIds, [ids.soon])
  assert.deepEqual(tile('overdue').agreementIds, [ids.old]); assert.equal(tile('overdue').obligationCount, 2)
  assert.deepEqual(tile('exceptions').agreementIds, [exceptionId])
  assert.deepEqual(tile('missing').agreementIds, [ids.missing])
  s = await viewer.state()
  for (const tile of p.tiles) {
    const rows = s.agreements.filter(a => tile.agreementIds.includes(a.id))
    assert.equal(tile.count, rows.length, tile.id)
    assert.equal(tile.valueCents, rows.reduce((sum, a) => sum + (a.value_cents ?? 0), 0), tile.id)
    assert.equal(tile.unvalued, rows.filter(a => a.value_cents === null).length, tile.id)
    assert.ok(!tile.agreementIds.includes(ids.hidden))
    if (tile.id.startsWith('type-')) assert.deepEqual(tile.agreementIds.sort(), s.agreements.filter(a => ['executed', 'imported'].includes(a.status) && a.type === tile.id.slice(5)).map(a => a.id).sort())
  }
  const query = await h.db.prepare("SELECT COUNT(*) AS n, SUM(value_cents) AS cents FROM lk_agreements WHERE status IN ('executed','imported') AND restricted=0").first()
  assert.equal(tile('all').count, query.n); assert.equal(tile('all').valueCents, query.cents)
  const terms = (await h.owner.state()).terms
  assert.equal(terms.find(t => t.agreement_id === ids.old && t.key === 'end_date' && t.status === 'confirmed').value, '2023-02-28')
  const proposed = await h.owner.command('term.propose', { agreementId: ids.old, key: 'end_date', value: '2030-02-28', citation: { quote: 'Agreed terms.' } })
  assert.equal((await get(viewer)).lifecycle[ids.old].end, '2027-02-28')
  await h.owner.command('term.decide', { agreementId: ids.old, termId: proposed.id, decision: 'confirm' })
  p = await get(viewer); assert.ok(!tile('notice-90').agreementIds.includes(ids.old))
  const owner = await get(h.owner); assert.ok(owner.tiles.find(t => t.id === 'all').agreementIds.includes(ids.hidden))
  const audit = (await h.owner.state()).audit
  assert.ok(audit.some(e => e.agreement_id === ids.hidden && e.action === 'agreement.view'))
  assert.equal((await h.request('/api/locket/portfolio')).status, 401)
})
