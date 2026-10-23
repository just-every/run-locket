import { test,expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { clauseSession } from './clause-session.mjs'
import { renewalScenario } from '../api/portfolio-fixture.mjs'
test.use({ignoreHTTPSErrors:true,locale:'en-US',timezoneId:'America/New_York'})
test(`Current renewal terms, optional and evergreen types, limits, termination and superseded history agree with every portfolio drilldown at 1440px/390px`,async({page})=>{
 for(const width of [1440,390]){
  const p=await clauseSession(page,width,{bindings:{TEST_NOW:String(Date.parse('2026-10-17T12:00:00Z'))}})
  const shot=async(name:string)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-renewal-${name}.png`),fullPage:true})}}
  const go=async(hash:string)=>{await page.goto(p.origin+'/app#'+hash);await page.reload()}
  try{
   const base=await renewalScenario(p.owner,{},undefined,{title:'Ridgeway annual services',counterparty:'Ridgeway Services',value:'48000'})
   const optional=await renewalScenario(p.owner,{effective_date:'2026-03-01',end_date:'2027-02-28',renewal_type:'optional',auto_renew:'no' },undefined,{title:'Northwind optional support',counterparty:'Northwind Technology',value:'24000'})
   const evergreen=await renewalScenario(p.owner,{renewal_type:'evergreen',auto_renew:'no',end_date:null},undefined,{title:'Harbor continuing logistics',counterparty:'Harbor Couriers',value:'12000'})
   const limited=await renewalScenario(p.owner,{renewals_allowed:'2'},undefined,{title:'Cedar capped legacy services',counterparty:'Cedar Manufacturing',value:'6000'})
   const terminated=await renewalScenario(p.owner,{},undefined,{title:'Stonegate closed work order',counterparty:'Stonegate Facilities',value:'10000'})
   await p.owner.command('renewal.terminate',{agreementId:terminated.id,version:(await terminated.current()).version,effectiveDate:'2026-10-01',citation:{quote:terminated.quote},reason:'Exercised the cited early termination clause.'})
   const ids=[base.id,optional.id,evergreen.id,limited.id,terminated.id],members=new Set(ids)
   const matrix=async(corrected=false)=>{
    await go('portfolio');await expect(page.getByRole('heading',{name:'Portfolio',exact:true})).toBeVisible()
    const state=await p.owner.state(),portfolio=state.portfolio
    expect(portfolio.lifecycle[optional.id].status).toBe('active');expect(portfolio.lifecycle[evergreen.id].deadline).toBeNull();expect(portfolio.lifecycle[limited.id].status).toBe('expired');expect(portfolio.lifecycle[terminated.id].status).toBe('terminated')
    for(const tile of portfolio.tiles){
     const expected=tile.id==='all'||tile.id==='type-supplier'?ids:tile.id==='lifecycle-auto_renewing'?[base.id]:tile.id==='lifecycle-active'?[optional.id,evergreen.id]:tile.id==='lifecycle-expired'?[limited.id]:tile.id==='lifecycle-terminated'?[terminated.id]:tile.id==='notice-90'?[...(corrected?[]:[base.id]),optional.id]:[]
     expect(tile.agreementIds.filter((id:string)=>members.has(id)).sort(),tile.id).toEqual([...expected].sort())
     const rows=state.agreements.filter((a:any)=>tile.agreementIds.includes(a.id)),card=page.locator(`[data-portfolio-tile="${tile.id}"]`)
     expect(tile.count).toBe(rows.length);expect(tile.valueCents).toBe(rows.reduce((sum:number,a:any)=>sum+(a.value_cents??0),0))
     await expect(card).toContainText(`${tile.count} ${tile.count===1?'agreement':'agreements'}`)
     await expect(card).toContainText('$'+(tile.valueCents/100).toLocaleString('en-US')+' USD')
     await card.click();await expect(page.getByRole('heading',{name:tile.label,exact:true,level:1})).toBeVisible()
     expect((await page.locator('[data-agreement-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-agreement-id')))).sort()).toEqual([...tile.agreementIds].sort())
     if(['lifecycle-active','lifecycle-expired','lifecycle-terminated','notice-90'].includes(tile.id))await shot(`${corrected?'corrected-':''}${tile.id}`)
     await page.getByRole('link',{name:'Back to portfolio',exact:true}).click()
    }
    await shot(corrected?'portfolio-corrected':'portfolio')
   }
   await matrix()
   await go(`agreement/${base.id}/terms`)
   const history=page.getByRole('region',{name:'Current term and renewal history',exact:true})
   await expect(history).toContainText('term 5');await expect(history).toContainText('Dec 30, 2026');await expect(history.getByText(/Derived at import/)).toHaveCount(4)
   await shot('history')
   await base.correction('renewal_term_months','18')
   await page.reload();await expect(history).toContainText('Aug 31, 2027');await expect(history).toContainText('Jul 2, 2027')
   await history.getByText(/Superseded derivation/).click();await expect(history.getByText(/Superseded derivation/)).toBeVisible();await shot('superseded')
   await matrix(true)
   await go('renewals');await expect(page.getByRole('heading',{name:'Renewals',exact:true})).toBeVisible()
   await page.getByText('Connected deadline calendars',{exact:true}).click()
   await expect(page.getByRole('checkbox',{name:'I approve this provider and calendar to receive deadlines for all agreements I can access.',exact:true})).toBeVisible()
   await shot('queue-calendar')
   await go(`agreement/${evergreen.id}/terms`);await expect(history).toContainText('Continues until notice');await expect(history).toContainText('Anniversary review')
   await history.getByLabel('Days before each anniversary',{exact:true}).fill('60')
   const saved=page.waitForResponse(response=>response.url()===p.origin+'/api/locket/commands'&&response.request().method()==='POST'&&response.request().postDataJSON().type==='renewal.review.configure')
   await history.getByRole('button',{name:'Save anniversary review',exact:true}).click();expect((await(await saved).json()).ok).toBe(true)
   expect((await p.owner.state()).renewalSettings.find((row:any)=>row.agreement_id===evergreen.id).evergreen_lead_days).toBe(60)
   await page.reload();await expect(history.getByLabel('Days before each anniversary',{exact:true})).toHaveValue('60');await shot('evergreen')
   await go(`agreement/${terminated.id}/terms`);await expect(history).toContainText('Terminated');await expect(history).toContainText('early termination');await shot('terminated')
  }finally{await p.close()}
 }
})
