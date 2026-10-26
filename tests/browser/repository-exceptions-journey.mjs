import {expect} from '@playwright/test'
import {file,pdf} from '../api/files.mjs'
import {join} from 'node:path'
import {mkdir} from 'node:fs/promises'
export async function repositoryExceptionsBrowserJourney(page,width,p){
 if(!p.h)return
 const h=p.h,owner=p.owner,now=Date.parse('2026-10-28T12:00:00Z');await h.setTime(now)
 await owner.command('repository.access',{...(await owner.state()).repositoryPolicy,enabled:false,hiddenFields:[],grants:[]})
 const requester=await h.invite('synthetic-locket-write-only@example.test','requester')
 const made=await requester.command('request.create',{title:'synthetic-locket-exceptions',type:'customer',value:'100',party:{name:'synthetic-locket-exceptions',kind:'customer'},text:'synthetic-locket-source',file:file('exceptions.pdf',pdf('synthetic-locket-source'))})
 const row=async()=>(await owner.state()).agreements.find(a=>a.id===made.id)
 const group=await owner.command('audience.save',{name:'Write-only Sales',kind:'group',memberIds:[]})
 const signIn=async client=>{
  await page.context().clearCookies()
  await page.context().addCookies(client.cookie.split('; ').map(pair=>{const at=pair.indexOf('=');return{name:pair.slice(0,at),value:pair.slice(at+1),url:p.origin,secure:true,httpOnly:true,sameSite:'Lax'}}))
 }
 const shot=async name=>{
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-REPO-013-${name}.png`),fullPage:true})}
 }
 const runUi=async click=>{
  const waiting=page.waitForResponse(r=>r.url()===p.origin+'/api/locket/commands'&&r.request().method()==='POST')
  await click();const body=await(await waiting).json();expect(body.ok,JSON.stringify(body.error)).toBe(true)
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false')
 }
 await owner.command('repository.access',{...(await owner.state()).repositoryPolicy,enabled:true,grants:[{audienceId:group.id,types:['customer'],departmentIds:[]}]})
 await signIn(owner);await page.goto(p.origin+`/app#agreement/${made.id}/details`);await page.reload()
 await page.getByLabel('Exception person',{exact:true}).selectOption(requester.id)
 await page.getByLabel('Exception reason',{exact:true}).fill('Temporary source review')
 // Keep the fixed instant while respecting this spec's pinned browser zone.
 const localExpiry=await page.evaluate(at=>{const date=new Date(at);return new Date(at-date.getTimezoneOffset()*60_000).toISOString().slice(0,16)},now+60_000)
 await page.getByLabel('Exception expiry',{exact:true}).fill(localExpiry)
 await runUi(()=>page.getByRole('button',{name:'Share temporarily',exact:true}).click())
 expect((await owner.state()).accessExceptions.find(x=>x.agreement_id===made.id).expires_at).toBe(now+60_000)
 await expect(page.locator('main')).toContainText('Temporary source review')
 await page.getByRole('button',{name:'Review current readers',exact:true}).click()
 const readers=page.getByRole('list',{name:'Current agreement readers',exact:true})
 await expect(readers).toContainText('Temporary group exception: Temporary source review')
 await shot('reasoned-share-reader-report')
 await page.getByLabel('Privileged note',{exact:true}).fill('synthetic-locket-privileged-browser-note')
 await runUi(()=>page.getByRole('button',{name:'Record legal note',exact:true}).click())
 await expect(page.locator('main')).toContainText('synthetic-locket-privileged-browser-note')
 await shot('privileged-note')
 await signIn(requester);await page.reload()
 await expect(page.locator('main')).toContainText('synthetic-locket-exceptions')
 await expect(page.locator('main')).not.toContainText('synthetic-locket-privileged-browser-note')
 await h.setTime(now+60_000)
 const timed=await requester.state();expect({now:timed.now,visible:timed.agreements.some(a=>a.id===made.id)}).toEqual({now:now+60_000,visible:false})
 await page.reload()
 await expect(page.locator('main')).toContainText('No agreement you can access has this link')
 await shot('share-expired')
 await h.setTime(now)
 await owner.command('audience.save',{...group,name:'Write-only Sales',kind:'group',memberIds:[requester.id]})
 await signIn(owner);await page.goto(p.origin+'/app#agreements');await page.reload()
 await page.getByText('Repository access rules',{exact:true}).click()
 await page.getByLabel('Hide Agreement value from group Write-only Sales',{exact:true}).check()
 await runUi(()=>page.getByRole('button',{name:'Save repository access',exact:true}).click())
 await expect(page.getByLabel('Hide Agreement value from group Write-only Sales',{exact:true})).toBeChecked()
 await shot('group-field-hiding')
 await signIn(requester);await page.goto(p.origin+`/app#agreement/${made.id}/details`);await page.reload()
 await page.getByLabel('Hidden value (USD)',{exact:true}).fill('637281.43')
 await runUi(()=>page.getByRole('button',{name:'Submit hidden value',exact:true}).click())
 expect((await row()).value_cents).toBe(63728143)
 await page.reload()
 await expect(page.getByLabel('Hidden value (USD)',{exact:true})).toHaveValue('')
 await expect(page.locator('main')).not.toContainText('637281')
 await expect(page.locator('main')).not.toContainText('637,281')
 await expect(page.locator('main')).not.toContainText('synthetic-locket-privileged-browser-note')
 await shot('hidden-value-submitted')
 await signIn(owner);await page.reload()
 await page.getByRole('button',{name:'Review current readers',exact:true}).click()
 await expect(readers).toContainText('Repository grant: Write-only Sales')
 await expect(readers).toContainText('Hidden fields: value')
 await shot('current-group-reader-report')
}
