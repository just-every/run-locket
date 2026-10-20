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
