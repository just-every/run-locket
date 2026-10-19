import test from 'node:test'
import assert from 'node:assert/strict'
import { installation } from './harness.mjs'
import { portfolioFixture } from './portfolio-fixture.mjs'
import { file, pdf } from './setup.mjs'

const clock = Date.parse('2026-10-17T12:00:00Z')
const get = async (client, params) => {
  const response = await client.request('/api/locket/repository?' + new URLSearchParams(params))
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}
const csvRows = text => {
  const rows = []; let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted
    } else if (!quoted && c === ',') { row.push(cell); cell = '' }
    else if (!quoted && c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++ }
    else cell += c
  }
  return rows
}

test('REPO-007 ROLE-001 saved views execute current visible agreements identically on screen and CSV, with personal pins and creator revisions', async t => {
  const h = await installation({ bindings: { TEST_NOW: String(clock) } }); t.after(() => h.close())
  const ids = await portfolioFixture(h.owner)
  const approver = await h.invite('views-approver@example.test', 'approver')
  const viewer = await h.invite('views-viewer@example.test', 'viewer')
  const agent = await h.invite('views-agent@example.test', 'agent')
  const definition = { query: 'agreement', filters: [
    { field: 'type', operator: 'eq', value: 'supplier' },
    { field: 'notice_deadline', operator: 'gte', value: '2026-10-01' },
    { field: 'notice_deadline', operator: 'lte', value: '2026-12-31' },
    { field: 'value', operator: 'gte', value: '100000.25' },
  ], sort: { field: 'value', direction: 'desc' }, columns: ['value', 'owner', 'notice_deadline', 'title'] }
  const name = 'Supplier renewals next quarter'
  const saved = await h.owner.command('view.save', { name, definition, sharedRoles: ['approver'] })
  let ownerResult = await get(h.owner, { viewId: saved.id }), shared = await get(approver, { viewId: saved.id })
  assert.equal(ownerResult.name, name)
  assert.deepEqual(ownerResult.rows.map(r => r.id), [ids.hidden, ids.old])
  assert.deepEqual(shared.rows.map(r => r.id), [ids.old])
  assert.deepEqual(shared.columns.map(c => c.id), definition.columns)
  assert.deepEqual(shared.rows[0].values, { value: 10000025, owner: 'Olive Owner', notice_deadline: '2026-12-30', title: 'old agreement API' })
  assert.equal(shared.evaluatedAt, clock)
  const csv = await approver.request('/api/locket/repository?' + new URLSearchParams({ viewId: saved.id, format: 'csv' }))
  assert.equal(csv.status, 200)
  const parsed = csvRows(await csv.text())
  assert.deepEqual(parsed[0], shared.columns.map(c => c.label))
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
  assert.deepEqual(parsed.slice(1), shared.rows.map(r => shared.columns.map(c => c.kind === 'money' ? usd.format(r.values[c.id] / 100) : String(r.values[c.id] ?? ''))))
  assert.equal((await viewer.request('/api/locket/repository?viewId=' + saved.id)).status, 404)
  assert.ok(!(await viewer.state()).savedViews.some(v => v.id === saved.id))
  await approver.command('view.save', { ...saved, name, definition, sharedRoles: [] }, { error: 'NOT_FOUND' })
  await approver.command('view.pin', { viewId: saved.id, pinned: true })
  assert.equal((await approver.state()).savedViews.find(v => v.id === saved.id).pinned, true)
  assert.equal((await h.owner.state()).savedViews.find(v => v.id === saved.id).pinned, false)
  await h.owner.command('access.set', { agreementId: ids.hidden, operatorId: approver.id, grant: 'grant' })
  assert.deepEqual((await get(approver, { viewId: saved.id })).rows.map(r => r.id), [ids.hidden, ids.old])
  await h.owner.command('access.set', { agreementId: ids.hidden, operatorId: approver.id, grant: 'revoke' })
  assert.deepEqual((await get(approver, { viewId: saved.id })).rows.map(r => r.id), [ids.old])
  const revision = await h.owner.command('view.save', { ...saved, name, definition, sharedRoles: [] })
  await h.owner.command('view.save', { ...saved, name, definition, sharedRoles: [] }, { error: 'STALE' })
  await h.owner.command('view.delete', saved, { error: 'STALE' })
  assert.equal((await approver.request('/api/locket/repository?viewId=' + saved.id)).status, 404)
  await approver.command('view.pin', { viewId: saved.id, pinned: false }, { error: 'NOT_FOUND' })
  await h.owner.command('view.delete', revision)
  assert.equal((await h.owner.request('/api/locket/repository?viewId=' + saved.id)).status, 404)
  const own = await viewer.command('view.save', { name: 'My private view', definition, sharedRoles: [] })
  assert.equal((await h.owner.request('/api/locket/repository?viewId=' + own.id)).status, 404)
  await viewer.command('view.pin', { viewId: own.id, pinned: true })
  const archive = await (await h.owner.request('/api/locket/export')).json()
  assert.equal(archive.records.lk_saved_views.find(v => v.id === own.id).name, 'My private view')
  assert.ok(archive.records.lk_view_pins.some(p => p.view_id === own.id && p.operator_id === viewer.id))
  await agent.command('view.save', { name, definition, sharedRoles: [] }, { error: 'FORBIDDEN' })
  await agent.command('view.pin', { viewId: own.id, pinned: true }, { error: 'FORBIDDEN' })
  await agent.command('view.delete', own, { error: 'FORBIDDEN' })
  assert.equal((await h.request('/api/locket/repository')).status, 401)
})

test('REPO-007 ad hoc views validate typed filters and protect spreadsheet cells while preserving quoted multiline content', async t => {
  const h = await installation({ bindings: { TEST_NOW: String(clock) } }); t.after(() => h.close())
  const title = '=SUM(1,2)\n"Supplier"'
  const agreement = await h.owner.command('legacy.import', { title, type: 'supplier', party: { name: '@Supplier', kind: 'supplier' }, value: '10.01', sourceSystem: 'Archive', sourceId: 'csv', file: file('agreement.pdf', pdf('Terms')), text: 'Terms', signed: true })
  const definition = { query: '', filters: [{ field: 'value', operator: 'eq', value: '10.01' }], sort: { field: 'title', direction: 'asc' }, columns: ['title', 'counterparty', 'value'] }
  const result = await get(h.owner, { definition: JSON.stringify(definition) })
  assert.deepEqual(result.rows.map(r => r.id), [agreement.id])
  const response = await h.owner.request('/api/locket/repository?' + new URLSearchParams({ definition: JSON.stringify(definition), format: 'csv' }))
  assert.equal(response.status, 200)
  assert.deepEqual(csvRows(await response.text()).slice(1), [["'" + title, "'@Supplier", '$10.01']])
  for (const filter of [{ field: 'value', operator: 'eq', value: '0.001' }, { field: 'notice_deadline', operator: 'eq', value: '2026-02-30' }, { field: 'value', operator: 'contains', value: '10' }, { field: 'unknown', operator: 'eq', value: 'x' }]) {
    const response = await h.owner.request('/api/locket/repository?' + new URLSearchParams({ definition: JSON.stringify({ ...definition, filters: [filter] }) }))
    assert.equal(response.status, 400)
  }
})
