import assert from 'node:assert/strict'
import { colleagueIdentity } from './colleague.mjs'

const savedNames = new Map()

async function json({ request, origin }, session, path, data) {
  const response = await request(origin + path, {
    headers: { Origin: origin, Cookie: session, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }),
  })
  assert.equal(response.status, 200, path)
  return response.json()
}

export async function restorePeopleNames(context) {
  const previous = savedNames.get(context.origin)
  if (!previous) return
  for (const [session, displayName] of previous) {
    await json(context, session, '/auth/display-name', { displayName })
  }
  savedNames.delete(context.origin)
}

export async function beforeStep(context) {
  await restorePeopleNames(context)
  if (context.step.id !== 'people_sensitive') return

  const colleague = colleagueIdentity()
  const native = await json(context, context.cookie, '/api/locket/state')
  const person = native.operators.find(operator => operator.id === colleague.id)
  assert.ok(person)
  savedNames.set(context.origin, [[context.cookie, native.actor.name], [colleague.cookie, person.name]])
  // Two genuinely signed-in people supply the classified records.
  await json(context, context.cookie, '/auth/display-name', { displayName: 'Synthetic Locket owner 00-0000000' })
  await json(context, colleague.cookie, '/auth/display-name', { displayName: 'Synthetic Locket colleague 00-0000000' })
}

export async function afterStep(context) {
  if (context.step.id !== 'people_sensitive') return
  try {
    const native = await json(context, context.cookie, '/api/locket/state')
    assert.deepEqual(context.result.members, native.operators)
  } finally {
    await restorePeopleNames(context)
  }
}
