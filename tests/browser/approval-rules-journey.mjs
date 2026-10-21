import {expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {approvalRuleFixture,ruleRequest} from '../api/approval-rule-fixture.mjs'

export async function approvalRulesJourney(page,width,p){
 const owner=p.owner,tag=randomUUID().slice(0,6),ownerId=(await owner.state()).actor.id
 const f=p.h?await approvalRuleFixture(p.h):{ownerId,finance:{id:ownerId},security:{id:ownerId},cfo:{id:ownerId},requester:owner,delegate:null,department:await owner.command('audience.save',{name:'Operations '+tag,kind:'department',memberIds:[ownerId]})}
 const shot=async name=>{
  await page.evaluate(()=>window.scrollTo(0,0))
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-APPROVE-002-${name}.png`),fullPage:true})}
 }
 const run=async action=>{const response=page.waitForResponse(r=>r.url()===p.origin+'/api/locket/commands'&&r.request().method()==='POST');await action();const body=await(await response).json();expect(body.ok,JSON.stringify(body.error)).toBe(true);await expect(page.locator('main')).toHaveAttribute('aria-busy','false');return body.result}
 const as=async client=>{
  if(!client?.cookie)return
  await page.context().clearCookies();await page.context().addCookies(client.cookie.split('; ').map(pair=>{const at=pair.indexOf('=');return{name:pair.slice(0,at),value:pair.slice(at+1),url:p.origin,secure:true,httpOnly:true,sameSite:'Lax'}}))
 }
 await page.goto(p.origin+'/app#library');await page.reload()
 const designer=page.locator('section').filter({has:page.getByRole('heading',{name:'Conditional approval rules',exact:true})}).last()
 // Start a new draft through the designer; the native second width retains the first draft.
 while(await designer.getByRole('button',{name:/Remove approval rule/}).count())await designer.getByRole('button',{name:/Remove approval rule/}).last().click()
 for(const [i,name,person,threshold]of [[1,'Finance',f.finance,'100000'],[2,'Security',f.security,''],[3,'CFO',f.cfo,'500000']]){
  await designer.getByRole('button',{name:'Add approval rule',exact:true}).click()
  await designer.getByLabel(`Rule ${i} name`,{exact:true}).fill(name)
  await designer.getByLabel(`Rule ${i} approver`,{exact:true}).selectOption(person.id)
  await designer.getByLabel(`Rule ${i} stage`,{exact:true}).fill(String(i))
  await designer.getByLabel(`Rule ${i} minimum value (USD)`,{exact:true}).fill(threshold)
  if(i===1){await designer.getByLabel(`Rule ${i} agreement type`,{exact:true}).selectOption('supplier');await designer.getByLabel(`Rule ${i} department`,{exact:true}).selectOption(f.department.id)}
  if(i===2)await designer.getByLabel(`Rule ${i} data processing`,{exact:true}).selectOption('yes')
 }
 await run(()=>designer.getByRole('button',{name:'Save approval rule draft',exact:true}).click())
 await designer.getByLabel('Sample approval department',{exact:true}).selectOption(f.department.id)
 await designer.getByLabel('Sample approval value (USD)',{exact:true}).fill('99999.99')
 await designer.getByLabel('Sample data processing',{exact:true}).selectOption('no')
 await run(()=>designer.getByRole('button',{name:'Preview approval rules',exact:true}).click())
 await expect(designer.getByRole('status',{name:'Approval rule preview',exact:true})).toContainText('No extra approver matches')
 await shot('below-threshold-preview')
 await designer.getByLabel('Sample approval value (USD)',{exact:true}).fill('600000')
 await designer.getByLabel('Sample data processing',{exact:true}).selectOption('yes')
 await run(()=>designer.getByRole('button',{name:'Preview approval rules',exact:true}).click())
 const preview=designer.getByRole('status',{name:'Approval rule preview',exact:true})
 await expect(preview).toContainText('Stage 1: Finance');await expect(preview).toContainText('Stage 2: Security');await expect(preview).toContainText('Stage 3: CFO')
 await shot('conditional-route-preview')
 await run(()=>designer.getByRole('button',{name:'Publish approval rules',exact:true}).click())
 await shot('published-rules')
 const id=await ruleRequest(owner,f.requester,f.department.id,{title:'Supplier '+tag})
 await page.goto(p.origin+`/app#agreement/${id}/approvals`);await page.reload()
 const answers=page.locator('section').filter({has:page.getByRole('heading',{name:'Approval routing answers',exact:true})}).last()
 await answers.getByLabel('Counterparty risk',{exact:true}).selectOption('medium')
 await answers.getByLabel('Data processing',{exact:true}).selectOption('yes')
 await run(()=>answers.getByRole('button',{name:'Save approval routing answers',exact:true}).click())
 if(f.delegate){
  const availability=page.locator('section').filter({has:page.getByRole('heading',{name:'Approver availability',exact:true})}).last()
  await availability.getByLabel('Approver to configure',{exact:true}).selectOption(f.security.id)
  await availability.getByText('Away from approvals',{exact:true}).check()
  await availability.getByLabel('Named away delegate',{exact:true}).selectOption(f.delegate.id)
  await run(()=>availability.getByRole('button',{name:'Save approval availability',exact:true}).click())
  await shot('away-delegate')
 }else await shot('routing-answers-and-availability')
 await page.goto(p.origin+`/app#agreement/${id}/versions`)
 await run(()=>page.getByRole('button',{name:'Submit for review',exact:true}).click())
 await as(f.finance)
 await page.goto(p.origin+`/app#agreement/${id}/approvals`);await page.reload()
 const route=page.locator('section').filter({has:page.getByRole('heading',{name:'Approval route for v1',exact:true})}).last().locator('.lk-route')
 await expect(route.locator('li>div>strong')).toHaveText(['Finance','Security','CFO'])
 await expect(route.getByRole('button',{name:'Record decision',exact:true})).toHaveCount(1)
 await expect(route).toContainText('Waiting for earlier stages')
 await shot('ordered-finance-first')
 const reminders=page.getByRole('region',{name:'Approval reminders',exact:true})
 await run(()=>reminders.getByRole('button',{name:'Remind approver',exact:true}).click())
 await expect(reminders).toContainText('Reminded recently')
 await expect(reminders).toContainText(p.h?'Provider accepted; delivery unconfirmed':'Email suppressed; no email sent')
 await shot('inherited-rule-reminder')
 await page.goto(p.origin+'/app#notifications');await page.reload()
 await expect(page.locator('main')).toContainText('Rule approval request')
 await shot('personal-rule-request')
 await page.goto(p.origin+`/app#agreement/${id}/approvals`);await page.reload()
 await run(()=>route.locator('li').filter({has:page.getByText('Finance',{exact:true})}).getByRole('button',{name:'Record decision',exact:true}).click())
 await as(f.delegate??owner)
 await page.goto(p.origin+`/app#agreement/${id}/approvals`);await page.reload()
 await expect(route.getByRole('button',{name:'Record decision',exact:true})).toHaveCount(1)
 await run(()=>route.locator('li').filter({has:page.getByText('Security',{exact:true})}).getByRole('button',{name:'Record decision',exact:true}).click())
 if(f.delegate)await expect(route).toContainText('Acted as away delegate')
 await shot('security-delegate-decision')
 await as(f.cfo)
 await page.goto(p.origin+`/app#agreement/${id}/approvals`);await page.reload()
 await run(()=>route.locator('li').filter({has:page.getByText('CFO',{exact:true})}).getByRole('button',{name:'Record decision',exact:true}).click())
 expect((await owner.state()).agreements.find(a=>a.id===id).status).toBe('approved')
 await expect(route.getByText('Approved',{exact:true})).toHaveCount(3)
 await shot('all-three-approved')
 await page.goto(p.origin+`/app#agreement/${id}/details`);await page.reload()
 await page.getByLabel('Value (USD)',{exact:true}).fill('650000')
 await run(()=>page.getByRole('button',{name:'Save details',exact:true}).click())
 await page.goto(p.origin+`/app#agreement/${id}/approvals`)
 const s=await owner.state()
 expect(s.agreements.find(a=>a.id===id).status).toBe('in_review')
 expect(s.approvals.filter(a=>a.agreement_id===id&&a.invalidated_at)).toHaveLength(3)
 expect(s.approvals.filter(a=>a.agreement_id===id&&!a.invalidated_at)).toHaveLength(0)
 await expect(route.getByRole('button',{name:'Record decision',exact:true})).toHaveCount(f.cfo.id===ownerId?1:0)
 await expect(page.locator('main')).toContainText('no longer counts')
 await shot('value-change-withdraws-all')
}
