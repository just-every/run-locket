import assert from 'node:assert/strict'
import { randomUUID, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { installation } from '../api/harness.mjs'
import { verificationOwner } from '../../node_modules/@runeditrun/rer/cli/agent-sponsors.mjs'
import { createProtocol, errorCode } from '../../src/modules/agent-door/conformance/protocol.mjs'
import { accessToken, autonomousPolicy, heldPolicy, seconds, signJws } from '../../src/modules/agent-door/conformance/crypto.mjs'

export async function auditPages(personJson, filters = {}) {
  const rows = [], cursors = []
  let after = '0'
  for (;;) {
    const page = await personJson('/agents/api/audit?' + new URLSearchParams({ ...filters, after }))
    rows.push(...page.rows)
    if (page.cursor === after || page.cursor === null) break
    assert.ok(!cursors.includes(page.cursor), 'Audit pagination must advance')
    cursors.push(page.cursor)
    after = page.cursor
  }
  return { rows, cursors }
}

// All fixtures enter real native and signed Business doors. No audit, command,
// decision, account or session row is inserted by the test.
export default async function auditExportJourney({ createInstallation = installation, keepOpen = false } = {}) {
  const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
  const { email } = await verificationOwner(process.cwd(), surface.verification.owner)
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const kid = randomUUID(), installationId = randomUUID(), sub = randomUUID()
  const issuer = 'https://synthetic-locket-' + randomUUID() + '.invalid'
  const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', pair.publicKey) }
  const secrets = new Set()
  const h = await createInstallation({ bindings: origin => ({
    RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
    RER_OWNER_CLAIM_APP_ORIGIN: origin, RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys), OWNER_EMAIL: email,
    RER_BUSINESS_TRUST: JSON.stringify({ v: 1, issuer, audience: origin, subject: installationId, email, keys: publicKeys }),
  }) })
  try {
    const { origin } = h, cookie = h.owner.cookie, business = 'synthetic-locket-audit'
    for (const value of cookie.split('; ')) secrets.add(value.split('=').slice(1).join('='))
    const request = (absolute, init = {}) => {
      assert.equal(new URL(absolute).origin, origin)
      return h.mf.dispatchFetch(absolute, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    }
    const iat = seconds()
    const settings = await signJws(pair.privateKey, kid, 'rer-business-settings+jwt', {
      v: 1, iss: issuer, aud: origin, sub: installationId, business, email, owner_id: sub,
      jti: randomUUID(), iat, exp: iat + 300, rev: 1, values: {}, logo: null, team: null,
    })
    secrets.add(settings)
    const paired = await h.owner.request('/api/rer/business-settings', { method: 'POST', body: { settings } })
    assert.equal(paired.status, 200)
    await paired.body?.cancel()
    const points = []
    const clients = [1, 2].map(index => {
      const c = createProtocol({ fetch: request, origin, surface,
        signer: { issuer, installationId, kid, privateKey: pair.privateKey },
        person: { email, sub, cookie }, business, consent: randomUUID(),
        agentId: 'synthetic-locket-audit-' + index, points, seq: 0, revision: 0 })
      c.name = 'Synthetic Locket audit ' + index
      c.call = async (name, args, options = {}) => {
        const token = await accessToken(c, { act: { sub: c.agentId, name: c.name, specialist: surface.specialist }, client_id: 'synthetic-locket-client-' + index })
        secrets.add(token)
        return c.mcp('tools/call', { name, arguments: args,
          ...(options.headers?.traceparent ? { _meta: { traceparent: options.headers.traceparent } } : {}),
          ...(options.requestState === undefined ? {} : { requestState: options.requestState }) }, { ...options, token })
      }
      return c
    })
    const [a, b] = clients
    const personJson = async path => {
      const response = await h.owner.request(path)
      assert.equal(response.status, 200)
      return response.json()
    }
    const snapshot = async () => {
      const archive = await personJson('/api/locket/export')
      return { agreements: archive.records.lk_agreements, proposals: archive.records.lk_proposals,
        access: archive.records.lk_access, roles: archive.records.lk_roles, commands: archive.records.lk_agent_commands,
        audit: archive.records.lk_audit.filter(row => ['request.create', 'request.update', 'proposal.prepare', 'access.grant', 'access.revoke', 'role.set'].includes(row.action)) }
    }
    const createArgs = (phase, restricted = false) => ({ title: 'synthetic-locket-audit-' + phase,
      type: 'supplier', party: { name: 'synthetic-locket-audit-party-' + phase, kind: 'supplier',
        ...(restricted ? { taxId: '12-3456789', taxIdKind: 'ein' } : {}) },
      restricted, idempotency_key: randomUUID() })
    const viewer = await h.invite(surface.verification.reviewers[0].email, 'viewer')
    const done = [], pendingIds = [], refusedKeys = [], replayKeys = [], heldReplayKeys = []
    const markReview = async (client, answer) => {
      const id = answer.result?._meta?.['com.runeditrun/review']?.id
      if (!id) return
      const marked = await client.personRequest('/agents/api/reviews/' + id + '/reviewed', { method: 'POST', body: '{}' })
      assert.equal(marked.status, 200)
      assert.equal((await marked.json()).review.state, 'reviewed')
    }
    const execute = async (client, tool, args, effect) => {
      const before = await snapshot()
      let answer = await client.call(tool, args)
      const heldDecision = answer.result?.resultType === 'input_required' ? answer.decision.id : null
      if (heldDecision) {
        assert.deepEqual(await snapshot(), before, 'Held calls must not create a native command or effect')
        assert.equal((await client.decideApproval(answer)).body.approval.state, 'executed')
        answer = await client.call(tool, args, { requestState: answer.result.requestState })
      }
      assert.equal(answer.result?.isError, false, tool + ': ' + errorCode(answer))
      await markReview(client, answer)
      done.push({ key: args.idempotency_key, agent: client, ...effect })
      const after = await snapshot()
      assert.deepEqual((await client.call(tool, args)).result.structuredContent, answer.result.structuredContent)
      assert.deepEqual(await snapshot(), after, 'Every mutator replay retains one native command and effect')
      if (heldDecision) heldReplayKeys.push({ key: args.idempotency_key, decisionId: heldDecision })
      else replayKeys.push(args.idempotency_key)
      return answer.result.structuredContent
    }
    let latest
    for (const [phase, policy] of [['autonomous', autonomousPolicy()], ['held', heldPolicy()]]) {
      const signed = await a.adopt(policy)
      secrets.add(signed.policy)
      const args = createArgs(phase)
      const created = await a.call('locket.requests.create', args, { headers: { traceparent: 'synthetic-locket-trace-' + phase } })
      assert.equal(created.result?.isError, false)
      assert.equal(created.decision.disposition, phase === 'held' ? 'review' : 'autonomous')
      latest = created.result.structuredContent.id
      done.push({ key: args.idempotency_key, agent: a, id: latest, phase })
      if (phase === 'held') {
        const id = created.result._meta['com.runeditrun/review'].id
        const marked = await a.personRequest('/agents/api/reviews/' + id + '/reviewed', { method: 'POST', body: '{}' })
        assert.equal(marked.status, 200)
        assert.equal((await marked.json()).review.state, 'reviewed')
      }
      const beforeReplay = await snapshot()
      const replay = await a.call('locket.requests.create', args)
      assert.deepEqual(replay.result.structuredContent, created.result.structuredContent)
      assert.deepEqual(await snapshot(), beforeReplay)
      replayKeys.push(args.idempotency_key)
      const conflict = await a.call('locket.requests.create', { ...args, title: 'synthetic-locket-changed' })
      assert.equal(errorCode(conflict), 'idempotency_conflict')
      assert.deepEqual(await snapshot(), beforeReplay)
      const current = (await h.owner.state()).agreements.find(row => row.id === latest)
      const updateArgs = { agreementId: latest, version: current.version, expected_revision: current.version,
        title: 'synthetic-locket-updated-' + phase, idempotency_key: randomUUID() }
      const updated = await b.call('locket.requests.update', updateArgs)
      assert.equal(updated.result?.isError, false)
      if (phase === 'held') {
        const id = updated.result._meta['com.runeditrun/review'].id
        const marked = await b.personRequest('/agents/api/reviews/' + id + '/reviewed', { method: 'POST', body: '{}' })
        assert.equal(marked.status, 200)
        assert.equal((await marked.json()).review.state, 'reviewed')
      }
      assert.equal((await h.owner.state()).agreements.find(row => row.id === latest).title, updateArgs.title)
      done.push({ key: updateArgs.idempotency_key, agent: b, id: latest, phase, action: 'request.update',
        target: { kind: 'agreement', id: latest } })
      const beforeUpdateReplay = await snapshot()
      assert.deepEqual((await b.call('locket.requests.update', updateArgs)).result.structuredContent, updated.result.structuredContent)
      assert.deepEqual(await snapshot(), beforeUpdateReplay)
      replayKeys.push(updateArgs.idempotency_key)
      const sensitive = createArgs(phase + '-sensitive', true)
      const beforeHeld = await snapshot()
      let answer = await b.call('locket.requests.create', sensitive)
      if (phase === 'held') {
        assert.equal(answer.result?.resultType, 'input_required')
        assert.deepEqual(await snapshot(), beforeHeld, 'Pending calls have no native effect')
        const approved = await b.decideApproval(answer)
        assert.equal(approved.status, 200)
        assert.equal(approved.body.approval.state, 'executed')
        answer = await b.call('locket.requests.create', sensitive, { requestState: answer.result.requestState })
        const stillPending = await b.call('locket.requests.create', createArgs(phase + '-pending', true))
        pendingIds.push(stillPending.result._meta['com.runeditrun/approval'].id)
        const rejectedArgs = createArgs(phase + '-rejected', true)
        const rejected = await b.call('locket.requests.create', rejectedArgs)
        const decision = await b.decideApproval(rejected, 'reject')
        assert.equal(decision.body.approval.state, 'rejected')
        const rejectedReplay = await b.call('locket.requests.create', rejectedArgs)
        assert.equal(errorCode(rejectedReplay), 'approval_rejected')
        refusedKeys.push(rejectedArgs.idempotency_key)
      }
      assert.equal(answer.result?.isError, false)
      done.push({ key: sensitive.idempotency_key, agent: b, id: answer.result.structuredContent.id, phase })
      const restrictedId = answer.result.structuredContent.id
      // Exercise every currently declared native mutator, not just requests.
      // Their operation and command joins must remain useful in an owner archive.
      const beforeProposal = await h.owner.state()
      const { idempotency_key: unused, ...proposalPayload } = createArgs(phase + '-proposal')
      const proposal = await execute(b, 'locket.proposals.prepare', {
        payload: proposalPayload, evidence: ['synthetic-locket-recorded-request'],
        idempotency_key: randomUUID(),
      }, { action: 'proposal.prepare', id: null, phase })
      const afterProposal = await h.owner.state()
      assert.equal(afterProposal.proposals.find(row => row.id === proposal.id).status, 'pending')
      assert.equal(afterProposal.agreements.length, beforeProposal.agreements.length)
      for (const grant of ['grant', 'revoke']) {
        const agreement = (await h.owner.state()).agreements.find(row => row.id === restrictedId)
        await execute(b, 'locket.access.update', {
          agreementId: restrictedId, operatorId: viewer.id, grant, version: agreement.version,
          expected_revision: agreement.version, idempotency_key: randomUUID(),
        }, { action: 'access.' + grant, id: restrictedId, phase, scope: 'locket:access',
          target: { kind: 'agreement', id: restrictedId } })
        assert.equal((await viewer.state()).agreements.some(row => row.id === restrictedId), grant === 'grant')
      }
      for (const role of ['requester', 'viewer']) {
        const listed = await a.call('locket.people.list', {})
        assert.equal(listed.result?.isError, false)
        const person = listed.result.structuredContent.members.find(row => row.id === viewer.id)
        assert.ok(person)
        await execute(b, 'locket.people.update', {
          operatorId: viewer.id, role, expected_revision: person.revision, idempotency_key: randomUUID(),
        }, { action: 'role.set', id: null, phase, scope: 'locket:people' })
        assert.equal((await viewer.state()).actor.role, role)
      }
      const beforeReads = await snapshot()
      const searched = await a.call('locket.repo.search_and_structured_filters', { query: 'synthetic-locket-updated-' + phase })
      assert.equal(searched.result?.isError, false)
      assert.deepEqual(searched.result.structuredContent.records.map(row => row.id), [latest])
      const counted = await b.call('locket.records.count', {})
      assert.equal(counted.result?.isError, false)
      assert.equal(counted.result.structuredContent.count, beforeReads.agreements.length)
      assert.deepEqual(counted.result.structuredContent.agreements.map(row => row.id).sort(), beforeReads.agreements.map(row => row.id).sort())
      assert.deepEqual(await snapshot(), beforeReads, 'Read tools create audit history without native effects')
      // A real multi-page fixture, split across two agents sharing one sponsor.
      // Reads remain standard under the held policy and enter its review feed.
      for (let index = 0; index < 104; index++) {
        const client = clients[index % 2]
        const read = await client.call('locket.agreements.read', { agreementId: latest })
        assert.equal(read.result?.isError, false)
        assert.equal(read.result.structuredContent.id, latest)
      }
      console.log(`PROBE BASE-AGENT-009 ${phase}: authenticated MCP create, read, retry and human decision -> native effects once, held effects only after approval, distinct agents and retained audit`)
    }
    await a.adopt(null)
    const beforeRefusal = await snapshot()
    assert.equal(errorCode(await a.call('locket.agreements.read', { agreementId: latest })), 'policy_unset')
    await a.adopt({ ...autonomousPolicy(), rules: [{ id: 'blocked', class: '*', do: 'blocked' }] })
    assert.equal(errorCode(await b.call('locket.agreements.read', { agreementId: latest })), 'policy_blocked')
    assert.deepEqual(await snapshot(), beforeRefusal)
    const all = await auditPages(personJson)
    assert.ok(all.rows.length > 200)
    assert.ok(all.cursors.length > 1)
    const archive = await personJson('/api/locket/export')
    assert.deepEqual(archive.agentAudit.rows, all.rows, 'Archive must equal every public audit field on every page')
    const rows = archive.agentAudit.rows
    const nativeIds = new Set(archive.records.lk_agent_commands.map(row => row.operation_id))
    for (const fixture of done) {
      const executions = rows.filter(row => row.idempotency_key === fixture.key && row.outcome === 'done')
      assert.equal(executions.length, 1)
      const row = executions[0]
      assert.equal(row.agent.id, fixture.agent.agentId)
      assert.equal(row.agent.name, fixture.agent.name)
      assert.equal(row.agent.specialist, surface.specialist)
      assert.equal(row.client_id, 'synthetic-locket-client-' + (fixture.agent === a ? 1 : 2))
      assert.equal(row.consent, fixture.agent.consent)
      assert.ok(row.scopes.includes('locket:write'))
      if (fixture.scope) assert.ok(row.scopes.includes(fixture.scope))
      assert.equal(row.label, row.agent.name + ' for ' + row.sponsor.name)
      assert.ok(row.classes.length && row.rules.length && row.revision > 0)
      const commands = archive.records.lk_agent_commands.filter(item => item.operation_id === row.operation_id)
      assert.equal(commands.length, 1)
      assert.equal(commands[0].agent_id, row.agent.id)
      assert.equal(commands[0].sponsor_id, row.sponsor.id)
      const native = archive.records.lk_audit.filter(item => item.command_id === commands[0].command_id)
      assert.equal(native.length, 1)
      assert.equal(native[0].action, fixture.action ?? 'request.create')
      if (fixture.target) assert.deepEqual(row.resource, fixture.target)
      assert.equal(native[0].agreement_id, fixture.id)
      assert.equal(native[0].actor_name, row.label)
      if (fixture.agent === a) assert.equal(row.trace, 'synthetic-locket-trace-' + fixture.phase)
      if (row.approval) {
        const approval = archive.agentAudit.approvals.find(item => item.id === row.approval.id)
        assert.equal(approval.state, 'executed')
        assert.equal(approval.decision_id, row.decision_id)
        assert.deepEqual(approval.approvals.map(mark => mark.person), [row.sponsor.id])
        assert.deepEqual(approval.approvals.map(mark => mark.name), [row.sponsor.name])
        assert.deepEqual(row.approval.by, [row.sponsor.id])
      }
      if (row.review) {
        const review = archive.agentAudit.reviews.find(item => item.id === row.review.id)
        assert.equal(review.state, 'reviewed')
        assert.equal(review.marked_by, row.sponsor.id)
        assert.equal(review.marked_name, row.sponsor.name)
        assert.ok(review.marked_at)
        assert.equal(row.review.by, row.sponsor.id)
      }
    }
    for (const row of rows.filter(row => row.tool === 'locket.agreements.read' && row.outcome === 'done')) {
      assert.equal(row.resource.kind, 'agreement')
      assert.ok(done.some(fixture => fixture.id === row.resource.id))
    }
    for (const tool of surface.tools) {
      assert.ok(rows.some(row => row.tool === tool.name && row.outcome === 'done'), 'Archive retains successful calls to ' + tool.name)
    }
    for (const code of ['policy_unset', 'policy_blocked', 'idempotency_conflict']) {
      const refused = rows.filter(row => row.code === code)
      assert.ok(refused.length, 'Archive retains typed refusal ' + code)
      assert.ok(refused.every(row => row.outcome === 'refused' && !nativeIds.has(row.operation_id)))
    }
    assert.equal(new Set(rows.map(row => row.sponsor.id)).size, 1)
    for (const id of pendingIds) {
      const row = rows.find(row => row.approval?.id === id && row.outcome === 'pending')
      assert.ok(row)
      assert.equal(nativeIds.has(row.operation_id), false)
      assert.deepEqual(row.approval.by, [])
      assert.equal(archive.agentAudit.approvals.find(item => item.id === id).state, 'pending')
    }
    for (const key of refusedKeys) {
      assert.ok(rows.some(row => row.idempotency_key === key && row.code === 'approval_rejected'))
      assert.ok(rows.filter(row => row.idempotency_key === key).every(row => !nativeIds.has(row.operation_id)))
    }
    for (const key of replayKeys) {
      const replay = rows.find(row => row.idempotency_key === key && row.outcome === 'replayed')
      const original = rows.find(row => row.idempotency_key === key && row.outcome === 'done')
      assert.equal(replay.replay_of, original.id)
      assert.equal(replay.operation_id, original.operation_id)
      assert.notEqual(replay.id, original.id)
    }
    for (const { key, decisionId } of heldReplayKeys) {
      const pending = rows.find(row => row.id === decisionId)
      const executed = rows.find(row => row.idempotency_key === key && row.outcome === 'done')
      const replays = rows.filter(row => row.idempotency_key === key && row.outcome === 'replayed')
      assert.equal(pending.outcome, 'pending')
      assert.equal(executed.decision_id, pending.id)
      assert.notEqual(executed.id, pending.id, 'Human approval execution has its own call audit row')
      assert.equal(executed.operation_id, pending.operation_id)
      assert.ok(replays.length)
      for (const replay of replays) {
        assert.equal(replay.replay_of, pending.id, 'Held replay links to the original decision, not a new native effect')
        assert.equal(replay.operation_id, executed.operation_id)
        assert.notEqual(replay.id, executed.id)
      }
    }
    assert.ok(archive.agentAudit.decisions.some(event => event.state === 'rejected' && event.actor.kind === 'person' && event.actor.person.id === rows[0].sponsor.id && event.actor.person.name === rows[0].sponsor.name))
    const classIds = [...new Set(rows.flatMap(row => row.classes.map(item => item.class)))]
    assert.ok(classIds.includes('standard') && classIds.includes('sensitive'))
    for (const filters of [
      ...clients.map(c => ({ agent: c.agentId })), ...classIds.map(value => ({ class: value })),
      { agent: a.agentId, class: 'sensitive' }, { agent: b.agentId, class: 'standard' },
    ]) {
      const expected = rows.filter(row => (!filters.agent || row.agent.id === filters.agent) && (!filters.class || row.classes.some(item => item.class === filters.class)))
      assert.deepEqual((await auditPages(personJson, filters)).rows, expected)
    }
    const refusedArchive = await viewer.request('/api/locket/export')
    assert.equal(refusedArchive.status, 403)
    assert.equal((await refusedArchive.json()).error.code, 'FORBIDDEN')
    const anonymous = await h.request('/api/locket/export')
    assert.equal(anonymous.status, 401)
    await anonymous.body?.cancel()
    const agentArchive = await h.request('/api/locket/export', { headers: { Authorization: 'Bearer ' + await accessToken(a) } })
    assert.equal(agentArchive.status, 401)
    await agentArchive.body?.cancel()
    const revoked = await a.personRequest('/agents/api/agents/' + a.agentId + '/revoke', { method: 'POST', body: '{}' })
    assert.equal(revoked.status, 200)
    await revoked.body?.cancel()
    const beforeRevoked = await snapshot()
    assert.equal((await a.call('locket.agreements.read', { agreementId: latest })).status, 401)
    assert.deepEqual(await snapshot(), beforeRevoked)
    const after = await personJson('/api/locket/export')
    assert.deepEqual(after.agentAudit.rows.slice(0, rows.length), rows)
    assert.ok(after.agentAudit.rows.filter(row => row.agent.id === a.agentId).every(row => row.agent.name === a.name))
    const now = Date.now()
    try {
      await h.setTime(now + 2 * 60 * 60 * 1000)
      const publicApproval = (await personJson('/agents/api/approvals/' + pendingIds[0])).approval
      const expired = await personJson('/api/locket/export')
      assert.equal(publicApproval.state, 'expired')
      assert.equal(expired.agentAudit.approvals.find(row => row.id === pendingIds[0]).state, publicApproval.state)
      assert.deepEqual(expired.agentAudit.rows, after.agentAudit.rows, 'Expiry changes no historical call outcome')
      assert.deepEqual(expired.records.lk_agent_commands, after.records.lk_agent_commands)
    } finally { await h.setTime(now) }
    const serialized = JSON.stringify(after)
    for (const secret of secrets) assert.equal(serialized.includes(secret), false, 'Archive must exclude authentication and signed envelopes')
    assert.doesNotMatch(JSON.stringify(after.agentAudit), /"(?:evidence|saved|envelope|revision_signature|principal|authorization|token|secret)"\s*:/i)
    assert.deepEqual(points.filter(point => !point.ok), [])
    console.log(`PROBE BASE-AGENT-009 export: owner archive -> ${after.agentAudit.rows.length} complete rows, exact paged agent and class sets, native operation and command joins, named decisions; viewer, anonymous and agent-only export refused; revoked agent refused with history intact; no credentials`)
    if (keepOpen) return { h, origin, archive: after, close: () => h.close() }
  } catch (error) { await h.close(); throw error }
  if (!keepOpen) await h.close()
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await auditExportJourney()
