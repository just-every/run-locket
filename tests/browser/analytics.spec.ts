import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { request, submit, approve, dispatch, finish, timedRequests } from '../api/analytics-fixture.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })

async function connect(page: any, width: number) {
  if (!process.env.LOCKET_ANALYTICS_LIVE) return productPage(page, { width })
  const origin = process.env.LOCKET_BASE_URL!, entry = process.env.LOCKET_OPEN!
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
    request: async (path: string) => { const r = await page.request.get(origin + path); return new Response(await r.body(), { status: r.status(), headers: r.headers() }) },
    command: async (type: string, payload: object) => {
      const response = await page.request.post(origin + '/api/locket/commands', { headers: { origin }, data: { commandId: randomUUID(), type, payload } })
      const body = await response.json(); expect(body.ok, JSON.stringify(body.error)).toBe(true); return body.result
    },
    close: async () => {},
  }
}

for (const width of [1440, 390]) test(`REPORT-001 measured workflow, entity/period filters and waiting-work links at ${width}px`, async ({ page }) => {
  const p = await connect(page, width)
  try {
    const suffix = `${width}-${Date.now()}`
    // Live runs share an installation; name each new entity explicitly.
    const existingEntity = (await p.state()).entities[0]?.id
    if ('h' in p) await timedRequests(p.h, 2)
    else for (let i = 1; i <= 2; i++) {
      const a = await request(p, `Completed NDA ${suffix}-${i}`, existingEntity ? { entityId: existingEntity } : {})
      await submit(p, a.id); await approve(p, a.id)
      // Existing live entities need their recorded signatory in the packet.
      const pkg = await dispatch(p, a.id); await finish(p, a.id, pkg)
    }
    const sent = await request(p, `Hosting NDA ${suffix}`, existingEntity ? { entityId: existingEntity } : {})
    await submit(p, sent.id); await approve(p, sent.id); await dispatch(p, sent.id)
    const entity = await p.command('entity.save', { legalName: `Northwind Holdings ${suffix}`, entityType: 'Corporation', formation: 'Delaware, United States', taxIdKind: 'ein', taxId: '12-3456789', registeredAddress: '251 Little Falls Drive, Wilmington, DE 19808', noticeAddress: 'Legal, 100 Pine Street, New York, NY 10005', currency: 'USD', timezone: 'America/New_York', signatories: [{ name: 'Alex Morgan', email: 'alex@example.test', title: 'Director' }] })
    const pending = await request(p, `Insurance NDA ${suffix}`, { entityId: entity.id })
    await submit(p, pending.id)
    const state = await p.state(), a = state.agreements.find((x: any) => x.id === pending.id)
    await p.command('approval.email', { agreementId: a.id, version: a.version, versionId: a.current_version_id, recipientId: state.actor.id })
    await page.goto(p.origin + '/app#portfolio'); await page.reload()
    const panel = page.getByRole('region', { name: 'Workflow performance', exact: true })
    await expect(panel.getByRole('heading', { name: 'Time in each workflow stage' })).toBeVisible()
    const analysis = await (await ('h' in p ? p.owner.request('/api/locket/analytics') : p.request('/api/locket/analytics'))).json()
    const draft = analysis.stages.find((s: any) => s.stage === 'draft')
    await expect(panel.getByRole('article', { name: 'Draft timing', exact: true })).toContainText(`${draft.count} completed visits`)
    await expect(panel.getByRole('article', { name: 'Draft timing', exact: true })).toContainText(`${(draft.medianMs / 3_600_000).toLocaleString('en-US', { maximumFractionDigits: 2 })} hours`)
    await expect(panel.getByRole('link', { name: `Insurance NDA ${suffix}`, exact: true }).last()).toBeVisible()
    await expect(panel.getByRole('link', { name: `Hosting NDA ${suffix}`, exact: true }).last()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    const shot = async (name: string) => {
      if (!process.env.LOCKET_SCREENSHOTS) return
      await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
      await panel.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-report-001-${name}.png`) })
    }
    await shot('workflow')
    await panel.getByLabel('Performance entity').selectOption(entity.id)
    await panel.getByRole('button', { name: 'Apply performance filters' }).click()
    await expect(panel).toContainText('1 opened · 0 completed')
    await expect(panel.getByRole('link', { name: `Hosting NDA ${suffix}`, exact: true })).toHaveCount(0)
    await shot('entity')
    await panel.getByLabel('Performance from').fill('2099-01-01')
    await panel.getByRole('button', { name: 'Apply performance filters' }).click()
    await expect(panel).toContainText('No request activity in this period.')
    await expect(panel).toContainText('No pending approval requests in this period.')
    await shot('empty')
    await panel.getByLabel('Performance through').fill('2098-01-01')
    await panel.getByRole('button', { name: 'Apply performance filters' }).click()
    await expect(panel.getByRole('alert')).toBeVisible()
    await shot('invalid-period')
    await panel.getByLabel('Performance from').fill(''); await panel.getByLabel('Performance through').fill('')
    await panel.getByRole('button', { name: 'Apply performance filters' }).click()
    await panel.getByRole('link', { name: `Insurance NDA ${suffix}`, exact: true }).last().click()
    await expect(page.getByRole('heading', { name: 'Review & approvals', exact: true })).toBeVisible()
  } finally { await p.close() }
})
