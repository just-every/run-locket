import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import accessFixture from './access-fixture.mjs'
import { autonomousPolicy, heldPolicy } from '../../node_modules/@runeditrun/rer/modules/agent-door/conformance/crypto.mjs'
import { errorCode } from '../../node_modules/@runeditrun/rer/modules/agent-door/conformance/protocol.mjs'

// These are confirmed disposable sessions, never a browser profile or a fixture
// account inserted into storage. The owner initializer supplies the invitation.
const colleagues = new Map()
const phases = new Map()
const pending = new Map()
const checked = new Set(['grant', 'revoke', 'role', 'role_narrow'])

export function rememberColleague(origin, session) {
  colleagues.set(origin, session)
  phases.clear()
  pending.clear()
}

function doors(context) {
  const { request, origin, cookie } = context
  const colleague = context.colleague ?? colleagues.get(origin)
  assert.ok(colleague?.cookie, 'A genuinely invited colleague session is required')
  const send = (path, init = {}, session = cookie) => request(origin + path, {
    ...init, headers: { Origin: origin, Cookie: session, 'Content-Type': 'application/json', ...init.headers },
  })
  const json = async (path, init, session) => {
    const response = await send(path, init, session)
    assert.equal(response.ok, true, 'Native read or command must succeed: ' + path)
    return response.json()
  }
  const command = async (type, payload, session) => (await json('/api/locket/commands', {
    method: 'POST', body: JSON.stringify({ commandId: randomUUID(), type, payload }),
  }, session)).result
  const state = session => json('/api/locket/state', undefined, session)
  const snapshot = async () => {
    const value = await state()
    return {
      agreements: value.agreements.map(row => ({ id: row.id, version: row.version, title: row.title })),
      grants: value.access,
      people: value.operators.map(({ id, role, status }) => ({ id, role, status })),
      // Audit reads have their own events; consequential native commands do not.
      commands: value.audit.filter(row => ['access.grant', 'access.revoke', 'role.set', 'request.create', 'request.update'].includes(row.action)),
    }
  }
  return { colleague, send, json, command, state, snapshot }
}

export default async function prepare(context) {
  const d = doors(context)
  const state = await d.state()
  const colleague = state.operators.find(row => row.email === d.colleague.email)
  const sponsor = state.operators.find(row => row.role === 'owner')
  assert.ok(colleague && sponsor && colleague.id !== sponsor.id)
  await d.command('role.set', { operatorId: colleague.id, role: 'viewer' })
  let control
  if (['autonomous', 'held'].includes(context.phase)) {
    control = await d.command('request.create', {
      title: 'synthetic-locket-access-' + context.phase, type: 'supplier',
      party: { name: 'synthetic-locket-access-control', kind: 'supplier' }, restricted: true,
    })
  }
  phases.set(context.phase, { colleagueId: colleague.id, sponsorId: sponsor.id, sponsorName: sponsor.name, controlId: control?.id })
  return { values: { colleague: { id: colleague.id } } }
}

async function auditRows(d) {
  const rows = []
  let after = '0'
  for (;;) {
    const page = await d.json('/agents/api/audit?after=' + after)
    rows.push(...page.rows)
    if (page.cursor === after || page.cursor === null) return rows
    after = page.cursor
  }
}

function roleOf(state, id) {
  return state.operators.find(row => row.id === id)?.role
}
function grants(state, id) {
  return state.access.filter(row => row.agreement_id === id).map(row => row.operator_id).sort()
}
async function visible(d, id) {
  return (await d.state(d.colleague.cookie)).agreements.some(row => row.id === id)
}

export async function beforeStep(context) {
  const { phase, step, args, tool } = context
  if (!['autonomous', 'held'].includes(phase) || !checked.has(step.id)) return
  const d = doors(context), fixture = phases.get(phase)
  assert.equal(args.operatorId, fixture.colleagueId)
  const access = step.tool === 'locket.access.update'
  const before = await d.state()
  const previousRole = roleOf(before, fixture.colleagueId)
  assert.equal(previousRole, step.id === 'role_narrow' ? 'requester' : 'viewer')
  let expected
  if (access) {
    const hadAccess = step.id === 'revoke'
    assert.deepEqual(grants(before, args.agreementId), hadAccess ? [fixture.colleagueId] : [])
    assert.equal(await visible(d, args.agreementId), hadAccess)
    const control = before.agreements.find(row => row.id === fixture.controlId)
    await d.command('access.set', { ...args, agreementId: control.id, version: control.version })
    const human = await d.state()
    expected = { grants: grants(human, control.id), visible: await visible(d, control.id) }
    assert.deepEqual(expected, {
      grants: args.grant === 'grant' ? [fixture.colleagueId] : [], visible: args.grant === 'grant',
    })
  } else {
    await d.command('role.set', { ...args, expectedRevision: before.operators.find(row => row.id === fixture.colleagueId).revision })
    expected = roleOf(await d.state(), fixture.colleagueId)
    assert.equal(expected, step.id === 'role' ? 'requester' : 'viewer')
    await d.command('role.set', { operatorId: fixture.colleagueId, role: previousRole })
  }
  const baseline = await d.snapshot()
  const unauthorized = await d.send('/api/locket/commands', {
    method: 'POST', body: JSON.stringify({
      commandId: randomUUID(), type: access ? 'access.set' : 'role.set', payload: args,
    }),
  }, d.colleague.cookie)
  assert.equal(unauthorized.status, 403)
  assert.equal((await unauthorized.json()).error.code, 'FORBIDDEN')
  assert.deepEqual(await d.snapshot(), baseline, 'The current colleague role cannot perform the privileged native command')
  const listed = await tool('locket.people.list', {})
  const revision = listed.result?.structuredContent?.members.find(row => row.id === fixture.colleagueId)?.revision
  if (!access) assert.equal(typeof revision, 'string', 'Role updates expose their current native revision')
  assert.equal((await d.state()).operators.find(row => row.id === fixture.colleagueId).revision, revision)
  const archive = await d.json('/api/locket/export')
  const commandIds = archive.records.lk_agent_commands.map(row => row.command_id)
  if (phase === 'held') {
    const held = await tool(step.tool, { ...args, idempotency_key: randomUUID() })
    assert.equal(held.result?.resultType, 'input_required')
    assert.equal(held.decision?.disposition, 'approval')
    assert.deepEqual(await d.snapshot(), baseline, 'Held action must have no native effect')
    const handle = held.result._meta['com.runeditrun/approval']
    const path = '/agents/api/approvals/' + encodeURIComponent(handle.id)
    const { approval } = await d.json(path)
    const decision = { revision: approval.revision, summary_sha256: approval.summary_sha256 }
    const refused = await d.send(path + '/approve', { method: 'POST', body: JSON.stringify(decision) }, d.colleague.cookie)
    assert.ok([403, 404].includes(refused.status), 'The other person cannot approve the sponsor action')
    await refused.body?.cancel()
    assert.deepEqual(await d.snapshot(), baseline)
    await d.json(path + '/reject', { method: 'POST', body: JSON.stringify(decision) })
    assert.deepEqual(await d.snapshot(), baseline)
  }
  pending.set(phase + ':' + step.id, { baseline, expected, commandIds, revision })
}

export async function afterStep(context) {
  const { phase, step, args, result, tool } = context
  if (!['autonomous', 'held'].includes(phase) || !checked.has(step.id)) return
  const d = doors(context), fixture = phases.get(phase)
  const proof = pending.get(phase + ':' + step.id)
  assert.ok(proof)
  const state = await d.state()
  const access = step.tool === 'locket.access.update'
  if (access) {
    assert.deepEqual(grants(state, args.agreementId), proof.expected.grants)
    assert.equal(await visible(d, args.agreementId), proof.expected.visible)
    assert.equal(state.agreements.find(row => row.id === args.agreementId).version,
      proof.baseline.agreements.find(row => row.id === args.agreementId).version + 1)
    assert.deepEqual(result, { agreementId: args.agreementId })
  } else {
    assert.equal(roleOf(state, fixture.colleagueId), proof.expected)
    assert.equal(roleOf(await d.state(d.colleague.cookie), fixture.colleagueId), proof.expected)
    assert.deepEqual(result, { operatorId: fixture.colleagueId, role: proof.expected })
    // The role change is effective on the existing colleague session.
    const beforeColleague = await d.snapshot()
    const response = await d.send('/api/locket/commands', {
      method: 'POST', body: JSON.stringify({ commandId: randomUUID(), type: 'request.create', payload: {
        title: 'synthetic-locket-role-' + phase, type: 'supplier', party: { name: 'synthetic-locket-role', kind: 'supplier' },
      } }),
    }, d.colleague.cookie)
    assert.equal(response.status, proof.expected === 'requester' ? 200 : 403)
    if (proof.expected === 'viewer') {
      assert.equal((await response.json()).error.code, 'FORBIDDEN')
      assert.deepEqual(await d.snapshot(), beforeColleague, 'Lost requester authority must refuse without an effect')
    }
    else await response.body?.cancel()
  }
  const rows = (await auditRows(d)).filter(row => row.idempotency_key === args.idempotency_key && row.outcome === 'done')
  assert.equal(rows.length, 1, 'One successful agent execution is retained')
  const row = rows[0]
  assert.equal(row.tool, step.tool)
  assert.equal(row.sponsor.id, fixture.sponsorId)
  assert.equal(row.sponsor.name, fixture.sponsorName)
  assert.equal(row.agent.name, 'Agent door conformance')
  assert.equal(row.decision, phase === 'held' ? 'approval' : 'autonomous')
  assert.deepEqual(row.classes, [{ class: 'access', facts: {
    measure: 1, direction: ['grant', 'role'].includes(step.id) ? 'widens' : 'narrows',
  } }])
  if (phase === 'held') assert.deepEqual(row.approval.by, [fixture.sponsorId])
  else assert.equal(row.approval, null)
  const archive = await d.json('/api/locket/export')
  const commands = archive.records.lk_agent_commands.filter(item => !proof.commandIds.includes(item.command_id))
  assert.equal(commands.length, 1, 'One native command belongs to the agent effect')
  assert.equal(commands[0].operation_id, row.operation_id)
  assert.equal(commands[0].agent_id, row.agent.id)
  assert.equal(commands[0].agent_name, row.agent.name)
  assert.equal(commands[0].sponsor_id, fixture.sponsorId)
  assert.deepEqual(JSON.parse(commands[0].approvers), phase === 'held' ? [{ id: fixture.sponsorId, name: row.sponsor.name }] : [])
  const native = archive.records.lk_audit.filter(item => item.command_id === commands[0].command_id)
  assert.equal(native.length, 1)
  assert.equal(native[0].action, access ? 'access.' + args.grant : 'role.set')
  assert.equal(native[0].actor_id, fixture.sponsorId)
  assert.equal(native[0].actor_name, row.agent.name + ' for ' + row.sponsor.name)
  const beforeReplay = await d.snapshot()
  const replay = await tool(step.tool, args)
  assert.equal(replay.result?.isError, false)
  assert.deepEqual(replay.result.structuredContent, result)
  assert.deepEqual(await d.snapshot(), beforeReplay, 'Replay must not repeat a native effect')
  assert.deepEqual((await d.json('/api/locket/export')).records.lk_agent_commands, archive.records.lk_agent_commands)
  {
    const staleArgs = { ...args, idempotency_key: randomUUID(), expected_revision: access ? args.version : proof.revision }
    const stale = await tool(step.tool, staleArgs)
    assert.equal(stale.result?._meta?.['com.runeditrun/error']?.code, 'revision_conflict')
    assert.deepEqual(await d.snapshot(), beforeReplay)
    const refused = await d.send('/api/locket/commands', { method: 'POST', body: JSON.stringify({
      commandId: randomUUID(), type: access ? 'access.set' : 'role.set',
      payload: access ? args : { ...args, expectedRevision: proof.revision },
    }) })
    assert.equal(refused.status, 409)
    assert.equal((await refused.json()).error.code, 'STALE')
    assert.deepEqual(await d.snapshot(), beforeReplay)
  }
  console.log('PROBE BASE-AGENT-005 ' + phase + '.' + step.id + ': authenticated MCP and native commands -> exact effect, direction, attribution and once-only replay')
}

export async function authorityJourney() {
  const context = await accessFixture()
  try {
    const d = doors(context), { owner, sponsor } = context
    const state = await d.state()
    const sponsorId = state.operators.find(row => row.email === context.colleagueEmail).id
    const colleagueId = state.operators.find(row => row.email === context.targetEmail).id
    const ownerId = state.operators.find(row => row.role === 'owner').id
    owner.sponsor.id = ownerId
    sponsor.sponsor.id = sponsorId
    const created = await d.command('request.create', { title: 'synthetic-locket-authority', type: 'supplier',
      party: { name: 'synthetic-locket-authority', kind: 'supplier' }, restricted: true })
    const version = async () => (await d.state()).agreements.find(row => row.id === created.id).version
    const accessArgs = async grant => ({ agreementId: created.id, operatorId: colleagueId, grant,
      version: await version(), idempotency_key: randomUUID() })
    const roleArgs = () => ({ operatorId: colleagueId, role: 'requester', idempotency_key: randomUUID() })
    const revoke = client => d.json('/agents/api/agents/' + encodeURIComponent(client.agentId) + '/revoke', { method: 'POST', body: '{}' })
    const error = errorCode
    await owner.adopt(autonomousPolicy())
    await d.command('role.set', { operatorId: sponsorId, role: 'counsel' })
    // Keep the sponsor a reader after demotion so this tests loss of the
    // native write authority independently from restricted-record visibility.
    await d.command('access.set', { agreementId: created.id, operatorId: sponsorId, grant: 'grant', version: await version() })
    const grant = await accessArgs('grant')
    const allowedGrant = await sponsor.tool('locket.access.update', grant)
    assert.equal(allowedGrant.status, 200, 'Active native access control: ' + error(allowedGrant))
    assert.equal(allowedGrant.result?.isError, false)
    assert.deepEqual(grants(await d.state(), created.id), [colleagueId, sponsorId].sort())
    const people = context.ownerClient(), assignment = roleArgs()
    const allowedRole = await people.tool('locket.people.update', assignment)
    assert.equal(allowedRole.result?.isError, false)
    assert.equal(roleOf(await d.state(), colleagueId), 'requester')

    await d.command('role.set', { operatorId: sponsorId, role: 'viewer' })
    await revoke(people)
    let before = await d.snapshot()
    const native = await context.signInSponsor()
    const noAccess = await accessArgs('revoke')
    for (const input of [noAccess, grant]) {
      const refused = await sponsor.tool('locket.access.update', input)
      assert.equal(error(refused), 'FORBIDDEN')
      assert.equal(refused.result?.structuredContent, undefined)
      assert.deepEqual(await d.snapshot(), before)
    }
    for (const input of [roleArgs(), assignment]) {
      const refused = await people.tool('locket.people.update', input)
      assert.equal(refused.status, 401)
      assert.equal(refused.result?.structuredContent, undefined)
      assert.deepEqual(await d.snapshot(), before)
    }
    for (const [type, payload] of [['access.set', noAccess], ['role.set', assignment]]) {
      const refused = await d.send('/api/locket/commands', { method: 'POST', body: JSON.stringify({
        commandId: randomUUID(), type, payload,
      }) }, native.cookie)
      assert.equal(refused.status, 403)
      assert.equal((await refused.json()).error.code, 'FORBIDDEN')
      assert.deepEqual(await d.snapshot(), before)
    }
    console.log('PROBE BASE-AGENT-005 native-authority: native counsel demotion and agent revocation -> current calls and captured replays refuse with unchanged native state')

    const held = heldPolicy()
    held.rules[0].approver = ['role:owner']
    await owner.adopt(held)
    for (const [toolName, args, access] of [
      ['locket.access.update', { agreementId: created.id, operatorId: colleagueId, grant: 'revoke', version: await version() }, true],
      ['locket.people.update', { operatorId: colleagueId, role: 'viewer' }, false],
    ]) {
      await staleApproval({ step: { tool: toolName }, args, tool: owner.tool }, d, { colleagueId }, access)
    }
    await d.command('role.set', { operatorId: sponsorId, role: 'counsel' })
    const pendingAccessArgs = await accessArgs('revoke')
    const pendingAccess = await sponsor.tool('locket.access.update', pendingAccessArgs)
    assert.equal(pendingAccess.result?.resultType, 'input_required')
    await d.command('role.set', { operatorId: sponsorId, role: 'viewer' })
    before = await d.snapshot()
    const accessApproval = await owner.decideApproval(pendingAccess)
    assert.equal(accessApproval.ok, true)
    assert.equal(accessApproval.body.approval.state, 'refused')
    assert.equal(error(await sponsor.tool('locket.access.update', pendingAccessArgs,
      { requestState: pendingAccess.result.requestState })), 'FORBIDDEN')
    assert.deepEqual(await d.snapshot(), before)

    const heldPeople = context.ownerClient(), pendingRoleArgs = { ...roleArgs(), role: 'viewer' }
    const pendingRole = await heldPeople.tool('locket.people.update', pendingRoleArgs)
    assert.equal(pendingRole.result?.resultType, 'input_required')
    await revoke(heldPeople)
    before = await d.snapshot()
    const roleApproval = await owner.decideApproval(pendingRole)
    assert.equal(roleApproval.ok, true)
    assert.equal(roleApproval.body.approval.state, 'refused')
    const retry = await heldPeople.tool('locket.people.update', pendingRoleArgs, { requestState: pendingRole.result.requestState })
    assert.equal(retry.status, 401)
    assert.equal(retry.result?.structuredContent, undefined)
    assert.deepEqual(await d.snapshot(), before)
    console.log('PROBE BASE-AGENT-005 held-authority: stale approval and lost native authority -> both tools refuse, including replay, with unchanged native state')
  } catch (error) {
    console.error('Native authority journey failed:', error.code ?? error.name,
      error.stack?.split('\n').find(line => line.includes('access-parity.mjs:') || line.includes('access-fixture.mjs:')))
    throw error
  } finally { await context.close() }
}

async function staleApproval({ step, args, tool }, d, fixture, access) {
  const state = await d.state()
  const current = state.agreements.find(row => row.id === args.agreementId)
  const listed = await tool('locket.people.list', {})
  const member = listed.result.structuredContent.members.find(row => row.id === fixture.colleagueId)
  const input = {
    ...args, idempotency_key: randomUUID(),
    ...(access ? { version: current.version, grant: args.grant === 'grant' ? 'revoke' : 'grant', expected_revision: current.version }
      : { role: member.role === 'viewer' ? 'requester' : 'viewer' }),
  }
  const before = await d.snapshot()
  const held = await tool(step.tool, input)
  assert.equal(held.result?.resultType, 'input_required')
  assert.deepEqual(await d.snapshot(), before)
  // Advance the native revision without changing the proposed action's class.
  // Direction comparisons alone cannot detect this stale approval.
  if (access) await d.command('request.update', { agreementId: current.id, version: current.version, title: current.title })
  else await d.command('role.set', { operatorId: member.id, role: member.role })
  const afterHuman = await d.snapshot()
  const handle = held.result._meta['com.runeditrun/approval']
  const path = '/agents/api/approvals/' + encodeURIComponent(handle.id)
  const { approval } = await d.json(path)
  const refused = await d.json(path + '/approve', { method: 'POST', body: JSON.stringify({
    revision: approval.revision, summary_sha256: approval.summary_sha256,
  }) })
  assert.equal(refused.approval.state, 'refused')
  const code = access ? 'revision_conflict' : 'approval_evidence_changed'
  assert.equal(refused.approval.code, code)
  const retry = await tool(step.tool, input, { requestState: held.result.requestState })
  assert.equal(retry.result?._meta?.['com.runeditrun/error']?.code, code)
  assert.deepEqual(await d.snapshot(), afterHuman, 'Stale human approval and replay must change nothing')
}
