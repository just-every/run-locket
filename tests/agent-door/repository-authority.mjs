import assert from 'node:assert/strict'
import { randomUUID, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { installation } from '../api/harness.mjs'
import { createProtocol } from '../../src/modules/agent-door/conformance/protocol.mjs'
import { autonomousPolicy, heldPolicy, signJws } from '../../src/modules/agent-door/conformance/crypto.mjs'
import { repositoryAuthority, repositoryParity } from './repository-parity.mjs'

/** A second real sponsor exercises the production MCP door with native viewer authority. */
export async function runRepositoryAuthority() {
  const now = Date.parse('2026-10-17T12:00:00Z')
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const signer = {
    privateKey: keys.privateKey, kid: 'synthetic-locket-1',
    issuer: 'https://synthetic-locket.invalid', installationId: randomUUID(),
  }
  const publicKeys = { [signer.kid]: await webcrypto.subtle.exportKey('jwk', keys.publicKey) }
  const appOrigin = 'https://synthetic-locket.invalid'
  const h = await installation({ bindings: {
    TEST_NOW: String(now),
    RER_OWNER_CLAIM_ISSUER: signer.issuer,
    RER_OWNER_CLAIM_INSTALLATION_ID: signer.installationId,
    RER_OWNER_CLAIM_APP_ORIGIN: appOrigin,
    RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys),
    RER_BUSINESS_TRUST: JSON.stringify({ v: 1, issuer: signer.issuer, audience: 'self-host', subject: signer.installationId, keys: publicKeys }),
  } })
  try {
    const request = (absoluteURL, init = {}) => {
      const url = new URL(absoluteURL)
      assert.equal(url.origin, h.origin, 'Authority fixtures use only their disposable installation')
      return h.request(url.pathname + url.search, { ...init, ...(init.body === undefined ? {} : { body: JSON.parse(init.body) }) })
    }
    const ownerSession = await (await h.owner.request('/auth/session')).json()
    const ownerSubject = randomUUID(), viewerSubject = randomUUID(), business = randomUUID()
    const email = ['synthetic-locket-1', 'example.invalid'].join('@')
    const iat = Math.floor(now / 1000)
    // Business creates the native invitation before binding it. An unrelated
    // pre-existing account must remain a conflict under the production adapter.
    const settings = await signJws(signer.privateKey, signer.kid, 'rer-business-settings+jwt', {
      v: 1, iss: signer.issuer, aud: 'self-host', sub: signer.installationId,
      business, email: ownerSession.operator.email, owner_id: ownerSubject,
      jti: randomUUID(), iat, exp: iat + 300, rev: 1,
      values: { display_name: 'Synthetic Locket' }, logo: null,
      team: [{ id: viewerSubject, email, name: 'Synthetic viewer', role: 'member', invite: 1 }],
    })
    const adopted = await h.request('/api/rer/business-settings', { method: 'POST', body: { settings } })
    assert.equal(adopted.status, 200, 'Signed Business settings bind the owner and invite the viewer')
    const roster = await adopted.json()
    assert.ok(roster.team.some(member => member.email === email && member.state === 'invited'))
    const invitation = h.mails.findLast(message => message.to.includes(email))
    assert.ok(invitation, 'The real auth invitation reached the captured mail edge')
    const link = (invitation.text.match(/https?:\/\/[^\s<>]+/g) ?? []).map(value => new URL(value)).find(url => url.origin === h.origin && url.pathname === '/auth/confirm' && url.searchParams.has('token'))
    assert.ok(link, 'The invitation contains a native one-use confirmation')
    const confirmed = await h.request('/auth/confirm', { method: 'POST', body: { token: link.searchParams.get('token') } })
    assert.equal(confirmed.status, 303)
    const viewerCookie = confirmed.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    assert.ok(viewerCookie)
    const viewerSessionResponse = await h.request('/auth/session', { as: viewerCookie })
    assert.equal(viewerSessionResponse.status, 200)
    const viewerSession = await viewerSessionResponse.json()
    await h.owner.command('role.set', { operatorId: viewerSession.operator.id, role: 'viewer' })

    const surface = JSON.parse(await readFile(new URL('../../agent-surface.json', import.meta.url), 'utf8'))
    const protocol = (subject, person, cookie) => createProtocol({
      fetch: request, origin: h.origin, signer, surface, business, now,
      person: { sub: subject, email: person.email, cookie },
      agentId: randomUUID(), consent: randomUUID(), points: [], seq: 0, revision: 0,
    })
    const owner = protocol(ownerSubject, ownerSession.operator, h.owner.cookie)
    const viewer = protocol(viewerSubject, viewerSession.operator, viewerCookie)
    for (const [phase, policy] of [['autonomous', autonomousPolicy], ['held', heldPolicy]]) {
      await owner.adopt(policy(), { aud: appOrigin })
      const context = { request, origin: h.origin, cookie: h.owner.cookie, phase,
        tool: owner.tool, colleague: { cookie: viewerCookie, tool: viewer.tool },
      }
      await repositoryParity(context)
      await repositoryAuthority(context)
    }
    assert.deepEqual(owner.points.filter(point => !point.ok), [], 'Signed policy adoption retains the declared production tool classes')
  } finally {
    await h.close()
  }
}
