import assert from 'node:assert/strict'
import { randomUUID, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installation } from '../api/harness.mjs'
import { colleagueIdentity } from './colleague.mjs'
import { proposalDecisionAttribution } from './proposal-decision-attribution.mjs'
import { verificationOwner } from '../../node_modules/@runeditrun/rer/cli/agent-sponsors.mjs'
import { createProtocol } from '../../node_modules/@runeditrun/rer/modules/agent-door/conformance/protocol.mjs'
import { autonomousPolicy, heldPolicy, seconds, signJws } from '../../node_modules/@runeditrun/rer/modules/agent-door/conformance/crypto.mjs'

const preparations = new Map()
const applies = ({ phase, step }) => ['autonomous', 'held'].includes(phase) && step.tool === 'locket.proposals.prepare'

function doors({ request, origin, cookie }) {
  const send = (path, init = {}, session = cookie) => request(origin + path, {
    ...init, headers: { Origin: origin, Cookie: session, 'Content-Type': 'application/json', ...init.headers },
  })
  const json = async (path, init, session) => {
    const response = await send(path, init, session)
    assert.equal(response.status, 200, path)
    return response.json()
  }
  const command = (type, payload, session) => json('/api/locket/commands', {
    method: 'POST', body: JSON.stringify({ commandId: randomUUID(), type, payload }),
  }, session)
  const state = session => json('/api/locket/state', undefined, session)
  const archive = () => json('/api/locket/export')
  return { send, json, command, state, archive }
}

export async function beforeStep(context) {
  if (!applies(context)) return
  const d = doors(context), { phase, step, args, tool } = context
  const before = await d.state()
  const held = phase === 'held' && step.expect.some(item => item.class !== 'standard')
  // Top-level person claims are discarded by the shared door before policy and
  // native execution. They must neither substitute identity nor grant approval.
  const injected = await tool(step.tool, { ...args, ...(held ? { idempotency_key: randomUUID() } : {}),
    prepared_by: 'synthetic-locket-forged', prepared_label: 'Synthetic impersonator',
    prepared_agent_id: 'synthetic-locket-forged', decided_by: before.actor.id,
    status: 'approved', person_confirmed: true, confirmed: true, approved: true,
  })
  const after = await d.state()
  assert.deepEqual(after.agreements, before.agreements, 'Preparation never creates an agreement')
  if (held) {
    assert.equal(injected.result?.resultType, 'input_required')
    assert.deepEqual(after.proposals, before.proposals, 'Person claims cannot release a held preparation')
    const path = '/agents/api/approvals/' + encodeURIComponent(injected.result._meta['com.runeditrun/approval'].id)
    const { approval } = await d.json(path)
    await d.json(path + '/reject', { method: 'POST', body: JSON.stringify({
      revision: approval.revision, summary_sha256: approval.summary_sha256,
    }) })
    assert.deepEqual((await d.state()).proposals, before.proposals)
  } else {
    assert.equal(injected.result?.isError, false)
    assert.equal(injected.result.structuredContent.status, 'pending')
  }
  assert.equal(injected.decision?.disposition, held ? 'approval' : phase === 'held' ? 'review' : 'autonomous')
  assert.deepEqual(injected.decision.classes.map(({ class: cls, facts }) => ({ class: cls, facts })), step.expect)
  preparations.set(phase + ':' + step.id, { before, injected, held })
}

export async function afterStep(context) {
  if (!applies(context)) return
  const d = doors(context), { phase, step, args, result, tool } = context
  const proof = preparations.get(phase + ':' + step.id)
  assert.ok(proof)
  let state = await d.state()
  const p = state.proposals.find(row => row.id === result.id)
  assert.equal(p.status, 'pending')
  assert.equal(p.decided_by, null)
  assert.equal(p.decided_at, null)
  assert.equal(p.outcome, null)
  assert.equal(state.proposals.length, proof.before.proposals.length + 1)
  assert.deepEqual(state.agreements, proof.before.agreements)
  assert.equal(p.prepared_by, state.actor.id, 'Native sponsor still controls visibility and self-approval')
  const archive = await d.archive()
  const bindings = archive.records.lk_proposal_agents.filter(row => row.proposal_id === p.id)
  assert.equal(bindings.length, 1)
  const agent = archive.records.lk_agent_commands.find(row => row.command_id === bindings[0].command_id)
  assert.ok(agent)
  assert.equal(p.prepared_command_id, agent.command_id)
  assert.equal(p.prepared_operation_id, agent.operation_id)
  assert.equal(p.prepared_agent_id, agent.agent_id)
  assert.equal(p.prepared_agent_name, agent.agent_name)
  assert.equal(p.prepared_sponsor_id, state.actor.id)
  assert.equal(p.prepared_sponsor_name, state.actor.name)
  assert.equal(p.prepared_label, agent.agent_name + ' for ' + state.actor.name)
  assert.equal(agent.agent_name, 'Agent door conformance')
  assert.deepEqual(JSON.parse(agent.approvers), proof.held ? [{ id: state.actor.id, name: state.actor.name }] : [])
  const operations = []
  let cursor = '0'
  for (;;) {
    const page = await d.json('/agents/api/audit?after=' + cursor)
    operations.push(...page.rows)
    if (page.cursor === cursor || page.cursor === null) break
    cursor = page.cursor
  }
  const operation = operations.find(row => row.operation_id === agent.operation_id && row.outcome === 'done')
  assert.ok(operation)
  assert.equal(operation.tool, step.tool)
  assert.equal(operation.idempotency_key, args.idempotency_key)
  assert.equal(operation.agent.id, agent.agent_id)
  assert.equal(operation.agent.name, agent.agent_name)
  assert.equal(operation.sponsor.id, agent.sponsor_id)
  assert.equal(operation.sponsor.name, agent.sponsor_name)
  assert.equal(operation.decision, phase === 'held' ? proof.held ? 'approval' : 'review' : 'autonomous')
  if (proof.held) assert.deepEqual(operation.approval.by, [state.actor.id])
  const audit = archive.records.lk_audit.filter(row => row.command_id === agent.command_id)
  assert.equal(audit.length, 1)
  assert.equal(audit[0].action, 'proposal.prepare')
  assert.equal(audit[0].actor_name, p.prepared_label)
  assert.equal(audit[0].actor_id, state.actor.id)
  const activity = await d.json('/api/locket/audit?action=proposal.prepare')
  assert.ok(activity.rows.some(row => row.id === audit[0].id && row.actor_name === p.prepared_label))
  const replay = await tool(step.tool, args)
  assert.equal(replay.result?.isError, false)
  assert.deepEqual(replay.result.structuredContent, result)
  assert.deepEqual((await d.state()).proposals, state.proposals)
  assert.deepEqual((await d.archive()).records.lk_proposal_agents, archive.records.lk_proposal_agents)

  const colleague = context.colleague ?? colleagueIdentity()
  const denied = await d.send('/api/locket/commands', { method: 'POST', body: JSON.stringify({
    commandId: randomUUID(), type: 'proposal.decide', payload: { proposalId: p.id, decision: 'approve' },
  }) }, colleague.cookie)
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).error.code, 'FORBIDDEN')
  assert.deepEqual((await d.state()).proposals, state.proposals)
  const decision = step.id === 'proposal_sensitive' ? 'reject' : 'approve'
  await d.command('proposal.decide', { proposalId: p.id, decision, reason: 'Synthetic signed-in decision',
    prepared_by: 'synthetic-locket-forged', decided_by: 'synthetic-locket-forged', prepared_label: 'Synthetic impersonator' })
  state = await d.state()
  const decided = state.proposals.find(row => row.id === p.id)
  assert.equal(decided.status, decision === 'approve' ? 'approved' : 'rejected')
  assert.equal(decided.decided_by, state.actor.id)
  assert.ok(decided.decided_at)
  assert.equal(decided.prepared_label, p.prepared_label)
  assert.equal(decided.prepared_command_id, agent.command_id)
  assert.equal(state.agreements.length, proof.before.agreements.length + (decision === 'approve' ? 1 : 0))
  const exported = await d.archive()
  assert.deepEqual(exported.records.lk_proposal_agents, archive.records.lk_proposal_agents)
  const raw = exported.records.lk_proposals.find(row => row.id === p.id)
  assert.equal(raw.decided_by, state.actor.id)
  assert.equal(raw.prepared_label, p.prepared_label)
  assert.equal(raw.prepared_command_id, agent.command_id)
  assert.equal(raw.prepared_operation_id, agent.operation_id)
  const human = exported.records.lk_audit.find(row => row.action === 'proposal.' + decision &&
    row.command_id !== agent.command_id && row.at === raw.decided_at)
  assert.ok(human)
  assert.equal(human.actor_name, state.actor.name)
  assert.equal(human.actor_id, state.actor.id)
  assert.equal(exported.records.lk_agent_commands.some(row => row.command_id === human.command_id), false)
  const afterDecisionReplay = await tool(step.tool, { ...args, prepared_by: 'synthetic-locket-forged', person_confirmed: true })
  assert.deepEqual(afterDecisionReplay.result.structuredContent, result)
  assert.deepEqual((await d.state()).proposals, state.proposals)
  console.log(`PROBE BASE-AGENT-008 ${phase}.${step.id}: MCP preparation with forged person claims -> pending once, bound agent and sponsor in proposal, activity and archive; signed-in ${decision} retained separately`)
}

// Reusable production Worker fixture for browser proof and focused authority
// checks. Its owner, Business binding and credentials enter through HTTP doors.
export async function attributionFixture(create = installation) {
  const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
  const { email } = await verificationOwner(process.cwd(), surface.verification.owner)
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const issuer = 'https://synthetic-locket.invalid', installationId = randomUUID(), kid = randomUUID(), sub = randomUUID()
  const keys = { [kid]: await webcrypto.subtle.exportKey('jwk', pair.publicKey) }
  const runtime = await create({ bindings: origin => ({
    RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
    RER_OWNER_CLAIM_APP_ORIGIN: origin, RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(keys), OWNER_EMAIL: email,
    RER_BUSINESS_TRUST: JSON.stringify({ v: 1, issuer, audience: origin, subject: installationId, email, keys }),
  }) })
  const h = runtime.h ?? runtime
  try {
    const origin = h.origin, cookie = h.owner.cookie, iat = seconds()
    const request = (url, init = {}) => {
      assert.equal(new URL(url).origin, origin)
      return h.mf.dispatchFetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    }
    const d = doors({ request, origin, cookie })
    const settings = await signJws(pair.privateKey, kid, 'rer-business-settings+jwt', {
      v: 1, iss: issuer, aud: origin, sub: installationId, business: 'rer-agent-conformance', email, owner_id: sub,
      jti: randomUUID(), iat, exp: iat + 300, rev: 1, values: {}, logo: null, team: null,
    })
    await d.json('/api/rer/business-settings', { method: 'POST', body: JSON.stringify({ settings }) })
    const colleague = await h.invite(email.replace('@', '-attribution@'), 'viewer')
    const client = createProtocol({ fetch: request, origin, surface,
      signer: { issuer, installationId, kid, privateKey: pair.privateKey },
      person: { email, sub, cookie }, business: 'rer-agent-conformance', consent: randomUUID(),
      agentId: 'synthetic-locket-' + randomUUID(), points: [], seq: 0, revision: 0, listed: new Map(),
    })
    client.sponsor.id = (await d.state()).actor.id
    return { ...d, h, runtime, client, colleague, origin, cookie, request,
      close: () => runtime.close() }
  } catch (error) { await runtime.close(); throw error }
}

export async function attributionJourney() {
  const fixture = await attributionFixture()
  try {
    const { client, colleague } = fixture
    const step = { id: 'proposal', tool: 'locket.proposals.prepare', expect: [{ class: 'standard', facts: { measure: 1 } }] }
    for (const [phase, policy] of [['autonomous', autonomousPolicy()], ['held', heldPolicy()]]) {
      await client.adopt(policy)
      const args = { payload: { title: 'synthetic-locket-attribution-' + phase, type: 'other',
        party: { name: 'synthetic-locket-attribution', kind: 'supplier' } },
      evidence: ['synthetic-locket-attribution'], idempotency_key: randomUUID() }
      for (const sensitive of [false, true]) {
        const current = sensitive ? { ...step, id: 'proposal_sensitive', expect: [...step.expect, { class: 'sensitive', facts: { measure: 1, kind: 'tax_identifier' } }] } : step
        const input = { ...args, idempotency_key: randomUUID(), evidence: sensitive ? ['The source records supplier EIN 12-3456789.'] : args.evidence }
        const context = { ...fixture, phase, step: current, args: input, tool: client.tool }
        await beforeStep(context)
        let answer = await client.tool(current.tool, input)
        if (answer.result?.resultType === 'input_required') {
          assert.equal((await client.decideApproval(answer)).ok, true)
          answer = await client.tool(current.tool, input, { requestState: answer.result.requestState })
        }
        assert.equal(answer.result?.isError, false)
        await afterStep({ ...context, result: answer.result.structuredContent })
      }
    }
    // Deleting an unused native draft removes its proposal binding, while a
    // captured prepare replay remains a receipt and cannot restore the draft.
    await client.adopt(autonomousPolicy())
    await proposalDecisionAttribution(fixture)
    const erasedArgs = { payload: { title: 'synthetic-locket-erasure', type: 'other',
      party: { name: 'synthetic-locket-erasure', kind: 'supplier' } }, evidence: ['synthetic-locket-erasure'], idempotency_key: randomUUID() }
    const erased = await client.tool(step.tool, erasedArgs)
    const erasedId = erased.result.structuredContent.id
    const applied = await fixture.command('proposal.decide', { proposalId: erasedId, decision: 'approve' })
    const agreementId = applied.result.outcome.id
    const draft = (await fixture.state()).agreements.find(row => row.id === agreementId)
    await fixture.command('draft.delete', { agreementId, version: draft.version, reason: 'Synthetic unused draft erasure' })
    const deleted = await fixture.state()
    assert.equal(deleted.agreements.some(row => row.id === agreementId), false)
    assert.equal(deleted.proposals.some(row => row.id === erasedId), false)
    assert.equal((await fixture.archive()).records.lk_proposal_agents.some(row => row.proposal_id === erasedId), false)
    const captured = await client.tool(step.tool, erasedArgs)
    assert.deepEqual(captured.result.structuredContent, erased.result.structuredContent)
    assert.deepEqual((await fixture.state()).proposals, deleted.proposals)
    assert.deepEqual((await fixture.state()).agreements, deleted.agreements)
    console.log('PROBE BASE-AGENT-008 erasure: owner draft deletion -> proposal and binding removed; captured MCP replay -> retained receipt, no restored proposal or agreement')
    // Restricted intake remains invisible to an unrelated viewer, including
    // its new preparer fields. Sponsor self-approval remains denied off-owner.
    await client.adopt(autonomousPolicy())
    const args = { payload: { title: 'synthetic-locket-restricted', type: 'other', restricted: true,
      party: { name: 'synthetic-locket-restricted', kind: 'supplier' } }, evidence: ['synthetic-locket-1'], idempotency_key: randomUUID() }
    const answer = await client.tool(step.tool, args)
    const id = answer.result.structuredContent.id
    assert.equal((await fixture.state(colleague.cookie)).proposals.some(row => row.id === id), false)
    const refused = await fixture.send('/api/locket/commands', { method: 'POST', body: JSON.stringify({
      commandId: randomUUID(), type: 'proposal.decide', payload: { proposalId: id, decision: 'approve' },
    }) }, colleague.cookie)
    assert.equal(refused.status, 404)
    assert.equal((await refused.json()).error.code, 'NOT_FOUND')
    const own = await fixture.send('/api/locket/commands', { method: 'POST', body: JSON.stringify({
      commandId: randomUUID(), type: 'proposal.prepare', payload: { kind: 'intake', payload: args.payload, evidence: args.evidence },
    }) }, colleague.cookie)
    assert.equal(own.status, 403)
    assert.equal((await own.json()).error.code, 'FORBIDDEN')
    await fixture.command('role.set', { operatorId: colleague.id, role: 'requester' })
    const human = await fixture.command('proposal.prepare', { kind: 'intake', payload: args.payload, evidence: args.evidence,
      prepared_by: 'synthetic-locket-forged', prepared_label: 'Synthetic impersonator' }, colleague.cookie)
    const self = await fixture.send('/api/locket/commands', { method: 'POST', body: JSON.stringify({
      commandId: randomUUID(), type: 'proposal.decide', payload: { proposalId: human.result.id, decision: 'approve' },
    }) }, colleague.cookie)
    assert.equal(self.status, 403)
    assert.equal((await self.json()).error.code, 'SELF_APPROVAL')
    const p = (await fixture.state()).proposals.find(row => row.id === human.result.id)
    assert.equal(p.status, 'pending')
    assert.equal(p.prepared_by, colleague.id)
    assert.equal(p.prepared_label, null)
    assert.equal((await fixture.archive()).records.lk_proposal_agents.some(row => row.proposal_id === p.id), false)
    const beforeRevocation = await fixture.state()
    await fixture.json('/agents/api/agents/' + encodeURIComponent(client.agentId) + '/revoke', { method: 'POST', body: '{}' })
    const replay = await client.tool(step.tool, args)
    assert.equal(replay.status, 401)
    assert.equal(replay.result?.structuredContent, undefined)
    assert.deepEqual((await fixture.state()).proposals, beforeRevocation.proposals)
    console.log('PROBE BASE-AGENT-008 authority: restricted native read and decision -> 404; viewer preparation and requester self-approval -> 403; revoked MCP replay -> 401; provenance unchanged')
  } finally { await fixture.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await attributionJourney()
