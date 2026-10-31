import assert from 'node:assert/strict'
let identity

export function colleagueIdentity() {
  assert.ok(identity, 'The positive colleague must complete native confirmation')
  return identity
}

export async function invitePerson({ request, origin, email, owner, mail }, displayName, role) {
  const invited = await request(origin + '/auth/invite', { method: 'POST', headers: { Origin: origin, Cookie: owner.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, displayName, role }) })
  console.log('Native colleague invitation HTTP', invited.status)
  assert.equal(invited.status, 202)
  await invited.body?.cancel()
  const messages = await mail.read({ limit: 10 })
  console.log('Native colleague accepted mail count', messages.length)
  const link = messages.flatMap(message => message.text?.match(/https?:\/\/[^\s<>]+/g) ?? []).map(value => new URL(value)).findLast(url => url.origin === origin && url.pathname === '/auth/confirm' && url.searchParams.has('token'))
  console.log('Native colleague confirmation link found', Boolean(link))
  assert.ok(link)
  const confirmed = await request(origin + '/auth/confirm', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: link.searchParams.get('token') }) })
  console.log('Native colleague confirmation HTTP', confirmed.status, 'session cookie', confirmed.headers.getSetCookie().length > 0)
  assert.equal(confirmed.status, 303)
  return confirmed
}

export async function confirmedPerson({ request, origin }, confirmed) {
  const cookie = confirmed.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
  assert.ok(cookie)
  const session = await request(origin + '/auth/session', { headers: { Cookie: cookie } })
  assert.equal(session.status, 200)
  const { operator } = await session.json()
  assert.equal(operator.status, 'active')
  assert.ok(operator.id)
  return { id: operator.id, email: operator.email, cookie }
}

export default async function (context) {
  const confirmed = await invitePerson(context, 'Morgan Colleague', 'member')
  identity = await confirmedPerson(context, confirmed)
  return confirmed
}
