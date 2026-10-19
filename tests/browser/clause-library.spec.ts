import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pdf } from '../api/files.mjs'

test.use({ locale: 'en-US', timezoneId: 'America/New_York' })
const origin = process.env.LOCKET_BASE_URL || 'http://127.0.0.1:8787'
for (const width of [1440, 390]) {
  test(`DRAFT-003 indemnity fallback insertion and executed acceptance at ${width}px`, async ({ page }) => {
    const entry = process.env.LOCKET_OPEN
    if (!entry) throw new Error('Set LOCKET_OPEN privately to the local owner entry URL.')
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(entry)
    await page.waitForURL(url => !url.hash.includes('rer-dev') && ['/app', '/setup'].includes(url.pathname))
    if (new URL(page.url()).pathname === '/setup') {
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
      await page.waitForURL(url => url.pathname === '/app')
    }
    const command = async (type: string, payload: object) => {
      const response = await page.request.post(`${origin}/api/locket/commands`, { headers: { origin }, data: { commandId: crypto.randomUUID(), type, payload } })
      const body = await response.json()
      expect(body.ok, JSON.stringify(body.error)).toBe(true)
      return body.result
    }
    const state = async () => (await page.request.get(`${origin}/api/locket/state`)).json()
    const tag = crypto.randomUUID().slice(0, 8)
    const preferred = `Each party indemnifies the other for negligence ${tag}.`
    const fallback = `Each party indemnifies the other for gross negligence ${tag}.`
    const template = await command('template.create', { name: `Indemnity ${tag}`, type: 'nda', body: 'NDA\n[[clause:indemnity]]', fields: [], clauses: [{ key: 'indemnity', title: `Indemnity ${tag}`, notes: 'Use mutual wording.', variants: [{ id: 'preferred', label: 'Preferred', text: preferred }, { id: 'fallback1', label: 'Fallback one', text: fallback, notes: 'Use when preferred is rejected.' }, { id: 'fallback2', label: 'Fallback two', text: `Indemnity for misconduct ${tag}.` }, { id: 'walk-away', label: 'Walk-away', text: `No indemnity ${tag}.` }] }] })
    await command('template.decide', { versionId: template.versionId, decision: 'approve' })
    const playbook = await command('playbook.draft', { rules: [{ key: 'indemnity', title: 'Mutual indemnity', preferred, alternatives: [fallback], authority: 'counsel' }] })
    await command('playbook.activate', { id: playbook.id })
    const request = await command('request.create', { title: `Clause negotiation ${tag}`, type: 'nda', party: { name: `Counterparty ${tag}`, kind: 'customer' }, templateVersionId: template.versionId, fields: {} })
    await page.goto(`${origin}/app#agreement/${request.id}`)
    await page.getByRole('button', { name: 'Add v2', exact: true }).click()
    const library = page.getByRole('region', { name: 'Approved clause library' })
    await library.getByRole('searchbox', { name: 'Search clauses by topic' }).fill(`indemnity ${tag}`)
    const row = library.locator('li').filter({ hasText: 'Fallback one' })
    await expect(row.getByText('Use when preferred is rejected.', { exact: false })).toBeVisible()
    await expect(row.getByText(/0 accepted/)).toBeVisible()
    if (process.env.LOCKET_SCREENSHOTS) {
      await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-draft-003-insertion.png`), fullPage: true })
    }
    await row.getByRole('button', { name: 'Choose Fallback one' }).click()
    await library.getByLabel('Passage to replace').fill(preferred)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    if (process.env.LOCKET_SCREENSHOTS) await library.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-draft-003-insertion-panel.png`) })
    const response = page.waitForResponse(r => r.url() === `${origin}/api/locket/commands` && r.request().method() === 'POST')
    await library.getByRole('button', { name: 'Insert clause into new version' }).click()
    const inserted = await (await response).json()
    expect(inserted.ok).toBe(true)
    await expect(page.getByText('Library wording in v2', { exact: true })).toBeVisible()
    await expect(page.locator('details').filter({ has: page.getByText('Library wording in v2', { exact: true }) }).getByText(new RegExp(template.versionId))).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    if (process.env.LOCKET_SCREENSHOTS) await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-draft-003-provenance.png`), fullPage: true })
    let s = await state(), a = s.agreements.find((x: any) => x.id === request.id)
    const version = s.versions.find((x: any) => x.id === a.current_version_id)
    expect(JSON.parse(version.fields).clauseLibrary[0].variantId).toBe('fallback1')
    await command('agreement.submit', { agreementId: a.id, version: a.version })
    s = await state(); a = s.agreements.find((x: any) => x.id === request.id)
    await command('approval.decide', { agreementId: a.id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' })
    s = await state(); a = s.agreements.find((x: any) => x.id === request.id)
    const pkg = await command('package.prepare', { agreementId: a.id, version: a.version, provider: 'docusign', recipients: [{ name: 'Alex', email: 'alex@example.test', action: 'sign' }] })
    s = await state(); a = s.agreements.find((x: any) => x.id === request.id)
    await command('package.sent', { agreementId: a.id, version: a.version, packageId: pkg.packageId, envelopeId: `ENV-${tag}` })
    s = await state(); a = s.agreements.find((x: any) => x.id === request.id)
    await command('execution.record', { agreementId: a.id, version: a.version, envelopeId: `ENV-${tag}`, executedOn: '2026-10-19', documentConfirmed: true, signers: [{ name: 'Alex', email: 'alex@example.test' }], signed: { filename: 'signed.pdf', base64: pdf(`Signed ${tag}`).toString('base64') }, certificate: { filename: 'certificate.pdf', base64: pdf(`Certificate ${tag}`).toString('base64') } })
    await page.goto(`${origin}/app#library`)
    await page.reload()
    await page.getByRole('searchbox', { name: 'Search clauses by topic' }).fill(`indemnity ${tag}`)
    const accepted = page.getByRole('region', { name: 'Approved clause library' }).locator('li').filter({ hasText: 'Fallback one' })
    await expect(accepted.getByText(/1 accepted/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    if (process.env.LOCKET_SCREENSHOTS) {
      await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-draft-003-clause-library.png`), fullPage: true })
      const authoring = page.locator('details').filter({ has: page.locator('summary', { hasText: /^New template$/ }) })
      await authoring.locator('summary').click()
      await authoring.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-draft-003-authoring.png`) })
    }
  })
}
