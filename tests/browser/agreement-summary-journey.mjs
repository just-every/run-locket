// Continuation of the model-records journey, using the same public commands and components.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { productPage } from './product-harness.mjs'
import { modelBindings } from '../api/model-settings-fixture.mjs'
import { summaryFake, summaryFixture, summaryExpected } from '../api/agreement-summary-fixture.mjs'
export async function agreementSummaryProof(browser, width) {
 const context = await browser.newContext({ignoreHTTPSErrors:true}), page = await context.newPage(), calls=[]
 const p = await productPage(page,{width,bindings:{...modelBindings,TEST_NOW:String(Date.parse('2026-10-27T12:00:00Z'))},outboundResponse:summaryFake(calls)})
 try {
  const f = await summaryFixture(p.h)
  await f.upload(2)
  const shot = async name => {
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
   if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-summary-${name}.png`),fullPage:true})}
  }
  await page.goto(p.origin+'/app#settings')
  const request=page.getByRole('region',{name:'Model requests',exact:true})
  await request.getByLabel('Agreement for model request',{exact:true}).selectOption(f.id)
  await request.getByLabel('I approve sending this version and its playbook for this request',{exact:true}).check()
  if(width===1440)await expect(request.getByRole('button',{name:'Run evaluated summaries',exact:true})).toBeDisabled()
  await request.getByRole('button',{name:'Simulate summaries',exact:true}).click()
  await expect(page.getByRole('article',{name:'summaries output record',exact:true})).toBeVisible()
  await page.goto(p.origin+`/app#agreement/${f.id}/review`)
  const summary=page.getByRole('region',{name:'Agreement summaries',exact:true})
  await expect(summary.getByRole('heading',{name:'Summary of v2 · Current · Provider simulation',exact:true})).toBeVisible()
  if(width===1440){
   await expect(summary.getByText('renewal term months · proposed',{exact:true})).toBeVisible()
   for(const [,value,quote] of summaryExpected){await expect(summary.getByRole('link',{name:quote,exact:true}).first()).toBeVisible();assert.ok((await summary.textContent()).includes(value))}
  }
  await shot('current')
  await f.upload(3)
  await page.reload()
  await expect(summary.getByRole('heading',{name:'Summary of v2 · Stale · Provider simulation',exact:true})).toBeVisible()
  await shot('stale')
  await summary.getByRole('link',{name:summaryExpected[7][2],exact:true}).click()
  if(width===1440)await expect(page.getByRole('navigation',{name:'Versions',exact:true}).locator('[aria-current=page]')).toContainText('v2')
  await shot('cited-version')
  const a=(await p.state()).agreements.find(a=>a.id===f.id)
  await p.command('request.update',{agreementId:a.id,version:a.version,title:a.title,ownerId:a.owner_id,currency:'USD',restricted:true})
  const viewer=await p.h.invite('synthetic-locket-summary-viewer@example.test','viewer')
  await context.clearCookies()
  await context.addCookies(viewer.cookie.split('; ').map(pair=>{const i=pair.indexOf('=');return{name:pair.slice(0,i),value:pair.slice(i+1),url:p.origin,secure:true,httpOnly:true,sameSite:'Lax'}}))
  await page.goto(p.origin+`/app#agreement/${f.id}/review`)
  await page.reload()
  await expect(page.getByText('No agreement you can access has this link.',{exact:false})).toBeVisible()
  await shot('restricted')
  console.log(`PASS ${width}: version-pinned cited summary, proposed renewal, stale retained summary, source link and current viewer refusal`)
 } finally {await p.close();await context.close()}
}
