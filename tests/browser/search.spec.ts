import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { searchFixture, searchDefinition } from '../api/search-fixture.mjs'
import { file, docx } from '../api/files.mjs'

test.use({ ignoreHTTPSErrors: true, actionTimeout: 15000 })
for (const width of [1440, 390]) test(`REPO-006 structured current-term search and exact current/older passages at ${width}px`, async ({ page }) => {
  let close = async () => {}, owner: any, origin: string
  const live = !!process.env.LOCKET_SEARCH_LIVE
  if (live) {
    origin = process.env.LOCKET_BASE_URL!
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(process.env.LOCKET_OPEN!)
    await page.waitForURL(url => !url.hash.includes('rer-dev') && ['/app','/setup'].includes(url.pathname))
    if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button',{name:'Finish setup',exact:true}).click(); await page.waitForURL(url=>url.pathname==='/app') }
    owner = {
      command: async (type: string, payload: object) => { const response=await page.request.post(origin+'/api/locket/commands',{headers:{origin},data:{type,payload,commandId:randomUUID()}}); const body=await response.json();expect(body.ok,JSON.stringify(body.error)).toBe(true);return body.result },
      state: async () => (await page.request.get(origin+'/api/locket/state')).json(),
    }
  } else {
    const p=await productPage(page,{width,bindings:{TEST_NOW:String(Date.parse('2026-10-17T12:00:00Z'))}});close=()=>p.close();origin=p.origin;owner=p.owner
  }
  const shot=async(name:string)=>{
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
    if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-REPO-006-${live?'live':'worker'}-${name}.png`),fullPage:true})}
  }
  try {
    const tag=randomUUID().slice(0,6), ids=await searchFixture(owner,tag)
    const old=await owner.command('request.create',{title:`Historical clauses ${tag}`,type:'other',party:{name:`Historical ${tag}`,kind:'supplier'},file:file('earlier.docx',docx([`Historical ${tag}.`,'1. Limitation of liability','The limitation of liability is $90,000.']))})
    let a=(await owner.state()).agreements.find((a:any)=>a.id===old.id)
    await owner.command('version.upload',{agreementId:old.id,version:a.version,kind:'counterparty',file:file('revised.docx',docx([`Historical ${tag}.`,'The updated draft has no cap.']))})
    await page.goto(origin+'/app#agreements')
    await page.getByRole('searchbox',{name:'Search agreements you can access'}).fill('limitation of liability')
    const card=page.locator(`[data-agreement-id="${old.id}"]`)
    await expect(card.getByRole('link',{name:/v1:.*limitation of liability/i}).first()).toBeVisible()
    await shot('board')
    console.log('REPO-006 board captured; opening older passage')
    await card.getByRole('link',{name:/v1:.*limitation of liability/i}).last().click()
    console.log('REPO-006 older passage clicked')
    await expect(page).toHaveURL(/versions\/1\/\d+\/\d+$/)
    await expect(page.locator('mark[data-search-hit]')).toHaveText('limitation of liability')
    await expect(page.locator('mark[data-search-hit]')).toBeInViewport()
    await shot('older-passage')
    await page.goto(origin+'/app#agreements')
    await page.getByRole('button',{name:'New view',exact:true}).click()
    await page.getByRole('searchbox',{name:'View query',exact:true}).fill(searchDefinition.query)
    const filters=[...searchDefinition.filters,{field:'title',operator:'contains',value:`current ${tag}`}]
    for(let i=0;i<filters.length;i++){
      await page.getByRole('button',{name:'Add filter',exact:true}).click()
      await page.getByLabel(`Filter field ${i+1}`,{exact:true}).selectOption(filters[i].field)
      await page.getByLabel(`Filter operator ${i+1}`,{exact:true}).selectOption(filters[i].operator)
      await page.getByLabel(`Filter value ${i+1}`,{exact:true}).fill(filters[i].value)
    }
    await page.getByRole('checkbox',{name:'Column Current term end',exact:true}).check()
    await page.getByRole('checkbox',{name:'Column Confirmed original end date',exact:true}).check()
    await page.getByRole('button',{name:'Apply view',exact:true}).click()
    const results=page.getByLabel('Repository view results',{exact:true})
    await expect(results.getByRole('status')).toHaveText('1 agreement you can access.')
    await expect(results.getByRole('table')).toContainText('2027-02-28')
    await expect(results.getByRole('table')).toContainText('2023-02-28')
    await expect(results.getByRole('table')).toContainText('$250,000.00')
    await shot('structured-results')
    await results.getByRole('link',{name:/v1:.*limitation of liability/i}).last().click()
    await expect(page.locator('mark[data-search-hit]')).toHaveText('limitation of liability')
    await expect(page.locator('mark[data-search-hit]')).toBeInViewport()
    await expect(page).toHaveURL(new RegExp(ids.current+'/versions/1/'))
    await shot('current-passage')
  } catch (error) { console.error(String(error).replace(/https?:\/\/[^\s]+/g, '[URL]')); throw error } finally { await close() }
})
