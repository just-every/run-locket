import { servicePerformanceHandlers } from './service-performance'
import { wordReviewHandlers, wordReviewView } from './word-review'
import { playbookRecommendationHandlers } from './playbook-recommendations'
import { reconciliationHandlers } from './reconciliation'
import { serviceLevelHandlers } from './service-levels'
import { familyAnalysisHandlers } from './family-analysis'
import { wordTemplateHandlers } from './word-templates'
import { accountingHandlers } from './accounting'
import { renewalBriefHandlers } from './renewal-briefs'
import { inboundExchangeResponse } from './exchange-inbound'
import { requireFullFields } from './repository-access'
import { repositoryBulkHandlers } from './repository-bulk'
import { repositoryBulkResponse } from './repository-bulk-http'
import { exchangeHandlers, exchangeList } from './exchange'
import { publicExchangeResponse } from './exchange-public'
import { erasureHandlers } from './erasure'
import { retentionHandlers } from './retention'
import { approvalRuleHandlers, ruleReminderReceipt } from './approval-rules'
import { repositoryAccessHandlers } from './repository-access'
import { queueHandlers } from './request-queue'
import { intakeFormHandlers } from './intake-forms'
import { intakeAudienceHandlers } from './intake-audiences'
import { editVersion } from './browser-edits'
import { workflowAnalytics } from './analytics'
import { resolveComment } from './comment-threads'
import { noticeAgentHandlers } from './notice-agent'
import { notificationHandlers } from './notifications'
import { reportHandlers, previewReport } from './reports'
import { reportCsv, reportPdf } from './report-output'
// Locket's HTTP surface under /api/locket. The same commands serve the
// interface, an agent working through an invited `agent` operator, and tests.
import type { Bindings } from '../auth.server'
import { approvalMailReceipt, emailApproval } from './approval-mail'
import { reminderReceiptFor } from './approval-reminder-dispatch'
import { approvalReminderHandlers } from './approval-reminders'
import { deadlineReminderHandlers } from './deadline-reminders'
import { preferenceHandlers } from './preferences'
import { selectFamilyTerm } from './families'
import { family } from './family-projection'
import { bulkOperationHandlers } from './bulk-reminder-operations'
import { bulkReminderHandlers } from './bulk-reminders'
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
import { emailNotice } from './notice-mail'
import { prepareLetter } from './notice-letters'
import { trackNotice } from './notice-tracking'
import { noticeEventResponse } from './notice-events'
import { savedViewHandlers } from './saved-views'
import { entityHandlers } from './entities'
import { installationHandlers } from './installation'
import { counterpartyHandlers } from './counterparties'
import { repositoryResult, repositoryCsv } from './repository'
import { fail, Problem } from './model'
import { obligationHandlers } from './obligations'
import { peopleHandlers } from './people'
import { proposalHandlers } from './proposals'
import { customFieldHandlers } from './custom-fields'
import { customValueHandlers } from './custom-values'
import { reviewHandlers } from './review'
import { compare, download, exportArchive, state } from './views'

export const handlers: Record<string, Handler> = {
  ...wordReviewHandlers,
  ...serviceLevelHandlers,
  ...servicePerformanceHandlers,
  ...playbookRecommendationHandlers, ...reconciliationHandlers, ...familyAnalysisHandlers, ...wordTemplateHandlers, ...accountingHandlers, ...renewalBriefHandlers, ...exchangeHandlers, ...repositoryBulkHandlers, ...erasureHandlers, ...retentionHandlers, ...approvalRuleHandlers, ...repositoryAccessHandlers, ...queueHandlers, ...intakeFormHandlers, ...intakeAudienceHandlers,
  ...customFieldHandlers, ...customValueHandlers,
  'version.edit': editVersion, 'comment.resolve': resolveComment,
  ...notificationHandlers, ...noticeAgentHandlers,
  ...savedViewHandlers, ...reportHandlers,
  ...entityHandlers,
  ...installationHandlers,
  ...counterpartyHandlers,
  'notice.email': emailNotice,
  'notice.letter': prepareLetter,
  'notice.tracking': trackNotice,
  ...agreementHandlers,
  ...bulkReminderHandlers,
  ...bulkOperationHandlers,
  'family.term': selectFamilyTerm,
  'approval.email': emailApproval,
  ...approvalReminderHandlers,
  ...deadlineReminderHandlers,
  ...preferenceHandlers,
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
    const event = await noticeEventResponse(request, env)
    if (event) return event
    const inbound = await inboundExchangeResponse(request,env)
    if(inbound)return inbound
    if (request.method === 'POST') {
      // Same-origin JSON only: a cross-site form cannot carry a session into a command.
      const origin = request.headers.get('origin')
      if (!origin || origin !== url.origin) return reply({ ok: false, error: { code: 'ORIGIN', message: 'Commands must come from this installation.' } }, 403)
      if (!(request.headers.get('content-type') ?? '').includes('application/json')) return reply({ ok: false, error: { code: 'INVALID', message: 'Send JSON.' } }, 415)
    }
    const clickwrap = await publicClickwrapResponse(request, env)
    if (clickwrap) return clickwrap
    const exchange = await publicExchangeResponse(request,env)
    if(exchange)return exchange
    const actor = await currentActor(request, env)
    const bulk = await repositoryBulkResponse(request,env,actor)
    if(bulk)return bulk
    if(request.method==='GET'&&path==='/exchanges')return reply(await exchangeList(env,actor,url.searchParams.get('agreementId')??''))
    if(request.method==='GET'&&path==='/word-review')return reply(await wordReviewView(env,actor,url.searchParams.get('versionId')??''))
    if (request.method === 'GET' && path === '/analytics') { await requireFullFields(env.DB,actor); return reply(workflowAnalytics(await state(env, actor), url.searchParams)) }
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
    if (request.method === 'GET' && path.startsWith('/families/')) return reply(family(await state(env, actor), decodeURIComponent(path.slice('/families/'.length))))
    if (request.method === 'GET' && path === '/repository') {
      const result = await repositoryResult(env, actor, url.searchParams)
      if (url.searchParams.get('format') === 'csv') {
        await recordReads(env, actor, [{ action: 'view.export', summary: 'Exported an accessible repository view as CSV.' }])
        return new Response(repositoryCsv(result), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="locket-view.csv"' } })
      }
      return reply(result)
    }
    if (request.method === 'GET' && path.startsWith('/reports/')) {
      const out = await previewReport(env, actor, decodeURIComponent(path.slice('/reports/'.length)))
      const format = url.searchParams.get('format')
      if (format === 'csv' || format === 'pdf') {
        await recordReads(env, actor, [{ action: 'report.export', summary: `Exported a personal report as ${format.toUpperCase()}.` }])
        return new Response((format === 'csv' ? reportCsv(out) : reportPdf(out)) as BodyInit, { headers: { ...headers, 'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf', 'content-disposition': `attachment; filename="locket-report.${format}"` } })
      }
      return reply(out)
    }
    if (request.method === 'GET' && path === '/portfolio') return reply(portfolio(await state(env, actor), url.searchParams.get('entityId')))
    if (request.method === 'GET' && path === '/state') { const workspace = await state(env, actor); return reply({ ...workspace, portfolio: portfolio(workspace) }) }
    if (request.method === 'GET' && path === '/search') {
      const params = new URLSearchParams(url.searchParams)
      if (params.has('q')) {
        if (params.has('definition') || params.has('viewId')) fail('INVALID', 'Choose q, definition or viewId.')
        params.set('definition', JSON.stringify({ query: params.get('q'), filters: [], sort: { field: 'title', direction: 'asc' }, columns: ['title','reference','status','counterparty'] }))
      }
      const result = await repositoryResult(env, actor, params)
      const restricted = new Set((await env.DB.prepare('SELECT id FROM lk_agreements WHERE restricted=1').all<{id:string}>()).results.map(a => a.id))
      await recordReads(env, actor, result.rows.filter(r => restricted.has(r.id)).map(r => ({action:'agreement.view',agreementId:r.id,summary:'Read restricted agreement in search results.'})))
      return reply({ results: result.rows.map(r => ({ id: r.id, title: r.values.title, reference: r.values.reference, status: r.values.status, party: r.values.counterparty, match: r.matches?.[0] ?? null, matches: r.matches })) })
    }
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
      return reply({ ok: true, result, ...(input.type === 'approval.email' ? { mailReceipt: await approvalMailReceipt(env, input.commandId) } : input.type === 'approval.remind' ? { mailReceipt: await reminderReceiptFor(env, input.commandId) } : input.type==='approval.rule.remind'?{mailReceipt:await ruleReminderReceipt(env,input.commandId)}:{}) })
    }
    return reply({ ok: false, error: { code: 'NOT_FOUND', message: 'No such Locket endpoint.' } }, 404)
  } catch (error) {
    if (error instanceof Problem) return reply({ ok: false, error: { code: error.code, message: error.message, details: error.details } }, error.status)
    console.error('locket request failed', error)
    return reply({ ok: false, error: { code: 'SERVER', message: 'Locket could not complete that request. Nothing was saved unless it is listed after reloading.' } }, 500)
  }
}
