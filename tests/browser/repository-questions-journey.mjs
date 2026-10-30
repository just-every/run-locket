// One browser journey through the real product UI and Worker. Assertions run
// at 1440; the same changed screens are captured once at 1440 and 390.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium,expect } from '@playwright/test'
import { productPage } from './product-harness.mjs'
import { modelBindings } from '../api/model-settings-fixture.mjs'
import { questionFake,questionFixture,selectionQuestion,liabilityQuestion,proposedQuestion,liabilityQuote } from '../api/repository-questions-fixture.mjs'
const browser=await chromium.launch({headless:true,...(process.env.LOCKET_CHROMIUM?{executablePath:process.env.LOCKET_CHROMIUM}:{}),args:['--no-sandbox']})
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage(),calls=[]
  const p=await productPage(page,{width,bindings:{...modelBindings,TEST_NOW:String(Date.parse('2026-10-29T12:00:00Z'))},outboundResponse:questionFake(calls)})
  try{
   const f=await questionFixture(p.h)
   const shot=async name=>{
    if(width===1440)assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-questions-${name}.png`),fullPage:true})}
   }
   await page.goto(p.origin+'/app#questions')
   const form=page.getByRole('region',{name:'Repository question',exact:true}),answer=page.getByRole('region',{name:'Repository answer',exact:true})
   const ask=async question=>{
    await form.getByLabel('Your question',{exact:true}).fill(question)
    await form.getByLabel('I approve sending this question and my accessible, AI-enabled documents for this request',{exact:true}).check()
    if(width===1440)await expect(form.getByRole('button',{name:'Ask question',exact:true})).toBeDisabled()
    await form.getByRole('button',{name:'Simulate question',exact:true}).click()
    await page.waitForURL(/#questions\//)
    await answer.getByRole('heading',{name:question,exact:true}).waitFor()
   }
   await ask(selectionQuestion)
   if(width===1440){
    await expect(answer).toContainText('2 matching agreements.')
    await expect(answer.getByRole('article',{name:'Acme supplier',exact:true})).toBeVisible()
    await expect(answer.getByRole('article',{name:'Restricted Supplier',exact:true})).toBeVisible()
    await expect(answer).toContainText('notice days: 90 · confirmed')
    await expect(answer).not.toContainText('Sixty Day Supplier')
   }
   await shot('selection')
   await answer.getByText('Model and source record',{exact:true}).click()
   if(width===1440){await expect(answer).toContainText('openai · synthetic-locket-1');await expect(answer).toContainText('0.007000 USD')}
   await shot('model-record')
   await ask(liabilityQuestion)
   if(width===1440){await expect(answer).toContainText('USD 250000');await expect(answer.getByRole('link',{name:liabilityQuote,exact:true})).toBeVisible()}
   await shot('liability')
   await answer.getByRole('link',{name:liabilityQuote,exact:true}).click()
   await page.waitForURL(/#agreement\//)
   if(width===1440)await expect(page.locator('mark').filter({hasText:liabilityQuote})).toBeVisible()
   await shot('source')
   await page.goto(p.origin+'/app#questions')
   await ask(proposedQuestion)
   if(width===1440)await expect(answer).toContainText('Relies on proposed, unconfirmed values.')
   await shot('proposed')
   await answer.getByRole('button',{name:'Accept answer record',exact:true}).click()
   if(width===1440)await expect(answer).toContainText('Provider simulation · accepted')
   const viewer=await p.h.invite('synthetic-locket-question-viewer@example.test','viewer')
   await context.clearCookies()
   await context.addCookies(viewer.cookie.split('; ').map(pair=>{const i=pair.indexOf('=');return{name:pair.slice(0,i),value:pair.slice(i+1),url:p.origin,secure:true,httpOnly:true,sameSite:'Lax'}}))
   await page.goto(p.origin+'/app#questions')
   await page.reload()
   await ask(selectionQuestion)
   if(width===1440){
    await expect(answer).toContainText('1 matching agreement.')
    await expect(answer).not.toContainText('Restricted Supplier')
    assert.equal(calls.at(-1).input.sources.some(s=>s.id===f.restricted.id),false)
   }
   await shot('viewer')
   console.log(`PASS ${width}: repository selection, liability passage, proposed label, accepting person and restricted viewer answer`)
  }finally{await p.close();await context.close()}
 }
}finally{await browser.close()}
