import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { portfolioFixture } from '../api/portfolio-fixture.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })
for (const width of [1440, 390]) {
  test(`REPORT-003 every portfolio tile opens its matching register at ${width}px`, async ({ page }) => {
    const runtime = await productPage(page, { width, bindings: { TEST_NOW: String(Date.parse('2026-10-17T12:00:00Z')) } })
    try {
      const ids = await portfolioFixture(runtime.owner, String(width))
      await page.goto(runtime.origin + '/app')
      await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible()
      const p = await (await runtime.owner.request('/api/locket/portfolio')).json()
      const money = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })
      // Compare exact rendered USD values to the formatter used by the product.
      for (const tile of p.tiles) {
        const card = page.locator(`[data-portfolio-tile="${tile.id}"]`)
        await expect(card).toContainText(`${tile.count} ${tile.count === 1 ? 'agreement' : 'agreements'}`)
        await expect(card).toContainText(money(tile.valueCents) + ' USD')
      }
      await expect(page.getByText(/74 days left/)).toHaveCount(2)
      await expect(page.getByText(/74 days left/).first()).toBeVisible()
      await expect(page.locator('[data-portfolio-tile="notice-90"]')).toContainText('3 agreements')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      if (process.env.LOCKET_SCREENSHOTS) {
        await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-report-003-portfolio.png`), fullPage: true })
      }
      for (const tile of p.tiles) {
        await page.locator(`[data-portfolio-tile="${tile.id}"]`).click()
        await expect(page.getByRole('heading', { name: tile.label, exact: true, level: 1 })).toBeVisible()
        const shown = await page.locator('[data-agreement-id]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-agreement-id')).sort())
        expect(shown).toEqual([...tile.agreementIds].sort())
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        if (process.env.LOCKET_SCREENSHOTS && ['notice-90', 'lifecycle-expired', 'missing'].includes(tile.id)) await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-report-003-${tile.id}.png`), fullPage: true })
        await page.getByRole('link', { name: 'Back to portfolio' }).click()
      }
      await page.locator('[data-portfolio-tile="notice-90"]').click()
      await expect(page.locator(`[data-agreement-id="${ids.old}"]`)).toBeVisible()
      await expect(page.locator(`[data-agreement-id="${ids.old}"]`)).toContainText('74 days left')
      await expect(page.locator(`[data-agreement-id="${ids.old}"]`)).toContainText('2026')
      await expect(page.locator(`[data-agreement-id="${ids.expired}"]`)).toHaveCount(0)
      await page.getByRole('link', { name: 'Clear portfolio filter' }).click()
      await expect(page.locator(`[data-agreement-id="${ids.expired}"]`)).toBeVisible()
    } finally { await runtime.close() }
  })
}
