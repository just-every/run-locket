import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { file,pdf } from '../api/files.mjs'
import { localMinute } from '../api/notice-fixture.mjs'

test.use({locale:'en-US',timezoneId:'America/New_York'})
test(`AGENT-003 real rer dev selected-source preparation and frozen schedule approval at 1440px and 390px`,async({page})=>{
  test.setTimeout(240_000)
  for (const width of [1440, 390]) {
 test.skip(!process.env.LOCKET_NOTICE_LIVE,'Run through notice-agent-live.mjs for the real rer dev session.')
 const origin=process.env.LOCKET_BASE_URL!
 await page.setViewportSize({width,height:1000})
 await page.goto(process.env.LOCKET_OPEN!)
 await page.waitForURL(url=>!url.hash.includes('rer-dev')&&['/app','/setup'].includes(url.pathname))
 if(new URL(page.url()).pathname==='/setup'){await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Finish setup',exact:true}).click();await page.waitForURL(url=>url.pathname==='/app')}
 const command=async(type:string,payload:object)=>{
  const res=await page.request.post(origin+'/api/locket/commands',{headers:{origin},data:{type,payload,commandId:randomUUID()}})
  const body=await res.json();expect(body.ok,JSON.stringify(body.error)).toBe(true);return body.result
 }
 const state=async()=> (await page.request.get(origin+'/api/locket/state')).json()
 const tag=randomUUID().slice(0,6),quote='Give 60 days notice by email or courier to the recorded notice address.'
 const a=await command('legacy.import',{title:`Cardinal facilities agreement ${width} ${tag}`,type:'supplier',party:{name:`Cardinal Facilities ${tag}`,kind:'supplier',email:'notices@cardinal.example',noticeAddress:'Cardinal Legal, 10 Main St, Raleigh NC',noticeMethod:'email'},sourceSystem:'Executed supplier archive',sourceId:tag,file:file('executed-facilities.pdf',pdf(`Facilities agreement ${tag}. ${quote}`)),text:`Facilities agreement ${tag}. ${quote}`,signed:true})
 for(const [key,value]of [['end_date','2027-12-31'],['notice_days','60']]){const t=await command('term.propose',{agreementId:a.id,key,value,citation:{quote}});await command('term.decide',{agreementId:a.id,termId:t.id,decision:'confirm'})}
 const r=(await state()).renewals.find((r:any)=>r.agreement_id===a.id)
 await command('renewal.decide',{renewalId:r.id,decision:'terminate',reason:'Facilities supplier replacement approved.'})
 await page.goto(origin+'/app#renewals')
 await page.getByRole('button',{name:`Cardinal facilities agreement ${width} ${tag}`,exact:true}).click()
 await page.getByText('Prepare a notice from the executed passage',{exact:true}).click()
 await page.getByLabel('Exact executed notice passage').fill(quote)
 await page.getByRole('button',{name:'Prepare cited draft',exact:true}).click()
 const notice=page.locator('article.lk-notice').filter({hasText:'To notices@cardinal.example'}).last()
 await expect(notice.getByRole('link',{name:'Download PDF letter'})).toBeVisible()
 await notice.getByLabel(`Send at (${r.timezone})`).fill(localMinute(Date.now()+86400000,r.timezone))
 await expect(notice).toContainText('Lead margin:')
 const shot=async(name:string)=>{
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-agent-003-live-${name}.png`),fullPage:true})}
 }
 await shot('review')
 const response=page.waitForResponse(r=>r.url()===origin+'/api/locket/commands'&&r.request().postDataJSON().type==='notice.schedule')
 await notice.getByRole('button',{name:'Approve exact PDF and schedule',exact:true}).click()
 expect((await(await response).json()).ok).toBe(true)
 await expect(notice).toContainText('Schedule: scheduled')
 await page.reload()
 await page.getByRole('button',{name:`Cardinal facilities agreement ${width} ${tag}`,exact:true}).click()
 await expect(notice).toContainText('Schedule: scheduled')
 const saved=await state(),savedNotice=saved.notices.find((n:any)=>n.agreement_id===a.id)
 expect(saved.noticePlans.find((p:any)=>p.id===savedNotice.id).status).toBe('scheduled')
 await expect(notice).toContainText('Approved, not sent')
 await expect(notice).toContainText('counsel makes that decision')
 await shot('scheduled')

  }
})
