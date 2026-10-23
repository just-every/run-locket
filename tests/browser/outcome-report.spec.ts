import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { file, pdf } from '../api/files.mjs'

test.use({ignoreHTTPSErrors:true})
test('AGENT-009 compares months, exposes source records and selects scoped report recipients at 1440px/390px',async({page})=>{
 for(const width of [1440,390]){
 const p=await productPage(page,{width,bindings:{TEST_NOW:String(Date.parse('2026-10-20T12:00:00Z'))}})
 try{
  const {owner,h,origin}=p,viewer=await h.invite('synthetic-locket-report-viewer@example.test','viewer'),ownerId=(await owner.state()).actor.id
  const source=await owner.command('legacy.import',{title:'synthetic-locket outcome supplier',type:'supplier',party:{name:'synthetic-locket report supplier',kind:'supplier'},sourceSystem:'Authorized archive',sourceId:`synthetic-locket-outcome-${width}`,file:file('supplier.pdf',pdf('Supplier must provide an annual insurance certificate.')),text:'Supplier must provide an annual insurance certificate.',signed:true})
  const duty=await owner.command('obligation.add',{agreementId:source.id,description:'Annual supplier insurance certificate',ownerId,dueDate:'2026-08-20',recurrence:'none',citation:{quote:'Supplier must provide an annual insurance certificate.'}})
  await owner.command('obligation.update',{agreementId:source.id,obligationId:duty.id,action:'confirm'})
  const restricted=await owner.command('legacy.import',{title:'Confidential deletion assurance',type:'supplier',party:{name:'Private supplier',kind:'supplier'},restricted:true,sourceSystem:'Authorized archive',sourceId:`synthetic-locket-private-outcome-${width}`,file:file('private.pdf',pdf('Private supplier must return a destruction certificate.')),text:'Private supplier must return a destruction certificate.',signed:true})
  const privateDuty=await owner.command('obligation.add',{agreementId:restricted.id,description:'Confidential destruction certificate',ownerId,dueDate:'2026-08-21',recurrence:'none',citation:{quote:'Private supplier must return a destruction certificate.'}})
  await owner.command('obligation.update',{agreementId:restricted.id,obligationId:privateDuty.id,action:'confirm'})
  await page.goto(origin+'/app#outcome-report/2026-09')
  const panel=page.getByRole('region',{name:'Monthly outcome report',exact:true})
  await expect(panel).toBeVisible()
  await panel.getByText('Attribute an obligation to the responsible side',{exact:true}).click()
  await panel.getByLabel('Obligation',{exact:true}).selectOption(duty.id)
  await panel.getByLabel('Responsible side',{exact:true}).selectOption('supplier')
  await panel.getByLabel('Citation review note',{exact:true}).fill('The signed clause names the supplier as the responsible party.')
  await panel.getByLabel('I checked the responsible side against the obligation’s cited agreement text.').check()
  await panel.getByRole('button',{name:'Record responsible side',exact:true}).click()
  await expect.poll(async()=> (await owner.state()).obligations.find((o:any)=>o.id===duty.id).responsible_side).toBe('supplier')
  await panel.getByText('Report recipients and read-only accounting consent',{exact:true}).click()
  const consent=panel.locator('details').filter({has:page.getByRole('button',{name:'Save report consent',exact:true})})
  await consent.getByLabel('Olive Owner',{exact:true}).check()
  await consent.getByLabel('synthetic-locket-report-viewer',{exact:true}).check()
  await consent.getByLabel('Send a generic report link each month',{exact:true}).check()
  await consent.getByRole('checkbox',{name:/I authorize these exact read-only sources/}).check()
  await consent.getByRole('button',{name:'Save report consent',exact:true}).click()
  await expect.poll(async()=>JSON.parse((await owner.state()).outcomeReports.settings.recipients)).toEqual(expect.arrayContaining([ownerId,viewer.id]))
  await panel.getByLabel('Report ending month',{exact:true}).fill('2026-09')
  await panel.getByRole('button',{name:'Read monthly report',exact:true}).click()
  const comparison=panel.getByRole('region',{name:'Outcome report comparison',exact:true})
  await expect(comparison.getByRole('table')).toBeVisible()
  await expect(comparison.getByRole('table').locator('tbody tr')).toHaveCount(12)
  const august=comparison.getByRole('row').filter({has:page.getByRole('rowheader',{name:'2026-08',exact:true})})
  await expect(august.getByRole('cell').first()).toContainText('2 records')
  await august.getByRole('cell').first().getByRole('link').click()
  const evidence=comparison.getByRole('region',{name:'Evidence for 2026-08',exact:true})
  await expect(evidence.getByRole('link',{name:'Annual supplier insurance certificate',exact:true}).first()).toHaveAttribute('href',`/app#agreement/${source.id}/terms`)
  await expect(comparison).toContainText('Recovery is unconfirmed')
  const send=panel.locator('form').filter({has:page.getByRole('button',{name:'Send this month’s report links once',exact:true})})
  await send.getByRole('checkbox',{name:/Send each selected recipient one generic link/}).check()
  const before=h.mails.length
  await send.getByRole('button',{name:'Send this month’s report links once',exact:true}).click()
  await expect.poll(()=>h.mails.length).toBe(before+2)
  await expect(panel.getByRole('region',{name:'Outcome report mail history',exact:true})).toContainText('mailbox delivery unconfirmed')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await panel.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-AGENT-009-outcomes.png`)})}
  const mail=h.mails.find(m=>m.to.includes('synthetic-locket-report-viewer@example.test')&&m.subject==='Your monthly Locket report is ready'),link=mail.text.match(/https?:\/\/[^\s]+/)[0]
  await page.context().clearCookies();await page.context().addCookies(viewer.cookie.split('; ').map(pair=>{const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:origin,secure:true,httpOnly:true,sameSite:'Lax' as const}}))
  await page.goto(link);await page.reload();await panel.getByRole('button',{name:'Read monthly report',exact:true}).click()
  await expect(comparison.getByRole('table').locator('tbody tr')).toHaveCount(12)
  await expect(august.getByRole('cell').first()).toContainText('1 records');await expect(panel).not.toContainText('Confidential destruction certificate')
  await expect(panel.getByText('Report recipients and read-only accounting consent',{exact:true})).toHaveCount(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  if(process.env.LOCKET_SCREENSHOTS)await panel.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-AGENT-009-recipient.png`)})
 }finally{await p.close()}
 }
})
