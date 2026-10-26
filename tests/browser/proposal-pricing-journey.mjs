// The real product component and authenticated Worker show the accepted pricing at both required sizes.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { productPage } from './product-harness.mjs'

const output = process.env.LOCKET_SCREENSHOTS
if (!output) throw Error('Set LOCKET_SCREENSHOTS to an evidence directory outside the checkout.')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.LOCKET_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })
    const page = await context.newPage()
    const proposal = { id: 'synthetic-locket-1', revision: 1, status: 'accepted', title: 'Accepted customer service', clientName: 'Synthetic customer', currency: 'GBP', scope: 'Provide hosted services.', terms: 'Initial term 12 months. Start 2026-11-01.', options: [{ id: 'selected', cents: 67500, tables: [{ lines: [{ name: 'Service', description: 'Hosted seats', quantity: '1.5', unitPrice: '500.00', grossCents: 75000, lineTotalCents: 67500 }] }], optionalItems: [{ id: 'backup', label: 'Premium backup', unitCents: 10000, min: 1, max: 5, quantity: 1, editable: true }, { id: 'unused', label: 'Not selected', unitCents: 50000, min: 1, max: 1, quantity: 1, editable: false }] }], acceptance: { revision: 1, optionId: 'selected', totalCents: 97500, currency: 'GBP', selection: { optionId: 'selected', totalCents: 97500, items: [{ id: 'backup', label: 'Premium backup', quantity: 3, unitCents: 10000, totalCents: 30000 }] } } }
    const product = await productPage(page, { width, bindings: { PLATTER_ORIGIN: 'https://platter.example.test', PLATTER_TOKEN: 'synthetic-locket-1', TEST_NOW: '1793016000000' }, outboundResponse: async request => {
      assert.equal(new URL(request.url).pathname, '/api/platter/agent/context')
      return Response.json({ proposals: [proposal] })
    } })
    try {
      const imported = await product.command('proposal.import', { proposalId: proposal.id, consent: true, usdRate: '1.25' })
      await page.goto(product.origin + `/app#agreement/${imported.id}/versions`)
      await page.getByRole('heading', { name: 'accepted-proposal.pdf', exact: true }).waitFor()
      const paper = page.locator('.lk-paper')
      await paper.getByText(/1.5 x GBP 500.00; net GBP 675.00/).waitFor()
      assert.match(await paper.innerText(), /Premium backup/)
      assert.doesNotMatch(await paper.innerText(), /Not selected/)
      assert.match(await paper.innerText(), /recorded rate 1.25 USD per GBP/)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      const agreements = page.getByRole('navigation', { name: 'Locket', exact: true }).getByRole('link', { name: 'Agreements', exact: true })
      await agreements.focus()
      await page.getByRole('tooltip', { name: 'Open Agreements', exact: true }).waitFor()
      await page.screenshot({ path: join(output, `${width}-proposal-pricing-document.png`), fullPage: true })
      await agreements.blur()
      await agreements.hover()
      await page.getByRole('tooltip', { name: 'Open Agreements', exact: true }).waitFor()
      await page.getByRole('link', { name: 'Details and access', exact: true }).click()
      await page.getByText('GBP', { exact: false }).first().waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      await page.screenshot({ path: join(output, `${width}-proposal-pricing-details.png`), fullPage: true })
      console.log(`PASS ${width}: accepted fractional and discounted pricing, selected optional item, recorded currency mapping, document and details, focus and hover tooltip`)
    } finally { await product.close(); await context.close() }
  }
} finally { await browser.close() }
