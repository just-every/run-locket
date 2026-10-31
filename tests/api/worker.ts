import { runPdfRenditions } from '../../src/locket/pdf-renditions'
import { runExecutionRetrievals } from '../../src/locket/execution-retrieval'
import { runConnectionExpiry } from '../../src/locket/connection-expiry'
import { runApprovalChannels } from '../../src/locket/approval-channel-automatic'
import { runOutcomeReports } from '../../src/locket/outcome-report-dispatch'
import { runRenewalBriefs } from '../../src/locket/renewal-briefs'
import { runRemediation } from '../../src/locket/remediation-mail'
import { runRenewalLifecycle } from '../../src/locket/renewal-lifecycle'
import { runRenewalCalendars } from '../../src/locket/renewal-calendar'
import { runRetentionReminders } from '../../src/locket/retention-reminders'
import { runRuleReminders } from '../../src/locket/approval-rules'
import { runQueueEscalations } from '../../src/locket/request-queue'
import { runNoticeAgent } from '../../src/locket/notice-agent-runtime'
import { runNotifications } from '../../src/locket/notification-dispatch'
import { runReports } from '../../src/locket/report-dispatch'
import { locketResponse } from '../../src/locket/api'
import { authResponse, runtimeBindings } from '../../src/auth.server'
import { businessSettings } from '../../src/agent-door/business'
import { locketAgentDoor } from '../../src/agent-door/index.server'
import { runApprovalReminders } from '../../src/locket/approval-reminder-dispatch'
import { runDeadlineReminders } from '../../src/locket/deadline-reminder-dispatch'

const systemNow = Date.now
export default {
  async fetch(request: Request, env: any) {
    Date.now = env.TEST_NOW ? () => Number(env.TEST_NOW) : systemNow
    const path = new URL(request.url).pathname
    if (['/api/rer/business-settings', '/rer-business-logo', '/rer-business.css'].includes(path)) {
      const business = await businessSettings(runtimeBindings(env)).handle(request)
      if (business) return business
    }
    if (path === '/mcp' || path === '/api/rer/agent-policy' || path === '/agents' || path.startsWith('/agents/') || ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'].includes(path)) {
      const agent = await (await locketAgentDoor(env)).handle(request)
      if (agent) return agent
    }
    return (await locketResponse(request, env)) ?? (await authResponse(request, env)) ?? new Response('Not found', { status: 404 })
  },
  async scheduled(controller: ScheduledController, env: any) {
    Date.now = env.TEST_NOW ? () => Number(env.TEST_NOW) : systemNow
    await runPdfRenditions(env,controller.scheduledTime)
    await runExecutionRetrievals(env,controller.scheduledTime)
    await runConnectionExpiry(env,controller.scheduledTime)
    await runRenewalLifecycle(env,controller.scheduledTime)
    await runRenewalCalendars(env,controller.scheduledTime)
    await runRemediation(env,controller.scheduledTime)
    await runRuleReminders(env, controller.scheduledTime)
    await runQueueEscalations(env, controller.scheduledTime)
    await runApprovalReminders(env, controller.scheduledTime)
    await runDeadlineReminders(env, controller.scheduledTime)
    await runRenewalBriefs(env, controller.scheduledTime)
    await runRetentionReminders(env, controller.scheduledTime)
    await runApprovalChannels(env, controller.scheduledTime)
    await runNotifications(env, controller.scheduledTime)
    await runNoticeAgent(env, controller.scheduledTime)
    await runReports(env, controller.scheduledTime)
    await runOutcomeReports(env, controller.scheduledTime)
  },
}
