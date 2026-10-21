import {expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {file,pdf} from '../api/files.mjs'

export async function repositoryAccessJourney(page,width,p){
 const owner=p.owner,ownerId=(await owner.state()).actor.id,tag=randomUUID().slice(0,6)
 const viewer=p.h?await p.h.invite(`synthetic-locket-sales-${tag}@example.test`,'viewer'):null
 const group=await owner.command('audience.save',{name:'Sales '+tag,kind:'group',memberIds:[viewer?.id??ownerId]})
 const department=await owner.command('audience.save',{name:'Sales department '+tag,kind:'department',memberIds:[]})
 const ids=[]
 for(const [i,type]of [[1,'customer'],[2,'supplier']]){
  const made=await owner.command('request.create',{title:`${type} ${tag}`,type,value:'748392.56',party:{name:'synthetic-locket-'+tag+'-'+i,kind:type},file:file('pricing-'+tag+'-'+i+'.pdf',pdf('Confidential pricing 748392.56 '+i)),text:'Confidential pricing 748392.56 '+i})
  ids.push(made.id)
  const a=(await owner.state()).agreements.find(a=>a.id===made.id)
  await owner.command('agreement.department',{agreementId:a.id,version:a.version,departmentId:department.id})
 }
 const shot=async name=>{
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-REPO-009-${name}.png`),fullPage:true})}
 }
 await page.goto(p.origin+'/app#agreements');await page.reload()
 await page.getByText('Repository access rules',{exact:true}).click()
 const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'Repository access',exact:true})}).last()
 await panel.getByText('Require a matching group or department grant',{exact:true}).check()
 await panel.getByRole('button',{name:'Add visibility grant',exact:true}).click()
 // Other widths share a native installation, so select the newly added final grant.
 const grants=panel.getByRole('group',{name:/Visibility grant/})
 const grant=grants.last()
 await grant.getByLabel(/audience/).selectOption(group.id)
 await grant.getByText('Sales department '+tag,{exact:true}).check()
 await panel.getByLabel('Hide Agreement value from viewer',{exact:true}).check()
 await panel.getByLabel('Hide Pricing schedules from viewer',{exact:true}).check()
 const response=page.waitForResponse(r=>r.url()===p.origin+'/api/locket/commands'&&r.request().method()==='POST')
 await panel.getByRole('button',{name:'Save repository access',exact:true}).click()
 const body=await(await response).json();expect(body.ok,JSON.stringify(body.error)).toBe(true)
 await expect(page.locator('main')).toHaveAttribute('aria-busy','false')
 await shot('owner-access-rules')
 const shared=await owner.command('view.save',{name:'Sales agreements '+tag,definition:{query:tag,filters:[],sort:{field:'title',direction:'asc'},columns:['title','value','owner']},sharedRoles:[],sharedGroups:[group.id]})
 await page.reload()
 const views=page.getByRole('region',{name:'Saved repository views',exact:true})
 await views.getByLabel('Saved view',{exact:true}).selectOption(shared.id)
 await views.getByRole('button',{name:'View definition',exact:true}).click()
 await expect(views.getByLabel('Shared with group Sales '+tag,{exact:true})).toBeChecked()
 await shot('group-shared-definition')
 if(!viewer){
  await page.goto(p.origin+`/app#agreement/${ids[0]}/details`);await page.reload()
  await page.getByText('Agreement department',{exact:true}).click()
  await expect(page.getByLabel('Department',{exact:true})).toHaveValue(department.id)
  await shot('owner-agreement-department')
  return
 }
 await page.context().clearCookies()
 await page.context().addCookies(viewer.cookie.split('; ').map(pair=>{const at=pair.indexOf('=');return{name:pair.slice(0,at),value:pair.slice(at+1),url:p.origin,secure:true,httpOnly:true,sameSite:'Lax'}}))
 await page.goto(p.origin+'/app#agreements');await page.reload()
 await expect(page.locator('.lk-board-card')).toHaveCount(1)
 await expect(page.locator('.lk-board-card')).toContainText('customer '+tag)
 await expect(page.locator('main')).not.toContainText('748,392.56')
 await shot('sales-register-hidden-value')
 await page.getByRole('searchbox').fill('748392')
 await expect(page.locator('.lk-board-card')).toHaveCount(0)
 await page.getByRole('searchbox').fill(tag)
 await expect(page.locator('.lk-board-card')).toHaveCount(1)
 await shot('scoped-search')
 await views.getByLabel('Saved view',{exact:true}).selectOption(shared.id)
 await views.getByRole('button',{name:'Open saved view',exact:true}).click()
 await expect(views.getByRole('columnheader',{name:'Value (USD)',exact:true})).toHaveCount(0)
 await expect(views).toContainText('customer '+tag)
 const waiting=page.waitForEvent('download')
 await views.getByRole('button',{name:'Export view CSV',exact:true}).click()
 const download=await waiting,stream=await download.createReadStream(),chunks=[]
 for await(const chunk of stream)chunks.push(chunk)
 const csv=Buffer.concat(chunks).toString()
 expect(csv).toContain('customer '+tag);expect(csv).not.toContain('supplier '+tag);expect(csv).not.toContain('748392');expect(csv).not.toContain('Value (USD)')
 await shot('group-view-export')
 await page.goto(p.origin+`/app#agreement/${ids[0]}/details`);await page.reload()
 await expect(page.locator('main')).toContainText('Unredacted documents and some fields are withheld')
 await expect(page.locator('main')).not.toContainText('748,392.56')
 await shot('agreement-custody')
 await page.goto(p.origin+'/app#portfolio');await page.reload()
 await expect(page.locator('main')).toContainText('Value hidden')
 await shot('portfolio-hidden-totals')
 const party=(await owner.state()).agreements.find(a=>a.id===ids[0]).party_id
 await page.goto(p.origin+'/app#counterparty/'+party);await page.reload()
 await expect(page.locator('[data-party-total]')).toHaveText('Hidden')
 await shot('counterparty-hidden-totals')
 await owner.command('audience.save',{id:group.id,version:group.version,name:'Sales '+tag,kind:'group',memberIds:[]})
 await page.goto(p.origin+'/app#agreements');await page.reload()
 await expect(page.locator('.lk-board-card')).toHaveCount(0)
 await expect(views.getByLabel('Saved view',{exact:true}).locator('option').filter({hasText:'Sales agreements '+tag})).toHaveCount(0)
 await shot('revoked-membership')
}
