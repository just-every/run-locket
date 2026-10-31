import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { errorCode } from '../../node_modules/@runeditrun/rer/modules/agent-door/conformance/protocol.mjs'

/** One intake survives concurrent capture replay; another person owns its decision. */
export async function proposalDecisionAttribution(f) {
  const args = { payload: { title: 'synthetic-locket-concurrent-intake', type: 'other',
    party: { name: 'synthetic-locket-concurrent', kind: 'supplier' } },
  evidence: ['synthetic-locket-request'], idempotency_key: randomUUID() }
  const before = await f.state()
  const answers = await Promise.all([f.client.tool('locket.proposals.prepare', args),
    f.client.tool('locket.proposals.prepare', { ...args, prepared_by: f.colleague.id, person_confirmed: true })])
  assert.ok(answers.some(answer => answer.result?.isError === false))
  for (const answer of answers) {
    if (answer.result?.isError !== false) assert.equal(errorCode(answer), 'decision_busy')
  }
  const captured = await f.client.tool('locket.proposals.prepare', args)
  assert.equal(captured.result?.isError, false)
  const id = captured.result.structuredContent.id
  const pending = await f.state(), p = pending.proposals.find(row => row.id === id)
  assert.equal(pending.proposals.length, before.proposals.length + 1)
  assert.deepEqual(pending.agreements, before.agreements)
  assert.equal(p.status, 'pending')
  assert.equal(p.decided_by, null)
  assert.equal(p.prepared_sponsor_id, before.actor.id)
  const archive = await f.archive()
  assert.deepEqual(archive.records.lk_proposal_agents.filter(row => row.proposal_id === id),
    [{ proposal_id: id, command_id: p.prepared_command_id }])
  assert.equal(archive.records.lk_agent_commands.filter(row => row.command_id === p.prepared_command_id).length, 1)
  assert.equal(archive.records.lk_audit.filter(row => row.command_id === p.prepared_command_id).length, 1)

  await f.command('role.set', { operatorId: f.colleague.id, role: 'requester' })
  const person = (await f.state()).operators.find(row => row.id === f.colleague.id)
  const commandId = randomUUID()
  const decide = () => f.json('/api/locket/commands', { method: 'POST', body: JSON.stringify({ commandId,
    type: 'proposal.decide', payload: { proposalId: id, decision: 'approve', decided_by: before.actor.id,
      prepared_by: f.colleague.id, prepared_label: 'Synthetic impersonator', person_confirmed: true },
  }) }, f.colleague.cookie)
  const decisions = await Promise.all([decide(), decide()])
  assert.deepEqual(decisions[0].result, decisions[1].result)
  const after = await f.state(), approved = after.proposals.find(row => row.id === id)
  assert.equal(after.agreements.length, before.agreements.length + 1)
  assert.equal(approved.status, 'approved')
  assert.equal(approved.decided_by, person.id)
  assert.notEqual(approved.decided_by, approved.prepared_by)
  for (const key of Object.keys(p).filter(key => key.startsWith('prepared_'))) assert.equal(approved[key], p[key])
  const exported = await f.archive(), raw = exported.records.lk_proposals.find(row => row.id === id)
  assert.equal(raw.decided_by, person.id)
  assert.equal(raw.prepared_label, p.prepared_label)
  assert.equal(raw.prepared_operation_id, p.prepared_operation_id)
  assert.deepEqual(exported.records.lk_proposal_agents, archive.records.lk_proposal_agents)
  const human = exported.records.lk_audit.filter(row => row.command_id === commandId && row.action === 'proposal.approve')
  assert.equal(human.length, 1)
  assert.equal(human[0].actor_id, person.id)
  assert.equal(human[0].actor_name, person.name)
  assert.equal(exported.records.lk_agent_commands.some(row => row.command_id === commandId), false)
  assert.ok(after.audit.some(row => row.id === human[0].id && row.actor_name === person.name))
  const replay = await f.client.tool('locket.proposals.prepare', args)
  assert.deepEqual(replay.result.structuredContent, captured.result.structuredContent)
  assert.deepEqual((await f.state()).proposals, after.proposals)
  assert.deepEqual((await f.state()).agreements, after.agreements)
  // Leave the shared fixture's colleague with the rights its negative paths expect.
  await f.command('role.set', { operatorId: f.colleague.id, role: 'viewer' })
  console.log('PROBE BASE-AGENT-008 concurrency: simultaneous MCP capture and native decision replay -> one pending proposal, one agreement and one human decision; original agent and sponsor binding unchanged')
}
