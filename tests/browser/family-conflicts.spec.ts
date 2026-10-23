import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { familyConflictFixture } from '../api/family-conflict-fixture.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })

async function connection(page: any, width: number) {
  if (!process.env.LOCKET_FAMILY_LIVE) return productPage(page, { width })
  const origin = process.env.LOCKET_BASE_URL, entry = process.env.LOCKET_OPEN
  if (!origin || !entry) throw Error('Live family journey requires the private owner entry and installation origin.')
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

test(`AGENT-005 family notice differences retain three citations and alternative deadlines at 1440px and 390px`, async ({ page }) => {
  test.setTimeout(240_000)
  for (const width of [1440, 390]) {
  const p = await connection(page, width)
  try {
    if ('h' in p) await p.h.setTime(Date.parse('2026-10-17T16:00:00Z'))
    const f = await familyConflictFixture(p)
    await page.goto(`${p.origin}/app#agreement/${f.master.id}/family`)
    await page.reload()
    const panel = page.getByRole('region', { name: 'Confirmed-term differences', exact: true })
    await expect(panel).toContainText('Counsel must review their scope and precedence.')
    for (const a of [f.master, f.amendment, f.order]) {
      await expect(panel.getByRole('link', { name: new RegExp(a === f.master ? 'Northwind MSA' : a === f.amendment ? 'Northwind notice amendment' : 'Northwind hosting order') })).toBeVisible()
      await expect(panel).toContainText(a.quote)
    }
    await expect(panel).toContainText('60 days')
    await expect(panel).toContainText('90 days')
    await expect(panel).toContainText('30 days')
    await expect(panel.locator('time')).toHaveCount(3)
    await expect(panel.locator('time').filter({ hasText: 'Nov 30, 2026' })).toBeVisible()
    await expect(panel.locator('time').filter({ hasText: 'Dec 30, 2026' })).toBeVisible()
    await expect(panel.locator('time').filter({ hasText: 'Jan 29, 2027' })).toBeVisible()
    await expect(panel).toContainText('This is an alternative for review, not a scheduled deadline.')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    if (process.env.LOCKET_SCREENSHOTS) {
      await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-agent-005-family-differences.png`), fullPage: true })
    }
    await panel.getByRole('link', { name: /Northwind notice amendment/ }).click()
    await expect(page.getByRole('heading', { name: 'Terms', exact: true })).toBeVisible()
    await expect(page.locator('main')).toContainText(f.amendment.quote)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  } finally { await p.close() }

  }
})

test(`AGENT-005 keeps local family review blocked until a live provider evaluation at 1440px and 390px`,async({page})=>{
  test.setTimeout(240_000)
  for (const width of [1440, 390]) {
 const {familyModelBindings,familyModelFake,familyAnalysisFixture}=await import('../api/family-analysis-fixture.mjs')
 const calls:any[]=[],p=await productPage(page,{width,bindings:familyModelBindings,outboundResponse:familyModelFake(calls)})
 try{
  await p.h.setTime(Date.parse('2026-10-17T16:00:00Z'))
  const f=await familyAnalysisFixture(p)
  await page.goto(`${p.origin}/app#agreement/${f.master.id}/family`)
  const panel=page.getByRole('region',{name:'Governing family analysis',exact:true})
  await expect(panel).toContainText('REVIEW-006 live evaluation')
  await panel.getByRole('button',{name:'Prepare executed-family analysis',exact:true}).click()
  await expect(panel).toContainText('Derived actions blocked.')
  await expect(panel).toContainText('Live family evaluation required.')
  await expect(panel.getByRole('button',{name:'Analyze approved snapshot',exact:true})).toHaveCount(0)
  await panel.getByText('Exact source snapshot',{exact:true}).click()
  for(const source of [f.master,f.amendment,f.order])await expect(panel).toContainText(source.quote)
  await expect(page.locator('main')).toContainText('Nov 30, 2026')
  await expect(page.locator('main')).toContainText('Dec 30, 2026')
  await expect(page.locator('main')).toContainText('Jan 29, 2027')
  expect(calls).toHaveLength(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-agent-005-evaluation-required.png`),fullPage:true})}
 }finally{await p.close()}

  }
})
