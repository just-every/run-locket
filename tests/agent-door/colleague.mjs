import assert from 'node:assert/strict'
export default async function ({ request, origin, email, owner, mail }) {
  const invited = await request(origin + '/auth/invite', { method: 'POST', headers: { Origin: origin, Cookie: owner.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, displayName: 'Morgan Colleague', role: 'member' }) })
  console.log('Native colleague invitation HTTP', invited.status)
  assert.equal(invited.status, 202)
  await invited.body?.cancel()
  const messages = await mail.read({ limit: 10 })
  console.log('Native colleague accepted mail count', messages.length)
  const link = messages.flatMap(message => message.text?.match(/https?:\/\/[^\s<>]+/g) ?? []).map(value => new URL(value)).find(url => url.origin === origin && url.pathname === '/auth/confirm' && url.searchParams.has('token'))
  assert.ok(link)
  return request(origin + '/auth/confirm', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: link.searchParams.get('token') }) })
}
