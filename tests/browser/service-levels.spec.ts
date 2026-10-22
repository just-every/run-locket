import { test,expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { serviceLevelBindings,serviceLevelFake,serviceLevelFixture } from '../api/service-level-fixture.mjs'

test.use({ignoreHTTPSErrors:true,locale:'en-US',timezoneId:'UTC'})
for(const width of [1440,390])test(`AGENT-002 authorizes monitoring, confirms signed terms and approves one exact USD 1000 claim for 99.2% versus 99.9% at ${width}px`,async({page})=>{
 const calls:any[]=[],p=await productPage(page,{width,bindings:serviceLevelBindings,outboundResponse:serviceLevelFake(calls,()=> 'exclusions')}),{h,origin}=p
 const outbound=()=>h.mails.filter((m:any)=>m.MessageStream==='outbound')
 const click=async(scope:any,label:string)=>{
  const pending=page.waitForResponse(r=>r.url()===origin+'/api/locket/commands'&&r.request().method()==='POST')
  await scope.getByRole('button',{name:label,exact:true}).click()
  const body=await(await pending).json();expect(body.ok,JSON.stringify(body.error)).toBe(true)
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false')
  return body.result
 }
 const as=async(client:any)=>{
  await page.context().addCookies(client.cookie.split('; ').map((pair:string)=>{const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:origin,secure:true,httpOnly:true,sameSite:'Lax' as const}}))
  await page.reload()
 }
 const shot=async(name:string)=>{
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-agent-002-${name}.png`),fullPage:true})}
 }
 try{
  const f=await serviceLevelFixture(h,{confirm:false,link:false}),source=f.source
  await page.goto(origin+`/app#agreement/${source.id}/terms`)
  const section=page.getByRole('region',{name:'Supplier service levels',exact:true})
  await expect(section).toBeVisible()
  await section.getByText('Authorize Uptime monitoring',{exact:true}).click()
  await section.getByLabel('Uptime installation origin',{exact:true}).fill(f.origin)
  await section.getByLabel('Uptime monitor ID',{exact:true}).fill(f.monitorId)
  await section.getByLabel('I authorize reading this exact installation and monitor for this agreement.',{exact:true}).check()
  await click(section,'Authorize exact Uptime monitor')
  await shot('authorized')
  expect(outbound()).toHaveLength(0)
  await as(f.counsel)
  const formula=await f.confirmPayload()
  await section.getByText('Confirm signed service-level formula',{exact:true}).click()
  await section.getByLabel('Service-level signed source',{exact:true}).selectOption(formula.sourceAgreementId)
  await section.getByLabel('Exact signed service-level clause',{exact:true}).fill(formula.citation.quote)
  if(formula.citation.page)await section.getByLabel('Service-level clause page',{exact:true}).fill(String(formula.citation.page))
  await section.getByLabel('Monthly uptime commitment (%)',{exact:true}).fill(String(formula.targetBps/100))
  await section.getByLabel('Credit tier lower bound (%)',{exact:true}).fill(String(formula.tierFloorBps/100))
  await section.getByLabel('Service credit (%)',{exact:true}).fill(String(formula.creditBps/100))
  await section.getByLabel('Monthly service charge (USD)',{exact:true}).fill(formula.monthlyBasis)
  await section.getByLabel('Service month time zone',{exact:true}).fill(formula.timeZone)
  await section.getByLabel('Claim window after month end (days)',{exact:true}).fill(String(formula.claimDays))
  await section.getByLabel('Counsel service-level interpretation',{exact:true}).fill(formula.interpretation)
  await section.getByLabel('I confirm that excluding unknown, paused and maintenance time matches the signed commitment.',{exact:true}).check()
  await section.getByLabel('I confirm this monthly charge, credit tier, time zone and claim window against the signed clause and amendments.',{exact:true}).check()
  await click(section,'Confirm signed service-level terms')
  await expect(section).toContainText(formula.citation.quote)
  await shot('counsel-confirmed')
  await as(h.owner)
  await section.getByLabel('Service month',{exact:true}).fill('2026-09')
  await click(section,'Read monthly monitoring evidence')
  const claim=page.getByRole('article',{name:'Service credit claim 2026-09',exact:true})
  await expect(claim).toBeVisible()
  await expect(claim).toContainText('99.2%')
  await expect(claim).toContainText('99.9%')
  await expect(claim).toContainText('$1,000.00 USD')
  await expect(claim).toContainText(formula.citation.quote)
  const record=(await p.state()).serviceLevels.claims.find((c:any)=>c.agreement_id===source.id),content=JSON.parse(record.content)
  expect(record.amount_cents).toBe(100000)
  expect(record.deadline_date).toBe('2026-10-30')
  await expect(claim.locator('time')).toHaveAttribute('datetime',new Date(record.deadline_at).toISOString())
  const read=(await p.state()).serviceLevels.reads.find((r:any)=>r.id===record.read_id)
  await expect(claim.getByRole('link',{name:'Download original monitoring response',exact:true})).toHaveAttribute('href',`/api/locket/files/${read.artifact_id}`)
  await claim.getByText('Monitoring response identity',{exact:true}).click()
  await expect(claim).toContainText(read.response_sha256)
  expect(content.metrics.upMs/content.metrics.observedMs).toBeCloseTo(0.992,8)
  expect((await p.state()).serviceLevels.breaches.some((b:any)=>b.claim_id===record.id&&b.status==='breached')).toBe(true)
  for(const [label,key] of [['Unknown, excluded','unknownMs'],['Paused, excluded','pausedMs'],['Maintenance, excluded','maintenanceMs']]){
   expect(content.metrics[key]).toBeGreaterThan(0)
   await expect(claim.locator('dl > div').filter({has:page.getByText(label,{exact:true})})).toContainText(`${content.metrics[key].toLocaleString('en-US')} ms`)
  }
  const bytesBefore=await(await h.owner.request(`/api/locket/files/${read.artifact_id}`)).arrayBuffer()
  expect(calls).toHaveLength(1)
  expect(Buffer.from(bytesBefore).toString('utf8')).toBe(calls[0].responseBody)
  await shot('credit-evidence')
  expect(outbound()).toHaveLength(0)
  // Counsel interprets the contract but cannot approve or send for its owner.
  await as(f.counsel)
  await expect(claim.getByRole('button',{name:'Approve service credit amount and message',exact:true})).toHaveCount(0)
  await expect(claim.getByRole('button',{name:'Send approved service credit claim',exact:true})).toHaveCount(0)
  await as(h.owner)
  await claim.getByText('Edit exact service credit claim',{exact:true}).click()
  await claim.getByLabel('Service credit recipient',{exact:true}).fill('synthetic-locket-supplier@example.test')
  await click(claim,'Save exact service credit message')
  await claim.getByLabel('I approve this exact amount, recipient, subject and message. Sending is a separate action.',{exact:true}).check()
  await click(claim,'Approve service credit amount and message')
  await expect(claim).toContainText('Amount and exact message approved; no email sent.')
  expect(outbound()).toHaveLength(0)
  await shot('owner-approved')
  await claim.getByRole('checkbox',{name:/Send the approved/}).check()
  await click(claim,'Send approved service credit claim')
  await expect(claim).toContainText('Postmark accepted; mailbox delivery and credit recovery unconfirmed.')
  expect(outbound()).toHaveLength(1)
  const saved=(await p.state()).serviceLevels.claims.find((c:any)=>c.id===record.id)
  expect(outbound()[0].TextBody).toBe(saved.message_text)
  expect(outbound()[0].Subject).toBe(saved.subject)
  await page.reload()
  await expect(claim).toContainText('Postmark accepted; mailbox delivery and credit recovery unconfirmed.')
  await expect(claim.getByRole('button',{name:'Send approved service credit claim',exact:true})).toHaveCount(0)
  expect(outbound()).toHaveLength(1)
  expect(Buffer.from(await(await h.owner.request(`/api/locket/files/${read.artifact_id}`)).arrayBuffer())).toEqual(Buffer.from(bytesBefore))
  await shot('provider-accepted')
 }finally{await p.close()}
})
