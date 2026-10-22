import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { file, docx } from '../api/files.mjs'

test.use({ ignoreHTTPSErrors: true })
for (const width of [1440, 390]) test(`NEG-004 two browser edits, selected mention, reply and resolution at ${width}px`, async ({ page }) => {
  let close = async () => {}, owner: any, counsel: any, origin: string
  const live = !!process.env.LOCKET_EDITS_LIVE
  if (live) {
    origin = process.env.LOCKET_BASE_URL!
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(process.env.LOCKET_OPEN!)
    await page.waitForURL(url => !url.hash.includes('rer-dev') && ['/app','/setup'].includes(url.pathname))
    if (new URL(page.url()).pathname === '/setup') { await page.getByRole('checkbox').check(); await page.getByRole('button',{name:'Finish setup',exact:true}).click(); await page.waitForURL(url=>url.pathname==='/app') }
    owner = {
      command: async (type: string, payload: object) => { const response=await page.request.post(origin+'/api/locket/commands',{headers:{origin},data:{type,payload,commandId:randomUUID()}}); const body=await response.json();expect(body.ok,JSON.stringify(body.error)).toBe(true);return body.result },
      state: async () => (await page.request.get(origin+'/api/locket/state')).json(),
    }
  } else {
    const p=await productPage(page,{width});close=()=>p.close();origin=p.origin;owner=p.owner
    counsel=await p.h.invite('counsel@example.test','counsel')
  }
  const shot=async(name:string)=>{
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
    if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-NEG-004-${live?'live':'worker'}-${name}.png`),fullPage:true})}
  }
  const waitCommand=(type:string)=>page.waitForResponse(r=>r.url()===origin+'/api/locket/commands'&&r.request().method()==='POST'&&r.request().postDataJSON().type===type)
  const save=async(type:string,button:any)=>{const response=waitCommand(type);await button.click();expect((await(await response).json()).ok).toBe(true)}
  try {
    const initial=await owner.state(),tag=randomUUID().slice(0,6)
    const original='1. Payment\nInvoices are due within 30 days.\n2. Liability\nLiability is capped at $100,000.\n3. Confidentiality\nBoth parties protect confidential information.'
    const edited=original.replace('30 days','45 days').replace('$100,000','$200,000')
    const created=await owner.command('request.create',{title:`Northwind MSA ${tag}`,type:'nda',party:{name:`Northwind Technology ${tag}`,kind:'supplier'},file:file('northwind.docx',docx(original.split('\n')))})
    await page.goto(`${origin}/app#agreement/${created.id}`)
    await page.getByRole('button',{name:'Add v2',exact:true}).click()
    await page.getByText('Edit document text in the browser',{exact:true}).click()
    await page.getByLabel('Edit v1 text',{exact:true}).fill(edited)
    await shot('editor')
    await save('version.edit',page.getByRole('button',{name:'Save browser revision',exact:true}))
    await expect(page).toHaveURL(/versions\/2$/)
    await expect(page.locator('.lk-paper del')).toHaveText(['30','$100'])
    await expect(page.locator('.lk-paper ins')).toHaveText(['45','$200'])
    await expect(page.locator('.lk-counts')).toContainText('2 tracked changes from v1')
    await page.getByRole('button',{name:'Compare',exact:true}).click()
    await expect(page.getByRole('combobox',{name:'Earlier version',exact:true})).toHaveValue('1')
    await page.getByRole('button',{name:'Compare',exact:true}).click()
    await shot('tracked')
    const unchanged=page.getByRole('button',{name:/unchanged paragraph/})
    while(await unchanged.count()) await unchanged.first().click()
    const quote='Both parties protect confidential information.'
    await page.locator('.lk-paper .lk-clause-text').filter({hasText:quote}).evaluate((element:any)=>{const range=document.createRange();range.selectNodeContents(element);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range)})
    const comments=page.getByRole('region',{name:'Comment threads',exact:true})
    await comments.getByRole('button',{name:'Use selected passage',exact:true}).click()
    await expect(comments.getByLabel('Quoted passage (optional)',{exact:true})).toHaveValue(quote)
    await comments.getByLabel('Comment on v2',{exact:true}).fill('Counsel, please confirm the reciprocal confidentiality wording.')
    const mentioned=live?initial.actor.name:'counsel'
    await comments.getByRole('checkbox',{name:new RegExp(`^Mention ${mentioned}`)}).check()
    await save('comment.add',comments.getByRole('button',{name:'Comment',exact:true}))
    const state=await owner.state(),root=state.comments.find((c:any)=>c.version_id===state.agreements.find((a:any)=>a.id===created.id).current_version_id&&!c.parent_id)
    if(!live){
      expect((await counsel.state()).notifications.items.some((n:any)=>n.kind==='mention'&&n.agreement_id===created.id)).toBe(true)
      await page.context().clearCookies()
      await page.context().addCookies(counsel.cookie.split('; ').map((pair:string)=>{const i=pair.indexOf('=');return{name:pair.slice(0,i),value:pair.slice(i+1),url:origin,secure:true,httpOnly:true,sameSite:'Lax' as const}}))
      await page.reload()
    }
    const thread=comments.locator(`[data-thread="${root.id}"]`)
    await thread.getByLabel('Reply to thread',{exact:true}).fill('Confirmed. The reciprocal confidentiality obligation is suitable.')
    await save('comment.add',thread.getByRole('button',{name:'Reply',exact:true}))
    await expect(thread.getByRole('list',{name:'Thread replies'})).toContainText('Confirmed. The reciprocal confidentiality obligation is suitable.')
    await shot('reply')
    await save('comment.resolve',thread.getByRole('button',{name:'Resolve thread',exact:true}))
    await expect(thread).toContainText(`Resolved by ${live?initial.actor.name:'counsel'}`)
    await expect(thread.getByRole('button',{name:'Reply',exact:true})).toHaveCount(0)
    await page.reload()
    await expect(thread).toContainText(`Resolved by ${live?initial.actor.name:'counsel'}`)
    await shot('resolved')
  } finally { await close() }
})

import { exchangeFixture, counterpartyText } from '../api/exchange-fixture.mjs'
import { hostExchange } from './exchange-fixture.mjs'
for(const width of [1440,390])test(`NEG-006 sends external v2, receives counterparty v3 and expires without an account at ${width}px`,async({page,browser})=>{
  const live=!!process.env.LOCKET_EXCHANGE_LIVE
  const p:any=live?await (await import('./metadata-page.mjs')).metadataPage(page,width):await productPage(page,{width,bindings:{POSTMARK_SERVER_TOKEN:'synthetic-locket-1'}})
  let unhost=async()=>{},publicContext:any=null
  let counterparty=page
  try{
    const shot=async(name:string)=>{
      const privateMain=counterparty.locator('main[aria-busy]')
      if(await privateMain.count())await expect(privateMain).toHaveAttribute('aria-busy','false')
      await counterparty.evaluate(()=>window.scrollTo(0,0))
      expect(await counterparty.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
      if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await counterparty.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-NEG-006-${name}.png`),fullPage:true})}
    }
    const x=await exchangeFixture(live?{owner:p.owner}:p.h)
    await page.goto(p.origin+'/app#agreement/'+x.a.id)
    await page.reload() // Fixture writes occurred outside this already-open workspace.
    const panel=page.getByRole('region',{name:'Counterparty exchange',exact:true})
    await expect(panel).toBeVisible()
    await panel.getByLabel('Share by',{exact:true}).selectOption(live?'link':'email')
    await panel.getByLabel('Why this contact is authorized to receive this version',{exact:true}).fill('synthetic-locket-14 approved counterparty negotiation contact')
    await expect(panel.getByRole('note')).toContainText('embedded comments')
    await panel.getByLabel('I approve this clean plain rendition and explicit disclosure to the selected contact',{exact:true}).check()
    const sending=page.waitForResponse(r=>r.url()===p.origin+'/api/locket/commands'&&r.request().postDataJSON()?.type==='exchange.send')
    await panel.getByRole('button',{name:'Share external version',exact:true}).click()
    const sent=await(await sending).json()
    expect(sent.ok,JSON.stringify(sent.error)).toBe(true)
    await expect(panel.getByRole('link',{name:'Open secure counterparty link'})).toBeVisible()
    if(!live)expect(p.h.mails.filter((m:any)=>m.text?.includes('/exchange#')).length).toBe(1)
    const link=await panel.getByRole('link',{name:'Open secure counterparty link'}).getAttribute('href')
    const token=new URL(link!).hash.slice(1)
    await shot('sender-approval')
    if(!live){
      expect(p.h.mails.find((m:any)=>m.text?.includes('/exchange#'))?.text).toContain('/exchange#'+token)
      unhost=await hostExchange(page,p.origin)
      await page.context().clearCookies()
    }else{publicContext=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:1000}});counterparty=await publicContext.newPage()}
    await counterparty.goto(link!)
    await expect(counterparty.getByRole('heading',{name:'Version 2',exact:true})).toBeVisible()
    await expect(counterparty.getByRole('region',{name:'External comments',exact:true})).toContainText('synthetic-locket-7 external question')
    await expect(counterparty.getByText('synthetic-locket-5 private legal position',{exact:true})).toHaveCount(0)
    await expect(counterparty.getByText('synthetic-locket-6 private approval note',{exact:true})).toHaveCount(0)
    const downloading=counterparty.waitForEvent('download')
    await counterparty.getByRole('button',{name:'Download external Word rendition',exact:true}).click()
    expect((await downloading).suggestedFilename()).toBe('external-v2.docx')
    await counterparty.getByLabel('External comment',{exact:true}).fill('synthetic-locket-15 counterparty response')
    await counterparty.getByRole('button',{name:'Add external comment',exact:true}).click()
    await expect(counterparty.getByRole('region',{name:'External comments',exact:true})).toContainText('synthetic-locket-15 counterparty response')
    await counterparty.getByLabel('Counterparty markup file',{exact:true}).setInputFiles({name:'synthetic-locket-3.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:docx(counterpartyText.split('\n'))})
    await counterparty.getByRole('button',{name:'Upload counterparty markup',exact:true}).click()
    await expect(counterparty.getByRole('status')).toContainText('Counterparty version 3 received')
    const state=await p.owner.state(),current=state.agreements.find((a:any)=>a.id===x.a.id),v3=state.versions.find((v:any)=>v.id===current.current_version_id)
    expect(v3.number).toBe(3);expect(v3.kind).toBe('counterparty');expect(v3.digest).toBeTruthy()
    for(const action of ['exchange.sent','exchange.opened','exchange.uploaded'])expect(state.audit.some((a:any)=>a.action===action)).toBe(true)
    expect(await counterparty.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
    await shot('counterparty')
    if(live)await p.owner.command('exchange.revoke',{agreementId:current.id,version:current.version,exchangeId:sent.result.id,reason:'Completed native counterparty review'})
    else await p.h.setTime(Date.now()+2*86_400_000)
    await counterparty.reload()
    await expect(counterparty.getByRole('alert')).toContainText('unavailable')
    await expect(counterparty.getByRole('region',{name:'Shared document'})).toHaveCount(0)
    await shot('expired')
    expect(await counterparty.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  }finally{await publicContext?.close();await unhost();await p.close()}
})
