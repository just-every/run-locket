import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { accessToken, autonomousPolicy, heldPolicy } from '../../src/modules/agent-door/conformance/crypto.mjs'

/** Follow the retrieved jobs through their offered native doors, without a tool-name table. */
export default async function promptOperationsJourney(c, native) {
  const state = () => native('/api/locket/state')
  const witness = async () => {
    const current = await state()
    return Object.fromEntries(['agreements', 'parties', 'versions', 'artifacts', 'proposals', 'terms', 'obligations']
      .map(key => [key, current[key]]))
  }
  for (const [phase, policy] of [['autonomous', autonomousPolicy()], ['held', heldPolicy()]]) {
    await c.adopt(policy)
    const initial = await witness()
    const listed = (await c.mcp('tools/list')).result.tools
    const jobs = (await c.mcp('prompts/list')).result.prompts
    const operations = []
    for (const job of jobs) {
      const retrieved = await c.mcp('prompts/get', { name: job.name })
      assert.equal(retrieved.body.error, undefined)
      const text = retrieved.result.messages.map(message => message.content.text).join('\n')
      for (const [, name] of text.matchAll(/^Tool: (.+)$/gm)) {
        const tool = listed.find(tool => tool.name === name)
        assert.ok(tool, 'A retrieved job must lead to a currently offered operation')
        operations.push(tool)
      }
    }
    assert.deepEqual(await witness(), initial, 'Discovering jobs must not perform them')
    const select = predicate => {
      const matches = operations.filter(tool => predicate(tool.inputSchema.properties, tool.annotations))
      assert.equal(matches.length, 1, 'The retrieved jobs must identify one matching native operation')
      return matches[0]
    }
    const create = select((p, a) => !a.readOnlyHint && p.title && p.party)
    const read = select((p, a) => a.readOnlyHint && p.agreementId)
    const edit = select((p, a) => !a.readOnlyHint && p.agreementId && p.title && p.version)
    const prepare = select((p, a) => !a.readOnlyHint && p.payload && p.evidence)
    const perform = async (tool, input, sensitive) => {
      const args = { ...input, ...(tool.annotations.readOnlyHint ? {} : { idempotency_key: randomUUID() }) }
      const before = await witness()
      let answer = await c.tool(tool.name, args)
      assert.equal(answer.status, 200)
      assert.deepEqual(answer.decision.classes.map(item => item.class).sort(), sensitive ? ['sensitive', 'standard'] : ['standard'])
      assert.equal(answer.decision.revision, c.revision)
      assert.equal(answer.decision.disposition, phase === 'held' ? sensitive ? 'approval' : 'review' : 'autonomous')
      if (phase === 'held' && sensitive) {
        assert.equal(answer.result.resultType, 'input_required')
        assert.equal(answer.result.structuredContent, undefined)
        assert.deepEqual(await witness(), before, 'Held guidance cannot authorize a native effect')
        const approved = await c.decideApproval(answer)
        assert.equal(approved.ok, true)
        answer = await c.tool(tool.name, args, { requestState: answer.result.requestState })
      }
      assert.equal(answer.result.isError, false)
      assert.notEqual(answer.result.resultType, 'input_required')
      assert.ok(answer.result.structuredContent)
      if (!tool.annotations.readOnlyHint) {
        const after = await witness()
        const replay = await c.tool(tool.name, args)
        assert.deepEqual(replay.result.structuredContent, answer.result.structuredContent)
        assert.deepEqual(await witness(), after, 'Retrying a prompted operation must not duplicate its native effect')
      }
      return answer.result.structuredContent
    }
    // Both a standard draft and a sensitive draft follow the same discovered job.
    // The latter needs a real signed-in decision under held policy, including reads.
    for (const sensitive of [false, true]) {
      const title = `synthetic-locket-${phase === 'held' ? 4 : 3}${sensitive ? ' EIN 12-3456789' : ''}`
      const created = await perform(create, { title, type: 'supplier', party: { name: 'synthetic-locket-5', kind: 'supplier' }, restricted: true }, sensitive)
      const current = await state()
      const row = current.agreements.find(row => row.id === created.id)
      assert.ok(row)
      assert.equal(row.title, title)
      assert.equal(row.status, 'draft')
      assert.equal(row.restricted, 1)
      const found = await perform(read, { agreementId: row.id }, sensitive)
      assert.equal(found.id, row.id)
      assert.equal(found.title, title)
      assert.equal(found.reference, row.reference)
      assert.equal(found.version, row.version)
      await perform(edit, { agreementId: row.id, title: title + ' revised', version: found.version, expected_revision: found.version }, sensitive)
      const updated = (await state()).agreements.find(item => item.id === row.id)
      assert.equal(updated.title, title + ' revised')
      assert.equal(updated.version, row.version + 1)
    }
    const beforeProposal = await state()
    const proposedTitle = 'synthetic-locket-6 EIN 12-3456789'
    const proposal = await perform(prepare, { payload: { title: proposedTitle, type: 'supplier', party: { name: 'synthetic-locket-7', kind: 'supplier' }, restricted: true }, evidence: ['synthetic-locket-8'], assumptions: [] }, true)
    const afterProposal = await state()
    assert.equal(proposal.status, 'pending')
    const saved = afterProposal.proposals.find(row => row.id === proposal.id)
    assert.equal(saved.status, 'pending')
    assert.equal(saved.decided_by, null)
    assert.equal(saved.agreement_id, null)
    assert.equal(JSON.parse(saved.payload).title, proposedTitle)
    assert.deepEqual(afterProposal.agreements, beforeProposal.agreements, 'Approval to prepare is distinct from a native intake decision')
    // A retrieved prompt is guidance, so it cannot widen a read-only credential.
    const beforeRefusal = await witness()
    const token = await accessToken(c, { scope: read._meta['com.runeditrun/scope'] })
    const refused = await c.tool(create.name, { title: 'synthetic-locket-9', type: 'supplier', party: { name: 'synthetic-locket-10', kind: 'supplier' }, idempotency_key: randomUUID() }, { token })
    assert.equal(refused.status, 403)
    assert.equal(refused.body.error.data.code, 'insufficient_scope')
    assert.deepEqual(await witness(), beforeRefusal)
    console.log(`PROBE BASE-AGENT-013 prompted operations ${phase}: retrieved jobs and live schemas -> standard and sensitive draft creation, exact readback, revisioned title edits, pending intake proposal, once-only retries; held sensitive actions wait for the signed-in person; read-only credential refuses writes without native effect`)
  }
}
