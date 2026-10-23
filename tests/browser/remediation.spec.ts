import { test,expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { clauseSession } from './clause-session.mjs'
import { remediationFixture,certificate } from '../api/remediation-fixture.mjs'
test.use({ignoreHTTPSErrors:true})
for(const width of [1440,390])test(`Obligation owner approves a supplier request, rejects $1M and confirms matching $2M evidence at ${width}px`,async({page})=>{
 const p=await clauseSession(page,width,{bindings:{POSTMARK_INBOUND_SECRET:'synthetic-locket-81',POSTMARK_REPLY_DOMAIN:'replies.example.test'}})
 const shot=async(name:string)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-remediation-${name}.png`),fullPage:true})}}
 const save=async(type:string,button:any)=>{const pending=page.waitForResponse(response=>response.url()===p.origin+'/api/locket/commands'&&response.request().method()==='POST'&&response.request().postDataJSON().type===type);await button.click();const result=await(await pending).json();expect(result.ok,JSON.stringify(result.error)).toBe(true);return result.result}
 try{
  const x=await remediationFixture(p)
  await page.goto(`${p.origin}/app#agreement/${x.a.id}/terms`)
  await page.reload()
  const panel=page.getByRole('region',{name:'Obligation remediation',exact:true})
  await expect(panel).toContainText('Required: USD 2000000.00, Harbor Couriers')
  await panel.getByText('Prepare request and chase schedule',{exact:true}).click()
  const sendAt=Math.ceil((Date.now()+12000)/1000)*1000
  await panel.getByLabel('Recorded supplier contact email',{exact:true}).fill('broker@example.test')
  await panel.getByLabel('Send times in UTC, one per line (YYYY-MM-DDTHH:mm)',{exact:true}).fill(new Date(sendAt).toISOString().slice(0,19))
  await save('remediation.prepare',panel.getByRole('button',{name:'Prepare requests',exact:true}))
  await expect(panel).toContainText('at least USD 2000000.00 coverage, naming Harbor Couriers')
  await expect(panel).toContainText('1 maximum occurrence; no repeat.');await expect(panel).toContainText('Withdrawal, a recipient reply or opt-out stops every future occurrence.');await shot('approval')
  await save('remediation.approve',panel.getByRole('button',{name:'Approve every exact request and chase time',exact:true}))
  await expect.poll(()=>Date.now(),{timeout:20000,intervals:[250,1000]}).toBeGreaterThanOrEqual(sendAt)
  await save('remediation.send',panel.getByRole('button',{name:'Send approved occurrence now',exact:true}))
  await expect(panel).toContainText(process.env.LOCKET_CAMPAIGN_LIVE?'suppressed':'accepted')
  await panel.getByLabel('Returned evidence PDF',{exact:true}).setInputFiles({name:'insufficient-certificate.pdf',mimeType:'application/pdf',buffer:certificate('1000000')})
  await save('remediation.evidence',panel.getByRole('button',{name:'Check evidence',exact:true}))
  await expect(panel).toContainText('Evidence: rejected');await expect(panel).toContainText('Coverage is below the required USD 2000000.00')
  await expect(page.locator('.lk-obligations > li').filter({hasText:'Replace expired certificate'}).locator('.lk-badge').first()).toHaveText('Confirmed')
  await shot('rejected')
  await panel.getByLabel('Returned evidence PDF',{exact:true}).setInputFiles({name:'compliant-certificate.pdf',mimeType:'application/pdf',buffer:certificate('2000000')})
  await save('remediation.evidence',panel.getByRole('button',{name:'Check evidence',exact:true}))
  const proof=panel.getByRole('article').filter({hasText:'Evidence: needs_confirmation'})
  await expect(proof).toContainText('Matching PDF text does not verify the issuer')
  await expect(proof).toContainText('Matching text does not establish the issuer, authenticity or unstructured conditions.');await expect(proof).toContainText('Page 1:');
  await proof.getByRole('checkbox',{name:'I reviewed the original certificate, its issuer and conditions',exact:true}).check()
  await proof.getByLabel('Review reason and original page references',{exact:true}).fill('Reviewed the original issuer and conditions on page 1; the certificate satisfies the signed insurance requirement.')
  await shot('review')
  await save('remediation.confirm',proof.getByRole('button',{name:'Confirm unknown fields and complete',exact:true}))
  await expect(panel).toContainText('Evidence: confirmed')
  await expect(panel.getByRole('button',{name:'Check evidence',exact:true})).toHaveCount(0)
  await expect(page.locator('.lk-obligations > li').filter({hasText:'Replace expired certificate'}).locator('.lk-badge').first()).toHaveText('Done')
  await expect(panel.getByRole('link',{name:'Original evidence PDF'})).toHaveCount(2)
  await page.reload();await expect(panel).toContainText('Evidence: confirmed');await shot('done')
 }finally{await p.close()}
})
