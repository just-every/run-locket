import { runRenewalBriefs } from './locket/renewal-briefs'
import { runRemediation } from './locket/remediation-mail'
import { runRenewalLifecycle } from './locket/renewal-lifecycle'
import { runRenewalCalendars } from './locket/renewal-calendar'
import { runRetentionReminders } from './locket/retention-reminders'
import { runRuleReminders } from './locket/approval-rules'
import { runQueueEscalations } from './locket/request-queue'
import { runNoticeAgent } from './locket/notice-agent-runtime'
import { runNotifications } from './locket/notification-dispatch'
import { runReports } from './locket/report-dispatch'
import { withDemo } from './modules/demo/index.mjs'
import { seedDemo } from './demo'
import start from '@tanstack/react-start/server-entry'
import { Hono } from 'hono'
import { dispatch } from './base/dispatch'
import { staticAssetResponse } from './base/static-assets'
import { deploymentHealth } from './base/deployment-health'
import { lobbyResponse } from './base/lobby'
import { setupStateResponse } from './base/setup-state'
import { authResponse, runtimeBindings, type Bindings } from './auth.server'
import { identity } from './identity'
import { locketResponse } from './locket/api'
import { runApprovalReminders } from './locket/approval-reminder-dispatch'
import { runDeadlineReminders } from './locket/deadline-reminder-dispatch'

const api = new Hono<{ Bindings: Bindings }>()
api.get('/health', (context) => context.json({ status: 'ok', ...deploymentHealth(context.env) }))

// Start documents keep their own cache policy and add no-transform, so no proxy
// rewrites the HTML React hydrates (Cloudflare's email address obfuscation
// honours it; src/base/hydration/README.md).
function noTransform(response: Response): Response {
  const headers = new Headers(response.headers), policy = headers.get('cache-control')
  headers.set('cache-control', policy ? `${policy}, no-transform` : 'no-transform')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default withDemo({
  async fetch(request, env, execution) {
    const asset = await staticAssetResponse(request, env)
    if (asset) return asset
    const locket = await locketResponse(request, env)
    if (locket) return locket
    const auth = await authResponse(request, env)
    if (auth) return auth
    // The installed variant: the Lobby at / and the public claim state it reads.
    // Local dev serves the saved origin's data at its own port (RER_DEV_ORIGIN).
    const state = await setupStateResponse(request, runtimeBindings(env))
    if (state) return state
    const lobby = await lobbyResponse(request, runtimeBindings(env), identity)
    if (lobby) return lobby
    return dispatch(request, () => api.fetch(request, env, execution), async () => noTransform(await start.fetch(request)))
  },
  // APPROVE-004 approval and RENEW-002 deadline reminders, hourly (triggers.crons in wrangler.jsonc, crons in deploy.json).
  async scheduled(controller, env) {
    await runRenewalLifecycle(runtimeBindings(env),controller.scheduledTime)
    await runRenewalCalendars(runtimeBindings(env),controller.scheduledTime)
    await runRemediation(runtimeBindings(env),controller.scheduledTime)
    await runRuleReminders(runtimeBindings(env), controller.scheduledTime)
    await runQueueEscalations(runtimeBindings(env), controller.scheduledTime)
    await runApprovalReminders(runtimeBindings(env), controller.scheduledTime)
    await runDeadlineReminders(runtimeBindings(env), controller.scheduledTime)
    await runRenewalBriefs(runtimeBindings(env), controller.scheduledTime)
    await runRetentionReminders(runtimeBindings(env), controller.scheduledTime)
    await runNotifications(runtimeBindings(env), controller.scheduledTime)
    await runNoticeAgent(runtimeBindings(env), controller.scheduledTime)
    await runReports(runtimeBindings(env), controller.scheduledTime)
  },
} satisfies ExportedHandler<Bindings>, { seed: seedDemo })
