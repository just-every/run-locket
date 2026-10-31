import assert from 'node:assert/strict'
import { randomUUID, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { serveHosted, HOSTED_ORIGIN } from '../../node_modules/@runeditrun/rer/cli/hosted-output.mjs'
import { verificationSponsors } from '../../node_modules/@runeditrun/rer/cli/agent-sponsors.mjs'
import { createProtocol } from '../../src/modules/agent-door/conformance/protocol.mjs'
import { autonomousPolicy, heldPolicy, seconds, signJws } from '../../src/modules/agent-door/conformance/crypto.mjs'

function message(text, contentType) {
  if (!contentType?.includes('text/event-stream')) return JSON.parse(text)
  const messages = text.split(/\r?\n\r?\n/).map(block => block.split(/\r?\n/)
    .filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'))
    .filter(Boolean).map(value => JSON.parse(value))
  return messages.findLast(item => item.id !== undefined)
}

// Only the downstream connection is disposable. Every result comes from the
// production Worker; nothing here replaces a result or writes fixture SQL.
async function transport(forward) {
  const wire = [], sockets = new WeakMap()
  let connections = 0, drop, failure
  const server = createServer(async (incoming, outgoing) => {
    try {
      assert.equal(incoming.method, 'POST')
      assert.equal(incoming.url, '/mcp')
      const chunks = []
      for await (const chunk of incoming) chunks.push(chunk)
      const body = Buffer.concat(chunks).toString()
      const rpc = JSON.parse(body)
      const entry = { id: rpc.id, args: rpc.params.arguments, connection: sockets.get(incoming.socket), responseStarted: false, bytes: 0 }
      wire.push(entry)
      const headers = new Headers(incoming.headers)
      // Reframe the buffered body for the upstream connection. Downstream
      // chunking and connection headers do not describe that new request.
      for (const name of ['host', 'connection', 'transfer-encoding', 'content-length']) headers.delete(name)
      const upstream = await forward('mcp', { method: 'POST', headers: Object.fromEntries(headers), body })
      const text = await upstream.text()
      entry.answer = message(text, upstream.headers.get('content-type'))
      assert.equal(entry.answer.id, rpc.id)
      if (drop) {
        const verify = drop
        drop = undefined
        assert.equal(upstream.status, 200)
        // This must complete before the socket closes, with no headers or body
        // written to the caller. A committed effect alone cannot fake a result.
        await verify(entry.answer)
        assert.equal(outgoing.headersSent, false)
        outgoing.destroy()
      } else {
        outgoing.writeHead(upstream.status, Object.fromEntries(upstream.headers))
        outgoing.end(text)
      }
    } catch (error) { failure = error; outgoing.destroy() }
  })
  server.on('connection', socket => sockets.set(socket, ++connections))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    wire,
    drop(verify) { assert.equal(drop, undefined); drop = verify },
    check() { assert.ifError(failure); assert.equal(drop, undefined) },
    fetch(_absolute, init) {
      return new Promise((resolve, reject) => {
        // No pooled socket and no automatic transport retry: a retry is a new
        // HTTP connection carrying the protocol client's next JSON-RPC id.
        const request = httpRequest({ host: '127.0.0.1', port, path: '/mcp', method: 'POST',
          agent: false, headers: init.headers, signal: init.signal }, response => {
          const entry = wire.at(-1), chunks = []
          entry.responseStarted = true
          response.on('data', chunk => { entry.bytes += chunk.length; chunks.push(chunk) })
          response.on('error', reject)
          response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
            status: response.statusCode, headers: response.headers,
          })))
        })
        request.on('error', reject)
        request.end(init.body)
      })
    },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) },
  }
}

export default async function transportReplayJourney() {
  const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
  const { email, sub } = (await verificationSponsors(process.cwd(), { owner: surface.verification.owner }))[0]
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const kid = randomUUID(), installationId = randomUUID(), issuer = 'https://synthetic-locket.invalid'
  const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', pair.publicKey) }
  let networkAttempts = 0, proxy
  const hosted = await serveHosted(process.cwd(), { bindings: {
    RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
    RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys), OWNER_EMAIL: email,
    RER_BUSINESS_TRUST: JSON.stringify({ v: 1, issuer, audience: HOSTED_ORIGIN, subject: installationId, email, keys: publicKeys }),
  }, outboundService: () => { networkAttempts++; throw new Error('Replay journey must not contact a provider') } })
  try {
    const origin = hosted.origin, business = 'synthetic-locket-12'
    proxy = await transport((path, init) => hosted.fetch(path, { ...init, signal: AbortSignal.timeout(30_000) }))
    const request = (absolute, init = {}) => {
      const url = new URL(absolute)
      assert.equal(url.origin, origin)
      const send = url.pathname === '/mcp' ? proxy.fetch : (_url, options) => hosted.fetch(url.href.slice(origin.length + 1), options)
      return send(absolute, { ...init, signal: AbortSignal.timeout(30_000) })
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
    const native = async path => {
      const response = await c.personRequest(path)
      assert.equal(response.status, 200)
      return response.json()
    }
    const doorAudit = async key => {
      const rows = []
      let after = '0'
      for (;;) {
        const page = await native('/agents/api/audit?after=' + after)
        rows.push(...page.rows.filter(row => row.idempotency_key === key))
        if (page.cursor === after || page.cursor === null) return rows
        after = page.cursor
      }
    }
    const snapshot = async () => {
      const state = await native('/api/locket/state')
      return { agreements: state.agreements, parties: state.parties, audit: state.audit,
        records: (await native('/api/locket/export')).records }
    }
    for (const [phase, policy] of [['autonomous', autonomousPolicy()], ['held', heldPolicy()]]) {
      await c.adopt(policy)
      let agreementId
      for (const kind of ['create', 'update']) {
        const before = await snapshot()
        const prior = before.agreements.find(row => row.id === agreementId)
        // A conspicuously synthetic tax-shaped title makes both verbs sensitive,
        // so held policy must require approval rather than standard review.
        const title = `synthetic-locket-${kind === 'create' ? 12 : 13}-${phase} 00-0000000`
        const args = { ...(kind === 'create' ? { title, type: 'supplier', party: { name: 'synthetic-locket-12-' + phase, kind: 'supplier' } }
          : { agreementId, title, version: prior.version, expected_revision: prior.version }), idempotency_key: randomUUID() }
        const name = 'locket.requests.' + kind
        let pending, approvalBefore, approvalPath
        if (phase === 'held') {
          pending = await c.tool(name, args)
          assert.equal(pending.result?.resultType, 'input_required')
          assert.equal(pending.decision.disposition, 'approval')
          assert.ok(pending.decision.classes.some(item => item.class === 'sensitive'))
          assert.deepEqual(await snapshot(), before, 'No native effect before the signed-in person approves')
          const handle = pending.result._meta['com.runeditrun/approval']
          const url = new URL(handle.url)
          assert.equal(url.origin, origin)
          assert.equal(url.pathname, '/agents/approvals/' + handle.id)
          const page = await c.personRequest(url.href)
          assert.equal(page.status, 200, 'The returned approval door opens for the authorized signed-in person')
          await page.body?.cancel()
          const decision = await c.decideApproval(pending)
          assert.equal(decision.ok, true)
          assert.equal(decision.body.approval.state, 'executed')
          approvalBefore = decision.body.approval
          approvalPath = '/agents/api/approvals/' + handle.id
          assert.equal(approvalBefore.approvals.length, 1)
          assert.equal(approvalBefore.approvals[0].person, (await native('/api/locket/state')).actor.id)
        }
        const options = pending ? { requestState: pending.result.requestState } : undefined
        let recorded, committed
        proxy.drop(async answer => {
          assert.equal(answer.error, undefined)
          assert.equal(answer.result?.isError, false)
          recorded = answer.result
          agreementId = kind === 'create' ? recorded.structuredContent.id : agreementId
          assert.ok(agreementId)
          assert.deepEqual(JSON.parse(recorded.content.find(item => item.type === 'text').text), recorded.structuredContent)
          committed = await snapshot()
          const row = committed.agreements.find(row => row.id === agreementId)
          assert.ok(row)
          assert.equal(row.title, title)
          assert.equal(row.version, kind === 'create' ? 1 : prior.version + 1)
          assert.equal(committed.agreements.length, before.agreements.length + (kind === 'create' ? 1 : 0))
          assert.equal(committed.records.lk_agent_commands.length, before.records.lk_agent_commands.length + 1)
        })
        const start = proxy.wire.length
        await assert.rejects(c.tool(name, args, options), { code: 'ECONNRESET' })
        proxy.check()
        const lost = proxy.wire[start]
        assert.equal(lost.responseStarted, false, 'No HTTP response headers reached the caller')
        assert.equal(lost.bytes, 0, 'No response bytes reached the caller')
        const initialAudit = await doorAudit(args.idempotency_key)
        const effects = initialAudit.filter(row => row.outcome === 'done')
        assert.equal(effects.length, 1)
        const original = effects[0]
        const replayOf = pending ? pending.decision.id : original.id
        const initialReplays = initialAudit.filter(row => row.outcome === 'replayed').length
        for (let retry = 1; retry <= 2; retry++) {
          const recovered = await c.tool(name, args, options)
          assert.equal(recovered.result?.isError, false)
          assert.deepEqual(recovered.result.structuredContent, recorded.structuredContent)
          assert.deepEqual(recovered.result.content, recorded.content)
          if (pending) {
            const receipt = recorded._meta['com.runeditrun/receipt']
            assert.ok(receipt.id)
            assert.equal(receipt.approval_id, approvalBefore.id)
            assert.equal(receipt.decision_id, pending.decision.id)
            assert.deepEqual(receipt.approved_by, [original.sponsor.id])
            assert.deepEqual(recovered.result._meta['com.runeditrun/receipt'], recorded._meta['com.runeditrun/receipt'])
            assert.deepEqual((await native(approvalPath)).approval, approvalBefore, 'Replay retains the original human decision')
          }
          assert.deepEqual(await snapshot(), committed, 'Replay cannot add a record, revision, command or native audit effect')
          const rows = await doorAudit(args.idempotency_key)
          const replays = rows.filter(row => row.outcome === 'replayed')
          assert.equal(replays.length, initialReplays + retry, 'Each retry retains its separate replay audit row')
          assert.equal(new Set(rows.map(row => row.id)).size, rows.length)
          for (const row of replays) {
            assert.equal(row.operation_id, original.operation_id)
            assert.equal(row.replay_of, replayOf)
            assert.deepEqual(row.approval, original.approval)
          }
          assert.equal(rows.filter(row => row.outcome === 'done').length, 1)
        }
        const requests = proxy.wire.slice(start)
        assert.equal(requests.length, 3)
        assert.equal(new Set(requests.map(row => row.id)).size, 3, 'Fresh JSON-RPC ids carry the same idempotency key')
        assert.equal(new Set(requests.map(row => row.connection)).size, 3, 'Every attempt uses a new HTTP connection')
        for (const row of requests) assert.deepEqual(row.args, args)
        const commands = committed.records.lk_agent_commands.filter(row => row.operation_id === original.operation_id)
        assert.equal(commands.length, 1)
        const command = commands[0]
        assert.equal(command.agent_id, c.agentId)
        assert.equal(command.sponsor_id, original.sponsor.id)
        assert.deepEqual(JSON.parse(command.approvers), pending ? [{ id: original.sponsor.id, name: original.sponsor.name }] : [])
        const effect = committed.records.lk_audit.filter(row => row.command_id === command.command_id)
        assert.equal(effect.length, 1)
        assert.equal(effect[0].action, 'request.' + kind)
        assert.equal(effect[0].agreement_id, agreementId)
        assert.deepEqual((await native('/api/locket/audit?agreement=' + agreementId)).rows.filter(row => row.command_id === command.command_id), effect)
        assert.deepEqual(committed.audit.filter(row => row.command_id === command.command_id), effect)
        console.log(`PROBE BASE-AGENT-012 point-2 ${phase}.${kind}: authenticated MCP through severed HTTP connection -> zero response bytes; two fresh-id retries recover identical recorded outcome, original approval and one native effect with separate linked replay audit rows`)
      }
    }
    assert.equal(networkAttempts, 0)
    assert.deepEqual(points.filter(point => !point.ok), [])
  } finally {
    try { await proxy?.close() } finally { await hosted.close() }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await transportReplayJourney()
