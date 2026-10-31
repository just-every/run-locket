import assert from 'node:assert/strict'
import { randomUUID, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { serveHosted, HOSTED_ORIGIN } from '../../node_modules/@runeditrun/rer/cli/hosted-output.mjs'
import { verificationSponsors } from '../../node_modules/@runeditrun/rer/cli/agent-sponsors.mjs'
import { createProtocol, VERSION, DECISION } from '../../src/modules/agent-door/conformance/protocol.mjs'
import { accessToken, autonomousPolicy, heldPolicy, seconds, signJws } from '../../src/modules/agent-door/conformance/crypto.mjs'

// Exercise the unchanged production capacity in a disposable Worker and D1.
// Raw MCP requests deliberately bypass the conformance client's 429 retries.
export default async function capacityJourney() {
  const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
  const { email, sub } = (await verificationSponsors(process.cwd(), { owner: surface.verification.owner }))[0]
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const kid = randomUUID(), installationId = randomUUID(), issuer = 'https://synthetic-locket.invalid'
  const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', pair.publicKey) }
  let networkAttempts = 0
  const hosted = await serveHosted(process.cwd(), { bindings: {
    RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
    RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys), OWNER_EMAIL: email,
    RER_BUSINESS_TRUST: JSON.stringify({ v: 1, issuer, audience: HOSTED_ORIGIN, subject: installationId, email, keys: publicKeys }),
  }, outboundService: () => { networkAttempts++; throw new Error('Capacity journey must not contact a provider') } })
  try {
    const origin = hosted.origin, business = 'synthetic-locket-11'
    const request = (absolute, init = {}) => {
      const url = new URL(absolute)
      assert.equal(url.origin, origin)
      return hosted.fetch(url.href.slice(origin.length + 1), { ...init, signal: AbortSignal.timeout(30_000) })
    }
    const signed = (type, payload) => signJws(pair.privateKey, kid, type, payload)
    const iat = seconds()
    const claim = await signed('rer-owner-claim+jwt', { v: 1, iss: issuer, aud: origin, installationId, email, jti: randomUUID(), iat, exp: iat + 300 })
    const boot = await request(origin + '/auth/owner-claim', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: claim, displayName: 'Synthetic Locket', returnTo: '/app' }) })
    assert.equal(boot.status, 303)
    const cookie = boot.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
    assert.ok(cookie)
    await boot.body?.cancel()
    const settings = await signed('rer-business-settings+jwt', { v: 1, iss: issuer, aud: origin, sub: installationId, business, email, owner_id: sub, jti: randomUUID(), iat, exp: iat + 300, rev: 1, values: {}, logo: null, team: null })
    const paired = await request(origin + '/api/rer/business-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }) })
    assert.equal(paired.status, 200)
    assert.equal((await paired.json()).rev, 1)
    const points = []
    const c = createProtocol({ fetch: request, origin, surface, signer: { issuer, installationId, kid, privateKey: pair.privateKey }, person: { email, sub, cookie }, business, consent: randomUUID(), agentId: randomUUID(), points, seq: 0, revision: 0 })
    let requestId = 0
    const raw = async (token, method, params = {}) => {
      const id = ++requestId
      const response = await request(origin + '/mcp', { method: 'POST', headers: {
        Origin: origin, Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json',
        'MCP-Protocol-Version': VERSION, 'Mcp-Method': method,
        ...(method === 'tools/call' ? { 'Mcp-Name': params.name } : {}),
      }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: {
        'io.modelcontextprotocol/protocolVersion': VERSION,
        'io.modelcontextprotocol/clientCapabilities': { elicitation: { url: {} } },
      } } }) })
      const body = await response.json()
      assert.equal(body.id, id)
      return { status: response.status, headers: response.headers, body, result: body.result, decision: body.result?._meta?.[DECISION] }
    }
    const native = async (path, init = {}) => {
      const response = await request(origin + path, { ...init, headers: {
        Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...init.headers,
      } })
      assert.equal(response.status, 200)
      return response.json()
    }
    const snapshot = async () => {
      const state = await native('/api/locket/state')
      return { agreements: state.agreements, parties: state.parties, audit: state.audit,
        records: (await native('/api/locket/export')).records }
    }
    const limited = answer => {
      assert.equal(answer.status, 429)
      assert.equal(answer.body.error?.data?.code, 'rate_limited')
      assert.equal(answer.result, undefined, 'A capacity refusal returns no tool result or approval')
      assert.match(answer.headers.get('retry-after') ?? '', /^\d+$/)
      const retryAfter = Number(answer.headers.get('retry-after'))
      assert.ok(retryAfter > 0 && retryAfter <= 60, 'Retry-After is positive and bounded to one minute')
      return retryAfter
    }
    const argsFor = label => ({ title: `synthetic-locket-11-${label} 00-0000000`, type: 'supplier',
      party: { name: 'synthetic-locket-11-' + label, kind: 'supplier' }, idempotency_key: randomUUID() })
    const create = async (token, args, phase) => {
      const before = await snapshot()
      let answer = await raw(token, 'tools/call', { name: 'locket.requests.create', arguments: args })
      assert.equal(answer.status, 200)
      if (phase === 'held') {
        assert.equal(answer.result?.resultType, 'input_required')
        assert.equal(answer.decision.disposition, 'approval')
        assert.ok(answer.decision.classes.some(item => item.class === 'sensitive'))
        assert.deepEqual(await snapshot(), before, 'Held mutations have no native effect before approval')
        const decision = await c.decideApproval(answer)
        assert.equal(decision.ok, true)
        assert.equal(decision.body.approval.state, 'executed')
        answer = await raw(token, 'tools/call', { name: 'locket.requests.create', arguments: args, requestState: answer.result.requestState })
      }
      assert.equal(answer.result?.isError, false)
      const id = answer.result.structuredContent.id
      const after = await snapshot()
      assert.equal(after.agreements.length, before.agreements.length + 1)
      assert.equal(after.agreements.find(row => row.id === id)?.title, args.title)
      assert.equal(after.records.lk_agent_commands.length, before.records.lk_agent_commands.length + 1)
      const effect = (await native('/api/locket/audit?agreement=' + id)).rows.filter(row => row.action === 'request.create')
      assert.equal(effect.length, 1)
      return id
    }
    const discovery = await raw(await accessToken(c), 'server/discover')
    assert.equal(discovery.status, 200)
    const limits = discovery.result._meta['com.runeditrun/limits']
    assert.ok(Number.isSafeInteger(limits.requestsPerMinute) && limits.requestsPerMinute > 0)
    assert.ok(Number.isSafeInteger(limits.maxBodyBytes) && limits.maxBodyBytes > 0)
    for (const [phase, policy] of [['autonomous', autonomousPolicy()], ['held', heldPolicy()]]) {
      await c.adopt(policy)
      c.agentId = randomUUID()
      const exhaustedAgent = c.agentId, token = await accessToken(c)
      const before = await snapshot(), args = argsFor(phase)
      let accepted = 0, refusal
      // Allow one window rollover while filling; never assert against a date
      // boundary or reduce the production limit to make exhaustion cheaper.
      for (let attempt = 0; attempt <= limits.requestsPerMinute * 2; attempt++) {
        const answer = await raw(token, 'tools/list')
        if (answer.status === 429) { limited(answer); refusal = answer; break }
        assert.equal(answer.status, 200)
        assert.ok(answer.result.tools.some(tool => tool.name === 'locket.requests.create'))
        accepted++
      }
      assert.ok(refusal, 'Authenticated raw requests must exhaust the discovered capacity')
      assert.ok(accepted >= limits.requestsPerMinute)
      // If filling ended at the very edge, enter the next advertised window
      // before repeating, so the mutation probe is not a boundary race.
      if (limited(refusal) <= 2) {
        await new Promise(resolve => setTimeout(resolve, limited(refusal) * 1000))
        for (let attempt = 0; attempt < limits.requestsPerMinute; attempt++) {
          const answer = await raw(token, 'tools/list')
          assert.equal(answer.status, 200)
        }
      }
      const deniedAt = Date.now()
      const denied = await raw(token, 'tools/call', { name: 'locket.requests.create', arguments: args })
      const retryAfter = limited(denied)
      assert.deepEqual(await snapshot(), before, 'Refused mutation changes no native record, command, audit or archive data')
      const healthyAgent = randomUUID()
      assert.notEqual(healthyAgent, exhaustedAgent)
      const otherToken = await accessToken(c, { act: { sub: healthyAgent, name: 'Synthetic Locket second agent', specialist: surface.specialist } })
      const other = await raw(otherToken, 'tools/list')
      assert.equal(other.status, 200)
      assert.ok(other.result.tools.some(tool => tool.name === 'locket.requests.create'))
      await create(otherToken, argsFor(phase + '-other'), phase)
      const human = await native('/api/locket/commands', { method: 'POST', body: JSON.stringify({ commandId: randomUUID(), type: 'request.create', payload: {
        title: 'synthetic-locket-11-person-' + phase, type: 'supplier', party: { name: 'synthetic-locket-11-person', kind: 'supplier' }, restricted: false,
      } }) })
      assert.equal(human.ok, true)
      assert.ok((await native('/api/locket/state')).agreements.some(row => row.id === human.result.id))
      console.log(`PROBE BASE-AGENT-011 point-1 ${phase}: raw authenticated MCP, discovered requestsPerMinute=${limits.requestsPerMinute} maxBodyBytes=${limits.maxBodyBytes}, accepted=${accepted} -> HTTP 429 rate_limited Retry-After=${retryAfter}; no tool result or native effect; same-sponsor second agent mutation and native person-session mutation succeed`)
      await new Promise(resolve => setTimeout(resolve, Math.max(0, retryAfter * 1000 - (Date.now() - deniedAt))))
      const recovered = await create(token, args, phase)
      assert.ok(recovered)
      console.log(`PROBE BASE-AGENT-011 point-1 ${phase} recovery: same exhausted credential after advertised ${retryAfter}s -> request created once, with required human approval under held policy`)
    }
    assert.equal(networkAttempts, 0)
    assert.deepEqual(points.filter(point => !point.ok), [])
  } finally { await hosted.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await capacityJourney()
