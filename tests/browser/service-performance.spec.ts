import { test,expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { isCreditMail } from '../api/reconciliation-fixture.mjs'
import { servicePerformanceFixture,servicePerformanceBindings } from '../api/service-performance-fixture.mjs'
import { linenMcpFixture } from '../api/service-ticket-fixture.mjs'

test.use({ignoreHTTPSErrors:true,locale:'en-US',timezoneId:'UTC'})
for(const width of [1440,390])test(`Supplier response, resolution and delivery reports preserve unknowns and require exact owner approval before one credit send at ${width}px`,async({page})=>{
 const linen=linenMcpFixture()
 const p=await productPage(page,{width,bindings:{...servicePerformanceBindings,LINEN_ORIGIN:'https://synthetic-locket-linen.example.test',LINEN_MCP_TOKEN:'synthetic-locket-1'},outboundResponse:linen.handle}),{h,origin}=p
 const outbound=()=>h.mails.filter(isCreditMail)
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
 const shot=async(metric:string,name:string)=>{
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-agent-002-${metric}-${name}.png`),fullPage:true})}
 }
 try{
  const f=await servicePerformanceFixture(h,{metric:'response',confirm:false})
  const section=page.getByRole('region',{name:'Supplier response and delivery performance',exact:true})
  await page.goto(origin+`/app#agreement/${f.source.id}/terms`)
  await expect(section).toBeVisible()
  await expect(section.getByRole('button',{name:'Compare authorized performance report',exact:true})).toHaveCount(0)
  for(const metric of ['response','resolution','delivery']){
   await as(f.counsel)
   const formula={...await f.confirmPayload(),metric,thresholdMinutes:metric==='delivery'?0:60,tiers:[{minimumLateMinutes:0,creditBps:1000},{minimumLateMinutes:60,creditBps:2000}],eligibleFee:'10000',cap:'1500'}
   const disclosure=section.getByText('Confirm signed performance formula',{exact:true})
   if(!await section.getByLabel('Exact signed performance clause',{exact:true}).isVisible())await disclosure.click()
   await section.getByLabel('Performance signed source',{exact:true}).selectOption(formula.sourceAgreementId)
   await section.getByLabel('Exact signed performance clause',{exact:true}).fill(formula.citation.quote)
   if(formula.citation.page)await section.getByLabel('Performance clause page',{exact:true}).fill(String(formula.citation.page))
   await section.getByLabel('Performance metric',{exact:true}).selectOption(metric)
   if(metric!=='delivery')await section.getByLabel('Performance threshold (minutes)',{exact:true}).fill('60')
   await section.getByLabel('Tier 1 minimum lateness (minutes)',{exact:true}).fill('0')
   await section.getByLabel('Tier 1 service credit (%)',{exact:true}).fill('10')
   if(!await section.getByLabel('Tier 2 minimum lateness (minutes)',{exact:true}).count())await section.getByRole('button',{name:'Add performance credit tier',exact:true}).click()
   await section.getByLabel('Tier 2 minimum lateness (minutes)',{exact:true}).fill('60')
   await section.getByLabel('Tier 2 service credit (%)',{exact:true}).fill('20')
   await section.getByLabel('Eligible monthly service fee (USD)',{exact:true}).fill('10000')
   await section.getByLabel('Eligible fee allocation',{exact:true}).fill(formula.allocation)
   await section.getByLabel('Monthly performance credit cap (USD)',{exact:true}).fill('1500')
   await section.getByLabel('Performance service month time zone',{exact:true}).fill(formula.timeZone)
   await section.getByLabel('Performance claim window after month end (days)',{exact:true}).fill(String(formula.claimDays))
   await section.getByLabel('Counsel performance interpretation',{exact:true}).fill(formula.interpretation)
   await section.getByRole('checkbox',{name:/I confirm the exact signed source/}).check()
   const confirmed=await click(section,'Confirm signed performance terms')
   await expect(section.getByRole('article',{name:'Confirmed performance terms',exact:true})).toContainText(formula.citation.quote)
   await shot(metric,'counsel-confirmed')
   await as(h.owner)
   await section.getByText('Upload authorized supplier performance report',{exact:true}).click()
   await section.getByLabel('Performance service month',{exact:true}).fill('2026-09')
   await section.getByLabel('Performance source name',{exact:true}).fill('Synthetic supplier performance export')
   await section.getByLabel('Performance source reference',{exact:true}).fill(`synthetic-locket-${metric}-september`)
   await section.getByLabel('Performance report coverage',{exact:true}).fill('September UTC records for the eligible contracted service. The third record has no completion evidence and stays unknown.')
   const csv='record_id,created_at,first_public_response_at,resolved_at,due_at,delivered_at\n'+
    'synthetic-locket-late,2026-09-01T00:00:00Z,2026-09-01T03:00:00Z,2026-09-01T03:00:00Z,2026-09-01T01:00:00Z,2026-09-01T03:00:00Z\n'+
    'synthetic-locket-met,2026-09-02T00:00:00Z,2026-09-02T00:10:00Z,2026-09-02T00:10:00Z,2026-09-02T01:00:00Z,2026-09-02T00:10:00Z\n'+
    'synthetic-locket-unknown,2026-09-03T00:00:00Z,,,2026-09-03T01:00:00Z,\n'
   await section.getByLabel('Supplier performance CSV',{exact:true}).setInputFiles({name:`synthetic-locket-${metric}.csv`,mimeType:'text/csv',buffer:Buffer.from(csv)})
   await section.getByRole('checkbox',{name:'I authorize using this exact supplier report and source for this agreement and service month.',exact:true}).check()
   const result=await click(section,'Compare authorized performance report')
   expect(result.status).toBe('breached')
   const claim=page.getByRole('article',{name:`Performance credit claim ${metric} 2026-09`,exact:true})
   await expect(claim).toBeVisible()
   await expect(claim).toContainText('$1,500.00 USD')
   await expect(claim).toContainText('1 proven late · 1 met the measured threshold · 1 unknown')
   await expect(claim).toContainText('Credit recovery unconfirmed')
   await expect(claim).toContainText(formula.citation.quote)
   await claim.getByText('Compare reported records',{exact:true}).click()
   await expect(claim.getByRole('article',{name:'Performance record synthetic-locket-unknown',exact:true})).toContainText('Unknown')
   await expect(claim).toContainText('A reported closure does not prove contractual fulfillment.')
   const state=await p.state(),record=state.serviceLevels.performanceClaims.find((c:any)=>c.id===result.claimId),report=state.serviceLevels.performanceReports.find((r:any)=>r.id===record.read_id)
   expect(report.term_id).toBe(confirmed.id)
   expect(record.amount_cents).toBe(150000)
   const original=Buffer.from(await(await h.owner.request(`/api/locket/files/${report.artifact_id}`)).arrayBuffer())
   expect(original.toString('utf8')).toBe(csv)
   await claim.getByText('Supplier report identity',{exact:true}).click()
   await expect(claim).toContainText(report.response_sha256)
   await expect(claim.locator('time')).toHaveAttribute('datetime',new Date(record.deadline_at).toISOString())
   await shot(metric,'breach-and-unknown-evidence')
   await as(f.counsel)
   await expect(claim.getByRole('button',{name:'Approve performance credit amount and message',exact:true})).toHaveCount(0)
   await expect(claim.getByRole('button',{name:'Send approved performance credit claim',exact:true})).toHaveCount(0)
   await as(h.owner)
   const beforeSend=outbound().length
   await claim.getByText('Edit exact performance credit claim',{exact:true}).click()
   await claim.getByLabel('Performance credit recipient',{exact:true}).fill('synthetic-locket-supplier@example.test')
   await click(claim,'Save exact performance credit message')
   await claim.getByRole('checkbox',{name:'I approve this exact performance credit amount, recipient, subject and message. Sending is a separate action.',exact:true}).check()
   await click(claim,'Approve performance credit amount and message')
   await expect(claim).toContainText('Performance credit amount and exact message approved; no email sent.')
   expect(outbound()).toHaveLength(beforeSend)
   await shot(metric,'owner-approved')
   await claim.getByRole('checkbox',{name:/Send the approved/}).check()
   await click(claim,'Send approved performance credit claim')
   await expect(claim).toContainText('Mail provider accepted; mailbox delivery and credit recovery unconfirmed.')
   expect(outbound()).toHaveLength(beforeSend+1)
   await page.reload()
   await expect(claim.getByRole('button',{name:'Send approved performance credit claim',exact:true})).toHaveCount(0)
   expect(Buffer.from(await(await h.owner.request(`/api/locket/files/${report.artifact_id}`)).arrayBuffer())).toEqual(original)
   await shot(metric,'provider-accepted')
  }
  // The live read uses Linen's published MCP network edge. Calendar response
  // timestamps can meet the metric; ticket closure stays unknown resolution.
  for(const metric of ['response','resolution']){
   const terms=(await p.state()).serviceLevels.performanceTerms
   await section.getByLabel('Confirmed performance formula',{exact:true}).selectOption(terms.find((term:any)=>term.metric===metric).id)
   await section.getByText('Read authorized Linen ticket evidence',{exact:true}).click()
   await section.getByLabel('Linen service month',{exact:true}).fill('2026-09')
   await section.getByLabel('Authorized Linen queue IDs',{exact:true}).fill('synthetic-locket-4')
   await section.getByLabel('Authorized Linen ticket IDs',{exact:true}).fill('synthetic-locket-2')
   await section.getByLabel('Linen evidence coverage',{exact:true}).fill('One explicitly selected September ticket from the authorized supplier queue. This selection does not prove completeness or fulfillment.')
   await section.getByRole('checkbox',{name:'I authorize reading these exact Linen queues and tickets for this agreement and service month, and retaining the original evidence.',exact:true}).check()
   const count=(await p.state()).serviceLevels.performanceClaims.length
   const result=await click(section,'Compare authorized Linen tickets')
   expect(result.status).toBe(metric==='response'?'met':'unavailable')
   expect((await p.state()).serviceLevels.performanceClaims).toHaveLength(count)
   const report=(await p.state()).serviceLevels.performanceReports.find((r:any)=>r.id===result.id)
   expect(report.source_kind).toBe('linen')
   const comparison=JSON.parse(report.metrics)
   expect(metric==='response'?comparison.metCount:comparison.unknownCount).toBe(1)
   const evidence=section.getByRole('article',{name:'Supplier performance evidence 2026-09',exact:true}).filter({has:page.locator(`a[href="/api/locket/files/${report.artifact_id}"]`)})
   await expect(evidence).toBeVisible()
   if(metric==='resolution')await expect(evidence).toContainText('unknown')
   const original=JSON.parse(Buffer.from(await(await h.owner.request(`/api/locket/files/${report.artifact_id}`)).arrayBuffer()).toString('utf8'))
   expect(original.provider).toBe('linen')
   expect(original.responses[0].body).toBe(linen.rawBodies.at(-1))
   await shot(metric,'linen-source-evidence')
   await page.reload()
  }
  expect(linen.requests).toHaveLength(2)
  expect(linen.requests.every((request:any)=>request.params.name==='work.get')).toBe(true)
 }finally{await p.close()}
})
