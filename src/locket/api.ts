// Locket's HTTP surface under /api/locket. The same commands serve the
// interface, an agent working through an invited `agent` operator, and tests.
import type { Bindings } from '../auth.server'
import { approvalMailReceipt, emailApproval } from './approval-mail'
import { portfolio } from './portfolio'
import { publicClickwrapResponse } from './clickwrap/http'
import { acceptanceCsv, acceptanceRecords, clickwrapHandlers } from './clickwrap/records'
import { currentActor, fullReaders } from './access'
import { auditCsv, auditTrail, recordReads } from './audit'
import { insertClause } from './clause-insertion'
import { approvedClauses } from './clause-provenance'
import { agreementHandlers } from './agreements'
import { runCommand, type Handler } from './commands'
import { executionHandlers } from './execution'
import { importHandlers } from './imports/commands'
import { libraryHandlers } from './library'
import { Problem } from './model'
import { obligationHandlers } from './obligations'
import { peopleHandlers } from './people'
import { proposalHandlers } from './proposals'
import { reviewHandlers } from './review'
import { compare, download, exportArchive, search, state } from './views'

export const handlers: Record<string, Handler> = {
  ...agreementHandlers,
  'approval.email': emailApproval,
  ...clickwrapHandlers,
  ...libraryHandlers,
  'clause.insert': insertClause,
  ...reviewHandlers,
  ...executionHandlers,
  ...obligationHandlers,
  ...proposalHandlers,
  ...peopleHandlers,
  ...importHandlers,
}

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers })

export async function locketResponse(request: Request, env: Bindings): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/locket/')) return null
  const path = url.pathname.slice('/api/locket'.length)
  try {
    if (request.method === 'POST') {
      // Same-origin JSON only: a cross-site form cannot carry a session into a command.
      const origin = request.headers.get('origin')
      if (!origin || origin !== url.origin) return reply({ ok: false, error: { code: 'ORIGIN', message: 'Commands must come from this installation.' } }, 403)
      if (!(request.headers.get('content-type') ?? '').includes('application/json')) return reply({ ok: false, error: { code: 'INVALID', message: 'Send JSON.' } }, 415)
    }
    const clickwrap = await publicClickwrapResponse(request, env)
    if (clickwrap) return clickwrap
    const actor = await currentActor(request, env)
    if (request.method === 'GET' && path === '/clickwrap/acceptances') {
      const rows = await acceptanceRecords(env, actor, url.searchParams)
      if (url.searchParams.get('format') === 'csv') {
        await recordReads(env, actor, [{ action: 'clickwrap.export', summary: `Exported ${rows.length} clickwrap acceptances as CSV.` }])
        return new Response(acceptanceCsv(rows), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="locket-clickwrap.csv"' } })
      }
      return reply({rows})
    }
    if (request.method === 'GET' && path === '/audit') {
      const { rows } = await auditTrail(env, actor, url.searchParams)
      if (url.searchParams.get('format') === 'csv') {
        await recordReads(env, actor, [{ action: 'audit.export', summary: `Exported ${rows.length} audit rows as CSV.` }], fullReaders)
        return new Response(auditCsv(rows), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="locket-audit.csv"' } })
      }
      return reply({ rows })
    }
    if (request.method === 'GET' && path === '/clause-library') return reply({ results: approvedClauses(await state(env, actor), url.searchParams.get('q') ?? '') })
    if (request.method === 'GET' && path === '/portfolio') return reply(portfolio(await state(env, actor)))
    if (request.method === 'GET' && path === '/state') { const workspace = await state(env, actor); return reply({ ...workspace, portfolio: portfolio(workspace) }) }
    if (request.method === 'GET' && path === '/search') return reply(await search(env, actor, url.searchParams.get('q') ?? ''))
    if (request.method === 'GET' && path === '/compare') return reply(await compare(env, actor, url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? ''))
    if (request.method === 'GET' && path === '/export') {
      const archive = await exportArchive(env, actor)
      return new Response(JSON.stringify(archive), { headers: { ...headers, 'content-type': 'application/json', 'content-disposition': `attachment; filename="locket-archive-${archive.exportedAt.slice(0, 10)}.json"` } })
    }
    if (request.method === 'GET' && path.startsWith('/files/')) return await download(env, actor, decodeURIComponent(path.slice('/files/'.length)))
    if (request.method === 'POST' && path === '/commands') {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return reply({ ok: false, error: { code: 'INVALID', message: 'The request body is not JSON.' } }, 400)
      }
      const result = await runCommand(env, actor, body, handlers, request)
      const input = body as { type: string; commandId: string }
      return reply({ ok: true, result, ...(input.type === 'approval.email' ? { mailReceipt: await approvalMailReceipt(env, input.commandId) } : {}) })
    }
    return reply({ ok: false, error: { code: 'NOT_FOUND', message: 'No such Locket endpoint.' } }, 404)
  } catch (error) {
    if (error instanceof Problem) return reply({ ok: false, error: { code: error.code, message: error.message, details: error.details } }, error.status)
    console.error('locket request failed', error)
    return reply({ ok: false, error: { code: 'SERVER', message: 'Locket could not complete that request. Nothing was saved unless it is listed after reloading.' } }, 500)
  }
}
