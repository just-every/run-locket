import { test,expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { reconciliationBindings,reconciliationFake,reconciliationFixture,isCreditMail } from '../api/reconciliation-fixture.mjs'

test.use({ignoreHTTPSErrors:true,locale:'en-US',timezoneId:'America/New_York'})
for(const width of [1440,390])test(`AGENT-001 reviews 3% versus 7%, confirms finance and approves one exact $4,000 credit request at ${width}px`,async({page})=>{
 const product=await productPage(page,{width,bindings:reconciliationBindings,outboundResponse:reconciliationFake([])}),{h,origin}=product
 const click=async(scope:any,label:string)=>{
  const pending=page.waitForResponse(r=>r.url()===origin+'/api/locket/commands'&&r.request().method()==='POST')
  await scope.getByRole('button',{name:label,exact:true}).click()
  const body=await(await pending).json();expect(body.ok,JSON.stringify(body.error)).toBe(true)
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false')
 }
 const shot=async(name:string)=>{
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-agent-001-${name}.png`),fullPage:true})}
 }
 const as=async(client:any)=>{
  await page.context().addCookies(client.cookie.split('; ').map((pair:string)=>{const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:origin,secure:true,httpOnly:true,sameSite:'Lax' as const}}))
  await page.reload()
 }
 try{
  const f=await reconciliationFixture(h)
  await page.goto(origin+`/app#agreement/${f.source.id}/terms`)
  const section=page.getByRole('region',{name:'Invoice reconciliation',exact:true})
  await expect(section).toContainText(f.quote)
  await expect(section).toContainText('Purse purchase orders are unavailable')
  await section.getByLabel('Bill period start',{exact:true}).fill('2025-01-01')
  await section.getByLabel('Bill period end',{exact:true}).fill('2026-10-17')
  await click(section,'Read current vendor bills')
  await section.getByLabel('Comparable baseline bill',{exact:true}).selectOption('synthetic-locket-3')
  await section.getByLabel('Bill to check',{exact:true}).selectOption('synthetic-locket-4')
  await click(section,'Prepare above-cap finding')
  const finding=page.getByRole('article',{name:'Invoice finding synthetic-locket-4',exact:true})
  await expect(finding).toContainText('$4,000.00 USD')
  await expect(finding).toContainText('Observed increase 7%')
  await expect(finding).toContainText('signed cap 3%')
  await expect(finding).toContainText(f.quote)
  await shot('finding')
  await finding.getByText('Edit exact supplier credit request',{exact:true}).click()
  await finding.getByLabel('Credit request recipient',{exact:true}).fill('synthetic-locket-supplier@example.test')
  await click(finding,'Save exact credit request')
  expect(h.mails.filter(isCreditMail).length).toBe(0)
  await as(f.finance)
  await finding.getByLabel('Finance accounting explanation',{exact:true}).fill('I checked the two full annual service periods, unchanged quantities, full contract allocation, taxes and credits; the USD 4,000 difference remains due for review.')
  await finding.getByLabel('Both bills are allocated completely to this contract and cover comparable annual services and quantities.',{exact:true}).check()
  await finding.getByLabel('I checked taxes, credits and all adjustments; the stated USD amount at stake remains correct.',{exact:true}).check()
  await click(finding,'Confirm invoice accounting')
  await shot('finance-confirmed')
  await as(h.owner)
  await finding.getByLabel('I approve this exact recipient, subject and message. Sending is a separate action.',{exact:true}).check()
  await click(finding,'Approve exact credit request')
  await expect(finding).toContainText('Approved; no email sent.')
  expect(h.mails.filter(isCreditMail).length).toBe(0)
  await shot('approved')
  await finding.getByLabel('Send the exact approved credit request to synthetic-locket-supplier@example.test through the installation mail provider.',{exact:true}).check()
  await click(finding,'Send approved credit request')
  await expect(finding).toContainText('Mail provider accepted; mailbox delivery and credit recovery unconfirmed.')
  const outbound=h.mails.filter(isCreditMail)
  expect(outbound.length).toBe(1)
  const record=(await product.state()).reconciliationFindings[0]
  expect(outbound[0].text).toBe(record.message_text)
  await page.reload()
  await expect(finding).toBeVisible()
  await expect(finding).toContainText('Mail provider accepted; mailbox delivery and credit recovery unconfirmed.')
  await expect(finding.getByRole('button',{name:'Send approved credit request',exact:true})).toHaveCount(0)
  expect(h.mails.filter(isCreditMail).length).toBe(1)
  await shot('accepted')
 }finally{await product.close()}
})
