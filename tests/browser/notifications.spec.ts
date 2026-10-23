import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { file, pdf } from '../api/files.mjs'

test.use({ ignoreHTTPSErrors: true })
test(`NOTIFY-001 inbox, explicit mention, read state and personal channels at 1440px/390px`, async ({ page }) => {
  for (const width of [1440, 390]) {
    let close = async () => {}
    let origin: string, owner: any
    if (process.env.LOCKET_NOTIFICATION_LIVE) {
      origin = process.env.LOCKET_BASE_URL!
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(process.env.LOCKET_OPEN!)
      await page.waitForURL(url => !url.hash.includes('rer-dev') && ['/app', '/setup'].includes(url.pathname))
      if (new URL(page.url()).pathname === '/setup') {
        await page.getByRole('checkbox').check()
        await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
        await page.waitForURL(url => url.pathname === '/app')
      }
      owner = {
        command: async (type: string, payload: object) => {
          const response = await page.request.post(origin + '/api/locket/commands', { headers: { origin }, data: { type, payload, commandId: randomUUID() } })
          const body = await response.json()
          expect(body.ok, JSON.stringify(body.error)).toBe(true)
          return body.result
        },
        state: async () => (await page.request.get(origin + '/api/locket/state')).json(),
      }
    } else {
      const product = await productPage(page, { width })
      close = () => product.close()
      origin = product.origin
      owner = product.owner
    }
    const commandResponse = (type: string) => page.waitForResponse(response => response.url() === origin + '/api/locket/commands' && response.request().method() === 'POST' && response.request().postDataJSON().type === type)
    const screenshot = async (name: string) => {
      if (!process.env.LOCKET_SCREENSHOTS) return
      await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-NOTIFY-001-${name}.png`), fullPage: true })
    }
    const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    try {
      const initial = await owner.state()
      await owner.command('notification.preferences', { inApp: true, email: true, digest: false, timezone: 'America/New_York' })
      const tag = randomUUID().slice(0, 8)
      const agreement = await owner.command('request.create', {
        title: `Supplier confidentiality review ${tag}`, type: 'nda', ownerId: initial.actor.id,
        party: { name: `Westlake Supply ${tag}`, kind: 'supplier' },
        file: file(`confidentiality-${tag}.pdf`, pdf('Both parties will protect confidential information.')),
        text: 'Both parties will protect confidential information.',
      })
      await page.goto(`${origin}/app#agreement/${agreement.id}`)
      const comments = page.locator('section.lk-comments-card')
      await comments.getByLabel('Comment on v1', { exact: true }).fill('Please review the confidentiality wording before we submit this request.')
      await comments.getByRole('checkbox', { name: `Mention ${initial.actor.name}`, exact: false }).check()
      await fits()
      await screenshot('mention')
      const mentioned = commandResponse('comment.add')
      await comments.getByRole('button', { name: 'Comment', exact: true }).click()
      const commentReply = await (await mentioned).json()
      expect(commentReply.ok, JSON.stringify(commentReply.error)).toBe(true)
      await expect(comments.getByText('Please review the confidentiality wording before we submit this request.', { exact: true })).toBeVisible()
      await page.getByRole('navigation', { name: 'Locket', exact: true }).getByRole('link', { name: 'Notifications', exact: true }).click()
      const inbox = page.getByRole('region', { name: 'Notification inbox', exact: true })
      const assignment = inbox.getByRole('article', { name: 'Assignment notification', exact: true }).filter({ has: page.locator(`a[href*="${agreement.id}"]`) })
      const mention = inbox.getByRole('article', { name: 'Comment mention notification', exact: true }).filter({ has: page.locator(`a[href*="${agreement.id}"]`) })
      await expect(assignment).toBeVisible()
      await expect(mention).toBeVisible()
      await expect(mention.getByText('Unread', { exact: true })).toBeVisible()
      // Notifications expose only a generic link; agreement details stay behind it.
      await expect(inbox).not.toContainText(`Westlake Supply ${tag}`)
      await expect(inbox).not.toContainText('Please review the confidentiality wording')
      const read = commandResponse('notification.read')
      await mention.getByRole('button', { name: 'Mark as read', exact: true }).click()
      expect((await (await read).json()).ok).toBe(true)
      await expect(mention.getByText('Read', { exact: true })).toBeVisible()
      await inbox.getByRole('button', { name: /^Unread / }).click()
      await expect(mention).toHaveCount(0)
      await expect(assignment).toBeVisible()
      await inbox.getByRole('button', { name: /^All / }).click()
      await mention.getByRole('link', { name: 'Open agreement', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`#agreement/${agreement.id}`))
      await expect(comments.getByText('Please review the confidentiality wording before we submit this request.', { exact: true })).toBeVisible()
      await page.getByRole('navigation', { name: 'Locket', exact: true }).getByRole('link', { name: 'Notifications', exact: true }).click()
      const preferences = page.getByRole('region', { name: 'Notification preferences', exact: true })
      await preferences.getByLabel('In-app notifications', { exact: true }).uncheck()
      await preferences.getByLabel('Email notifications', { exact: true }).uncheck()
      await preferences.getByLabel('Daily email digest', { exact: true }).check()
      await preferences.getByLabel('Notification time zone', { exact: true }).selectOption('America/Los_Angeles')
      const saved = commandResponse('notification.preferences')
      await preferences.getByRole('button', { name: 'Save notification preferences', exact: true }).click()
      expect((await (await saved).json()).ok).toBe(true)
      await page.reload()
      await expect(preferences.getByLabel('In-app notifications', { exact: true })).not.toBeChecked()
      await expect(preferences.getByLabel('Email notifications', { exact: true })).not.toBeChecked()
      await expect(preferences.getByLabel('Daily email digest', { exact: true })).toBeChecked()
      await expect(preferences.getByLabel('Notification time zone', { exact: true })).toHaveValue('America/Los_Angeles')
      expect((await owner.state()).notifications.preferences).toEqual({ inApp: false, email: false, digest: true, timezone: 'America/Los_Angeles' })
      await preferences.getByLabel('In-app notifications', { exact: true }).check()
      await preferences.getByLabel('Email notifications', { exact: true }).check()
      const enabled = commandResponse('notification.preferences')
      await preferences.getByRole('button', { name: 'Save notification preferences', exact: true }).click()
      expect((await (await enabled).json()).ok).toBe(true)
      await expect(preferences.getByRole('button', { name: 'Save notification preferences', exact: true })).toBeEnabled()
      await expect.poll(async () => (await owner.state()).notifications.preferences).toEqual({ inApp: true, email: true, digest: true, timezone: 'America/Los_Angeles' })
      await expect(mention.getByText('Read', { exact: true })).toBeVisible()
      await fits()
      await screenshot('inbox-preferences')
      await page.goto(`${origin}/app#agreement/${agreement.id}/versions`)
      const submitted = commandResponse('agreement.submit')
      await page.getByRole('button', { name: 'Submit for review', exact: true }).click()
      expect((await (await submitted).json()).ok).toBe(true)
      await page.goto(`${origin}/app#agreement/${agreement.id}/review`)
      const approval = page.getByRole('region', { name: 'Email approval link', exact: true })
      const emailed = commandResponse('approval.email')
      await approval.getByRole('button', { name: 'Email approval link', exact: true }).click()
      const reply = await (await emailed).json()
      expect(reply.ok).toBe(true)
      expect(reply.mailReceipt.code).toBe('daily_digest')
      await expect(page.getByRole('status')).toContainText('daily digest')
      await fits()
      await screenshot('approval-digest')
      await page.getByRole('navigation', { name: 'Agreement sections', exact: true }).getByRole('link', { name: 'Approvals', exact: true }).click()
      const reminder = page.getByRole('region', { name: 'Approval reminders', exact: true })
      await expect(reminder).toBeVisible()
      const reminded = commandResponse('approval.remind')
      await reminder.getByRole('button', { name: 'Remind approver', exact: true }).click()
      const reminderReply = await (await reminded).json()
      expect(reminderReply.ok).toBe(true)
      expect(reminderReply.mailReceipt.code).toBe('daily_digest')
      await expect(page.getByRole('status')).toContainText('daily digest')
      await fits()
      await screenshot('reminder-digest')
    } finally { await close() }
  }
})
