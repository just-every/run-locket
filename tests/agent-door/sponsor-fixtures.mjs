import assert from 'node:assert/strict'
import { colleagueIdentity } from './colleague.mjs'
import { inactiveSponsor } from './negative-sponsor.mjs'

export default async function ({ phase, request, origin, cookie, database }) {
  const colleague = colleagueIdentity()
  const values = { colleague: { id: colleague.id } }
  if (phase !== 'negative') return { values }

  const sponsor = inactiveSponsor()
  assert.notEqual(sponsor.id, colleague.id)
  const db = await database('DB')
  const binding = await db.prepare('SELECT operator_id, email, state, business_role FROM bs_team WHERE business_id=?').bind(sponsor.sub).first()
  assert.equal(binding.operator_id, sponsor.id)
  assert.equal(binding.email, sponsor.email)
  assert.ok(['active', 'invited'].includes(binding.state))
  assert.equal(binding.business_role, 'admin')

  const session = await request(origin + '/auth/session', { headers: { Cookie: sponsor.cookie } })
  assert.equal(session.status, 200)
  const { operator } = await session.json()
  assert.equal(operator.id, sponsor.id)
  assert.equal(operator.email, sponsor.email)
  assert.equal(operator.status, 'active')
  const active = await request(origin + '/agents/api/state', { headers: { Cookie: sponsor.cookie } })
  assert.equal(active.status, 200, 'The bound active native sponsor can open agent settings')
  await active.body?.cancel()

  const suspended = await request(origin + '/auth/operator/status', {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId: sponsor.id, status: 'inactive' }),
  })
  assert.equal(suspended.status, 200)
  const person = await suspended.json()
  assert.equal(person.id, sponsor.id)
  assert.equal(person.status, 'inactive')

  const refused = await request(origin + '/agents/api/state', { headers: { Cookie: sponsor.cookie } })
  assert.equal(refused.status, 401)
  assert.deepEqual(await refused.json(), { code: 'unauthenticated' })
  console.log('Native inactive sponsor: active bound control HTTP 200; owner suspension HTTP 200; suspended person HTTP 401')
  return { values, sponsors: { inactive: { sub: sponsor.sub, email: sponsor.email } } }
}
