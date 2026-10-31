import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { file, docx } from '../api/files.mjs'

const searchTool = 'locket.repo.search_and_structured_filters'
const errorCode = answer => answer.result?._meta?.['com.runeditrun/error']?.code
const ids = result => result.rows.map(row => row.id)
const termQuote = 'Agreed dates and payment terms.'
const termCitation = (row, text) => ({ versionId: row.versionId, quote: termQuote, start: text.indexOf(termQuote), end: text.indexOf(termQuote) + termQuote.length })

function person({ request, origin, cookie }) {
  const fetch = (path, init = {}) => request(origin + path, { ...init, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...init.headers } })
  const json = async (path, init) => {
    const response = await fetch(path, init)
    const body = await response.json()
    assert.equal(response.status, 200, `${path.split('?')[0]}: ${body.error?.code ?? 'request failed'}`)
    return body
  }
  return {
    fetch, state: () => json('/api/locket/state'),
    async command(type, payload) {
      const body = await json('/api/locket/commands', { method: 'POST', body: JSON.stringify({ commandId: randomUUID(), type, payload }) })
      assert.equal(body.ok, true, type)
      return body.result
    },
    repository: definition => json('/api/locket/repository' + (definition === undefined ? '' : '?definition=' + encodeURIComponent(JSON.stringify(definition)))),
  }
}

async function businessState(owner) {
  const state = await owner.state()
  return Object.fromEntries(['agreements', 'versions', 'artifacts', 'parties', 'terms', 'renewals', 'obligations', 'customFields', 'customValues', 'access', 'operators', 'repositoryPolicy', 'proposals', 'savedViews'].map(key => [key, state[key]]))
}

async function parity(client, tool, args) {
  const defaults = (await client.repository()).definition
  const native = await client.repository({ ...defaults, ...args })
  const answer = await tool(searchTool, args)
  assert.equal(answer.result?.isError, false)
  const result = answer.result.structuredContent
  assert.ok(Number.isSafeInteger(result.evaluatedAt))
  assert.deepEqual({ ...result, evaluatedAt: native.evaluatedAt }, native)
  return result
}

async function fixtures(owner, phase) {
  const tag = `synthetic-locket-${phase}-${randomUUID()}`
  const custom = await owner.command('field.save', { name: tag, kind: 'text', agreementTypes: ['supplier', 'customer'], requiredStages: [], editRoles: ['owner'], options: [] })
  const passage = `${tag} escrow passage`
  const text = `${passage}\n${termQuote}`
  const rows = []
  for (const [index, type, value, customValue, restricted] of [
    [1, 'supplier', '1200.50', 'synthetic-locket-1', false],
    [2, 'supplier', '1200.50', 'synthetic-locket-1', false],
    [3, 'supplier', undefined, 'synthetic-locket-1', false],
    [4, 'customer', '1200.50', 'synthetic-locket-2', false],
    [5, 'supplier', '1200.50', 'synthetic-locket-1', true],
  ]) {
    const made = await owner.command('legacy.import', {
      title: `${tag} ${index}`, type, ...(value === undefined ? {} : { value }), restricted,
      party: { name: `${tag} party ${index}`, kind: 'supplier' },
      customValues: { [custom.id]: customValue }, sourceSystem: tag, sourceId: String(index),
      file: file(`${tag}-${index}.docx`, docx([text, String(index)])), text, signed: true,
    })
    rows.push(made)
    for (const [key, value] of [['effective_date', '2026-01-01'], ['end_date', '2027-12-31']]) {
      const term = await owner.command('term.propose', { agreementId: made.id, key, value, citation: termCitation(made, text) })
      await owner.command('term.decide', { agreementId: made.id, termId: term.id, decision: 'confirm' })
    }
  }
  return { tag, passage, text, rows, custom: `custom:${custom.id}` }
}

async function refusedCalls(owner, tool) {
  const before = await businessState(owner)
  for (const args of [
    { query: 42 }, { query: 'x'.repeat(2001) }, { columns: [42] },
    { filters: {} }, { filters: [{ field: 'type', operator: 'neq', value: 'supplier' }] },
    { filters: [{ field: 'type', operator: 'eq', value: 42 }] },
    { filters: [{ field: 'type', value: 'supplier' }] },
    { sort: { field: 'title', direction: 'sideways' } }, { sort: { direction: 'asc' } },
  ]) {
    const answer = await tool(searchTool, args)
    assert.equal(errorCode(answer), 'invalid_arguments')
    assert.equal(answer.result?.isError, true)
    assert.equal(answer.result?.structuredContent, undefined)
  }
  assert.deepEqual(await businessState(owner), before, 'schema refusals preserve native business state')
}

async function nativeValidation(owner, tool, query) {
  const defaults = (await owner.repository()).definition
  const before = await businessState(owner)
  for (const extra of [
    { filters: [{ field: 'synthetic-locket-unknown', operator: 'eq', value: 'synthetic-locket-1' }] },
    { columns: ['synthetic-locket-unknown'] },
    { sort: { field: 'synthetic-locket-unknown', direction: 'asc' } },
    { filters: [{ field: 'end_date', operator: 'gte', value: '2026-02-30' }] },
    { filters: [{ field: 'value', operator: 'gte', value: '1200.501' }] },
    { filters: [{ field: 'value', operator: 'contains', value: '1200' }] },
    { filters: [{ field: 'notice_days', operator: 'contains', value: '60' }] },
    { filters: [{ field: 'notice_days', operator: 'gte', value: 'sixty' }] },
  ]) {
    const args = { query, ...extra }
    const response = await owner.fetch('/api/locket/repository?definition=' + encodeURIComponent(JSON.stringify({ ...defaults, ...args })))
    assert.equal(response.status, 400)
    const native = await response.json()
    assert.equal(native.ok, false)
    assert.equal(native.error.code, 'INVALID')
    const answer = await tool(searchTool, args)
    assert.equal(answer.result?.isError, true)
    assert.equal(errorCode(answer), native.error.code)
    assert.equal(answer.result?.structuredContent, undefined)
  }
  assert.deepEqual(await businessState(owner), before, 'native validation refusals preserve native business state')
}

async function colleagueParity(context, owner, fixture) {
  assert.ok(context.colleague?.cookie && typeof context.colleague.tool === 'function', 'Repository authority parity requires the invited colleague session and its sponsor-scoped tool')
  const client = person({ ...context, cookie: context.colleague.cookie }), tool = context.colleague.tool
  const state = await client.state(), role = state.actor.role
  assert.ok(['viewer', 'requester', 'approver'].includes(role), 'Repository authority parity needs a colleague without full field authority')
  const args = { query: fixture.tag, columns: ['title', 'value', fixture.custom] }
  let result = await parity(client, tool, args)
  assert.equal(result.rows.length, 4)
  assert.ok(!JSON.stringify(result).includes(fixture.rows[4].id))
  await owner.command('access.set', { agreementId: fixture.rows[4].id, operatorId: state.actor.id, grant: 'grant' })
  result = await parity(client, tool, args)
  assert.equal(result.rows.length, 5)
  await owner.command('access.set', { agreementId: fixture.rows[4].id, operatorId: state.actor.id, grant: 'revoke' })
  assert.equal((await parity(client, tool, args)).rows.length, 4)
  const prior = (await owner.state()).repositoryPolicy
  const hiddenFields = prior.hiddenFields.filter(item => item.role !== role)
  hiddenFields.push({ role, fields: ['value', fixture.custom] })
  const changed = await owner.command('repository.access', { ...prior, hiddenFields })
  try {
    result = await parity(client, tool, args)
    assert.deepEqual(result.definition.columns, ['title'])
    assert.deepEqual(result.columns.map(column => column.id), ['title'])
    for (const row of result.rows) assert.deepEqual(Object.keys(row.values), ['title'])
    assert.deepEqual((await parity(client, tool, { query: fixture.passage, columns: ['title'] })).rows, [], 'hidden fields withhold unredacted passage evidence')
    const before = await businessState(owner)
    for (const field of ['value', fixture.custom]) for (const extra of [
      { filters: [{ field, operator: 'eq', value: field === 'value' ? '1200.50' : 'synthetic-locket-1' }] },
      { sort: { field, direction: 'asc' } },
    ]) {
      const definition = { ...(await client.repository()).definition, query: fixture.tag, ...extra }
      const native = await client.fetch('/api/locket/repository?definition=' + encodeURIComponent(JSON.stringify(definition)))
      assert.equal(native.status, 403)
      assert.equal((await native.json()).error.code, 'FIELD_ACCESS')
      const answer = await tool(searchTool, { query: fixture.tag, ...extra })
      assert.equal(errorCode(answer), 'FIELD_ACCESS')
      assert.equal(answer.result?.structuredContent, undefined)
    }
    assert.deepEqual(await businessState(owner), before, 'hidden-field refusals preserve native business state')
  } finally {
    await owner.command('repository.access', { ...prior, version: changed.version })
  }
}

async function sensitivePassage(context, owner, fixture) {
  const query = `${fixture.tag} disclosure`
  const text = `A disclosed passage: ${query}. Supplier EIN 12-3456789.`
  const made = await owner.command('request.create', { title: `${fixture.tag} sensitive`, type: 'supplier', party: { name: fixture.tag, kind: 'supplier' }, file: file(`${fixture.tag}-sensitive.docx`, docx([text])), text })
  const args = { query, columns: ['title'] }
  const native = await owner.repository({ ...(await owner.repository()).definition, ...args })
  assert.deepEqual(ids(native), [made.id])
  assert.equal(native.rows[0].matches[0].quote, query)
  assert.ok(native.rows[0].matches[0].excerpt.includes('12-3456789'))
  const before = await businessState(owner)
  const answer = await context.tool(searchTool, args)
  assert.ok(answer.decision?.classes.some(item => item.class === 'sensitive' && item.facts.kind === 'tax_identifier'))
  if (context.phase === 'held') {
    assert.equal(answer.decision.disposition, 'approval')
    assert.equal(answer.result?.resultType, 'input_required')
    assert.ok(answer.result?._meta?.['com.runeditrun/approval']?.id)
    assert.equal(answer.result?.structuredContent, undefined, 'pending approval withholds sensitive passage results')
    assert.deepEqual(await businessState(owner), before)
  } else {
    assert.equal(answer.decision.disposition, 'autonomous')
    assert.equal(answer.result?.isError, false)
    assert.deepEqual({ ...answer.result.structuredContent, evaluatedAt: native.evaluatedAt }, native)
  }
}

/** Extends the mandatory journey in both native policy rounds. */
export async function repositoryParity(context) {
  const owner = person(context), fixture = await fixtures(owner, context.phase)
  const definition = { query: fixture.passage, filters: [
    { field: 'status', operator: 'eq', value: 'imported' },
    { field: 'type', operator: 'eq', value: 'supplier' },
    { field: 'value', operator: 'gte', value: '1200.49' },
    { field: 'value', operator: 'lte', value: '1200.50' },
    { field: 'end_date', operator: 'gte', value: '2027-01-01' },
    { field: 'end_date', operator: 'lte', value: '2027-12-31' },
    { field: fixture.custom, operator: 'contains', value: 'locket-1' },
  ], columns: ['title', 'status', 'type', 'value', 'end_date', fixture.custom], sort: { field: 'value', direction: 'asc' } }
  const expected = [fixture.rows[0].id, fixture.rows[1].id, fixture.rows[4].id].sort((a, b) => a.localeCompare(b, 'en-US'))
  let result = await parity(owner, context.tool, definition)
  assert.deepEqual(ids(result), expected)
  for (const row of result.rows) {
    assert.equal(row.values.value, 120050)
    assert.equal(row.values[fixture.custom], 'synthetic-locket-1')
    assert.equal(row.matches.length, 1)
    const hit = row.matches[0]
    assert.equal(hit.quote, fixture.passage)
    assert.equal(fixture.text.slice(hit.start, hit.end), hit.quote)
    assert.equal(hit.versionId, fixture.rows.find(item => item.id === row.id).versionId)
  }
  for (const direction of ['asc', 'desc']) {
    result = await parity(owner, context.tool, { query: fixture.tag, filters: [{ field: 'type', operator: 'eq', value: 'supplier' }], sort: { field: 'value', direction } })
    assert.deepEqual(ids(result), [...expected, fixture.rows[2].id], 'ties use identity and missing values stay last in both directions')
  }
  // The full default portfolio can contain the sensitive mandatory fixtures.
  // Scope the held default-query case to these ordinary native records.
  if (context.phase === 'autonomous') await parity(owner, context.tool, {})
  await parity(owner, context.tool, { filters: [{ field: fixture.custom, operator: 'eq', value: 'synthetic-locket-1' }] })
  await parity(owner, context.tool, { query: fixture.tag })
  const proposed = await owner.command('term.propose', { agreementId: fixture.rows[0].id, key: 'end_date', value: '2031-12-31', citation: termCitation(fixture.rows[0], fixture.text) })
  const termArgs = { query: fixture.tag, filters: [{ field: 'end_date', operator: 'eq', value: '2031-12-31' }], columns: ['title', 'end_date'] }
  assert.deepEqual(ids(await parity(owner, context.tool, termArgs)), [])
  await owner.command('term.decide', { agreementId: fixture.rows[0].id, termId: proposed.id, decision: 'confirm' })
  assert.deepEqual(ids(await parity(owner, context.tool, termArgs)), [fixture.rows[0].id])
  await refusedCalls(owner, context.tool)
  await nativeValidation(owner, context.tool, fixture.tag)
  await sensitivePassage(context, owner, fixture)
}

/** Public MCP authority evidence uses an independently invited sponsor. */
export async function repositoryAuthority(context) {
  const owner = person(context), fixture = await fixtures(owner, context.phase ?? 'authority')
  await colleagueParity(context, owner, fixture)
}

export async function repositoryStep(context) {
  if (context.stage === 'afterStep' && context.step.id === 'search' && ['autonomous', 'held'].includes(context.phase)) await repositoryParity(context)
}
