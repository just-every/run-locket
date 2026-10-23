import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { bulkClock, bulkFixture } from '../api/bulk-reminders-fixture.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })
test(`RENEW-004 selects a filtered imported view, reviews 34 deadlines and 6 skips, stores 34 schedules at 1440px and 390px`, async ({ page }) => {
  test.setTimeout(240_000)
  for (const width of [1440, 390]) {
    const runtime = await productPage(page, { width, bindings: { TEST_NOW: String(bulkClock) } })
    try {
      const fixture = await bulkFixture(runtime.owner, `Browser-${width}`)
      await page.goto(runtime.origin + '/app#renewals')
      const panel = page.locator('.lk-bulk-reminders')
      await expect(panel.getByRole('heading', { name: 'Bulk reminder schedules' })).toBeVisible()
      await panel.getByLabel('Filter imported agreements').fill(`Browser-${width}-01`)
      await expect(panel.getByRole('checkbox', { name: 'Select all matching imported agreements' })).toBeVisible()
      await expect(panel.locator('.lk-bulk-selection > label')).toHaveCount(1)
      await panel.getByRole('checkbox', { name: 'Select all matching imported agreements' }).check()
      await expect(panel).toContainText('1 selected')
      await panel.getByLabel('Filter imported agreements').fill('')
      await panel.getByLabel('Agreement view', { exact: true }).selectOption('type-supplier')
      await expect(panel.locator('.lk-bulk-selection > label')).toHaveCount(40)
      await panel.getByRole('checkbox', { name: 'Select all matching imported agreements' }).check()
      await expect(panel).toContainText('40 selected')
      if(process.env.LOCKET_SCREENSHOTS){
        await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true})
        await panel.getByRole('heading',{name:'Bulk reminder schedules'}).scrollIntoViewIfNeeded()
        await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-renew-004-selection-viewport.png`)})
      }
      await panel.getByRole('button', { name: 'Preview reminder schedules', exact: true }).click()
      await expect(panel.getByRole('heading', { name: '34 tracked deadlines · 6 skipped' })).toBeVisible()
      await expect(panel.getByRole('status').filter({hasText:'Previewed 40 of 40 agreements.'})).toBeVisible()
      await page.reload()
      await panel.getByText('Stored reviews and resumable operations', {exact:true}).click()
      await panel.getByRole('button',{name:/Open reviewed selection/}).click()
      await expect(panel.getByRole('heading', {name:'34 tracked deadlines · 6 skipped'})).toBeVisible()
      const old = panel.locator(`[data-bulk-preview="${fixture.old[0]}"]`)
      await expect(old).toContainText('2026-03-01 to 2027-02-28')
      await expect(old).toContainText('Current term 5')
      await expect(old).toContainText('America/New_York')
      await expect(panel.locator(`[data-bulk-preview="${fixture.missing[0]}"]`)).toContainText('Missing confirmed terms')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      if (process.env.LOCKET_SCREENSHOTS) {
        await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
        await panel.getByRole('heading',{name:'34 tracked deadlines · 6 skipped'}).scrollIntoViewIfNeeded()
        await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-renew-004-preview-viewport.png`)})
        await page.evaluate(() => scrollTo(0, 0))
        await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-renew-004-preview.png`), fullPage: true })
      }
      await panel.getByRole('button', { name: 'Apply reviewed schedules', exact: true }).click()
      await expect(panel.getByRole('status').filter({hasText:'34 agreements scheduled.'})).toHaveText('34 agreements scheduled. No reminders delivered.')
      await expect(panel.getByRole('status').filter({hasText:'Processed 40 of 40 agreements.'})).toBeVisible()
      await expect(panel.locator('[data-reminder-schedule]')).toHaveCount(34)
      const schedules = (await runtime.state()).reminderSchedules
      expect(schedules).toHaveLength(34)
      expect(schedules.filter((r: any) => fixture.old.includes(r.agreement_id)).every((r: any) => r.deadline_at > bulkClock)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      if(process.env.LOCKET_SCREENSHOTS){await panel.getByRole('status').filter({hasText:'34 agreements scheduled.'}).scrollIntoViewIfNeeded();await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-renew-004-scheduled-viewport.png`)})}
      await page.evaluate(() => scrollTo(0, 0))
      if (process.env.LOCKET_SCREENSHOTS) await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-renew-004-scheduled.png`), fullPage: true })
    } finally { await runtime.close() }

  }
})
