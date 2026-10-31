import assert from 'node:assert/strict'
import { randomUUID, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { serveHosted, HOSTED_ORIGIN } from '../../node_modules/@runeditrun/rer/cli/hosted-output.mjs'
import { verificationSponsors } from '../../node_modules/@runeditrun/rer/cli/agent-sponsors.mjs'
import { createProtocol, errorCode } from '../../src/modules/agent-door/conformance/protocol.mjs'
import { autonomousPolicy, heldPolicy, seconds, signJws } from '../../src/modules/agent-door/conformance/crypto.mjs'
import { colleagueIdentity } from './colleague.mjs'
import accessFixture from './access-fixture.mjs'

const standard = [{ class: 'standard', facts: { measure: 1 } }]
const expected = measure => [...standard, ...(measure ? [{ class: 'sensitive', facts: { measure, kind: 'tax_identifier' } }] : [])]
const facts = answer => answer.decision?.classes.map(({ class: id, facts }) => ({ class: id, facts }))
const names = ['synthetic-locket-6 standard confirmed 00-0000000 000-00-0000', 'synthetic-locket-7 00-0000000']
const savedNames = new Map()

async function json(request, origin, cookie, path, body) {
  const response = await request(origin + path, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' } })
  assert.equal(response.status, 200, path)
  return response.json()
}

// The mandatory conformance table exercises both declared classes under both
// policies. Change names only through each genuinely confirmed person's session.
export async function beforeStep({ step, request, origin, cookie, phase }) {
  if (step.id !== 'people_sensitive') return
  const colleague = colleagueIdentity()
  const ownerState = await json(request, origin, cookie, '/api/locket/state')
  const sessions = [cookie, colleague.cookie]
  savedNames.set(origin + phase, [ownerState.actor.name, ownerState.operators.find(row => row.id === colleague.id).name])
  for (const [index, session] of sessions.entries()) await json(request, origin, session, '/auth/display-name', { displayName: names[index] })
}

export async function afterStep({ step, request, origin, cookie, phase, result }) {
  if (step.id !== 'people_sensitive') return
  const native = await json(request, origin, cookie, '/api/locket/state')
  assert.deepEqual(result.members, native.operators)
  const previous = savedNames.get(origin + phase)
  assert.ok(previous)
  for (const [index, session] of [cookie, colleagueIdentity().cookie].entries()) await json(request, origin, session, '/auth/display-name', { displayName: previous[index] })
  savedNames.delete(origin + phase)
}

// Run against the built production Worker. Only the invitation mail network
// edge is replaced; no account, session, result or audit row is fabricated.
export default async function peopleClassificationJourney() {
  const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
  const { email, sub } = (await verificationSponsors(process.cwd(), { owner: surface.verification.owner }))[0]
  const addresses = [email.replace('@', '-people@'), email.replace('@', '-people-control@')]
  const subjects = addresses.map(() => randomUUID())
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const kid = randomUUID(), installationId = randomUUID(), issuer = 'https://synthetic-locket.invalid'
  const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', pair.publicKey) }
  const mails = []
  const hosted = await serveHosted(process.cwd(), { bindings: {
    RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
    RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys), OWNER_EMAIL: email,
    RER_BUSINESS_TRUST: JSON.stringify({ v: 1, issuer, audience: HOSTED_ORIGIN, subject: installationId, email, keys: publicKeys }),
    MAIL_PROVIDER: 'resend', MAIL_FROM: email,
  }, outboundService: async request => {
    assert.equal(request.method, 'POST')
    assert.equal(request.url, 'https://api.resend.com/emails')
    mails.push(await request.json())
    return Response.json({ id: 'synthetic-locket-' + mails.length })
  } })
  try {
    const origin = hosted.origin, business = 'synthetic-locket-6'
    const request = (absolute, init = {}) => {
      const url = new URL(absolute)
      assert.equal(url.origin, origin)
      return hosted.fetch(url.href.slice(origin.length + 1), { ...init, signal: AbortSignal.timeout(30_000) })
    }
    const signed = (type, payload) => signJws(pair.privateKey, kid, type, payload)
    const iat = seconds()
    const claim = await signed('rer-owner-claim+jwt', { v: 1, iss: issuer, aud: origin, installationId, email, jti: randomUUID(), iat, exp: iat + 300 })
    const boot = await request(origin + '/auth/owner-claim', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: claim, displayName: 'synthetic-locket-6', returnTo: '/app' }) })
    assert.equal(boot.status, 303)
    const cookie = boot.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
    assert.ok(cookie)
    await boot.body?.cancel()
    const settings = await signed('rer-business-settings+jwt', { v: 1, iss: issuer, aud: origin, sub: installationId, business, email, owner_id: sub,
      jti: randomUUID(), iat, exp: iat + 300, rev: 1, values: {}, logo: null,
      team: addresses.map((email, index) => ({ id: subjects[index], email, name: 'synthetic-locket-' + (index + 7), role: 'member', invite: 1 })) })
    const paired = await request(origin + '/api/rer/business-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }) })
    assert.equal(paired.status, 200)
    assert.equal((await paired.json()).rev, 1)
    const invite = async (email, name) => {
      const response = await request(origin + '/auth/invite', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, displayName: name, role: 'member' }) })
      assert.equal(response.status, 202)
      await response.body?.cancel()
      const mail = mails.findLast(message => message.to.includes(email))
      assert.ok(mail)
      const link = new URL(mail.text.match(/https?:\/\/[^\s<>]+/)[0])
      assert.equal(link.origin, origin)
      assert.equal(link.pathname, '/auth/confirm')
      const confirmed = await request(origin + '/auth/confirm', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: link.searchParams.get('token') }) })
      assert.equal(confirmed.status, 303)
      const session = confirmed.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
      assert.ok(session)
      await confirmed.body?.cancel()
      const person = await json(request, origin, session, '/auth/session')
      assert.equal(person.operator.status, 'active')
      return { cookie: session, id: person.operator.id, email }
    }
    const people = []
    for (const [index, address] of addresses.entries()) people.push(await invite(address, 'synthetic-locket-' + (index + 7)))
    const points = []
    const makeClient = person => createProtocol({ fetch: request, origin, surface, signer: { issuer, installationId, kid, privateKey: pair.privateKey }, person,
      business, consent: randomUUID(), agentId: randomUUID(), points, seq: 0, revision: 0 })
    const owner = makeClient({ email, sub, cookie })
    const viewer = makeClient({ ...people[0], sub: subjects[0] })
    const native = (person = owner) => json(request, origin, person.person.cookie, '/api/locket/state')
    const command = (type, payload) => json(request, origin, cookie, '/api/locket/commands', { commandId: randomUUID(), type, payload })
    const rename = (person, displayName) => json(request, origin, person.cookie, '/auth/display-name', { displayName })
    const audit = async () => {
      const rows = []
      let after = '0'
      for (;;) {
        const page = await json(request, origin, cookie, '/agents/api/audit?after=' + after)
        rows.push(...page.rows)
        if (page.cursor === after || page.cursor === null) return rows
        after = page.cursor
      }
    }
    const noMembers = answer => {
      assert.equal(answer.result?.structuredContent, undefined)
      const text = JSON.stringify(answer.body)
      for (const person of people) assert.equal(text.includes(person.id), false)
      for (const name of names) assert.equal(text.includes(name), false)
      assert.equal(text.includes('"members"'), false)
    }
    const checkAudit = async answer => {
      const row = (await audit()).findLast(row => row.id === answer.decision.id)
      assert.ok(row)
      assert.deepEqual(row.classes, facts(answer))
      assert.equal(row.tool, 'locket.people.list')
      return row
    }
    const list = (client, args = {}, options) => client.tool('locket.people.list', args, options)
    const memberRead = async (client, measure) => {
      const answer = await list(client)
      assert.deepEqual(facts(answer), expected(measure))
      if (answer.decision.disposition === 'approval') {
        assert.equal(answer.result.resultType, 'input_required')
        noMembers(answer)
        const handle = answer.result._meta['com.runeditrun/approval']
        const page = await client.personRequest(new URL(handle.url).pathname)
        assert.equal(page.status, 200)
        await page.body?.cancel()
        const denied = await request(origin + '/agents/api/approvals/' + handle.id + '/approve', { method: 'POST', headers: { Origin: origin, Cookie: people[1].cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
        assert.equal(denied.status, 403)
        await denied.body?.cancel()
        const waiting = await list(client, {}, { requestState: answer.result.requestState })
        assert.equal(waiting.result.resultType, 'input_required')
        noMembers(waiting)
        const approved = await client.decideApproval(answer)
        assert.equal(approved.ok, true)
        assert.equal(approved.body.approval.state, 'executed')
        const completed = await list(client, {}, { requestState: answer.result.requestState })
        assert.equal(completed.result.isError, false)
        assert.deepEqual(completed.result.structuredContent.members, (await native(client)).operators)
        assert.equal(completed.result._meta['com.runeditrun/receipt'].approval_id, handle.id)
        return { answer: completed, pending: answer }
      }
      assert.equal(answer.result.isError, false)
      assert.deepEqual(answer.result.structuredContent.members, (await native(client)).operators)
      await checkAudit(answer)
      return { answer }
    }
    for (const [phase, policy] of [['autonomous', autonomousPolicy()], ['held', heldPolicy()]]) {
      await owner.adopt(policy)
      await rename(people[0], 'synthetic-locket-7 sensitive internal confirmed')
      await rename(people[1], 'synthetic-locket-8')
      const before = await native()
      for (const client of [owner, viewer]) {
        const plain = await memberRead(client, 0)
        const claimed = await list(client, { class: 'sensitive', classes: ['sensitive'], internal: true, confirmExternal: true, confirmed: true })
        assert.deepEqual(facts(claimed), facts(plain.answer))
        assert.deepEqual(claimed.result.structuredContent, plain.answer.result.structuredContent)
        if (client === viewer) assert.ok(plain.answer.result.structuredContent.members.every(row => !Object.hasOwn(row, 'email')))
        else assert.ok(plain.answer.result.structuredContent.members.every(row => typeof row.email === 'string'))
      }
      assert.deepEqual((await native()).operators, before.operators)
      await rename(people[0], names[0])
      for (const client of [owner, viewer]) {
        const single = await memberRead(client, 1)
        assert.equal(single.answer.result.structuredContent.members.filter(row => row.name === names[0]).length, 1)
        const claimed = await list(client, { class: 'standard', classes: ['standard'], internal: true, confirmExternal: true, confirmed: true })
        assert.deepEqual(facts(claimed), expected(1))
        assert.equal(claimed.decision.disposition, phase === 'held' ? 'approval' : 'autonomous')
        if (phase === 'held') noMembers(claimed)
        else assert.deepEqual(claimed.result.structuredContent, single.answer.result.structuredContent)
      }
      await rename(people[1], names[1])
      for (const client of [owner, viewer]) await memberRead(client, 2)
      await owner.adopt({ ...policy, rules: [{ id: 'sensitive-blocked', class: 'sensitive', do: 'blocked' }, ...policy.rules] })
      for (const client of [owner, viewer]) {
        const blocked = await list(client, { class: 'standard', confirmed: true })
        assert.equal(errorCode(blocked), 'policy_blocked')
        assert.deepEqual(facts(blocked), expected(2))
        noMembers(blocked)
        const row = await checkAudit(blocked)
        assert.equal(row.outcome, 'refused')
        assert.equal(row.code, 'policy_blocked')
      }
      console.log(`PROBE BASE-AGENT-006 ${phase}: authenticated people list -> native owner and viewer parity; plain standard, one record with repeated identifiers measures 1, two records measure 2; ignored claims; required approval withholds members; blocked sensitive reads disclose none and audit exact classes`)
    }
    await owner.adopt(heldPolicy())
    await rename(people[1], 'synthetic-locket-8')
    const stale = await list(viewer)
    assert.deepEqual(facts(stale), expected(1))
    noMembers(stale)
    await rename(people[1], names[1])
    const refused = await viewer.decideApproval(stale)
    assert.equal(refused.body.approval.state, 'refused')
    assert.equal(refused.body.approval.code, 'approval_evidence_changed')
    const execution = (await audit()).findLast(row => row.approval?.id === stale.result._meta['com.runeditrun/approval'].id && row.outcome === 'refused')
    assert.ok(execution)
    assert.deepEqual(execution.classes, expected(2))
    const retried = await list(viewer, {}, { requestState: stale.result.requestState })
    assert.equal(errorCode(retried), 'approval_evidence_changed')
    noMembers(retried)
    // A completed approval must not authorize newly disclosed sensitive records.
    await rename(people[1], 'synthetic-locket-8')
    const approved = await memberRead(viewer, 1)
    await rename(people[1], names[1])
    const changed = await list(viewer, {}, { requestState: approved.pending.result.requestState })
    assert.equal(errorCode(changed), 'resource_changed')
    assert.deepEqual(facts(changed), expected(2))
    noMembers(changed)
    await checkAudit(changed)
    console.log('PROBE BASE-AGENT-006 changed-projection: signed-in name change after pending or completed approval -> refusal, no member content, current sensitive measure 2 retained in refused audit')
    // Only an owner sees native email fields. A hidden identifier must not turn
    // an ordinary viewer projection into a sensitive disclosure.
    await rename(people[0], 'synthetic-locket-7')
    await rename(people[1], 'synthetic-locket-8')
    await invite(email.replace('@', '-00-0000000@'), 'synthetic-locket-9')
    await owner.adopt(autonomousPolicy())
    await memberRead(owner, 1)
    await memberRead(viewer, 0)
    await command('role.set', { operatorId: people[0].id, role: 'agent' })
    const roleRead = await memberRead(viewer, 0)
    assert.ok(roleRead.answer.result.structuredContent.members.every(row => !Object.hasOwn(row, 'email')))
    const suspended = await json(request, origin, cookie, '/auth/operator/status', { operatorId: people[0].id, status: 'inactive' })
    assert.equal(suspended.status, 'inactive')
    const unavailable = await list(viewer)
    assert.equal(unavailable.status, 401)
    noMembers(unavailable)
    await owner.adopt(autonomousPolicy(), { revoked: { agents: [], consents: [owner.consent] } })
    const revoked = await list(owner)
    assert.equal(revoked.status, 401)
    noMembers(revoked)
    assert.deepEqual(points.filter(point => !point.ok), [])
    console.log('PROBE BASE-AGENT-006 current-access: identifier present only in native owner email projection -> owner sensitive, viewer standard; current role remains native, suspended sponsor and revoked consent -> 401 without members')
  } finally { await hosted.close() }
  await changedDuringDecision()
}

async function changedDuringDecision() {
  let change
  const fixture = await accessFixture({ entryPoint: 'tests/agent-door/people-checkpoint.ts', serviceBindings: {
    PEOPLE_CHECKPOINT: async () => {
      const next = change
      change = undefined
      if (next) await next()
      return new Response(null, { status: 204 })
    },
  } })
  try {
    const { owner, post, request, origin, cookie, colleague } = fixture
    const rename = (displayName, session = colleague.cookie) => async () => {
      const response = await post('/auth/display-name', { displayName }, session)
      assert.equal(response.status, 200)
      assert.equal((await response.json()).displayName, displayName)
    }
    const list = options => owner.tool('locket.people.list', {}, options)
    const check = async (answer, measure) => {
      assert.equal(change, undefined, 'The native change must occur after classification, before execution')
      assert.equal(errorCode(answer), 'resource_changed')
      assert.deepEqual(facts(answer), expected(measure))
      assert.equal(answer.result.structuredContent, undefined)
      assert.equal(JSON.stringify(answer.body).includes('"members"'), false)
      const rows = (await json(request, origin, cookie, '/agents/api/audit')).rows
      const row = rows.findLast(row => row.id === answer.decision.id)
      assert.equal(row.outcome, 'refused')
      assert.equal(row.code, 'resource_changed')
      assert.deepEqual(row.classes, expected(measure))
    }
    await owner.adopt(autonomousPolicy())
    const plain = await list()
    assert.deepEqual(facts(plain), standard)
    change = rename(names[0])
    await check(await list(), 0)
    const sensitive = await list()
    assert.deepEqual(facts(sensitive), expected(1))
    assert.ok(sensitive.result.structuredContent.members.some(row => row.name === names[0]))
    change = rename('synthetic-locket-7')
    await check(await list(), 1)
    await rename(names[0])()
    await owner.adopt(heldPolicy())
    const pending = await list()
    assert.equal(pending.result.resultType, 'input_required')
    assert.deepEqual(facts(pending), expected(1))
    change = rename(names[1], cookie)
    const approval = await owner.decideApproval(pending)
    assert.equal(change, undefined)
    assert.equal(approval.body.approval.state, 'refused')
    assert.equal(approval.body.approval.code, 'resource_changed')
    const refused = await list({ requestState: pending.result.requestState })
    assert.equal(errorCode(refused), 'resource_changed')
    assert.equal(refused.result.structuredContent, undefined)
    const rows = (await json(request, origin, cookie, '/agents/api/audit')).rows
    const execution = rows.findLast(row => row.approval?.id === pending.result._meta['com.runeditrun/approval'].id && row.outcome === 'refused' && row.classes.some(item => item.class === 'sensitive' && item.facts.measure === 1))
    assert.ok(execution, 'The interrupted approval records the classes actually decided before the projection changed')
    const fresh = await list()
    assert.deepEqual(facts(fresh), expected(2))
    assert.equal(fresh.result.resultType, 'input_required')
    assert.deepEqual(owner.points.filter(point => !point.ok), [])
    console.log('PROBE BASE-AGENT-006 decision-binding: native name changes paused at the real decision boundary -> autonomous standard and sensitive reads and held execution refuse resource_changed with no members; refused audit retains decided classes; fresh call requires approval for both records')
  } finally { await fixture.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await peopleClassificationJourney()
