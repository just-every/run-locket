import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { file, pdf } from '../api/files.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })
const quote = 'This agreement ends on December 26, 2026; either party may give 30 days notice.'
test(`US-001 sets the installation's Pacific zone and business-day rolling, shows USD and W-9 at intake, a GBP value at its recorded rate and a Thanksgiving deadline rolled to Wednesday at 1440px and 390px`, async ({ page }) => {
  test.setTimeout(240_000)
  for (const width of [1440, 390]) {
    const p = await productPage(page, { width })
    try {
      const screenshot = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        if (process.env.LOCKET_SCREENSHOTS) {
          await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
          await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-us-001-${name}.png`), fullPage: true })
        }
      }
      // The owner chooses Pacific time and turns on business-day rolling.
      await page.goto(p.origin + '/app#library')
      const panel = page.getByRole('region', { name: 'Installation defaults', exact: true })
      await expect(panel).toContainText('US dollars (USD)')
      await expect(panel).toContainText('Eastern (America/New_York)')
      await panel.getByText('Change installation defaults', { exact: true }).click()
      await panel.getByLabel('Installation time zone', { exact: true }).selectOption('America/Los_Angeles')
      await panel.getByLabel('Roll a notice deadline on a weekend or US federal holiday back to the previous business day', { exact: true }).check()
      await panel.getByRole('button', { name: 'Save defaults', exact: true }).click()
      await expect(panel).toContainText('Pacific (America/Los_Angeles)')
      await expect(panel).toContainText('Roll back to the previous US business day')
      await screenshot('defaults')

      // The request form shows USD and the installation's zone; a supplier request needs a certificate of insurance and a W-9.
      await page.goto(p.origin + '/app#new')
      await page.reload()
      await expect(page.getByLabel('Currency', { exact: true })).toHaveValue('USD')
      await expect(page.getByLabel('Agreement value (USD)', { exact: true })).toBeVisible()
      await expect(page.getByLabel('Time zone', { exact: true })).toHaveValue('America/Los_Angeles')
      await page.getByLabel('Request type *', { exact: true }).selectOption('supplier')
      await expect(page.locator('.lk-checklist li')).toHaveText([/Certificate of insuranceRequired for supplier/, /Form W-9Required for supplier/])
      await screenshot('intake')

      // A GBP agreement keeps its amount and shows the USD equivalent at the recorded rate.
      await page.getByLabel('Agreement title *', { exact: true }).fill('London services')
      await page.getByLabel('Request type *', { exact: true }).selectOption('nda')
      await page.getByLabel('Currency', { exact: true }).fill('GBP')
      await page.getByLabel('Agreement value (GBP)', { exact: true }).fill('40000')
      await page.getByLabel('US dollars per 1 GBP *', { exact: true }).fill('1.27')
      await page.getByLabel('Name', { exact: true }).fill('Thames Ltd')
      await page.getByLabel('EIN', { exact: true }).fill('12-3456789')
      await page.getByRole('radio', { name: 'Add later', exact: true }).check()
      await page.getByRole('button', { name: 'Create request', exact: true }).click()
      await expect(page.locator('.lk-doc-meta')).toContainText('£40,000.00 GBP')
      await expect(page.locator('.lk-doc-meta')).toContainText('$50,800 USD at 1.27 USD per GBP, rate recorded by')
      const london = (await p.state()).agreements.find((a: any) => a.title === 'London services')
      expect([london.timezone, london.currency, london.original_cents, london.value_cents]).toEqual(['America/Los_Angeles', 'GBP', 4000000, 5080000])
      expect((await p.state()).parties.find((x: any) => x.name === 'Thames Ltd')).toMatchObject({ tax_id_kind: 'ein', tax_id: '12-3456789' })
      await screenshot('gbp')

      // A notice deadline on Thanksgiving (Thursday November 26, 2026) rolls back to Wednesday.
      const legacy = await p.command('legacy.import', { title: 'Holiday supply', type: 'other', party: { name: 'Holiday Goods', kind: 'supplier' }, sourceSystem: 'Shared drive', sourceId: 'contracts/holiday.pdf', signed: true, text: quote, file: file('holiday.pdf', pdf(quote)) })
      for (const [key, value] of [['end_date', '2026-12-26'], ['notice_days', '30'], ['auto_renew', 'no']]) {
        const t = await p.command('term.propose', { agreementId: legacy.id, key, value, citation: { quote } })
        await p.command('term.decide', { agreementId: legacy.id, termId: t.id, decision: 'confirm' })
      }
      await page.goto(`${p.origin}/app#agreement/${legacy.id}/terms`)
      await page.reload()
      await expect(page.getByText('Notice deadline', { exact: false }).first()).toContainText('Wed Nov 25, 2026, 11:59 pm PT')
      // Governing law is chosen from the US states and DC, or typed for another jurisdiction.
      await page.getByText('Propose or correct a term', { exact: true }).click()
      await expect(page.locator('#lk-governing-law option')).toHaveCount(51)
      await expect(page.locator('#lk-governing-law option[value="District of Columbia"]')).toHaveCount(1)
      await screenshot('thanksgiving')
    } finally {
      await p.close()
    }

  }
})
