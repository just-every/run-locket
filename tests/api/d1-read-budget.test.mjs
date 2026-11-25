import assert from 'node:assert/strict'
import test from 'node:test'
import { installation } from './harness.mjs'
import { seedPortfolio } from './d1-budget-fixture.mjs'

// Workers Free allows 5 million D1 rows read a day for the whole account, shared by every tool on it.
// 100 agreements with 30 days of retained history: scheduled runs and polls must read rows in
// proportion to what is open or due, never to what has piled up. Ceilings are generous.
const hour = 3_600_000
const reading = async h => (await h.request('/__d1_meter')).json()
const hourly = (h, at) => h.scheduled(at)
const minutely = async (h, at) => { const r = await (await h.mf.getWorker()).scheduled({ scheduledTime: new Date(at), cron: '* * * * *' }); assert.equal(r.outcome, 'ok', JSON.stringify(r)) }

test('D1 reads of Locket\'s scheduled runs and polls do not grow with retained history', async t => {
  const h = await installation({ entryPoint: 'tests/api/metered-worker.ts' }); t.after(() => h.close())
  const at = Date.parse('2026-06-15T12:00:00Z')
  await h.setTime(at)
  await seedPortfolio(h.db, at)
  await reading(h)

  // The first hourly run after an upgrade checks every agreement once.
  await hourly(h, at)
  const first = await reading(h)
  // Later runs read only what is due: agreements changed or unchecked for a day, and reminders in their window.
  await hourly(h, at + hour)
  await hourly(h, at + 2 * hour)
  await reading(h)
  await hourly(h, at + 3 * hour)
  const steady = await reading(h)
  await minutely(h, at + 3 * hour + 60_000)
  const minute = await reading(h)
  // Opening the version page polls one rendition, not the workspace.
  const poll = await h.owner.request('/api/locket/pdf-rendition?versionId=v0')
  assert.equal(poll.status, 200)
  assert.equal((await poll.json()).status, 'ready')
  const rendition = await reading(h)

  console.log(`hourly first ${first.rows} rows, steady ${steady.rows} rows (${steady.writes} written); minute ${minute.rows} rows; rendition poll ${rendition.rows} rows`)
  assert.ok(first.rows < 15_000, `first hourly run read ${first.rows} rows`)
  assert.ok(steady.rows < 3_000, `a steady hourly run read ${steady.rows} rows`)
  assert.ok(steady.writes < 300, `a steady hourly run wrote ${steady.writes} rows`)
  assert.ok(minute.rows < 100, `a minute run read ${minute.rows} rows`)
  assert.ok(rendition.rows < 60, `a rendition poll read ${rendition.rows} rows`)
})
