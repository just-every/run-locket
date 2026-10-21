import {expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {pdf} from '../api/files.mjs'

export async function queueJourney(page,width,p){
 const tag=randomUUID().slice(0,6),owner=p.owner,ownerId=(await owner.state()).actor.id
 const colleague=p.h?await p.h.invite(`synthetic-locket-${tag}@example.test`,'counsel'):null
 const members=[ownerId,...(colleague?[colleague.id]:[])].sort()
 const group=await owner.command('audience.save',{name:'Legal '+tag,kind:'group',memberIds:members})
 const shot=async name=>{
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-INTAKE-006-${name}.png`),fullPage:true})}
 }
 const run=async action=>{const result=page.waitForResponse(r=>r.url()===p.origin+'/api/locket/commands'&&r.request().method()==='POST');await action();const data=await(await result).json();expect(data.ok,JSON.stringify(data.error)).toBe(true);await expect(page.locator('main')).toHaveAttribute('aria-busy','false');return data.result}
 await page.goto(p.origin+'/app#queue');await page.reload()
 const rules=page.locator('section').filter({has:page.getByRole('heading',{name:'Assignment and service levels',exact:true})}).last()
 await rules.getByLabel('Rule request type',{exact:true}).selectOption('nda')
 await rules.getByLabel('Assignment team',{exact:true}).selectOption(group.id)
 await rules.getByLabel('Team lead',{exact:true}).selectOption(ownerId)
 await rules.getByLabel('Service level (business days)',{exact:true}).fill('2')
 await run(()=>rules.getByRole('button',{name:'Save assignment rule',exact:true}).click())
 await shot('assignment-rule')
 const ids=[]
 for(let i=1;i<=3;i++){
  await page.goto(p.origin+'/app#new')
  await page.getByLabel('Agreement title *',{exact:true}).fill(`NDA ${tag} ${i}`)
  await page.getByLabel('Request type *',{exact:true}).selectOption('nda')
  await page.getByRole('radio',{name:'New',exact:true}).check()
  await page.getByLabel('Name',{exact:true}).fill('Counterparty '+tag)
  await page.getByLabel('Attach draft',{exact:true}).check()
  await page.getByLabel('Draft (PDF or DOCX)',{exact:true}).setInputFiles({name:`nda-${tag}-${i}.pdf`,mimeType:'application/pdf',buffer:pdf('NDA '+tag+' '+i)})
  await page.getByLabel('Text (optional for PDF)',{exact:true}).fill('NDA '+tag+' '+i)
  const created=await run(()=>page.getByRole('button',{name:'Create request',exact:true}).click());ids.push(created.id)
 }
 await page.goto(p.origin+'/app#queue');await page.reload()
 const work=(await owner.state()).requestQueue.work
 expect(ids.map(id=>work.find(w=>w.agreement_id===id).assignee_id)).toEqual([members[0],members[1%members.length],members[0]])
 await page.getByLabel('Queue team',{exact:true}).selectOption(group.id)
 await expect(page.locator('[data-request-id]')).toHaveCount(3)
 await page.getByText('My work',{exact:true}).click()
 await expect(page.locator('[data-request-id]')).toHaveCount(ids.filter(id=>work.find(w=>w.agreement_id===id).assignee_id===ownerId).length)
 await page.getByText('My work',{exact:true}).click()
 await shot('round-robin-queue')
 let card=page.locator(`[data-request-id="${ids[0]}"]`)
 await card.getByText('Manage request',{exact:true}).click()
 await card.getByLabel('New assignee',{exact:true}).selectOption(colleague?.id??ownerId)
 await card.getByLabel('Reassignment reason',{exact:true}).fill('Cover an absence')
 await run(()=>card.getByRole('button',{name:'Reassign request',exact:true}).click())
 await card.getByLabel('Working stage',{exact:true}).selectOption('negotiation')
 await card.getByLabel('Stage reason',{exact:true}).fill('Counterparty review')
 await run(()=>card.getByRole('button',{name:'Update working stage',exact:true}).click())
 await shot('reassigned-negotiation')
 await card.getByLabel('Cancellation reason',{exact:true}).selectOption('deal_lost')
 await run(()=>card.getByRole('button',{name:'Cancel request',exact:true}).click())
 await expect(card).toHaveCount(0)
 await page.getByLabel('Queue status',{exact:true}).selectOption('cancelled')
 card=page.locator(`[data-request-id="${ids[0]}"]`)
 await expect(card).toContainText('Canceled at negotiation: deal lost')
 await shot('canceled-history')
 const analytics=await(await owner.request('/api/locket/analytics')).json()
 expect(analytics.canceled.some(c=>c.agreementId===ids[0]&&c.reason==='deal_lost'&&c.stage==='negotiation')).toBe(true)
 await page.goto(p.origin+'/app#portfolio');await page.reload()
 await expect(page.getByRole('heading',{name:'Canceled requests by reason and stage',exact:true})).toBeVisible()
 // The native runner retains the first width's reopened cancellation history.
 const expectedCancellations=p.h||width===1440?1:2
 expect(analytics.canceled.filter(c=>c.reason==='deal_lost'&&c.stage==='negotiation')).toHaveLength(expectedCancellations)
 await expect(page.locator('main')).toContainText('deal lost · negotiation: '+expectedCancellations)
 await shot('cancellation-report')
 await page.goto(p.origin+'/app#queue');await page.reload()
 await page.getByLabel('Queue status',{exact:true}).selectOption('cancelled')
 card=page.locator(`[data-request-id="${ids[0]}"]`)
 await card.getByLabel('Reason to reopen',{exact:true}).fill('Deal resumed after counsel review')
 await run(()=>card.getByRole('button',{name:'Reopen request',exact:true}).click())
 await page.getByLabel('Queue status',{exact:true}).selectOption('open')
 await expect(card).toContainText('Reopened: Deal resumed after counsel review')
 await shot('reopened-queue')
 if(p.h){
  const due=Math.max(...(await owner.state()).requestQueue.work.map(w=>w.due_at)),now=due+86400000
  await p.h.setTime(now);await p.h.scheduled(now)
  await page.reload();await expect(page.locator('[data-request-id]').first()).toContainText('overdue')
  await shot('sla-breach')
  await page.goto(p.origin+'/app#notifications');await page.reload()
  await expect(page.locator('main')).toContainText('Queue overdue')
  await shot('team-lead-notification')
 }
}
