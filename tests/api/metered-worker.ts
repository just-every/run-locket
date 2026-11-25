// The test Worker with a D1 binding that counts the rows every statement reads (meta.rows_read),
// so a test can hold a scheduled run or a poll to a row budget. GET /__d1_meter returns the rows
// read and written since the last call and starts a new count.
import worker from './worker'
import { runPdfRenditions } from '../../src/locket/pdf-renditions'
import { runExecutionRetrievals } from '../../src/locket/execution-retrieval'

let rows = 0, writes = 0, calls = 0
const record = (meta: any) => { calls++; rows += Number(meta?.rows_read ?? 0); writes += Number(meta?.rows_written ?? 0) }

function wrap(statement: any): any {
  return {
    _statement: statement,
    bind: (...values: unknown[]) => wrap(statement.bind(...values)),
    run: async () => { const result = await statement.run(); record(result.meta); return result },
    all: async () => { const result = await statement.all(); record(result.meta); return result },
    // first() discards metadata, so read the same result through all().
    first: async (column?: string) => { const result = await statement.all(); record(result.meta); const row = result.results[0]; if (!row) return null; return column === undefined ? row : row[column] },
    raw: (options?: unknown) => statement.raw(options),
  }
}
const meter = (db: any): any => ({
  prepare: (sql: string) => wrap(db.prepare(sql)),
  batch: async (statements: any[]) => { const results = await db.batch(statements.map(s => s._statement ?? s)); for (const result of results) record(result.meta); return results },
  exec: (sql: string) => db.exec(sql),
  dump: () => db.dump(),
})

export default {
  async fetch(request: Request, env: any) {
    if (new URL(request.url).pathname === '/__d1_meter') {
      const reading = { rows, writes, calls }
      rows = writes = calls = 0
      return Response.json(reading)
    }
    return worker.fetch(request, { ...env, DB: meter(env.DB) })
  },
  async scheduled(controller: ScheduledController, env: any) {
    // The minute trigger runs only what server.ts runs for it; the hourly trigger runs everything.
    if (controller.cron === '* * * * *') {
      const metered = { ...env, DB: meter(env.DB) }
      await runPdfRenditions(metered, controller.scheduledTime)
      await runExecutionRetrievals(metered, controller.scheduledTime)
      return
    }
    return worker.scheduled(controller, { ...env, DB: meter(env.DB) })
  },
}
