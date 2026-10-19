import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { file, pdf } from '../api/files.mjs'
import { postEvent, signedEvent, webhookKey } from '../api/notice-fixture.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

for (const width of [1440, 390]) {
  test(`RENEW-002 sets offsets and a digest preference, shows the sent reminder, its bounce and the alternate retry on the deadline at ${width}px`, async ({ page }) => {
    const key = webhookKey()
    const p = await productPage(page, { width, bindings: { NOTICE_RESEND_WEBHOOK_SECRET: key } })
    const { h, origin, command, state } = p
    const screenshot = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
      if (process.env.LOCKET_SCREENSHOTS) {
        await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-renew-002-${name}.png`), fullPage: true })
      }
    }
    try {
      const tag = crypto.randomUUID().slice(0, 8)
      const rhea = await h.invite(`rhea-${tag}@example.test`, 'requester')
      await page.goto(`${origin}/app#renewals`)
      const offsets = page.getByRole('region', { name: 'Deadline reminder offsets', exact: true })
      await expect(offsets.getByLabel('Days before each deadline', { exact: true })).toHaveValue('90, 60, 30, 7')
      await offsets.getByLabel('Days before each deadline', { exact: true }).fill('60, 30, 7')
      await offsets.getByRole('button', { name: 'Save reminder offsets', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('Saved.')
      expect((await state()).deadlineReminders.offsets).toEqual([60, 30, 7])

      await page.goto(`${origin}/app#activity`)
      const preferences = page.getByRole('region', { name: 'Reminder preferences', exact: true })
      await preferences.getByLabel('Person', { exact: true }).selectOption(rhea.id)
      await preferences.getByLabel('Time zone', { exact: true }).selectOption('America/Denver')
      await preferences.getByLabel('Daily digest: one email a day with every deadline reminder that came due').check()
      await preferences.getByRole('button', { name: 'Save preferences', exact: true }).click()
      await expect(preferences.getByText(/Mountain · delegate none · daily digest · alternate default/)).toBeVisible()
      await screenshot('preferences')
      await command('preferences.set', { operatorId: rhea.id, timezone: 'America/Denver', digest: false })

      const end = iso(Date.now() + 70 * 86_400_000)
      const a = await command('legacy.import', { title: `Courier supply ${tag}`, type: 'supplier', ownerId: rhea.id, party: { name: `Courier ${tag}`, kind: 'supplier' }, sourceSystem: 'Archive', sourceId: crypto.randomUUID(), file: file('signed.pdf', pdf(`Give 30 days notice ${tag}.`)), text: `Give 30 days notice ${tag}.`, signed: true })
      for (const [k, v] of [['end_date', end], ['notice_days', '30']]) {
        const term = await command('term.propose', { agreementId: a.id, key: k, value: v, citation: { quote: `Give 30 days notice ${tag}.` } })
        await command('term.decide', { agreementId: a.id, termId: term.id, decision: 'confirm' })
      }
      await h.scheduled(Date.now()) // the 60-day time passed 20 days ago: too late, so nothing is sent
      expect(h.mails.filter((m: any) => m.subject === 'Renewal notice deadline in Locket').length).toBe(0)
      const deadlineDate = (await state()).renewals.find((r: any) => r.agreement_id === a.id).deadline_date
      await h.scheduled(Date.parse(iso(Date.parse(deadlineDate) - 60 * 86_400_000) + 'T18:00:00Z')) // that morning, 9:00 Mountain has passed
      const records = (await (await h.owner.request('/api/locket/export')).json()).records
      const sent = records.lk_deadline_reminders.find((r: any) => r.agreement_id === a.id && r.kind === 'reminder')
      expect(sent.offset_days).toBe(60)
      expect((await postEvent(h, signedEvent(key, sent.provider_message_id, { type: 'email.bounced', to: `rhea-${tag}@example.test` }))).status).toBe(200)
      expect(h.mails.filter((m: any) => m.to[0] === 'owner@example.test' && m.subject === 'Renewal notice deadline in Locket').length).toBe(1)

      await page.goto(`${origin}/app#renewals`)
      await page.reload()
      await page.getByRole('button', { name: `Courier supply ${tag}`, exact: true }).click()
      const log = page.getByRole('region', { name: 'Deadline reminders sent', exact: true })
      await expect(log.getByText(`60-day reminder to rhea-${tag} (responsible person)`)).toBeVisible()
      await expect(log.getByText('Provider: bounced', { exact: true })).toBeVisible()
      await expect(log.getByText('Alternate retry of the 60-day reminder to Olive Owner (owner)')).toBeVisible()
      await screenshot('renewal')
    } finally {
      await p.close()
    }
  })
}
