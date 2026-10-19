import { test, expect } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pdf } from '../api/files.mjs'

const origin = process.env.LOCKET_BASE_URL || 'http://127.0.0.1:8787'
for (const width of [1440, 390]) {
  test(`AUDIT-001 filters and matching CSV after approval, restricted view and download at ${width}px`, async ({ page }) => {
    const entry = process.env.LOCKET_OPEN
    if (!entry) throw new Error('This journey requires the private local owner entry.')
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(entry)
    await page.waitForURL(url => !url.hash.includes('rer-dev') && ['/app', '/setup'].includes(url.pathname))
    if (new URL(page.url()).pathname === '/setup') {
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
      await page.waitForURL(url => url.pathname === '/app')
    }
    const command = async (type: string, payload: object) => {
      const res = await page.request.post(origin + '/api/locket/commands', { headers: { origin }, data: { commandId: crypto.randomUUID(), type, payload } })
      const body = await res.json()
      expect(body.ok, JSON.stringify(body.error)).toBe(true)
      return body.result
    }
    const created = await command('request.create', {
      title: `Cascade acquisition NDA ${width}`, type: 'nda', value: '25000', restricted: true,
      party: { name: `Cascade Holdings ${width} Inc.`, kind: 'other' },
      file: { filename: 'cascade-nda.pdf', mediaType: 'application/pdf', base64: pdf('Confidential acquisition agreement.').toString('base64') },
      text: 'Confidential acquisition agreement.',
    })
    let state = await (await page.request.get(origin + '/api/locket/state')).json()
    let agreement = state.agreements.find((a: any) => a.id === created.id)
    await command('agreement.submit', { agreementId: created.id, version: agreement.version })
    state = await (await page.request.get(origin + '/api/locket/state')).json()
    agreement = state.agreements.find((a: any) => a.id === created.id)
    await command('approval.decide', { agreementId: created.id, version: agreement.version, versionId: agreement.current_version_id, kind: 'commercial', decision: 'approved' })
    await page.goto(origin + '/app#agreement/' + created.id)
    await expect(page.getByRole('heading', { name: 'cascade-nda.pdf', exact: true })).toBeVisible()
    const artifact = state.artifacts.find((f: any) => f.agreement_id === created.id && f.role === 'original')
    expect((await page.request.get(origin + '/api/locket/files/' + artifact.id)).status()).toBe(200)
    await page.goto(origin + '/app#activity')
    const log = page.locator('.lk-activity-log')
    await expect(log).toHaveAttribute('aria-busy', 'false')
    await log.getByLabel('Person', { exact: true }).selectOption(state.actor.id)
    await log.getByLabel('Agreement', { exact: true }).selectOption(created.id)
    const rows = (await (await page.request.get(origin + '/api/locket/audit?' + new URLSearchParams({ agreement: created.id }))).json()).rows
    const approval = rows.find((r: any) => r.action === 'approval.approved')
    expect(approval).toBeTruthy()
    const day = new Date(approval.at).toISOString().slice(0, 10)
    await log.getByLabel('From (UTC)').fill(day)
    await log.getByLabel('To (UTC)').fill(day)
    await log.getByRole('button', { name: 'Apply filters' }).click()
    await expect(log).toHaveAttribute('aria-busy', 'false')
    const visibleIds = await log.locator('[data-audit-id]').evaluateAll(elements => elements.map(e => e.getAttribute('data-audit-id')).sort())
    expect(visibleIds.length).toBeGreaterThan(0)
    const expected = rows.filter((r: any) => r.actor_id === state.actor.id && new Date(r.at).toISOString().slice(0, 10) === day)
    expect(visibleIds).toEqual(expected.map((r: any) => r.id).sort())
    expect(expected.some((r: any) => r.action === 'file.download')).toBe(true)
    expect(expected.some((r: any) => r.action === 'agreement.view')).toBe(true)
    const downloadPromise = page.waitForEvent('download')
    await log.getByRole('link', { name: 'Export audit CSV' }).click()
    const download = await downloadPromise
    const csv = await readFile((await download.path())!, 'utf8')
    expect(csv.trim().split('\r\n').slice(1).map(line => line.split(',')[0].replaceAll('"', '')).sort()).toEqual(visibleIds)
    expect((await (await page.request.get(origin + '/api/locket/audit?action=audit.export')).json()).rows.some((r: any) => r.actor_id === state.actor.id)).toBe(true)
    await log.getByLabel('Action', { exact: true }).selectOption('approval.approved')
    await log.getByRole('button', { name: 'Apply filters' }).click()
    await expect(log).toHaveAttribute('aria-busy', 'false')
    await expect(log.locator('[data-audit-id]')).toHaveCount(1)
    await expect(log.locator('[data-audit-id]')).toHaveAttribute('data-audit-id', approval.id)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    if (process.env.LOCKET_SCREENSHOTS) {
      await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-audit-filtered.png`), fullPage: true })
    }
    await log.getByLabel('Search activity', { exact: true }).fill('not-a-matching-action')
    await log.getByRole('button', { name: 'Apply filters' }).click()
    await expect(log).toHaveAttribute('aria-busy', 'false')
    await expect(log.locator('[data-audit-id]')).toHaveCount(0)
    await expect(log.getByText('No activity matches these filters.')).toBeVisible()
    if (process.env.LOCKET_SCREENSHOTS) await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-audit-empty.png`), fullPage: true })
  })
}
