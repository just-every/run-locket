import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { families, resourceInstallation, resourceRecords } from './resource-fixtures.mjs'
import { autonomousPolicy, heldPolicy, accessToken } from '../../src/modules/agent-door/conformance/crypto.mjs'
import { errorCode } from '../../src/modules/agent-door/conformance/protocol.mjs'

export function assertAgreementLink(result, id) {
  const links = result.content.filter(item => item.type === 'resource_link')
  assert.deepEqual(links.map(link => link.uri), [`locket://agreements/${id}`])
}
export function assertRequestLinks(result, native) {
  const id = result.structuredContent.id
  const current = native.agreements.find(row => row.id === id)
  assert.ok(current)
  assert.deepEqual(result.content.filter(item => item.type === 'resource_link').map(link => link.uri),
    [uri('agreements', id), uri('counterparties', current.party_id), ...(current.current_version_id ? [uri('versions', current.current_version_id)] : []),
      ...(current.entity_id ? [uri('entities', current.entity_id)] : [])])
}
const uri = (kind, id) => `locket://${kind}/${id}`
const content = answer => {
  assert.equal(answer.status, 200)
  assert.equal(answer.body.error, undefined, JSON.stringify(answer.body.error))
  assert.equal(answer.result.contents.length, 1)
  const item = answer.result.contents[0]
  assert.equal(item.mimeType, 'application/json')
  assert.equal(item._meta['com.runeditrun/untrusted'], true)
  return JSON.parse(item.text)
}
const unavailable = answer => {
  assert.equal(answer.status, 200)
  assert.equal(errorCode(answer), 'resource_unavailable')
  assert.equal(answer.result, undefined)
  return answer.body.error
}

async function approveRead(h, c, address) {
  const pending = await c.mcp('resources/read', { uri: address })
  assert.equal(errorCode(pending), 'approval_required')
  assert.equal(pending.decision.disposition, 'approval')
  assert.equal(pending.result, undefined)
  assert.equal(pending.body.error.data.contents, undefined)
  assert.equal(JSON.stringify(pending.body).includes('12-3456789'), false)
  assert.ok(pending.decision.classes.some(row => row.class === 'sensitive' && row.do === 'approval'))
  const { approval: handle, requestState } = pending.body.error.data
  const view = await c.personJson('/agents/api/approvals/' + handle.id)
  assert.equal(view.approval.state, 'pending')
  const accepted = await h.jsonRequest(`/agents/api/approvals/${handle.id}/approve`, {
    revision: view.approval.revision, summary_sha256: view.approval.summary_sha256,
  }, c.person.cookie)
  assert.equal(accepted.status, 200)
  assert.equal((await accepted.json()).approval.state, 'executed')
  const read = await c.mcp('resources/read', { uri: address, requestState })
  return content(read)
}

async function linkedTool(h, name, args, expected) {
  const before = await h.owner.state()
  let answer = await h.a.tool(name, args)
  if (answer.result?.resultType === 'input_required') {
    const waiting = await h.owner.state()
    for (const collection of ['agreements', 'access', 'operators', 'proposals']) assert.deepEqual(waiting[collection], before[collection])
    const approved = await h.a.decideApproval(answer)
    assert.equal(approved.ok, true)
    answer = await h.a.tool(name, args, { requestState: answer.result.requestState })
  }
  assert.equal(answer.result?.isError, false, JSON.stringify(answer.body))
  const result = answer.result.structuredContent
  const links = answer.result.content.filter(item => item.type === 'resource_link')
  assert.deepEqual(links.map(link => link.uri).sort(), expected(result).sort())
  const native = await h.owner.state()
  for (const link of links) {
    const address = new URL(link.uri), kind = address.hostname, id = address.pathname.slice(1)
    assert.deepEqual(content(await h.a.mcp('resources/read', { uri: link.uri })), native[families[kind]].find(row => row.id === id))
  }
  return result
}

export async function runResources() {
  const h = await resourceInstallation()
  try {
    const f = await resourceRecords(h)
    const templates = Object.keys(families).map(kind => uri(kind, '{id}')).sort()
    for (const [phase, policy] of [['autonomous', autonomousPolicy()], ['held', heldPolicy()]]) {
      await h.a.adopt(policy)
      for (const c of [h.a, h.b]) {
        const one = await c.mcp('resources/templates/list'), two = await c.mcp('resources/templates/list')
        assert.deepEqual(one.result, two.result)
        assert.deepEqual(one.result.resourceTemplates.map(item => item.uriTemplate), templates)
        assert.equal(one.result.cacheScope, 'private')
        assert.equal(one.result.ttlMs, 0)
      }
      for (const [human, c, label] of [[h.owner, h.a, 'owner'], [h.viewer, h.b, 'viewer']]) {
        const native = await human.state()
        for (const [kind, collection] of Object.entries(families)) {
          const expected = native[collection].find(row => row.id === f.ids[kind])
          if (label === 'owner' || !['reports', 'proposals', 'saved-views', 'imports'].includes(kind)) assert.ok(expected, `${phase} ${label} seeded ${kind} must be visible`)
          const answer = await c.mcp('resources/read', { uri: uri(kind, f.ids[kind]) })
          if (expected) {
            assert.deepEqual(content(answer), expected, `${phase} ${label} ${kind}`)
            assert.equal(answer.decision.disposition, phase === 'held' ? 'review' : 'autonomous')
            if (kind === 'files') {
              assert.equal(Object.hasOwn(content(answer), 'base64'), false)
              assert.equal(Object.hasOwn(content(answer), 'bytes'), false)
              assert.match(content(answer).sha256, /^[a-f0-9]{64}$/)
            }
          } else assert.deepEqual(unavailable(answer), unavailable(await c.mcp('resources/read', { uri: uri(kind, randomUUID()) })))
        }
      }
      const title = 'synthetic-locket-link-' + phase
      for (const entityId of [undefined, randomUUID()]) {
        const payload = { ...(entityId ? { entityId } : {}), title: title + '-refused', type: 'supplier', party: { name: title + '-refused', kind: 'supplier' } }
        const before = await h.owner.state()
        const person = await h.jsonRequest('/api/locket/commands', { commandId: randomUUID(), type: 'request.create', payload }, h.cookie)
        assert.equal(person.ok, false)
        const nativeError = (await person.json()).error.code
        const refused = await h.a.tool('locket.requests.create', { ...payload, idempotency_key: randomUUID() })
        assert.equal(refused.result?.isError, true)
        assert.equal(errorCode(refused), nativeError)
        assert.deepEqual(refused.result.content.filter(item => item.type === 'resource_link'), [])
        const after = await h.owner.state()
        for (const collection of ['agreements', 'parties', 'versions', 'artifacts']) assert.deepEqual(after[collection], before[collection])
      }
      const created = await h.a.tool('locket.requests.create', { entityId: f.ids.entities, title, type: 'supplier', party: { name: title, kind: 'supplier' }, idempotency_key: randomUUID() })
      assert.equal(created.result.isError, false)
      const id = created.result.structuredContent.id
      const createdNative = await h.owner.state()
      assertRequestLinks(created.result, createdNative)
      for (const link of created.result.content.filter(item => item.type === 'resource_link')) {
        const address = new URL(link.uri)
        assert.deepEqual(content(await h.a.mcp('resources/read', { uri: link.uri })),
          createdNative[families[address.hostname]].find(row => row.id === address.pathname.slice(1)))
      }
      let linked = content(await h.a.mcp('resources/read', { uri: created.result.content.find(item => item.type === 'resource_link').uri }))
      assert.equal(linked.title, title)
      assert.deepEqual(linked, (await h.owner.state()).agreements.find(row => row.id === id))
      const read = await h.a.tool('locket.agreements.read', { agreementId: id })
      assertAgreementLink(read.result, id)
      assert.deepEqual(content(await h.a.mcp('resources/read', { uri: uri('agreements', id) })), read.result.structuredContent)
      const changed = await h.a.tool('locket.requests.update', { agreementId: id, version: linked.version, title: title + '-revised', idempotency_key: randomUUID() })
      assert.equal(changed.result.isError, false)
      assertAgreementLink(changed.result, id)
      linked = content(await h.a.mcp('resources/read', { uri: changed.result.content.find(item => item.type === 'resource_link').uri }))
      assert.equal(linked.title, title + '-revised')
      assert.deepEqual(linked, (await h.owner.state()).agreements.find(row => row.id === id))
      const prepared = await linkedTool(h, 'locket.proposals.prepare', {
        payload: { title: 'synthetic-locket-linked-proposal-' + phase, type: 'supplier', party: { name: 'synthetic-locket-linked-party', kind: 'supplier' } },
        evidence: [f.quote], idempotency_key: randomUUID(),
      }, result => [uri('proposals', result.id)])
      assert.equal(content(await h.a.mcp('resources/read', { uri: uri('proposals', prepared.id) })).status, 'pending')
      const people = await linkedTool(h, 'locket.people.list', {}, result => result.members.map(person => uri('people', person.id)))
      assert.ok(people.members.some(person => person.id === h.viewerId))
      for (const role of ['requester', 'viewer']) {
        await linkedTool(h, 'locket.people.update', { operatorId: h.viewerId, role, idempotency_key: randomUUID() }, () => [uri('people', h.viewerId)])
        assert.equal((await h.viewer.state()).actor.role, role)
      }
      for (const grant of ['grant', 'revoke']) {
        const secret = (await h.owner.state()).agreements.find(row => row.id === f.secret)
        await linkedTool(h, 'locket.access.update', { agreementId: secret.id, version: secret.version, operatorId: h.viewerId, grant,
          idempotency_key: randomUUID() }, () => [uri('agreements', secret.id), uri('people', h.viewerId)])
        assert.equal((await h.viewer.state()).agreements.some(row => row.id === secret.id), grant === 'grant')
      }
      const found = await linkedTool(h, 'locket.repo.search_and_structured_filters', { query: 'synthetic-locket-link-' + phase },
        result => result.records.map(row => uri('agreements', row.id)))
      assert.ok(found.records.some(row => row.id === id))
      await linkedTool(h, 'locket.records.count', {}, result => [...result.agreements.map(row => uri('agreements', row.id)),
        ...result.people.map(row => uri('people', row.id)), ...result.proposals.map(row => uri('proposals', row.id))])
      console.log(`PROBE BASE-AGENT-003 links-${phase}: agreement read, create and update MCP outputs -> exact record links and current native state readback`)
      console.log(`PROBE BASE-AGENT-003 entity-${phase}: omitted or missing contracting entity -> same native refusal, no writes or links; selected entity -> exact linked native entity and request`)
      console.log(`PROBE BASE-AGENT-003 wider-links-${phase}: proposals, people, role changes, reader changes, repository search and record witness -> exact links, native readback and unchanged state before required approval`)
      console.log(`PROBE BASE-AGENT-003 native-parity-${phase}: ${templates.length} templates and complete owner and viewer native rows -> exact scoped JSON; file metadata only; untrusted markers retained`)
      // Customer, imported and document text is returned as data, not authority.
      const document = await h.b.mcp('resources/read', { uri: uri('versions', f.ids.versions) })
      assert.ok(content(document).text.includes(f.quote))
      assert.equal((await h.viewer.state()).agreements.some(row => row.id === f.secret), false)
      assert.deepEqual(unavailable(await h.b.mcp('resources/read', { uri: uri('agreements', f.secret) })),
        unavailable(await h.b.mcp('resources/read', { uri: uri('agreements', randomUUID()) })))
      // A tax identifier is classified from the actual projected native fields.
      for (const [human, c] of [[h.owner, h.a], [h.viewer, h.b]]) {
        const expected = (await human.state()).parties.find(row => row.id === f.sensitive)
        const address = uri('counterparties', f.sensitive)
        const actual = phase === 'held' ? await approveRead(h, c, address) : content(await c.mcp('resources/read', { uri: address }))
        assert.deepEqual(actual, expected)
        assert.equal(actual.tax_id, '12-3456789')
      }
      console.log(`PROBE BASE-AGENT-003 sensitive-${phase}: counterparty tax identifier -> ${phase === 'held' ? 'no content before native human approval; exact native content after approval' : 'exact authorized content'}`)
      // The same admitted viewer credential loses every newly revoked record.
      const token = await accessToken(h.b)
      const readSecret = () => h.b.mcp('resources/read', { uri: uri('agreements', f.secret) }, { token })
      let row = (await h.owner.state()).agreements.find(row => row.id === f.secret)
      await h.owner.command('access.set', { agreementId: row.id, version: row.version, operatorId: h.viewerId, grant: 'grant' })
      assert.equal(content(await readSecret()).id, row.id)
      const granted = await h.owner.state()
      const scoped = { agreements: row.id, versions: granted.versions.find(item => item.agreement_id === row.id).id,
        files: granted.artifacts.find(item => item.agreement_id === row.id).id, counterparties: row.party_id }
      for (const [kind, id] of Object.entries(scoped)) assert.equal(content(await h.b.mcp('resources/read', { uri: uri(kind, id) }, { token })).id, id)
      row = granted.agreements.find(item => item.id === row.id)
      await h.owner.command('access.set', { agreementId: row.id, version: row.version, operatorId: h.viewerId, grant: 'revoke' })
      for (const [kind, id] of Object.entries(scoped)) assert.deepEqual(
        unavailable(await h.b.mcp('resources/read', { uri: uri(kind, id) }, { token })),
        unavailable(await h.b.mcp('resources/read', { uri: uri(kind, randomUUID()) }, { token })))
      console.log(`PROBE BASE-AGENT-003 revocation-${phase}: same Business-bound viewer credential after access removal -> agreement, version, file and counterparty identical to missing ids`)
      if (phase === 'held') {
        const sensitiveUri = uri('counterparties', f.sensitive)
        const pending = await h.b.mcp('resources/read', { uri: sensitiveUri })
        assert.equal(errorCode(pending), 'approval_required')
        const handle = pending.body.error.data.approval
        const approval = (await h.b.personJson('/agents/api/approvals/' + handle.id)).approval
        let restricted = (await h.owner.state()).agreements.find(item => item.id === f.sensitiveAgreement)
        await h.owner.command('access.set', { agreementId: restricted.id, version: restricted.version, operatorId: h.viewerId, grant: 'revoke' })
        const attempt = await h.jsonRequest(`/agents/api/approvals/${handle.id}/approve`, {
          revision: approval.revision, summary_sha256: approval.summary_sha256,
        }, h.viewerCookie)
        assert.equal(attempt.status, 200)
        const rejected = (await attempt.json()).approval
        assert.equal(rejected.state, 'refused')
        // Base reports classifier refusal during approval execution with this
        // stable wrapper code; native lookup still withholds the record.
        assert.equal(rejected.code, 'execution_failed')
        const denied = await h.b.mcp('resources/read', { uri: sensitiveUri, requestState: pending.body.error.data.requestState })
        assert.equal(denied.result, undefined)
        assert.equal(JSON.stringify(denied.body).includes('12-3456789'), false)
        assert.ok(errorCode(denied))
        restricted = (await h.owner.state()).agreements.find(item => item.id === restricted.id)
        await h.owner.command('access.set', { agreementId: restricted.id, version: restricted.version, operatorId: h.viewerId, grant: 'grant' })
        const replay = await h.b.mcp('resources/read', { uri: sensitiveUri, requestState: pending.body.error.data.requestState })
        assert.equal(replay.result, undefined)
        assert.notEqual(errorCode(replay), null)
        console.log('PROBE BASE-AGENT-003 pending-revocation: revoke sensitive source before approval, restore access, replay old request -> refused, no private content or revival')
      }
    }
    // Hidden fields use the native redacted projection, including whole-family
    // withholding; an omitted value must not reappear in a resource allowlist.
    await h.a.adopt(autonomousPolicy())
    await h.owner.command('repository.access', { version: 0, enabled: false, grants: [], hiddenFields: [{ role: 'viewer', fields: ['value'] }] })
    const hidden = await h.viewer.state(), full = await h.owner.state()
    assert.equal(Object.hasOwn(hidden.agreements.find(row => row.id === f.ids.agreements), 'value_cents'), false)
    assert.equal(full.agreements.find(row => row.id === f.ids.agreements).value_cents, 738219)
    for (const [kind, collection] of Object.entries(families)) {
      const expected = hidden[collection].find(row => row.id === f.ids[kind])
      const answer = await h.b.mcp('resources/read', { uri: uri(kind, f.ids[kind]) })
      if (expected) assert.deepEqual(content(answer), expected)
      else assert.deepEqual(unavailable(answer), unavailable(await h.b.mcp('resources/read', { uri: uri(kind, randomUUID()) })))
    }
    assert.equal(content(await h.b.mcp('resources/read', { uri: uri('versions', f.ids.versions) })).text, null)
    assert.deepEqual(content(await h.a.mcp('resources/read', { uri: uri('agreements', f.ids.agreements) })), full.agreements.find(row => row.id === f.ids.agreements))
    console.log('PROBE BASE-AGENT-003 hidden-fields: native viewer value hiding -> no value, no document text or withheld records; owner retains full native fields')
    for (const [cls, address] of [['standard', uri('agreements', f.ids.agreements)], ['sensitive', uri('counterparties', f.sensitive)]]) {
      const policy = autonomousPolicy(); policy.rules.push({ id: 'block-resource', class: cls, do: 'blocked' })
      await h.a.adopt(policy)
      const before = await h.owner.state()
      const refused = await h.a.mcp('resources/read', { uri: address })
      assert.equal(errorCode(refused), 'policy_blocked')
      assert.equal(refused.decision.disposition, 'blocked')
      assert.equal(refused.result, undefined)
      assert.equal(refused.body.error.data.contents, undefined)
      const after = await h.owner.state()
      for (const collection of Object.values(families)) assert.deepEqual(after[collection], before[collection])
    }
    console.log('PROBE BASE-AGENT-003 blocked: standard and sensitive resource policy blocks -> typed refusal, no content, unchanged native records')
    await h.a.adopt(null)
    assert.deepEqual((await h.a.mcp('resources/templates/list')).result.resourceTemplates, [])
    assert.equal(errorCode(await h.a.mcp('resources/read', { uri: uri('agreements', f.ids.agreements) })), 'policy_unset')
    await h.a.adopt(autonomousPolicy(), { paused: true })
    assert.deepEqual((await h.a.mcp('resources/templates/list')).result.resourceTemplates, [])
    assert.equal(errorCode(await h.a.mcp('resources/read', { uri: uri('agreements', f.ids.agreements) })), 'agents_paused')
    assert.ok(h.a.points.every(point => point.ok), JSON.stringify(h.a.points.filter(point => !point.ok)))
    console.log('PROBE BASE-AGENT-003 unset-and-pause: unanswered policy and Business Pause -> empty discovery and no resource content')
    await h.a.adopt(autonomousPolicy())
    const token = await accessToken(h.b)
    assert.equal(content(await h.b.mcp('resources/read', { uri: uri('agreements', f.ids.agreements) }, { token })).id, f.ids.agreements)
    const stopped = await h.jsonRequest(`/agents/api/agents/${h.b.agentId}/revoke`, {}, h.cookie)
    assert.equal(stopped.status, 200)
    assert.equal((await stopped.json()).revoked, true)
    const revoked = await h.b.mcp('resources/read', { uri: uri('agreements', f.ids.agreements) }, { token })
    assert.equal(revoked.status, 401)
    assert.equal(revoked.result, undefined)
    console.log('PROBE BASE-AGENT-003 credential-revocation: revoke admitted agent, reuse valid Business credential -> HTTP 401 with no native content')
    console.log('Resource parity journey passed: primary native records, owner and viewer, autonomous and held policies, current field and record authority.')
  } finally { await h.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runResources()
