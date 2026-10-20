import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { agentFixture, localMinute, signedEvent, postEvent, webhookKey } from '../api/notice-fixture.mjs'

test.use({ignoreHTTPSErrors:true,locale:'en-US',timezoneId:'America/New_York'})
for(const width of [1440,390])test(`AGENT-003 cited draft, exact schedule, bounce alert and newly approved courier delivery at ${width}px`,async({page})=>{
 const key=webhookKey(),product=await productPage(page,{width,bindings:{NOTICE_RESEND_WEBHOOK_SECRET:key}}),{h,origin,state}=product
 const shot=async(name:string)=>{
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-agent-003-${name}.png`),fullPage:true})}
 }
 const click=async(scope:any,label:string)=>{
  const response=page.waitForResponse(r=>r.url()===`${origin}/api/locket/commands`&&r.request().method()==='POST')
  await scope.getByRole('button',{name:label,exact:true}).click()
  const body=await(await response).json();expect(body.ok,JSON.stringify(body.error)).toBe(true)
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false')
 }
 try{
  const f=await agentFixture(h,`Managed notice ${width}`),due=Math.ceil((f.now+3600000)/3600000)*3600000
  await page.goto(origin+'/app#renewals')
  await page.getByText('Prepare a notice from the executed passage',{exact:true}).click()
  await page.getByLabel('Exact executed notice passage').fill('Give 60 days notice.')
  await page.getByRole('button',{name:'Prepare cited draft',exact:true}).click()
  const email=page.locator('article.lk-notice').filter({hasText:'To notices@cardinal.example'})
  await expect(email.getByRole('link',{name:'Download PDF letter'})).toBeVisible()
  await expect(email).toContainText('Prepared draft, not legal advice or proof of service.')
  await email.getByLabel(`Send at (${f.timezone})`).fill(localMinute(due,f.timezone))
  await expect(email).toContainText('Lead margin:')
  await shot('draft-review')
  await click(email,'Approve exact PDF and schedule')
  await expect(email).toContainText('Schedule: scheduled')
  await shot('scheduled')
  await h.setTime(due);await h.scheduled(due);await page.reload()
  await expect(email).toContainText('Email accepted by provider')
  const workspace=await state(),dispatch=workspace.noticeDispatches.find((d:any)=>d.notice_id===workspace.notices[0].id)
  expect((await postEvent(h,signedEvent(key,dispatch.provider_message_id,{type:'email.bounced',timestamp:Math.floor(due/1000),createdAt:new Date(due).toISOString()}))).status).toBe(200)
  await page.reload();await expect(email).toContainText('Decision-maker alert:')
  const courier=page.locator('article.lk-notice').filter({hasText:'To Cardinal Legal'})
  await expect(courier).toContainText('another human approval required')
  await shot('bounce-and-proposal')
  await courier.getByLabel(`Send at (${f.timezone})`).fill(localMinute(due+3600000,f.timezone))
  await click(courier,'Approve exact PDF and schedule')
  await h.setTime(due+3600000);await h.scheduled(due+3600000);await page.reload()
  await courier.getByLabel('Sent at',{exact:true}).fill(localMinute(due+3600000,f.timezone))
  await courier.getByLabel('Certified mail or courier tracking number').fill('UPS-LKT-45-DAYS')
  await click(courier,'Record that it was sent')
  await expect(courier).toContainText('Schedule: recorded')
  await expect(courier).toContainText('Sent, delivery unconfirmed')
  await shot('courier-unconfirmed')
  await h.setTime(due+7200000)
  await courier.getByLabel('Delivered at',{exact:true}).fill(localMinute(due+7200000,f.timezone))
  await courier.getByLabel('Delivery evidence note').fill('Carrier receipt signed by Cardinal reception.')
  await click(courier,'Record delivered evidence')
  await expect(courier).toContainText('Manually recorded delivered')
  await expect(courier).toContainText('counsel makes that decision')
  await shot('courier-delivered')
 }finally{await product.close()}
})
