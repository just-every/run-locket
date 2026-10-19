import { locketResponse } from '../../src/locket/api'
import { authResponse } from '../../src/auth.server'
import { runApprovalReminders } from '../../src/locket/approval-reminder-dispatch'
import { runDeadlineReminders } from '../../src/locket/deadline-reminder-dispatch'

const systemNow = Date.now
export default {
  async fetch(request: Request, env: any) {
    Date.now = env.TEST_NOW ? () => Number(env.TEST_NOW) : systemNow
    return (await locketResponse(request, env)) ?? (await authResponse(request, env)) ?? new Response('Not found', { status: 404 })
  },
  async scheduled(controller: ScheduledController, env: any) {
    await runApprovalReminders(env, controller.scheduledTime)
    await runDeadlineReminders(env, controller.scheduledTime)
  },
}
