import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import promptJourney from './prompts.mjs'
import transportReplayJourney from './transport-replay.mjs'
import eventJourney, { beforeStep as beforeEvents, afterStep as afterEvents } from './events.mjs'
import { beforeStep as beforeAccess, afterStep as afterAccess } from './access-parity.mjs'

async function accessHook(hook, context) {
  try { await hook(context) } catch (error) {
    console.error('Native agent journey failed:', context.phase, context.step.id,
      error.code ?? error.name, error.stack?.split('\n').find(line => line.includes('access-parity.mjs:') || line.includes('events.mjs:')))
    throw error
  }
}
export async function beforeStep(context) {
  await accessHook(beforeAccess, context)
  await accessHook(beforeEvents, context)
}
export async function afterStep(context) {
  await accessHook(afterAccess, context)
  await accessHook(afterEvents, context)
}

export default async function ({ request, origin, cookie, tool }) {
  await promptJourney()
  await transportReplayJourney()
  await eventJourney()
  const human = async (path, init = {}) => {
    const response = await request(origin + path, { ...init, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...init.headers } })
    assert.equal(response.ok, true)
    return response.json()
  }
  const args = { title: 'Native boundary review', type: 'supplier', party: { name: 'Boundary Supplier', kind: 'supplier' }, idempotency_key: randomUUID() }
  const created = await tool('locket.requests.create', args)
  assert.equal(created.result?.isError, false)
  const result = created.result.structuredContent
  const before = (await human('/api/locket/state')).agreements
  const replayed = await tool('locket.requests.create', args)
  assert.deepEqual(replayed.result.structuredContent, result)
  assert.deepEqual((await human('/api/locket/state')).agreements, before)
  const changed = await tool('locket.requests.create', { ...args, title: 'Changed arguments' })
  assert.equal(changed.result?._meta?.['com.runeditrun/error']?.code, 'idempotency_conflict')
  const row = before.find(item => item.id === result.id)
  await human('/api/locket/commands', { method: 'POST', body: JSON.stringify({ commandId: randomUUID(), type: 'request.update', payload: { agreementId: row.id, version: row.version, title: 'Human revision' } }) })
  const stale = await tool('locket.requests.update', { agreementId: row.id, title: 'Stale agent revision', version: row.version, expected_revision: row.version, idempotency_key: randomUUID() })
  assert.equal(stale.result?._meta?.['com.runeditrun/error']?.code, 'revision_conflict')
  assert.equal((await human('/api/locket/state')).agreements.find(item => item.id === row.id).title, 'Human revision')
  const audit = await human('/api/locket/audit?agreement=' + row.id)
  assert.ok(audit.rows.some(item => item.action === 'request.create' && item.actor_name.includes(' for Synthetic Base 1')))
}
