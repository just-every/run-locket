import test from 'node:test'
import assert from 'node:assert/strict'
import { installation } from './harness.mjs'
import { portfolioFixture } from './portfolio-fixture.mjs'
import { file, pdf } from './setup.mjs'
import { fieldSpec, metadataFields, metadataAgreement, metadataText, customKey, customDefinition } from './custom-metadata-fixture.mjs'

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

test('REPO-005 typed metadata enforces owner definitions, edit roles, stage requirements and approval context through commands', async t => {
  const h = await installation(); t.after(() => h.close())
  const requester = await h.invite('metadata-requester@example.test', 'requester')
  const viewer = await h.invite('metadata-viewer@example.test', 'viewer')
  const agent = await h.invite('metadata-agent@example.test', 'agent')
  await requester.command('field.save', fieldSpec('Not allowed', 'text'), { error: 'FORBIDDEN' })
  const ids = await metadataFields(h.owner)
  const specs = [['Memo', 'text'], ['Quantity', 'number'], ['Budget', 'money'], ['Review date', 'date'], ['Contact', 'person'], ['Affiliate', 'counterparty']]
  for (const [name, kind] of specs) ids[kind] = (await h.owner.command('field.save', fieldSpec(name, kind, { editRoles: ['owner'] }))).id
  const own = (await h.owner.state()).actor.id
  const a = await metadataAgreement(h.owner, { values: { [ids.yes]: false } })
  let current = (await h.owner.state()).agreements.find(x => x.id === a.id)
  await h.owner.command('agreement.submit', { agreementId: a.id, version: current.version })
  current = (await h.owner.state()).agreements.find(x => x.id === a.id)
  const decision = { agreementId: a.id, version: current.version, versionId: a.versionId, kind: 'commercial', decision: 'approved' }
  await h.owner.command('approval.decide', decision, { error: 'FIELDS' })
  assert.equal((await h.owner.state()).approvals.length, 0)
  await viewer.command('field.values.set', { agreementId: a.id, expectedVersion: current.version, values: { [ids.cost]: 'Operations' } }, { error: 'FORBIDDEN' })
  await agent.command('field.values.set', { agreementId: a.id, expectedVersion: current.version, values: { [ids.cost]: 'Operations' } }, { error: 'FORBIDDEN' })
  const set = async (values, error) => h.owner.command('field.values.set', { agreementId: a.id, expectedVersion: (await h.owner.state()).agreements.find(x => x.id === a.id).version, values }, error ? { error } : {})
  for (const values of [{ [ids.yes]: 'yes' }, { [ids.number]: '4' }, { [ids.money]: '1.001' }, { [ids.date]: '2026-02-30' }, { [ids.cost]: 'Unconfigured' }, { [ids.person]: 'unknown-person' }, { [ids.counterparty]: 'unknown-party' }]) await set(values, 'INVALID')
  await set({ [ids.cost]: 'Operations', [ids.text]: '=review\nthis', [ids.number]: 0, [ids.money]: '1200.50', [ids.date]: '2027-02-01', [ids.person]: own, [ids.counterparty]: current.party_id })
  let state = await h.owner.state()
  const recorded = Object.fromEntries(state.customValues.filter(v => v.agreement_id === a.id).map(v => [v.field_id, JSON.parse(v.value)]))
  assert.deepEqual(recorded, { [ids.yes]: false, [ids.cost]: 'Operations', [ids.text]: '=review\nthis', [ids.number]: 0, [ids.money]: 120050, [ids.date]: '2027-02-01', [ids.person]: own, [ids.counterparty]: current.party_id })
  await requester.command('field.values.set', { agreementId: a.id, expectedVersion: state.agreements.find(x => x.id === a.id).version, values: { [ids.text]: 'cannot' } }, { error: 'FORBIDDEN' })
  current = state.agreements.find(x => x.id === a.id)
  await h.owner.command('approval.decide', { ...decision, version: current.version })
  await set({ [ids.cost]: null }, 'FIELDS')
  await set({ [ids.yes]: true })
  state = await h.owner.state()
  assert.equal(state.agreements.find(x => x.id === a.id).status, 'in_review')
  assert.ok(state.approvals.every(x => x.invalidated_at))
  await h.owner.command('field.values.set', { agreementId: a.id, expectedVersion: current.version, values: { [ids.yes]: false } }, { error: 'STALE' })
  const definition = state.customFields.find(f => f.id === ids.cost)
  await h.owner.command('field.save', { ...fieldSpec('Cost center', 'pick_list', { options: ['Operations','Finance'], requiredStages: ['approved'], helpText: 'Choose the budget owner.' }), id: ids.cost, version: definition.version })
  await h.owner.command('field.save', { ...fieldSpec('Cost center', 'pick_list', { options: ['Operations','Finance'], requiredStages: ['approved'] }), id: ids.cost, version: definition.version }, { error: 'STALE' })
  await h.owner.command('field.save', { ...fieldSpec('Cost center', 'text'), id: ids.cost, version: definition.version + 1 }, { error: 'FIELD_IN_USE' })
  const before = await h.owner.command('field.save', fieldSpec('Before intake', 'text', { requiredStages: ['draft'] }))
  await h.owner.command('request.create', { title: 'Incomplete', type: 'other', partyId: current.party_id }, { error: 'FIELDS' })
  const complete = await h.owner.command('request.create', { title: 'Complete', type: 'other', partyId: current.party_id, customValues: { [before.id]: 'Provided' } })
  assert.ok((await h.owner.state()).customValues.some(v => v.agreement_id === complete.id && JSON.parse(v.value) === 'Provided'))
  const notApplicable = await h.owner.command('request.create', { title: 'A customer', type: 'customer', partyId: current.party_id })
  await h.owner.command('field.values.set', { agreementId: notApplicable.id, expectedVersion: 1, values: { [ids.yes]: true } }, { error: 'INVALID' })
  const archive = await (await h.owner.request('/api/locket/export')).json()
  assert.ok(archive.records.lk_custom_fields.some(f => f.id === ids.yes))
  assert.ok(archive.records.lk_custom_values.some(v => v.agreement_id === a.id && v.field_id === ids.money))
  assert.ok(state.audit.some(x => x.action === 'field.values.set' && x.agreement_id === a.id))
})

test('REPO-005 REPO-006 REPO-007 typed custom queries, ordering, scoped CSV and report groups use confirmed values', async t => {
  const h = await installation({ bindings: { TEST_NOW: String(clock) } }); t.after(() => h.close())
  const viewer = await h.invite('custom-query-viewer@example.test', 'viewer')
  const ids = await metadataFields(h.owner)
  const number = (await h.owner.command('field.save', fieldSpec('Score', 'number'))).id
  const budget = (await h.owner.command('field.save', fieldSpec('Budget', 'money'))).id
  const date = (await h.owner.command('field.save', fieldSpec('Review day', 'date'))).id
  const memo = (await h.owner.command('field.save', fieldSpec('Memo', 'text'))).id
  const values = { [ids.yes]: true, [ids.cost]: 'Operations', [number]: -2.5, [budget]: '100.25', [date]: '2027-01-31', [memo]: '=special\nmetadata' }
  const visible = await metadataAgreement(h.owner, { title: 'Visible processing', values })
  const hidden = await metadataAgreement(h.owner, { title: 'Hidden processing', values: { ...values, [number]: 3 }, restricted: true })
  const missing = await metadataAgreement(h.owner, { title: 'Unfilled processing' })
  const definition = { ...customDefinition(ids), filters: [...customDefinition(ids).filters, { field: customKey(number), operator: 'gte', value: '-2.5' }, { field: customKey(budget), operator: 'lte', value: '100.25' }, { field: customKey(date), operator: 'eq', value: '2027-01-31' }], sort: { field: customKey(number), direction: 'desc' }, columns: [customKey(ids.cost), customKey(budget), 'title', customKey(ids.yes), customKey(number), customKey(memo)] }
  const view = await h.owner.command('view.save', { name: 'Processing fields', definition, sharedRoles: ['viewer'] })
  assert.deepEqual((await get(h.owner, { viewId: view.id })).rows.map(r => r.id), [hidden.id, visible.id])
  const result = await get(viewer, { viewId: view.id })
  assert.deepEqual(result.rows.map(r => r.id), [visible.id])
  assert.deepEqual(result.columns.map(c => c.id), definition.columns)
  assert.deepEqual(Object.values(result.rows[0].values), ['Operations', 10025, 'Visible processing', 'yes', -2.5, '=special\nmetadata'])
  const csv = csvRows(await (await viewer.request('/api/locket/repository?' + new URLSearchParams({ viewId: view.id, format: 'csv' }))).text())
  assert.deepEqual(csv[0], ['Cost center','Budget','Agreement','Data processing','Score','Memo'])
  assert.deepEqual(csv[1], ['Operations','$100.25','Visible processing','yes',"'-2.5","'=special\nmetadata"])
  assert.equal(csv.length, 2)
  const search = await (await viewer.request('/api/locket/search?q=' + encodeURIComponent('special\nmetadata'))).json()
  assert.deepEqual(search.results.map(r => r.id), [visible.id])
  assert.equal(search.results[0].match, null)
  assert.ok(!(await viewer.state()).customValues.some(v => v.agreement_id === hidden.id))
  for (const changed of [{ ...definition, columns: ['custom:unknown'] }, { ...definition, filters: [{ field: customKey(number), operator: 'contains', value: '2' }] }, { ...definition, filters: [{ field: customKey(date), operator: 'eq', value: '2027-02-30' }] }, { ...definition, filters: [{ field: customKey(ids.yes), operator: 'eq', value: 'maybe' }] }]) assert.equal((await viewer.request('/api/locket/repository?' + new URLSearchParams({ definition: JSON.stringify(changed) }))).status, 400)
  const unfiltered = await get(viewer, { definition: JSON.stringify({ query: '', filters: [], sort: { field: customKey(number), direction: 'desc' }, columns: ['title', customKey(number)] }) })
  assert.deepEqual(unfiltered.rows.map(r => r.id), [visible.id, missing.id])
  const own = (await viewer.state()).actor.id
  const report = await viewer.command('report.create', { name: 'Custom metadata report', viewId: view.id, groupField: customKey(ids.cost), frequency: 'weekly', format: 'csv', firstAt: '2027-01-01T09:00', recipients: [own] })
  const output = await (await viewer.request('/api/locket/reports/' + report.id)).json()
  assert.deepEqual(output.groups, [{ group: 'Operations', count: 1, value: 0, missing: 1 }])
  const reportCsv = await (await viewer.request('/api/locket/reports/' + report.id + '?format=csv')).text()
  assert.match(reportCsv, /Cost center/); assert.match(reportCsv, /Visible processing/); assert.ok(!reportCsv.includes('Hidden processing'))
  const pdf = await viewer.request('/api/locket/reports/' + report.id + '?format=pdf')
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf')
  await h.owner.command('access.set', { agreementId: hidden.id, operatorId: own, grant: 'grant' })
  assert.deepEqual((await get(viewer, { viewId: view.id })).rows.map(r => r.id), [hidden.id, visible.id])
  await h.owner.command('access.set', { agreementId: hidden.id, operatorId: own, grant: 'revoke' })
  assert.deepEqual((await get(viewer, { viewId: view.id })).rows.map(r => r.id), [visible.id])
})

test('REPO-005 REPO-008 cited custom proposals require human acceptance and preserve scoped, stale governing family sources', async t => {
  const h = await installation(); t.after(() => h.close())
  const agent = await h.invite('custom-proposals-agent@example.test', 'agent')
  const viewer = await h.invite('custom-family-viewer@example.test', 'viewer')
  const ids = await metadataFields(h.owner)
  const root = await metadataAgreement(h.owner, { title: 'Master processing' })
  const child = await metadataAgreement(h.owner, { title: 'Amended processing', parentId: root.id, restricted: true })
  const payload = { agreementId: child.id, versionId: child.versionId, values: { [ids.yes]: true, [ids.cost]: 'Finance' }, citation: { quote: 'Cost center: Operations.', start: metadataText.indexOf('Cost center'), end: metadataText.indexOf('Cost center') + 'Cost center: Operations.'.length } }
  await agent.command('proposal.prepare', { kind: 'custom_fields', payload, evidence: ['Document passage'] }, { error: 'NOT_FOUND' })
  await h.owner.command('access.set', { agreementId: child.id, operatorId: agent.id, grant: 'grant' })
  const proposal = await agent.command('proposal.prepare', { kind: 'custom_fields', payload, evidence: ['Document passage'] })
  assert.ok(!(await h.owner.state()).customValues.some(v => v.agreement_id === child.id))
  await agent.command('proposal.decide', { proposalId: proposal.id, decision: 'approve' }, { error: 'FORBIDDEN' })
  await viewer.command('proposal.decide', { proposalId: proposal.id, decision: 'approve' }, { error: 'NOT_FOUND' })
  await h.owner.command('proposal.decide', { proposalId: proposal.id, decision: 'approve', values: { [ids.yes]: true, [ids.cost]: 'Operations' } })
  let state = await h.owner.state()
  assert.equal(JSON.parse(state.customValues.find(v => v.agreement_id === child.id && v.field_id === ids.cost).value), 'Operations')
  const source = state.terms.find(t => t.agreement_id === child.id && t.key === customKey(ids.cost))
  assert.equal(JSON.parse(source.value), 'Operations'); assert.equal(JSON.parse(source.citation).quote, payload.citation.quote)
  await h.owner.command('family.term', { agreementId: root.id, version: state.agreements.find(a => a.id === root.id).version, termId: source.id })
  const family = await (await h.owner.request('/api/locket/families/' + root.id)).json()
  assert.equal(family.governing[0].stale, false); assert.equal(family.governing[0].source.id, child.id)
  assert.equal((await (await viewer.request('/api/locket/families/' + root.id)).json()).governing.length, 0)
  state = await h.owner.state()
  await h.owner.command('field.values.set', { agreementId: child.id, expectedVersion: state.agreements.find(a => a.id === child.id).version, values: { [ids.cost]: 'Finance' } })
  assert.equal((await (await h.owner.request('/api/locket/families/' + root.id)).json()).governing[0].stale, true)
  const stale = await agent.command('proposal.prepare', { kind: 'custom_fields', payload, evidence: ['Document passage'] })
  state = await h.owner.state()
  await h.owner.command('field.values.set', { agreementId: child.id, expectedVersion: state.agreements.find(a => a.id === child.id).version, values: { [ids.yes]: false } })
  await h.owner.command('proposal.decide', { proposalId: stale.id, decision: 'approve' }, { error: 'STALE' })
  await agent.command('proposal.prepare', { kind: 'custom_fields', payload: { ...payload, citation: { ...payload.citation, quote: 'Invented passage' } }, evidence: ['No matching source'] }, { error: 'CITATION' })
})
