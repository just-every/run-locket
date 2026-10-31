import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import accessFixture from './access-fixture.mjs'
import { accessToken, autonomousPolicy, heldPolicy } from '../../src/modules/agent-door/conformance/crypto.mjs'
import { errorCode } from '../../src/modules/agent-door/conformance/protocol.mjs'
import { schemaErrors } from '../../src/modules/agent-door/conformance/schema.mjs'

const eventTool = 'locket.events.list'
const types = new Map([
  ['locket.requests.create', 'request.created'], ['locket.requests.update', 'request.updated'],
  ['locket.access.update', 'agreement.access_changed'],
])
const pending = new Map()
const recordEvents = events => events.filter(event => [...types.values()].includes(event.type))
const ids = events => events.map(event => event.id)

function native({ request, origin, cookie }) {
  const json = async (path, init = {}) => {
    const response = await request(origin + path, { ...init, headers: {
      Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...init.headers,
    } })
    assert.equal(response.status, 200, path)
    return response.json()
  }
  const state = () => json('/api/locket/state')
  const command = async (type, payload) => (await json('/api/locket/commands', {
    method: 'POST', body: JSON.stringify({ commandId: randomUUID(), type, payload }),
  })).result
  const snapshot = async () => {
    const value = await state()
    return { agreements: value.agreements, parties: value.parties, access: value.access,
      commands: value.audit.filter(row => ['request.create', 'request.update', 'access.grant', 'access.revoke'].includes(row.action)) }
  }
  return { json, state, command, snapshot }
}

async function page(tool, args = {}) {
  const answer = await tool(eventTool, args)
  assert.equal(answer.status, 200)
  assert.equal(answer.result?.isError, false)
  const value = answer.result.structuredContent
  assert.ok(Array.isArray(value.events))
  assert.ok(value.cursor === null || typeof value.cursor === 'string')
  return value
}
async function retained(tool, limit = 200) {
  const result = []
  let after
  for (let pages = 0; pages < 100; pages++) {
    const value = await page(tool, { ...(after ? { after } : {}), limit })
    assert.ok(value.events.length <= limit)
    assert.equal(new Set(ids(value.events)).size, value.events.length)
    if (value.events.length) assert.equal(value.cursor, value.events.at(-1).id)
    result.push(...value.events)
    if (value.events.length < limit) return result
    assert.notEqual(value.cursor, after)
    after = value.cursor
  }
  assert.fail('Retained event pagination must finish')
}

// Observe the mandatory create, edit and reader-grant journeys under both
// policies. All fixtures and effects use authenticated production HTTP doors.
export async function beforeStep(context) {
  const { phase, step, args, tool } = context
  if (!['autonomous', 'held'].includes(phase) || !types.has(step.tool)) return
  const d = native(context)
  const baseline = await d.snapshot()
  const events = recordEvents(await retained(tool))
  const archive = await d.json('/api/locket/export')
  if (phase === 'held' && step.expect.some(item => item.class !== 'standard')) {
    const held = await tool(step.tool, { ...args, idempotency_key: randomUUID() })
    assert.equal(held.result?.resultType, 'input_required')
    assert.equal(held.decision?.disposition, 'approval')
    assert.deepEqual(await d.snapshot(), baseline, 'Approval must precede the native effect')
    assert.deepEqual(recordEvents(await retained(tool)), events, 'A pending action emits no record-change event')
    const handle = held.result._meta['com.runeditrun/approval']
    const path = '/agents/api/approvals/' + encodeURIComponent(handle.id)
    const { approval } = await d.json(path)
    await d.json(path + '/reject', { method: 'POST', body: JSON.stringify({
      revision: approval.revision, summary_sha256: approval.summary_sha256,
    }) })
    assert.deepEqual(await d.snapshot(), baseline)
    assert.deepEqual(recordEvents(await retained(tool)), events, 'A rejection emits no record-change event')
  }
  pending.set(phase + ':' + step.id, { baseline, events, commandIds: archive.records.lk_agent_commands.map(row => row.command_id) })
}

export async function afterStep(context) {
  const { phase, step, args, result, tool } = context
  if (!['autonomous', 'held'].includes(phase) || !types.has(step.tool)) return
  const d = native(context), before = pending.get(phase + ':' + step.id)
  assert.ok(before)
  const agreementId = result.id ?? args.agreementId
  const uri = 'locket://agreements/' + agreementId
  const events = recordEvents(await retained(tool))
  const added = events.filter(event => !ids(before.events).includes(event.id))
  // The autonomous harness also makes an independent injection-control call
  // with a fresh key. Match each native command to its own agreement event.
  const matched = added.filter(event => event.uri === uri)
  assert.equal(matched.length, 1, 'Exactly one retained record event belongs to this native effect')
  const event = matched[0]
  assert.equal(event.type, types.get(step.tool))
  assert.equal(event.uri, uri)
  assert.match(event.id, /^[a-f0-9-]{36}$/)
  assert.deepEqual(Object.keys(event).sort(), ['actor', 'at', 'id', 'type', 'uri'])
  const state = await d.state()
  const row = state.agreements.find(row => row.id === agreementId)
  assert.ok(row, 'The event URI resolves to the current native agreement')
  const archive = await d.json('/api/locket/export')
  const commands = archive.records.lk_agent_commands.filter(row => !before.commandIds.includes(row.command_id))
  assert.equal(commands.length, added.length)
  for (const item of commands) {
    const nativeAudit = archive.records.lk_audit.filter(row => row.command_id === item.command_id)
    assert.equal(nativeAudit.length, 1)
    assert.equal(added.filter(event => event.uri === 'locket://agreements/' + nativeAudit[0].agreement_id).length, 1)
  }
  const matchingCommands = commands.filter(item => archive.records.lk_audit.some(row => row.command_id === item.command_id && row.agreement_id === agreementId))
  assert.equal(matchingCommands.length, 1)
  const command = matchingCommands[0]
  assert.equal(event.actor.kind, 'agent')
  assert.deepEqual(event.actor.agent, { id: command.agent_id, name: command.agent_name })
  assert.equal(event.actor.for.id, command.sponsor_id)
  assert.equal(event.actor.for.name, state.operators.find(person => person.id === command.sponsor_id).name)
  const audit = archive.records.lk_audit.filter(row => row.command_id === command.command_id)
  assert.equal(audit.length, 1)
  assert.equal(audit[0].actor_id, event.actor.for.id)
  assert.equal(audit[0].actor_name, event.actor.label)
  assert.equal(event.actor.label, event.actor.agent.name + ' for ' + event.actor.for.name)
  assert.equal(audit[0].action, step.tool === 'locket.access.update' ? 'access.' + args.grant : step.tool === 'locket.requests.create' ? 'request.create' : 'request.update')
  assert.ok(Number.isFinite(Date.parse(event.at)))
  assert.ok(Date.parse(event.at) >= audit[0].at, 'Event time follows the committed native audit time')
  assert.ok(Date.parse(event.at) >= row.created_at)
  if (step.tool === 'locket.requests.update') assert.equal(row.title, args.title)
  if (step.tool === 'locket.requests.create') assert.equal(row.title, args.title)
  if (step.tool === 'locket.access.update') assert.equal(state.access.some(item => item.agreement_id === agreementId && item.operator_id === args.operatorId), args.grant === 'grant')
  assert.deepEqual(JSON.parse(command.approvers).map(person => person.id), phase === 'held' && step.expect.some(item => item.class !== 'standard') ? [event.actor.for.id] : [])
  const snapshot = await d.snapshot()
  const replay = await tool(step.tool, args)
  assert.equal(replay.result?.isError, false)
  assert.deepEqual(replay.result.structuredContent, result)
  assert.deepEqual(await d.snapshot(), snapshot)
  assert.deepEqual(recordEvents(await retained(tool)), events, 'Mutation replay neither appends a duplicate event nor repeats the native effect')
  console.log(`PROBE BASE-AGENT-010 ${phase}.${step.id}: MCP mutation and native readback -> one typed event, stable ID, exact URI, agent for person, native timestamp and once-only replay`)
}

export default async function eventJourney() {
  const fixture = await accessFixture()
  try {
    const d = native(fixture), { owner, sponsor } = fixture
    const observer = fixture.ownerClient()
    const state = await d.state()
    const sponsorId = state.operators.find(row => row.email === fixture.colleagueEmail).id
    const targetId = state.operators.find(row => row.email === fixture.targetEmail).id
    await d.command('role.set', { operatorId: sponsorId, role: 'viewer' })
    await owner.adopt(autonomousPolicy())
    const listed = (await owner.mcp('tools/list')).result.tools.find(tool => tool.name === eventTool)
    assert.ok(listed)
    assert.equal(listed._meta['com.runeditrun/scope'], 'events:read')
    assert.deepEqual(listed._meta['com.runeditrun/classes'], ['standard'])
    assert.equal(listed.annotations.readOnlyHint, true)
    assert.equal(listed.annotations.destructiveHint, false)
    assert.equal(listed.annotations.openWorldHint, false)
    const createArgs = { title: 'synthetic-locket-events', type: 'supplier', restricted: true,
      party: { name: 'synthetic-locket-events', kind: 'supplier' }, idempotency_key: randomUUID() }
    const created = await owner.tool('locket.requests.create', createArgs)
    assert.equal(created.result?.isError, false)
    const agreementId = created.result.structuredContent.id
    const version = async () => (await d.state()).agreements.find(row => row.id === agreementId).version
    await d.command('access.set', { agreementId, operatorId: sponsorId, grant: 'grant', version: await version() })
    const changed = await owner.tool('locket.requests.update', { agreementId, version: await version(), title: 'synthetic-locket-events-updated', idempotency_key: randomUUID() })
    assert.equal(changed.result?.isError, false)
    const all = await retained(owner.tool)
    assert.equal(recordEvents(all).filter(event => event.uri === 'locket://agreements/' + agreementId).length, 2)
    for (const policy of [autonomousPolicy(), heldPolicy()]) {
      await owner.adopt(policy)
      const before = await d.snapshot()
      const first = await page(owner.tool, { limit: 1 })
      assert.deepEqual(schemaErrors(listed.outputSchema, first), [])
      const retry = await page(owner.tool, { limit: 1 })
      assert.deepEqual(retry, first)
      const rest = await page(owner.tool, { after: first.cursor, limit: 2 })
      assert.deepEqual(await page(owner.tool, { after: first.cursor, limit: 2 }), rest)
      const paged = await retained(owner.tool, 2)
      assert.deepEqual(paged, await retained(owner.tool))
      assert.equal(new Set(ids(paged)).size, paged.length)
      assert.deepEqual(ids(rest.events), ids(paged).slice(1, 3))
      assert.deepEqual(await d.snapshot(), before)
    }
    console.log('PROBE BASE-AGENT-010 cursor: nonempty MCP pages under autonomous and held policies -> ordered stable IDs on retries, bounded pages, truthful output schema and unchanged native state')

    await owner.adopt(autonomousPolicy())
    const visible = recordEvents(await retained(sponsor.tool))
    assert.deepEqual(visible, recordEvents(await retained(owner.tool)))
    const noRecordScope = await accessToken(sponsor, { scope: 'events:read' })
    assert.deepEqual(recordEvents((await sponsor.tool(eventTool, {}, { token: noRecordScope })).result.structuredContent.events), [])
    await d.command('access.set', { agreementId, operatorId: sponsorId, grant: 'revoke', version: await version() })
    for (const args of [{}, { after: visible[0].id, limit: 1 }]) {
      assert.deepEqual(recordEvents(await retained((name, input) => sponsor.tool(name, { ...input, ...args }))), [])
    }
    const privateRead = await sponsor.tool('locket.agreements.read', { agreementId })
    assert.equal(errorCode(privateRead), 'resource_unavailable')
    assert.equal(privateRead.result?.structuredContent, undefined)
    console.log('PROBE BASE-AGENT-010 current-access: genuinely bound viewer with events and record scopes -> existing IDs; native revoke or missing record scope -> no agreement events, including cursor replay')

    const baseline = await d.snapshot(), baselineEvents = recordEvents(await retained(observer.tool))
    const attempts = async (code, options) => {
      const calls = [[eventTool, { limit: 1 }], ['locket.requests.create', { ...createArgs, idempotency_key: randomUUID() }],
        ['locket.requests.update', { agreementId, version: await version(), title: 'synthetic-locket-refused', idempotency_key: randomUUID() }],
        ['locket.access.update', { agreementId, operatorId: targetId, version: await version(), grant: 'grant', idempotency_key: randomUUID() }]]
      for (const [name, args] of calls) {
        const answer = await owner.tool(name, args, options)
        assert.equal(errorCode(answer), code, name)
        assert.equal(answer.result?.structuredContent, undefined, 'Refusal must disclose no record data')
      }
      assert.deepEqual(await d.snapshot(), baseline)
    }
    for (const [label, policy, options, code] of [
      ['unset', null, {}, 'policy_unset'],
      ['blocked', { ...autonomousPolicy(), rules: [{ id: 'blocked', class: '*', do: 'blocked' }] }, {}, 'policy_blocked'],
      ['Business Pause', autonomousPolicy(), { paused: true }, 'agents_paused'],
    ]) {
      await owner.adopt(policy, options)
      await attempts(code)
      await owner.adopt(autonomousPolicy())
      assert.deepEqual(recordEvents(await retained(observer.tool)), baselineEvents)
      console.log(`PROBE BASE-AGENT-010 ${label}: polling and create, edit and access calls -> ${code}, no private result, no record-change events or native effects`)
    }
    await d.json('/agents/api/pause', { method: 'POST', body: JSON.stringify({ paused: true }) })
    await attempts('agents_paused')
    await d.json('/agents/api/pause', { method: 'POST', body: JSON.stringify({ paused: false }) })
    assert.deepEqual(recordEvents(await retained(observer.tool)), baselineEvents)
    const missing = await owner.tool(eventTool, {}, { token: await accessToken(owner, { scope: 'locket:read' }) })
    assert.equal(missing.status, 403)
    assert.equal(errorCode(missing), 'insufficient_scope')
    assert.ok(missing.headers.get('www-authenticate').includes('events:read'))
    assert.equal(missing.result?.structuredContent, undefined)
    await attempts('insufficient_scope', { token: await accessToken(owner, { scope: '' }) })
    await owner.adopt(autonomousPolicy(), { revoked: { agents: [], consents: [owner.consent] } })
    await attempts('unauthenticated')
    assert.deepEqual(recordEvents(await retained(observer.tool)), baselineEvents)
    assert.deepEqual(await d.snapshot(), baseline)
    console.log('PROBE BASE-AGENT-010 admission: local Pause, missing scopes and revoked consent -> typed refusal, no private result, unchanged native records and retained record-event IDs')
    assert.deepEqual(owner.points.filter(point => !point.ok), [])
  } finally { await fixture.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await eventJourney()
