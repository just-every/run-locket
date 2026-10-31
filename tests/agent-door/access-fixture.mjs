import assert from 'node:assert/strict'
import { randomUUID, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { installation } from '../api/harness.mjs'
import { verificationOwner } from '../../node_modules/@runeditrun/rer/cli/agent-sponsors.mjs'
import { createProtocol } from '../../node_modules/@runeditrun/rer/modules/agent-door/conformance/protocol.mjs'
import { seconds, signJws } from '../../node_modules/@runeditrun/rer/modules/agent-door/conformance/crypto.mjs'

// This separate native Worker uses the production auth, Business and MCP doors.
// Only its paid mail edge is simulated; every account is genuinely invited.
export default async function accessFixture() {
  const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
  const { email } = await verificationOwner(process.cwd(), surface.verification.owner)
  const colleagueEmail = surface.verification.reviewers[0].email
  const targetEmail = colleagueEmail.replace('@', '-target@')
  const issuer = 'https://synthetic-locket-' + randomUUID() + '.invalid'
  const installationId = randomUUID(), kid = randomUUID(), ownerSub = randomUUID(), colleagueSub = randomUUID()
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', pair.publicKey) }
  console.log('Native authority fixture: preparing Worker')
  const h = await installation({ bindings: origin => ({
    RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
    RER_OWNER_CLAIM_APP_ORIGIN: origin, RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys),
    RER_BUSINESS_TRUST: JSON.stringify({ v: 1, issuer, audience: origin, subject: installationId, email, keys: publicKeys }),
    OWNER_EMAIL: email,
  }) })
  try {
    console.log('Native authority fixture: native Worker ready')
    const origin = h.origin, cookie = h.owner.cookie
    const request = (absolute, init = {}) => {
      assert.equal(new URL(absolute).origin, origin)
      return h.mf.dispatchFetch(absolute, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    }
    const post = (path, body, session = cookie) => request(origin + path, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: session },
      body: JSON.stringify(body),
    })
    await h.invite(colleagueEmail, 'viewer')
    const target = await h.invite(targetEmail, 'viewer')
    const iat = seconds()
    const settings = await signJws(pair.privateKey, kid, 'rer-business-settings+jwt', {
      v: 1, iss: issuer, aud: origin, sub: installationId, business: 'rer-agent-conformance', email, owner_id: ownerSub,
      jti: randomUUID(), iat, exp: iat + 300, rev: 1, values: {}, logo: null,
      team: [{ id: colleagueSub, email: colleagueEmail, name: 'Synthetic native sponsor', role: 'member', invite: 1 }],
    })
    const paired = await post('/api/rer/business-settings', { settings })
    assert.equal(paired.status, 200)
    assert.equal((await paired.json()).rev, 1)
    const makeClient = sub => createProtocol({
      fetch: request, origin, surface, signer: { issuer, installationId, kid, privateKey: pair.privateKey },
      person: { email: sub === ownerSub ? email : colleagueEmail, cookie, sub },
      business: 'rer-agent-conformance', consent: randomUUID(), agentId: 'synthetic-locket-' + randomUUID(),
      points: [], seq: 0, revision: 0, listed: new Map(),
    })
    return { request, origin, cookie, colleague: { email: targetEmail, cookie: target.cookie },
      owner: makeClient(ownerSub), sponsor: makeClient(colleagueSub), colleagueEmail, targetEmail, post,
      signInSponsor: () => h.signIn(colleagueEmail), close: () => h.close() }
  } catch (error) { await h.close(); throw error }
}
