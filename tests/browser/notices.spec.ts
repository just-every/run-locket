import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { noticeFixture, prepare, signedEvent, postEvent, webhookKey } from '../api/notice-fixture.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })
for (const width of [1440, 390]) {
  test(`RENEW-006 reviews frozen PDF, sends approved email, displays signed delivery and manual certified-mail evidence at ${width}px`, async ({ page }) => {
    const key = webhookKey()
    const product = await productPage(page, { width, bindings: { NOTICE_RESEND_WEBHOOK_SECRET: key } })
    const { h, origin, command, state } = product
    const shot = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      if (process.env.LOCKET_SCREENSHOTS) {
        await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-renew-006-${name}.png`), fullPage: true })
      }
    }
    const click = async (scope: any, label: string) => {
      const response = page.waitForResponse(r => r.url() === `${origin}/api/locket/commands` && r.request().method() === 'POST')
      await scope.getByRole('button', { name: label, exact: true }).click()
      const body = await (await response).json()
      expect(body.ok, JSON.stringify(body.error)).toBe(true)
      await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
    }
    try {
      const f = await noticeFixture(product.owner, `Browser ${width}`)
      const n = await prepare(product.owner, f.renewalId)
      await page.goto(origin + '/app#renewals')
      const email = page.locator('article.lk-notice').filter({ hasText: 'To notices@cardinal.example' })
      await expect(email.getByRole('link', { name: 'Download PDF letter' })).toBeVisible()
      const s = await state(), letter = s.noticeLetters.find((l: any) => l.id === n.id)
      await expect(email).toContainText(letter.sha256)
      const downloaded = await h.owner.request(`/api/locket/files/${letter.artifact_id}`)
      expect(downloaded.headers.get('x-locket-sha256')).toBe(letter.sha256)
      await shot('draft')
      await click(email, 'Approve for sending')
      await expect(email).toContainText('Approved, not sent')
      await shot('approved')
      await click(email, 'Send approved PDF by email')
      await expect(email).toContainText('Email accepted by provider')
      const dispatch = (await state()).noticeDispatches.find((d: any) => d.notice_id === n.id)
      await expect(email).toContainText(dispatch.provider_message_id)
      await shot('accepted')
      expect((await postEvent(h, signedEvent(key, dispatch.provider_message_id))).status).toBe(200)
      await page.reload()
      await expect(email).toContainText('Provider reported delivered')
      await expect(email).toContainText('legally effective; counsel makes that decision')
      await shot('delivered')
      const paper = await prepare(product.owner, f.renewalId, 'Cardinal Legal, 10 Main St, Raleigh NC')
      await command('notice.approve', { noticeId: paper.id })
      await page.reload()
      const mail = page.locator('article.lk-notice').filter({ hasText: 'To Cardinal Legal' })
      await mail.getByLabel('Sent by', { exact: true }).selectOption('post')
      await mail.getByLabel('Sent at', { exact: true }).fill('2026-10-18T09:00')
      await mail.getByLabel('Certified mail or courier tracking number').fill('9400-1234-5678')
      await click(mail, 'Record that it was sent')
      await expect(mail).toContainText('Sent, delivery unconfirmed')
      await expect(mail).toContainText('9400-1234-5678')
      await shot('mail-unconfirmed')
      await mail.getByLabel('Delivered at', { exact: true }).fill('2026-10-18T11:00')
      await mail.getByLabel('Delivery evidence note').fill('Carrier delivery receipt: signed for by reception.')
      await click(mail, 'Record delivered evidence')
      await expect(mail).toContainText('Manually recorded delivered')
      await expect(mail).toContainText('signed for by reception')
      await shot('mail-delivered')
    } finally { await product.close() }
  })
}
