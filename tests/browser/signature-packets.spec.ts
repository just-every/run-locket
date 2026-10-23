import { test,expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { file,pdf } from '../api/files.mjs'
import { agreement,approvePacket,configureConnection,preparePacket,signatureEdge,signerRules,signingTemplate,templatePacket } from '../api/signature-packet-fixture.mjs'
test.use({ignoreHTTPSErrors:true,locale:'en-US',timezoneId:'America/New_York'})
test(`Signature coordinator reviews template packet, previews signer rules and places page seven fields with CC at 1440px/390px`,async({page})=>{
 for(const width of [1440,390]){
 const edge=signatureEdge(),product=await productPage(page,{width,...edge}),{h,origin}=product
 const click=async(label:string)=>{const response=page.waitForResponse(r=>r.url()===origin+'/api/locket/commands'&&r.request().method()==='POST');await page.getByRole('button',{name:label,exact:true}).click();const body=await (await response).json();expect(body.ok,JSON.stringify(body.error)).toBe(true);await expect(page.locator('main')).toHaveAttribute('aria-busy','false');return body.result}
 const shot=async(name:string)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-signature-${name}.png`),fullPage:true})}}
 try{
  const people=await signerRules(h),main=await signingTemplate(h.owner,'MSA'),dpa=await signingTemplate(h.owner,'DPA')
  const id=await templatePacket(h.owner,{main,dpa}),prepared=await preparePacket(h.owner,id)
  await page.goto(origin+`/app#agreement/${id}/signature`)
  await expect(page.getByRole('heading',{name:'Signature packages',exact:true})).toBeVisible()
  await expect(page.getByText('Internal signer selected by published rule.')).toBeVisible()
  await expect(page.getByText(/signature · internal · page 1 · template anchor/).first()).toBeVisible()
  await expect(page.getByText('DPA.pdf',{exact:false}).first()).toBeVisible()
  await shot('template-packet')
  await page.getByText('Owner signing settings',{exact:true}).click()
  await page.getByLabel('Preview USD value',{exact:true}).fill('50000')
  await click('Preview signer route')
  await expect(page.getByRole('status')).toContainText('vp-sales@example.test')
  await h.owner.command('signature.availability',{operatorId:people.cfo.id,version:0,away:true})
  await page.getByLabel('Preview USD value',{exact:true}).fill('250000')
  await click('Preview signer route')
  await expect(page.getByRole('status')).toContainText('fallback@example.test')
  await shot('fallback-preview')
  const source=pdf('Synthetic counterparty agreement for page seven',7),request=await h.owner.command('request.create',{title:'Synthetic manual signing',type:'nda',party:{name:'Synthetic paper counterparty',kind:'customer'},file:file('counterparty.pdf',source),text:'Synthetic counterparty agreement for page seven'})
  await configureConnection(h.owner,'docusign')
  await page.goto(origin+`/app#agreement/${request.id}/signature`);await page.reload()
  await page.getByLabel('Packet recipient 1 name').fill('Synthetic counterparty')
  await page.getByLabel('Packet recipient 1 email').fill('signer@example.test')
  await page.getByRole('button',{name:'Add packet recipient',exact:true}).click()
  await page.getByLabel('Packet recipient 2 name').fill('Synthetic copy recipient')
  await page.getByLabel('Packet recipient 2 email').fill('cc@example.test')
  await page.getByLabel('Packet recipient 2 action').selectOption('copy')
  await page.getByLabel('Packet recipient 2 party role').fill('copy')
  await click('Load PDF page dimensions')
  await page.getByLabel('Field page',{exact:true}).fill('7')
  await page.getByRole('button',{name:'Place signature on page 7',exact:true}).click({position:{x:80,y:250}})
  await page.getByLabel('Field kind',{exact:true}).selectOption('date')
  await page.getByRole('button',{name:'Add field at coordinates',exact:true}).click()
  await page.getByLabel('Field 2 y',{exact:true}).fill('600')
  // Our rule-selected fallback also signs this packet; place its own block explicitly.
  await page.getByLabel('Field party role',{exact:true}).fill('internal')
  await page.getByLabel('Field kind',{exact:true}).selectOption('signature')
  await page.getByRole('button',{name:'Add field at coordinates',exact:true}).click()
  await page.getByLabel('Field 3 y',{exact:true}).fill('650')
  await page.getByLabel('Reason for packet changes',{exact:true}).fill('Coordinator placed signature and date on page seven and added a CC.')
  await click('Save signing packet')
  const placement=page.getByRole('button',{name:'Place signature on page 7',exact:true})
  await placement.focus();await expect(page.getByRole('tooltip',{name:'Place field',exact:true})).toBeVisible();await shot('field-tooltip');await placement.blur()
  await shot('page-seven-fields')
  await approvePacket(h.owner,request.id)
  await page.reload()
  const pkg=await click('Prepare signature package')
  await page.getByRole('checkbox',{name:'I authorize this exact packet, recipients, fields and connection for this provider operation.'}).check()
  await click('Send approved packet')
  await expect(page.getByRole('status')).toContainText('Provider operation: sent')
  const sent=edge.requests.at(-1)
  expect(sent.documents[0].bytes).toEqual(source)
  expect(sent.body.recipients.carbonCopies[0].email).toBe('cc@example.test')
  const manifest=JSON.parse((await h.owner.state()).packages.find((p:any)=>p.id===pkg.packageId).manifest)
  expect(manifest.fields.every((f:any)=>f.page===7)).toBe(true)
  expect(manifest.fields.some((f:any)=>f.kind==='date')).toBe(true)
  expect((await agreement(h.owner,request.id)).status).toBe('out_for_signature')
  await shot('packet-provider-receipt')
 }finally{await product.close()}
 }
})
