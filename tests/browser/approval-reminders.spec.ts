import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { file, pdf } from '../api/files.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })

for (const width of [1440, 390]) {
  test(`APPROVE-004 sets reminder intervals and a delegate, shows the scheduled reminders and escalation, and limits Remind approver at ${width}px`, async ({ page }) => {
    const p = await productPage(page, { width })
    const { h, origin, command, state } = p
    const screenshot = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
      if (process.env.LOCKET_SCREENSHOTS) {
        await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-approve-004-${name}.png`), fullPage: true })
      }
    }
    try {
      const tag = crypto.randomUUID().slice(0, 8)
      const approver = await h.invite(`approver-${tag}@example.test`, 'approver')
      const delegate = await h.invite(`delegate-${tag}@example.test`, 'approver')
      await page.goto(`${origin}/app#activity`)
      const settings = page.getByRole('region', { name: 'Approval reminder settings', exact: true })
      await settings.getByLabel('Escalate after (business days)', { exact: true }).fill('2')
      await settings.getByRole('button', { name: 'Save reminder intervals', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('Saved.')
      await settings.getByLabel('Approver', { exact: true }).selectOption(approver.id)
      await settings.getByLabel('Time zone', { exact: true }).selectOption('America/Chicago')
      await settings.getByLabel('Delegate', { exact: true }).selectOption(delegate.id)
      await settings.getByRole('button', { name: 'Save approval preferences', exact: true }).click()
      await expect(settings.getByText(`Central · delegate delegate-${tag}`)).toBeVisible()
      await screenshot('settings')
      expect((await state()).approvalReminders.settings.escalateAfterDays).toBe(2)

      const created = await command('request.create', { title: `Reminder journey ${tag}`, type: 'nda', party: { name: `Counterparty ${tag}`, kind: 'customer' }, file: file('review.pdf', pdf(`Confidentiality ${tag}`)), text: `Confidentiality ${tag}` })
      let a = (await state()).agreements.find((x: any) => x.id === created.id)
      await command('agreement.submit', { agreementId: a.id, version: a.version })
      a = (await state()).agreements.find((x: any) => x.id === created.id)
      await command('approval.email', { agreementId: a.id, version: a.version, versionId: a.current_version_id, recipientId: approver.id })
      await h.scheduled(Date.now() + 6 * 86_400_000) // at least 2 business days later: reminders and the escalation are due
      await page.goto(`${origin}/app#agreement/${a.id}/approvals`)
      await page.reload()
      const panel = page.getByRole('region', { name: 'Approval reminders', exact: true })
      await expect(panel.getByText(`Waiting on approver-${tag}`, { exact: true })).toBeVisible()
      await expect(panel.getByText(`Escalated to delegate-${tag} (delegate)`, { exact: true })).toBeVisible()
      await expect(panel.getByText(/^Reminder \d+ to approver-/)).toBeVisible()
      await expect(panel.getByText(/^Next reminder .* CT$/)).toBeVisible()

      const sent = page.waitForResponse(r => r.url() === `${origin}/api/locket/commands` && r.request().method() === 'POST')
      await panel.getByRole('button', { name: 'Remind approver', exact: true }).click()
      const body = await (await sent).json()
      expect(body.ok, JSON.stringify(body.error)).toBe(true)
      expect(body.mailReceipt.status).toBe('accepted')
      await expect(page.getByRole('status')).toContainText('The mail provider accepted the reminder. Mailbox delivery is unconfirmed.')
      await expect(panel.getByText(/^Reminded recently\. Next manual reminder from /)).toBeVisible()
      await expect(panel.getByRole('button', { name: 'Remind approver', exact: true })).toHaveCount(0)
      expect(h.mails.filter((m: any) => m.subject === 'Reminder: approval waiting in Locket' && m.to[0] === `approver-${tag}@example.test`).length).toBe(2)
      await screenshot('approvals')

      await page.getByRole('navigation', { name: 'Agreement sections' }).getByRole('link', { name: 'Details and access', exact: true }).click()
      await expect(page.getByText(/Manual reminder to approver-.*: the mail provider accepted it; mailbox delivery is unconfirmed\./)).toBeVisible()
      await expect(page.getByText(new RegExp(`Escalated approver-${tag}'s pending approval to delegate-${tag} \\(delegate\\)`))).toBeVisible()
      await screenshot('activity')
    } finally {
      await p.close()
    }
  })
}
