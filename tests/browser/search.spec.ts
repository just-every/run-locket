import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { searchFixture, searchDefinition } from '../api/search-fixture.mjs'
import { file, docx } from '../api/files.mjs'

test.use({ ignoreHTTPSErrors: true, actionTimeout: 15000 })
test(`REPO-006 structured current-term search and exact current and older passages at 1440px and 390px`, async ({ page }) => {
  test.setTimeout(240_000)
  for (const width of [1440, 390]) {
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
    const department=await owner.command('audience.save',{name:'Legal '+tag,kind:'department',memberIds:[]})
    const current=(await owner.state()).agreements.find((a:any)=>a.id===ids.current)
    await owner.command('agreement.department',{agreementId:current.id,version:current.version,departmentId:department.id})
    const old=await owner.command('request.create',{title:`Historical clauses ${tag}`,type:'other',party:{name:`Historical ${tag}`,kind:'supplier'},file:file('earlier.docx',docx([`Historical ${tag}.`,'1. Limitation of liability','The limitation of liability is $90,000.']))})
    let a=(await owner.state()).agreements.find((a:any)=>a.id===old.id)
    await owner.command('version.upload',{agreementId:old.id,version:a.version,kind:'counterparty',file:file('revised.docx',docx([`Historical ${tag}.`,'The updated draft has no cap.']))})
    await page.goto(origin+'/app#agreements')
    // Fixtures enter through the HTTP API while the live app is already open.
    await page.reload()
    const card=page.locator(`[data-agreement-id="${old.id}"]`)
    await expect(card).toBeVisible()
    const searched = page.waitForResponse(response => new URL(response.url()).pathname === '/api/locket/search')
    await page.getByRole('searchbox',{name:'Search agreements you can access'}).fill('limitation of liability')
    await searched
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
    const filters=[...searchDefinition.filters,{field:'title',operator:'contains',value:`current ${tag}`},{field:'department',operator:'eq',value:'Legal '+tag}]
    for(let i=0;i<filters.length;i++){
      await page.getByRole('button',{name:'Add filter',exact:true}).click()
      await page.getByLabel(`Filter field ${i+1}`,{exact:true}).selectOption(filters[i].field)
      await page.getByLabel(`Filter operator ${i+1}`,{exact:true}).selectOption(filters[i].operator)
      await page.getByLabel(`Filter value ${i+1}`,{exact:true}).fill(filters[i].value)
    }
    await page.getByRole('checkbox',{name:'Column Department',exact:true}).check()
    await page.getByRole('checkbox',{name:'Column Current term end',exact:true}).check()
    await page.getByRole('checkbox',{name:'Column Confirmed original end date',exact:true}).check()
    await page.getByRole('button',{name:'Apply view',exact:true}).click()
    const results=page.getByLabel('Repository view results',{exact:true})
    await expect(results.getByRole('status')).toHaveText('1 agreement you can access.')
    await expect(results.getByRole('table')).toContainText('Legal '+tag)
    await expect(results.getByRole('table')).toContainText('2027-02-28')
    await expect(results.getByRole('table')).toContainText('2023-02-28')
    await expect(results.getByRole('table')).toContainText('$250,000.00')
    await shot('structured-results')
    const agreementsLink=page.getByRole('link',{name:'Agreements',exact:true})
    await agreementsLink.focus()
    await expect(page.getByRole('tooltip')).toHaveText('Open Agreements')
    await agreementsLink.blur()
    await agreementsLink.hover()
    await expect(page.getByRole('tooltip')).toHaveText('Open Agreements')
    await shot('repository-tooltip')
    await page.mouse.move(0,0)
    await results.getByRole('link',{name:/v1:.*limitation of liability/i}).last().click()
    await expect(page.locator('mark[data-search-hit]')).toHaveText('limitation of liability')
    await expect(page.locator('mark[data-search-hit]')).toBeInViewport()
    await expect(page).toHaveURL(new RegExp(ids.current+'/versions/1/'))
    await shot('current-passage')
  } catch (error) { console.error(String(error).replace(/https?:\/\/[^\s]+/g, '[URL]')); throw error } finally { await close() }

  }
})

test('REPO-002 background PDF status and page-14 passage navigation', async ({page})=>{
 page.on('pageerror',error=>console.error('PDF browser error:',error.message))
 test.setTimeout(180_000)
 const {embeddedPdf,nativePdfImport}=await import('../api/pdf-rendition-fixture.mjs')
 const p=await productPage(page,{width:1440})
 const shot=async(name:string)=>{
  if(!process.env.LOCKET_SCREENSHOTS)return
  await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true})
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-REPO-002-${name}.png`),fullPage:true})
  }
  await page.setViewportSize({width:1440,height:1000})
 }
 try{
  const created=await p.owner.command('legacy.import',nativePdfImport(await embeddedPdf('synthetic-locket-browser')))
  await page.goto(p.origin+'/app#agreement/'+created.id+'/versions/1')
  const status=page.getByLabel('PDF text processing')
  await expect(status.getByRole('status')).toContainText('queued for background processing')
  await shot('queued')
  await p.h.scheduled(Date.now())
  await page.reload()
  await expect(status.getByRole('status')).toHaveText('Embedded PDF text ready: 20 pages.')
  await expect(status.getByRole('progressbar')).toHaveAttribute('value','20')
  await shot('ready')
  await page.goto(p.origin+'/app#agreements')
  const searched=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/locket/search')
  await page.getByRole('searchbox',{name:'Search agreements you can access'}).fill('Aurora escrow')
  await searched
  const link=page.locator(`[data-agreement-id="${created.id}"]`).getByRole('link',{name:/v1.*page 14.*Aurora escrow/})
  await expect(link).toBeVisible()
  await link.click()
  await expect(page.locator('mark[data-search-hit]')).toHaveText('Aurora escrow')
  await expect(page.locator('mark[data-search-hit]')).toHaveAttribute('data-pdf-page','14')
  await expect(page.locator('mark[data-search-hit]')).toBeInViewport()
  await expect(page.getByRole('link',{name:'Open original page 14'})).toHaveAttribute('href',/\/api\/locket\/files\/[^#]+#page=14&zoom=150,50,80$/)
  await shot('page-14-passage')
  const transcribed=await p.owner.command('request.create',{title:'synthetic-locket-transcription',type:'other',party:{name:'synthetic-locket-transcription',kind:'supplier'},file:file('transcribed.pdf',await embeddedPdf('synthetic-locket-transcription')),text:'Person supplied review text stays pinned.'})
  await page.goto(p.origin+'/app#agreements')
  await page.reload()
  const oldSearch=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/locket/search')
  await page.getByRole('searchbox',{name:'Search agreements you can access'}).fill('Person supplied review')
  await oldSearch
  const transcriptionLink=page.locator(`[data-agreement-id="${transcribed.id}"]`).getByRole('link',{name:/Person supplied review/})
  const transcriptionHref=await transcriptionLink.getAttribute('href')
  expect(transcriptionHref).toMatch(/versions\/1\/0\/22$/)
  await p.h.scheduled(Date.now())
  await page.goto(p.origin+'/app'+transcriptionHref)
  await page.reload()
  await expect(page.locator('mark[data-search-hit]')).toHaveText('Person supplied review')
  await expect(page.locator('mark[data-search-hit]')).not.toHaveAttribute('data-pdf-page')
  await page.goto(p.origin+'/app#agreement/'+created.id+'/versions/1/0/10/unavailable-rendition')
  await expect(page.locator('.lk-paper-empty')).toContainText('This PDF passage is unavailable')
  await expect(page.locator('mark[data-search-hit]')).toHaveCount(0)
 }finally{await p.close()}
})
