import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { productPage } from './product-harness.mjs'
import { reportFixture, reportView } from '../api/report-fixture.mjs'

test.use({ignoreHTTPSErrors:true})
for(const width of [1440,390])test(`REPORT-002 builds scoped renewal totals and schedules CSV/PDF at ${width}px`,async({page})=>{
  const reportName=`Renewals by month ${width} ${randomUUID().slice(0,6)}`
  const live=Boolean(process.env.LOCKET_REPORT_LIVE)
  let close=async()=>{}
  let origin:string,owner:any,state:any
  if(live){
    origin=process.env.LOCKET_BASE_URL!
    await page.goto(process.env.LOCKET_OPEN!)
    await page.waitForURL(url=>!url.hash.includes('rer-dev')&&['/app','/setup'].includes(url.pathname))
    await page.setViewportSize({width,height:1000})
    owner={command:async(type:string,payload:any)=>{const response=await page.request.post(origin+'/api/locket/commands',{headers:{origin},data:{type,payload,commandId:randomUUID()}});const body=await response.json();expect(body.ok,JSON.stringify(body.error)).toBe(true);return body.result},state:async()=>await(await page.request.get(origin+'/api/locket/state')).json()}
    // Complete the installation's real first-run door if needed.
    if(new URL(page.url()).pathname==='/setup'){
      await page.getByRole('checkbox').check()
      await page.getByRole('button',{name:'Finish setup',exact:true}).click()
      await page.waitForURL(url=>url.pathname==='/app')
    }
  }else{
    const p=await productPage(page,{width,bindings:{TEST_NOW:String(Date.parse('2026-10-20T12:00:00Z'))}})
    close=()=>p.close();origin=p.origin;owner=p.owner
  }
  try{
    state=await owner.state()
    if(!state.agreements.some((a:any)=>a.title==='Reporting public A'))await reportFixture(owner)
    const view=await owner.command('view.save',{name:`Supplier renewals ${width}`,definition:reportView,sharedRoles:[]})
    await page.goto(origin+'/app#agreements')
    if(live)await page.reload()
    await page.getByRole('navigation',{name:'Locket',exact:true}).getByRole('link',{name:'Agreements',exact:true}).click()
    await page.locator('summary').filter({hasText:/^Custom reports$/}).click()
    const panel=page.getByRole('region',{name:'Custom reports'})
    await expect(panel).toBeVisible()
    await panel.locator('summary').click()
    await panel.getByLabel('Report name',{exact:true}).fill(reportName)
    await panel.getByLabel('Saved view',{exact:true}).selectOption(view.id)
    await panel.getByLabel('Group by',{exact:true}).selectOption('notice_deadline')
    await panel.getByLabel('Frequency',{exact:true}).selectOption('monthly')
    await panel.getByLabel('Attachment',{exact:true}).selectOption('csv')
    await panel.getByLabel('First occurrence (America/New_York)',{exact:true}).fill('2026-12-01T12:00')
    if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await panel.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-REPORT-002-form.png`)})}
    const saved=page.waitForResponse(r=>r.url()===origin+'/api/locket/commands'&&r.request().method()==='POST')
    await panel.getByRole('button',{name:'Schedule report',exact:true}).click()
    expect((await(await saved).json()).ok).toBe(true)
    const card=panel.getByRole('article').filter({has:page.getByRole('heading',{name:reportName,exact:true})})
    await expect(card).toBeVisible()
    await card.getByRole('button',{name:'Open report',exact:true}).click()
    const preview=panel.getByRole('region',{name:'Report preview'})
    await expect(preview.getByRole('table')).toContainText('2026-12')
    await expect(preview.getByRole('table')).toContainText('$9,300.75')
    await expect(preview).toContainText('3 agreements')
    const [download]=await Promise.all([page.waitForEvent('download'),card.getByRole('link',{name:'Download CSV',exact:true}).click()])
    expect(download.suggestedFilename()).toBe('locket-report.csv')
    const [pdf]=await Promise.all([page.waitForEvent('download'),card.getByRole('link',{name:'Download PDF',exact:true}).click()])
    expect(pdf.suggestedFilename()).toBe('locket-report.pdf')
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    const dir=process.env.LOCKET_SCREENSHOTS
    if(dir){await mkdir(dir,{recursive:true});await panel.screenshot({path:join(dir,`${width}-REPORT-002-preview.png`)})}
    await card.getByRole('button',{name:'Stop schedule',exact:true}).click()
    await expect(card).toContainText('Stopped')
    if(dir)await panel.screenshot({path:join(dir,`${width}-REPORT-002-stopped.png`)})
  }finally{await close()}
})
