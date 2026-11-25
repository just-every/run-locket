import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { installation } from './harness.mjs'

test('A mail-off owner uses a one-time sign-in grant and email requests are refused', async t => {
  const h = await installation({ bindings: { MAIL_PROVIDER: 'none', MAIL_FROM: undefined, MAIL_API_KEY: undefined } })
  t.after(() => h.close())
  const email = 'owner@example.test'
  const emailLink = await h.request('/auth/magic-link', { method: 'POST', body: { email } })
  assert.equal(emailLink.status, 503)
  assert.equal((await emailLink.json()).error, 'mail_off')

  // Write the same grant record as the hosted CLI. Only the Worker owns consumption.
  const token = randomBytes(32).toString('base64url')
  const digest = createHash('sha256').update('owner-signin\0' + token).digest('hex')
  const now = Date.now()
  await h.db.prepare(`INSERT INTO oa_owner_signins
    (id,token_hash,operator_id,operator_version,created_at,expires_at)
    SELECT ?,?,id,version,?,? FROM oa_operators WHERE email=?`)
    .bind(randomUUID(), digest, now, now + 60_000, email).run()

  const confirm = () => h.request('/auth/owner-signin', { method: 'POST', body: { token } })
  const signedIn = await confirm()
  assert.equal(signedIn.status, 303)
  const cookie = signedIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const session = await h.request('/auth/session', { as: cookie })
  assert.equal(session.status, 200)
  assert.equal((await session.json()).operator.email, email)
  assert.equal((await confirm()).status, 400)

  const invite = await h.request('/auth/invite', { method: 'POST', as: cookie, body: { email: 'colleague@example.test', displayName: 'Colleague', role: 'member' } })
  assert.equal(invite.status, 503)
  assert.equal((await invite.json()).error, 'mail_off')
  assert.equal(h.mails.length, 0)
})
