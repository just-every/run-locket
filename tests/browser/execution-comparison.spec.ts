import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { file, pdf } from '../api/files.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })

async function connection(page: any, width: number) {
  if (!process.env.LOCKET_EXECUTION_LIVE) return productPage(page, { width })
  const origin = process.env.LOCKET_BASE_URL
  const entry = process.env.LOCKET_OPEN
  if (!origin || !entry) throw Error('Live execution journey requires the private owner entry and installation origin.')
  await page.setViewportSize({ width, height: 1000 })
  await page.goto(entry)
  await page.waitForURL((url: URL) => !url.hash.includes('rer-dev') && ['/app', '/setup'].includes(url.pathname))
  if (new URL(page.url()).pathname === '/setup') {
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
    await page.waitForURL((url: URL) => url.pathname === '/app')
  }
  return {
    origin,
    state: async () => (await page.request.get(origin + '/api/locket/state')).json(),
    command: async (type: string, payload: object) => {
      const response = await page.request.post(origin + '/api/locket/commands', { headers: { origin }, data: { commandId: randomUUID(), type, payload } })
      const body = await response.json()
      expect(body.ok, JSON.stringify(body.error)).toBe(true)
      return body.result
    },
    close: async () => {},
  }
}

for (const width of [1440, 390]) test(`AGENT-006 changed signed liability is visible and held until reasoned acceptance at ${width}px`, async ({ page }) => {
  const product = await connection(page, width)
  const { command, state, origin } = product
  const shot = async (name: string) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    if (process.env.LOCKET_SCREENSHOTS) {
      await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-agent-006-${name}.png`), fullPage: true })
    }
  }
  const click = async (label: string) => {
    const pending = page.waitForResponse(response => response.url() === origin + '/api/locket/commands' && response.request().method() === 'POST')
    await page.getByRole('button', { name: label, exact: true }).click()
    const body = await (await pending).json()
    expect(body.ok, JSON.stringify(body.error)).toBe(true)
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
    return body.result
  }
  try {
    const tag = randomUUID().slice(0, 8)
    const approvedText = `Agreement ${tag}. Liability cap is USD 100000.`
    const returnedText = approvedText.replace('100000', '1000000')
    const approved = pdf(approvedText), returned = pdf(returnedText)
    const request = await command('request.create', { title: `Northwind services agreement ${tag}`, type: 'nda', party: { name: `Northwind Technology Inc. ${tag}`, kind: 'customer' }, file: file('approved-liability.pdf', approved), text: approvedText })
    const agreement = async () => (await state()).agreements.find((a: any) => a.id === request.id)
    let a = await agreement()
    await command('agreement.submit', { agreementId: a.id, version: a.version })
    a = await agreement()
    await command('approval.decide', { agreementId: a.id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' })
    a = await agreement()
    const pkg = await command('package.prepare', { agreementId: a.id, version: a.version, provider: 'docusign', recipients: [{ name: 'Alex', email: 'alex@example.test', action: 'sign' }] })
    a = await agreement()
    await command('package.sent', { agreementId: a.id, version: a.version, packageId: pkg.packageId, envelopeId: `ENV-${tag}` })
    await page.goto(origin + `/app#agreement/${a.id}/execution`)
    await page.getByLabel('Signed PDF', { exact: true }).setInputFiles({ name: 'returned-liability.pdf', mimeType: 'application/pdf', buffer: returned })
    await page.getByLabel('Certificate of completion (as issued by the provider)').setInputFiles({ name: 'certificate.pdf', mimeType: 'application/pdf', buffer: pdf(`Provider certificate ${tag}`) })
    await page.getByLabel('Executed on', { exact: true }).fill('2026-10-20')
    await page.getByRole('checkbox', { name: 'I checked that this signed file is the packaged document.' }).check()
    const recorded = await click('Record execution')
    expect(recorded.status).toBe('needs_review')
    const comparison = page.getByRole('region', { name: 'Signed document comparison' })
    await expect(comparison.getByRole('heading', { name: 'PDF text comparison' })).toBeVisible()
    await expect(comparison).toContainText('Approved page 1')
    await expect(comparison).toContainText('Returned page 1')
    await expect(comparison.locator('blockquote').filter({ hasText: 'Liability cap is USD 100000.' })).toBeVisible()
    await expect(comparison.locator('blockquote').filter({ hasText: 'Liability cap is USD 1000000.' })).toBeVisible()
    expect((await agreement()).status).toBe('out_for_signature')
    await shot('changed-cap-held')
    const reason = 'Reviewed the increased liability cap and accept the signed terms.'
    page.once('dialog', dialog => dialog.accept(reason))
    await click('Accept with reason')
    await expect(page.getByText(reason, { exact: false })).toBeVisible()
    expect((await agreement()).status).toBe('executed')
    await page.reload()
    await expect(page.getByRole('region', { name: 'Signed document comparison' })).toContainText('Liability cap is USD 1000000.')
    expect((await state()).executions.find((e: any) => e.id === recorded.executionId).resolution).toBe(reason)
    await shot('accepted-with-history')
  } finally {
    await product.close()
  }
})
