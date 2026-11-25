import assert from 'node:assert/strict'
import { registerInactiveReviewer } from './negative-sponsor.mjs'
export default async function ({ request, origin, claim, displayName, reviewers }) {
  const bootstrap = await request(origin + claim.path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: claim.token, displayName, returnTo: '/app' }) })
  console.log('Native owner claim HTTP', bootstrap.status)
  if (bootstrap.status !== 303) { try { const body = await bootstrap.clone().json(); console.log('Native claim refusal', body.error ?? body.code ?? 'unspecified') } catch {} }
  assert.equal(bootstrap.status, 303)
  const cookie = bootstrap.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
  assert.ok(cookie)
  await reviewers.initialize('colleague', { cookie })
  registerInactiveReviewer(reviewers, { cookie })
  return bootstrap
}
