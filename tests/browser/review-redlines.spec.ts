import { test,expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { clauseSession } from './clause-session.mjs'
import { reviewRedlinesFixture } from '../api/review-redlines-fixture.mjs'
test.use({ignoreHTTPSErrors:true})
for(const width of [1440,390])test(`Reviewer edits three accepted findings, saves attributed browser and Word redlines and keeps reasons internal at ${width}px`,async({page})=>{
 const p=await clauseSession(page,width)
 const shot=async(name:string)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-redlines-${name}.png`),fullPage:true})}}
 try{
  const x=await reviewRedlinesFixture(p)
  await page.goto(`${p.origin}/app#agreement/${x.a.id}/review`);await page.reload()
  const panel=page.getByRole('region',{name:'Accepted finding redlines',exact:true})
  for(const key of ['payment','liability','confidentiality'])await panel.getByRole('checkbox',{name:'Apply '+key,exact:true}).check()
  await panel.getByLabel('Wording for payment',{exact:true}).fill('Invoices are due within 45 days.')
  await panel.getByLabel('Reason for liability',{exact:true}).fill('Counsel reviewed the higher cap for this scope.')
  await panel.getByRole('checkbox',{name:'Share confidentiality reason externally',exact:true}).check()
  await shot('edit')
  const pending=page.waitForResponse(response=>response.url()===p.origin+'/api/locket/commands'&&response.request().method()==='POST'&&response.request().postDataJSON().type==='review.redlines')
  await panel.getByRole('button',{name:'Save reviewed redlines',exact:true}).click();expect((await(await pending).json()).ok).toBe(true)
  await expect(panel).toContainText('3 changes saved by');await expect(panel).toContainText('synthetic-locket-91');await expect(panel.getByText(/Internal reason/)).toHaveCount(2);await expect(panel.getByText(/External reason/)).toHaveCount(1)
  await shot('saved')
  await panel.getByRole('link',{name:'Review browser redlines',exact:true}).click()
  const word=page.getByRole('region',{name:'Word tracked changes',exact:true})
  await expect(word).toBeVisible();await expect(word).toContainText('45 days')
  const state=await p.owner.state(),v=state.versions.find((row:any)=>row.id===state.agreements.find((row:any)=>row.id===x.a.id).current_version_id)
  expect(JSON.parse(v.fields).reviewRedlines.changes).toHaveLength(3)
  const model=await(await page.request.get(p.origin+'/api/locket/word-review?versionId='+v.id)).json()
  expect(model.changes.filter((c:any)=>c.kind==='insertion')).toHaveLength(3);expect(model.changes.filter((c:any)=>c.kind==='deletion')).toHaveLength(3);expect(model.changes.every((c:any)=>c.author===state.actor.name)).toBe(true)
  await shot('browser-word')
  const fold=page.getByRole('button',{name:/Show .*unchanged paragraph/}).first()
  if(await fold.count()){await fold.focus();await expect(page.getByRole('tooltip',{name:'Show unchanged',exact:true})).toBeVisible();await fold.blur();await fold.hover();await expect(page.getByRole('tooltip',{name:'Show unchanged',exact:true})).toBeVisible();await shot('tooltip')}
 }finally{await p.close()}
})
