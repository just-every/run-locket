import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { file, pdf } from '../api/files.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })
const quote = 'The supplier keeps insurance in force and reports on security every quarter.'
test(`OBL-002 refuses an insurance obligation done without its certificate, emails and escalates an overdue one and shows the raised risk on the counterparty page at 1440px/390px`, async ({ page }) => {
  for (const width of [1440, 390]) {
    const p = await productPage(page, { width })
    try {
      const screenshot = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        if (process.env.LOCKET_SCREENSHOTS) {
          await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
          await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-obl-002-${name}.png`), fullPage: true })
        }
      }
      await p.h.setTime(Date.parse('2026-08-03T15:00:00Z'))
      const a = await p.command('legacy.import', { title: 'Secure courier supply', type: 'supplier', party: { name: 'Harbor Couriers', kind: 'supplier' }, sourceSystem: 'Shared drive', sourceId: 'contracts/courier.pdf', signed: true, text: quote, file: file('courier.pdf', pdf(quote)) })
      for (const [description, evidence, risk, dueDate] of [['Keep a certificate of insurance on file', 'file', 'low', '2026-12-31'], ['Deliver the quarterly security report', 'none', 'medium', '2026-08-10']]) {
        const o = await p.command('obligation.add', { agreementId: a.id, description, ownerId: (await p.state()).actor.id, recurrence: 'none', evidence, risk, dueDate, citation: { quote } })
        await p.command('obligation.update', { agreementId: a.id, obligationId: o.id, action: 'confirm' })
      }

      const other = await p.h.invite('synthetic-locket-other-owner@example.test', 'requester')
      const ownerId = (await p.state()).actor.id
      const extras: Record<string, string> = {}
      for (const [description, recurrence, owner, dueDate] of [
        ['synthetic-locket-monthly report', 'monthly', ownerId, '2026-08-31'],
        ['synthetic-locket-waiver', 'none', ownerId, '2026-08-10'],
        ['synthetic-locket-other assignment', 'none', other.id, '2026-08-14'],
        ['synthetic-locket-rejected suggestion', 'none', ownerId, '2026-08-10'],
      ]) {
        const o = await p.command('obligation.add', { agreementId: a.id, description, ownerId: owner, dueDate, recurrence, evidence: 'none', risk: 'low', citation: { quote } })
        extras[description] = o.id
        await p.command('obligation.update', { agreementId: a.id, obligationId: o.id, action: description.includes('rejected') ? 'reject' : 'confirm' })
      }

      // Done needs the certificate: refused without it, accepted with it.
      await page.goto(`${p.origin}/app#agreement/${a.id}/terms`)
      await page.reload()
      const insurance = page.locator('.lk-obligations li').filter({ hasText: 'Keep a certificate of insurance on file' })
      await expect(insurance).toContainText('A file is required')
      await insurance.getByRole('button', { name: 'Mark done', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('Marking this obligation done needs a file (such as a certificate of insurance) as evidence.')
      await insurance.getByLabel('Evidence file', { exact: true }).setInputFiles({ name: 'coi.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf('Certificate of insurance')) })
      await insurance.getByRole('button', { name: 'Mark done', exact: true }).click()
      await expect(insurance).toContainText('Evidence: coi.pdf')
      await screenshot('evidence')

      const waiver = page.locator(`[data-obligation-id="${extras['synthetic-locket-waiver']}"]`)
      await waiver.getByText('Waive this occurrence', { exact: true }).click()
      await waiver.getByLabel('Waiver reason', { exact: true }).fill('Owner records a local tracking waiver for this occurrence.')
      await waiver.getByRole('button', { name: 'Record waiver', exact: true }).click()
      await expect(waiver.locator('.lk-badge')).toHaveText('Waived')

      // The report passes its due date: its owner is emailed the next morning, and escalated three days later.
      await p.h.scheduled(Date.parse('2026-08-11T13:00:00Z'))
      await p.h.scheduled(Date.parse('2026-08-14T13:00:00Z'))
      expect(p.h.mails.filter((m: any) => m.subject === 'Overdue obligation in Locket')).toHaveLength(1)
      expect(p.h.mails.filter((m: any) => m.subject === 'Escalated overdue obligation in Locket')).toHaveLength(1)
      await p.h.setTime(Date.parse('2026-08-14T14:00:00Z'))
      await page.reload()
      const report = page.locator('.lk-obligations li').filter({ hasText: 'Deliver the quarterly security report' })
      await expect(report).toContainText('High raised from medium: overdue')
      const monthly = page.locator(`[data-obligation-id="${extras['synthetic-locket-monthly report']}"]`)
      await monthly.getByRole('button', { name: 'Mark done', exact: true }).click()
      await expect(monthly.locator('.lk-badge')).toHaveText('Done')
      await page.getByRole('link', { name: 'My obligations', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'My obligations', exact: true })).toBeVisible()
      const own = page.getByRole('region', { name: 'My obligation list', exact: true })
      await expect(own.locator('li')).toHaveCount(5)
      await expect(own).not.toContainText('synthetic-locket-other assignment')
      await expect(own).not.toContainText('synthetic-locket-rejected suggestion')
      await expect(own).toContainText('Waived')
      await expect(own).toContainText('Missed')
      await expect(own).toContainText('Upcoming')
      await expect(own).toContainText('Sep 30, 2026')
      await screenshot('owner-list')
      const renewalsLink = page.getByRole('link', { name: 'Renewals', exact: true })
      await renewalsLink.focus()
      await expect(page.getByRole('tooltip')).toHaveText('Open Renewals')
      await page.goto(`${p.origin}/app#agreement/${a.id}/terms`)
      await page.locator('.lk-doc-meta').getByRole('link', { name: 'Harbor Couriers', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Harbor Couriers', exact: true })).toBeVisible()
      await expect(page.locator('[data-party-risk]')).toHaveText('Risk: High (raised: 1 overdue obligation)')
      await expect(page.getByRole('region', { name: 'Obligation risk', exact: true })).toContainText('Deliver the quarterly security report')
      const counterpartyObligations = page.getByRole('region', { name: 'Obligation risk', exact: true })
      await expect(counterpartyObligations).toContainText('synthetic-locket-other assignment')
      await expect(counterpartyObligations.locator(`[data-obligation-id="${extras['synthetic-locket-other assignment']}"] .lk-badge`)).toHaveText('Due')
      await expect(counterpartyObligations).toContainText('Waived')
      await expect(counterpartyObligations).not.toContainText('synthetic-locket-rejected suggestion')
      await screenshot('counterparty')
    } finally {
      await p.close()
    }
  }
})
