import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })
const parent = { legalName: 'Brightline Holdings, Inc.', entityType: 'Corporation', formation: 'Delaware, United States', taxIdKind: 'ein', taxId: '12-3456789', registeredAddress: '251 Little Falls Drive, Wilmington, DE 19808', noticeAddress: '100 Pine Street, New York, NY 10005', currency: 'USD', timezone: 'America/New_York', signatories: [{ name: 'Dana Park', email: 'dana@brightline.example', title: 'Chief Executive Officer' }] }
for (const width of [1440, 390]) {
  test(`ENTITY-001 records a UK subsidiary, offers only its template at intake and names it on the agreement at ${width}px`, async ({ page }) => {
    const p = await productPage(page, { width })
    try {
      const screenshot = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        if (process.env.LOCKET_SCREENSHOTS) {
          await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
          await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-entity-001-${name}.png`), fullPage: true })
        }
      }
      const parentId = (await p.command('entity.save', parent)).id
      await page.goto(p.origin + '/app#library')
      const panel = page.getByRole('region', { name: 'Our entities', exact: true })
      await panel.getByText('Record an entity', { exact: true }).click()
      for (const [label, value] of [['Legal name *', 'Brightline UK Limited'], ['Entity type *', 'Private limited company'], ['State or country of formation *', 'England and Wales, United Kingdom'], ['Tax ID', 'GB123456789'], ['Default currency *', 'GBP'], ['Time zone *', 'Europe/London'], ['Registered address *', '1 Poultry, London EC2R 8EJ'], ['Notice address *', '20 Farringdon Road, London EC1M 3HE'], ['Authorized signatories', 'Alex Morgan | alex@brightline-uk.example | Managing Director']])
        await panel.getByLabel(label, { exact: true }).fill(value)
      await panel.getByLabel('Tax ID kind', { exact: true }).selectOption('foreign')
      await panel.getByRole('button', { name: 'Save entity', exact: true }).click()
      await expect(panel.getByText('Signatories: Alex Morgan (Managing Director)', { exact: true })).toBeVisible()
      await screenshot('entities')
      const ukId = (await p.state()).entities.find((e: any) => e.legal_name === 'Brightline UK Limited').id
      for (const [name, entityId] of [['UK NDA', ukId], ['US NDA', parentId]]) {
        const t = await p.command('template.create', { name, type: 'nda', entityId, body: 'NDA for {{our_entity}} with {{counterparty}}. Notices: {{our_notice_address}}.', fields: [], clauses: [] })
        await p.command('template.decide', { versionId: t.versionId, decision: 'approve' })
      }

      await page.goto(p.origin + '/app#new')
      await page.reload()
      const entity = page.getByLabel('Our contracting entity *', { exact: true })
      const template = page.getByLabel('Template version', { exact: true })
      await entity.selectOption({ label: 'Brightline UK Limited' })
      await expect(template.locator('option')).toHaveText(['UK NDA v1'])
      await entity.selectOption({ label: 'Brightline Holdings, Inc.' })
      await expect(template.locator('option')).toHaveText(['US NDA v1'])
      await entity.selectOption({ label: 'Brightline UK Limited' })
      await page.getByLabel('Agreement title *', { exact: true }).fill('UK mutual NDA')
      await page.getByLabel('Request type *', { exact: true }).selectOption('nda')
      await page.getByLabel('Name', { exact: true }).fill('Northwind Partners')
      await screenshot('intake')
      await page.getByRole('button', { name: 'Create request', exact: true }).click()
      await expect(page.locator('.lk-doc-meta')).toContainText('Our entityBrightline UK Limited')
      const created = (await p.state()).agreements.find((a: any) => a.title === 'UK mutual NDA')
      expect([created.entity_id, created.timezone]).toEqual([ukId, 'Europe/London'])
      await screenshot('agreement')
    } finally {
      await p.close()
    }
  })
}
