import { test, expect } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { portfolioFixture } from '../api/portfolio-fixture.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })
for (const width of [1440, 390]) {
  test(`REPO-007 saves ordered supplier renewal columns, shares to approvers, pins personally and exports only their visible rows at ${width}px`, async ({ page }) => {
    const p = await productPage(page, { width, bindings: { TEST_NOW: String(Date.parse('2026-10-17T12:00:00Z')) } })
    try {
      const tag = `Views-${width}`, ids = await portfolioFixture(p.owner, tag)
      const approver = await p.h.invite(`saved-approver-${width}@example.test`, 'approver')
      await page.goto(p.origin + '/app#agreements')
      const panel = page.getByRole('region', { name: 'Saved repository views', exact: true })
      const screenshot = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        if (process.env.LOCKET_SCREENSHOTS) {
          await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
          await panel.scrollIntoViewIfNeeded()
          await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-repo-007-${name}.png`), fullPage: true })
        }
      }
      await panel.getByRole('button', { name: 'New view', exact: true }).click()
      await panel.getByLabel('View name', { exact: true }).fill('Supplier renewals next quarter')
      await panel.getByLabel('View query', { exact: true }).fill(tag)
      for (const [index, field, operator, value] of [[1, 'type', 'eq', 'supplier'], [2, 'current_term_end', 'gte', '2027-01-01'], [3, 'current_term_end', 'lte', '2027-03-31']] as const) {
        await panel.getByRole('button', { name: 'Add filter', exact: true }).click()
        await panel.getByLabel(`Filter field ${index}`, { exact: true }).selectOption(field)
        await panel.getByLabel(`Filter operator ${index}`, { exact: true }).selectOption(operator)
        await panel.getByLabel(`Filter value ${index}`, { exact: true }).fill(value)
      }
      await panel.getByLabel('Sort field', { exact: true }).selectOption('value')
      await panel.getByLabel('Sort direction', { exact: true }).selectOption('desc')
      await panel.getByLabel('Shared with approver', { exact: true }).check()
      await panel.getByRole('button', { name: 'Move Value (USD) up', exact: true }).click()
      await panel.getByRole('button', { name: 'Apply view', exact: true }).click()
      await expect(panel.getByRole('status')).toHaveText('2 agreements you can access.')
      await expect(panel.locator('thead th')).toHaveText(['Value (USD)', 'Agreement', 'Owner', 'Notice deadline'])
      await expect(panel.locator('tbody tr').first().locator('td')).toHaveCount(4)
      await expect(panel.getByRole('table')).toContainText('2026-12-30')
      await screenshot('definition-preview')
      const response = page.waitForResponse(r => r.url() === p.origin + '/api/locket/commands' && r.request().method() === 'POST')
      await panel.getByRole('button', { name: 'Save view', exact: true }).click()
      const saved = await (await response).json()
      expect(saved.ok, JSON.stringify(saved.error)).toBe(true)
      const id = saved.result.id
      await expect(panel.getByRole('button', { name: 'Pin view', exact: true })).toBeVisible()
      await panel.getByRole('button', { name: 'Pin view', exact: true }).click()
      await expect(panel.getByRole('button', { name: 'Unpin view', exact: true })).toBeVisible()
      await screenshot('saved-pinned')
      await page.context().clearCookies()
      await page.context().addCookies(approver.cookie.split('; ').map((pair: string) => {
        const i = pair.indexOf('=')
        return { name: pair.slice(0, i), value: pair.slice(i + 1), url: p.origin, secure: true, httpOnly: true, sameSite: 'Lax' as const }
      }))
      await page.reload()
      await panel.getByLabel('Saved view', { exact: true }).selectOption(id)
      await panel.getByRole('button', { name: 'Open saved view', exact: true }).click()
      await expect(panel.getByRole('status')).toHaveText('1 agreement you can access.')
      await expect(panel.getByRole('table')).toContainText(`old agreement ${tag}`)
      await expect(panel.getByRole('table')).not.toContainText(`hidden agreement ${tag}`)
      await expect(panel.getByRole('table')).toContainText('$100,000.25')
      await expect(panel.getByRole('button', { name: 'Pin view', exact: true })).toBeVisible()
      await screenshot('approver-results')
      const downloaded = page.waitForEvent('download')
      await panel.getByRole('button', { name: 'Export view CSV', exact: true }).click()
      const path = await (await downloaded).path()
      const csv = await readFile(path!, 'utf8')
      expect(csv).toContain('"Value (USD)","Agreement","Owner","Notice deadline"')
      expect(csv).toContain('"$100,000.25"')
      expect(csv).toContain(`old agreement ${tag}`)
      expect(csv).not.toContain(`hidden agreement ${tag}`)
      expect(csv).toContain('2026-12-30')
      const result = await (await approver.request('/api/locket/repository?viewId=' + id)).json()
      expect(result.rows.map((row: any) => row.id)).toEqual([ids.old])
      await screenshot('exported')
    } finally { await p.close() }
  })
}
