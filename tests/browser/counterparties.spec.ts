import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { file, pdf } from '../api/files.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })
const quote = 'This agreement runs from January 1, 2026 to December 31, 2027.'
for (const width of [1440, 390]) {
  test(`REPO-010 records a counterparty's notice address and signatory, links three agreements, merges an intake duplicate and shows combined value and the next deadline at ${width}px`, async ({ page }) => {
    const p = await productPage(page, { width })
    try {
      const screenshot = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        if (process.env.LOCKET_SCREENSHOTS) {
          await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
          await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-repo-010-${name}.png`), fullPage: true })
        }
      }
      const kept = await p.command('party.save', { name: 'Acme Robotics, Inc.', kind: 'supplier' })
      const imported = (title: string, value: string) => p.command('legacy.import', { title, type: 'supplier', partyId: kept.id, value, sourceSystem: 'Shared drive', sourceId: `contracts/${title}.pdf`, signed: true, text: quote, file: file(`${title}.pdf`, pdf(`${title} ${quote}`)) })
      const msa = await imported('Acme MSA', '120000')
      await imported('Acme amendment 1', '50000')
      await p.command('request.create', { title: 'Acme spares order', type: 'nda', partyId: kept.id, value: '9000' })
      for (const [key, value] of [['effective_date', '2026-01-01'], ['end_date', '2027-12-31'], ['notice_days', '60'], ['auto_renew', 'no']]) {
        const term = await p.command('term.propose', { agreementId: msa.id, key, value, citation: { quote } })
        await p.command('term.decide', { agreementId: msa.id, termId: term.id, decision: 'confirm' })
      }

      // Intake creates a duplicate under a different spelling.
      await page.goto(p.origin + '/app#new')
      await page.reload()
      await page.getByLabel('Agreement title *', { exact: true }).fill('Acme gripper NDA')
      await page.getByLabel('Request type *', { exact: true }).selectOption('nda')
      await page.getByRole('radio', { name: 'New', exact: true }).check()
      await page.getByLabel('Name', { exact: true }).fill('ACME Robotics')
      await page.getByRole('radio', { name: 'Add later', exact: true }).check()
      await page.getByRole('button', { name: 'Create request', exact: true }).click()
      await expect(page.locator('.lk-doc-meta')).toContainText('ACME Robotics')

      // The kept record takes its notice address, method and signatory.
      await page.goto(`${p.origin}/app#counterparty/${kept.id}`)
      await page.reload()
      const details = page.getByRole('region', { name: 'Details', exact: true })
      await details.getByText('Edit counterparty', { exact: true }).click()
      await details.getByLabel('Entity type', { exact: true }).fill('Corporation')
      await details.getByLabel('State or country of formation', { exact: true }).fill('Delaware')
      await details.getByLabel('Tax ID', { exact: true }).fill('98-7654321')
      await details.getByLabel('Notice method', { exact: true }).selectOption('courier')
      await details.getByLabel('Notice address', { exact: true }).fill('General Counsel, 1 Market Street, San Francisco, CA 94105')
      await details.getByLabel('Authorized signatories', { exact: true }).fill('Jordan Diaz | jordan@acme.example | Chief Financial Officer')
      await details.getByRole('button', { name: 'Save counterparty', exact: true }).click()
      await expect(details).toContainText('General Counsel, 1 Market Street, San Francisco, CA 94105 by courier')
      await expect(details).toContainText('Jordan Diaz, Chief Financial Officer')
      await expect(page.locator('.lk-titlebar')).toContainText('EIN 98-7654321')

      // Merge the duplicate: its agreement moves here and the page shows the combined value and the next deadline.
      const mergePanel = page.getByRole('region', { name: 'Merge a duplicate', exact: true })
      await mergePanel.getByLabel('Duplicate counterparty', { exact: true }).selectOption({ label: 'ACME Robotics' })
      await mergePanel.getByLabel('Why they are the same *', { exact: true }).fill('Same Delaware corporation')
      await mergePanel.getByRole('button', { name: 'Merge into this counterparty', exact: true }).click()
      await expect(details).toContainText('Merged into this record: ACME Robotics (Same Delaware corporation)')
      const agreements = page.getByRole('region', { name: 'Agreements', exact: true })
      for (const title of ['Acme MSA', 'Acme amendment 1', 'Acme spares order', 'Acme gripper NDA']) await expect(agreements.getByRole('link', { name: title, exact: true })).toBeVisible()
      await expect(page.locator('[data-party-total]')).toHaveText('$170,000 USD')
      await expect(page.locator('[data-party-annual]')).toHaveText('$60,000 USD')
      await expect(page.locator('[data-party-deadline]')).toHaveText('Mon Nov 1, 2027, 11:59 pm ET')
      await screenshot('page')
    } finally {
      await p.close()
    }
  })
}
