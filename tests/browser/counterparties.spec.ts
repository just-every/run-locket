import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { file, pdf } from '../api/files.mjs'
import { erasureFixture, erasureSubject } from '../api/erasure-fixture.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })
const quote = 'This agreement runs from January 1, 2026 to December 31, 2027.'
for (const width of [1440, 390]) {
  test(`REPO-010 records a counterparty's notice address and signatory, links three agreements, merges an intake duplicate and shows combined value and the next deadline at ${width}px`, async ({ page }) => {
    const p = await productPage(page, { width })
    try {
      const screenshot = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        if (process.env.LOCKET_SCREENSHOTS) {
          await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
          await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-repo-010-${name}.png`), fullPage: true })
        }
      }
      const kept = await p.command('party.save', { name: 'Acme Robotics, Inc.', kind: 'supplier' })
      const imported = (title: string, value: string) => p.command('legacy.import', { title, type: 'supplier', partyId: kept.id, value, sourceSystem: 'Shared drive', sourceId: `contracts/${title}.pdf`, signed: true, text: quote, file: file(`${title}.pdf`, pdf(`${title} ${quote}`)) })
      const msa = await imported('Acme MSA', '120000')
      await imported('Acme amendment 1', '50000')
      await p.command('request.create', { title: 'Acme spares order', type: 'nda', partyId: kept.id, value: '9000' })
      for (const [key, value] of [['effective_date', '2026-01-01'], ['end_date', '2027-12-31'], ['notice_days', '60'], ['auto_renew', 'no']]) {
        const term = await p.command('term.propose', { agreementId: msa.id, key, value, citation: { quote } })
        await p.command('term.decide', { agreementId: msa.id, termId: term.id, decision: 'confirm' })
      }

      // Intake creates a duplicate under a different spelling.
      await page.goto(p.origin + '/app#new')
      await page.reload()
      await page.getByLabel('Agreement title *', { exact: true }).fill('Acme gripper NDA')
      await page.getByLabel('Request type *', { exact: true }).selectOption('nda')
      await page.getByRole('radio', { name: 'New', exact: true }).check()
      await page.getByLabel('Name', { exact: true }).fill('ACME Robotics')
      await page.getByRole('radio', { name: 'Add later', exact: true }).check()
      await page.getByRole('button', { name: 'Create request', exact: true }).click()
      await expect(page.locator('.lk-doc-meta')).toContainText('ACME Robotics')

      // The kept record takes its notice address, method and signatory.
      await page.goto(`${p.origin}/app#counterparty/${kept.id}`)
      await page.reload()
      const details = page.getByRole('region', { name: 'Details', exact: true })
      await details.getByText('Edit counterparty', { exact: true }).click()
      await details.getByLabel('Entity type', { exact: true }).fill('Corporation')
      await details.getByLabel('State or country of formation', { exact: true }).fill('Delaware')
      await details.getByLabel('Tax ID', { exact: true }).fill('98-7654321')
      await details.getByLabel('Notice method', { exact: true }).selectOption('courier')
      await details.getByLabel('Notice address', { exact: true }).fill('General Counsel, 1 Market Street, San Francisco, CA 94105')
      await details.getByLabel('Authorized signatories', { exact: true }).fill('Jordan Diaz | jordan@acme.example | Chief Financial Officer')
      await details.getByRole('button', { name: 'Save counterparty', exact: true }).click()
      await expect(details).toContainText('General Counsel, 1 Market Street, San Francisco, CA 94105 by courier')
      await expect(details).toContainText('Jordan Diaz, Chief Financial Officer')
      await expect(page.locator('.lk-titlebar')).toContainText('EIN 98-7654321')

      // Merge the duplicate: its agreement moves here and the page shows the combined value and the next deadline.
      const mergePanel = page.getByRole('region', { name: 'Merge a duplicate', exact: true })
      await mergePanel.getByLabel('Duplicate counterparty', { exact: true }).selectOption({ label: 'ACME Robotics' })
      await mergePanel.getByLabel('Why they are the same *', { exact: true }).fill('Same Delaware corporation')
      await mergePanel.getByRole('button', { name: 'Merge into this counterparty', exact: true }).click()
      await expect(details).toContainText('Merged into this record: ACME Robotics (Same Delaware corporation)')
      const agreements = page.getByRole('region', { name: 'Agreements', exact: true })
      for (const title of ['Acme MSA', 'Acme amendment 1', 'Acme spares order', 'Acme gripper NDA']) await expect(agreements.getByRole('link', { name: title, exact: true })).toBeVisible()
      await expect(page.locator('[data-party-total]')).toHaveText('$170,000 USD')
      await expect(page.locator('[data-party-annual]')).toHaveText('$60,000 USD')
      await expect(page.locator('[data-party-deadline]')).toHaveText('Mon Nov 1, 2027, 11:59 pm ET')
      await screenshot('page')
    } finally {
      await p.close()
    }
  })
}

for(const width of [1440,390])test(`ERASE-001 verified contact erasure, counsel hold and explicit retention preview at ${width}px`,async({page})=>{
 const p=await productPage(page,{width})
 try{
  const counsel=await p.h.invite('synthetic-locket-counsel@example.test','counsel')
  const delegate=await p.h.invite('synthetic-locket-privacy@example.test','viewer')
  const x=await erasureFixture(p.h),row=x.rows[x.held.id]
  const switchTo=async(cookie:string)=>{await page.context().clearCookies();await page.context().addCookies(cookie.split('; ').map(pair=>{const at=pair.indexOf('=');return{name:pair.slice(0,at),value:pair.slice(at+1),url:p.origin,secure:true,httpOnly:true,sameSite:'Lax' as const}}))}
  const shot=async(name:string)=>{
   await page.evaluate(()=>window.scrollTo(0,0))
   await expect(page.locator('main')).toHaveAttribute('aria-busy','false')
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
   if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-ERASE-001-${name}.png`),fullPage:true})}
  }
  // The owner records a dated hold; active counsel must authorize its release.
  await page.goto(p.origin+'/app#agreement/'+x.held.id+'/details');await page.reload()
  const hold=page.getByRole('region',{name:'Legal hold',exact:true})
  await hold.getByLabel('Legal hold reason',{exact:true}).fill('Preserve litigation evidence')
  await hold.getByLabel('Legal hold review date',{exact:true}).fill('2026-10-21')
  await hold.getByRole('button',{name:'Set legal hold',exact:true}).click()
  await expect(hold).toContainText('Active: Preserve litigation evidence')
  await expect(hold).toContainText('Review overdue: 2026-10-21')
  await expect(hold).toContainText('Counsel must release this hold')
  await expect(hold.getByRole('button',{name:'Release legal hold',exact:true})).toHaveCount(0)
  await hold.getByText('Delete this unexecuted draft',{exact:true}).click()
  await hold.getByLabel('Draft deletion reason',{exact:true}).fill('Requested removal')
  await hold.getByRole('button',{name:'Delete draft and files',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('release the legal hold')
  await shot('held-deletion-refused')
  await page.goto(p.origin+'/app#counterparty/'+x.party.id);await page.reload()
  const authority=page.getByRole('region',{name:'Scoped privacy authority',exact:true})
  await authority.getByLabel('Privacy delegate',{exact:true}).selectOption(delegate.id)
  await authority.getByRole('checkbox').check()
  await authority.getByRole('button',{name:'Grant privacy authority',exact:true}).click()
  await expect(authority.getByRole('button',{name:'Revoke privacy authority',exact:true})).toBeVisible()
  await shot('scoped-authority')
  for(const partyId of [...new Set((await p.state()).agreements.map((a:any)=>a.party_id))])await p.command('privacy.scope',{partyId,operatorId:delegate.id,enabled:true})
  await switchTo(delegate.cookie)
  await page.reload()
  await expect(page.getByRole('region',{name:'Scoped privacy authority',exact:true})).toHaveCount(0)
  const erase=page.getByRole('region',{name:'Verified personal-data erasure',exact:true})
  await erase.getByLabel('How the request was verified',{exact:true}).selectOption('established_channel')
  await erase.getByLabel('Request received on',{exact:true}).fill('2026-10-20')
  await erase.getByLabel('Erasure reason',{exact:true}).selectOption('privacy_request')
  await erase.getByLabel('I verified this person’s erasure request.',{exact:true}).check()
  await shot('verified-request')
  await erase.getByRole('button',{name:'Preview erasure',exact:true}).click()
  await expect(erase.getByRole('heading',{name:'Erasure preview',exact:true})).toBeVisible()
  await expect(erase).toContainText('Nothing has been erased.')
  await expect(erase).toContainText('Preview fingerprint:')
  await expect(erase).toContainText(x.comment.commentId)
  await expect(erase).toContainText('Annual terms')
  await expect(erase).toContainText(x.heldComment.commentId)
  await expect(erase).toContainText('This person stays in current contacts because an agreement is held.')
  await expect(erase).toContainText('Preserve litigation evidence')
  await expect(erase).toContainText((await p.state()).actor.id)
  for(const draft of [x.keep,x.held,x.remove])for(const f of x.files[draft.id])await expect(erase).toContainText(f.id)
  expect((await p.state()).comments.find((c:any)=>c.id===x.comment.commentId).body).toContain(erasureSubject.email)
  await erase.getByLabel('Disposition for Cardinal confidentiality draft',{exact:true}).selectOption('business_retention')
  await erase.getByLabel('Disposition for Litigation confidentiality draft',{exact:true}).selectOption('legal_hold')
  await erase.getByLabel('Disposition for Unexecuted supplier draft',{exact:true}).selectOption('delete')
  await erase.getByLabel('I approve this exact preview and the draft dispositions above.',{exact:true}).check()
  await shot('exact-preview')
  await erase.getByRole('button',{name:'Confirm previewed erasure',exact:true}).click()
  await expect(erase.getByRole('heading',{name:'Erasure receipt',exact:true})).toBeVisible()
  await expect(erase.getByRole('status')).toContainText('Erasure confirmed.')
  await expect(erase).toContainText(x.heldComment.commentId)
  await expect(erase).toContainText('This person stays in current contacts because an agreement is held.')
  await expect(erase).toContainText('Preserve litigation evidence')
  await expect(erase).toContainText('Business retention')
  await expect(erase).toContainText(x.remove.id)
  await expect(page.getByRole('region',{name:'Details',exact:true})).toContainText('[erased person]')
  await shot('receipt')
  expect((await p.state()).agreements.some((r:any)=>r.id===x.remove.id)).toBe(false)
  await page.goto(p.origin+'/app#agreement/'+x.keep.id)
  await expect(page.locator('.lk-comments')).toContainText('[erased person] reviews the Annual terms')
  await expect(page.locator('.lk-comments')).not.toContainText(erasureSubject.email)
  await shot('comment-erased')
  await page.goto(p.origin+'/app#agreement/'+x.held.id)
  await expect(page.locator('.lk-comments')).toContainText('Ann · morgan@example.test · preserve this comment exactly.')
  await shot('held-comment-retained')
  await switchTo(p.h.owner.cookie)
  await counsel.command('hold.set',{agreementId:row.id,version:row.version,holdVersion:1,active:false,reason:'Preservation obligation concluded'})
  await p.h.setTime(Date.now()+3*86400000)
  await page.goto(p.origin+'/app#library');await page.reload()
  const retention=page.getByRole('region',{name:'Draft retention',exact:true})
  await retention.getByLabel('Draft retention days',{exact:true}).fill('1')
  await retention.getByRole('button',{name:'Save retention period',exact:true}).click()
  await expect(retention.getByRole('button',{name:'Preview expired drafts',exact:true})).toBeVisible()
  await p.h.scheduled((await p.state()).now)
  await page.goto(p.origin+'/app#notifications');await page.reload()
  await expect(page.getByRole('article',{name:'Expired draft needs owner review notification',exact:true})).toHaveCount(2)
  await shot('expiry-reminders')
  await page.goto(p.origin+'/app#library')
  await retention.getByRole('button',{name:'Preview expired drafts',exact:true}).click()
  await expect(retention).toContainText('2 expired drafts. Nothing has been deleted.')
  await expect(retention).toContainText('Cardinal confidentiality draft')
  await expect(retention).toContainText('Litigation confidentiality draft')
  await shot('retention-preview')
  await retention.getByLabel('Retention deletion reason',{exact:true}).fill('Reviewed expired unexecuted drafts')
  await retention.getByLabel('I approve deletion of exactly these drafts and files.',{exact:true}).check()
  await retention.getByRole('button',{name:'Approve previewed deletions',exact:true}).click()
  await expect(retention.getByText('2 expired drafts. Nothing has been deleted.',{exact:true})).toHaveCount(0)
  expect((await p.state()).agreements.some((r:any)=>r.id===x.keep.id||r.id===x.held.id)).toBe(false)
  await shot('retention-applied')
  // Synthetic migrated erasure whose address was absent before private blocks.
  await p.h.db.prepare("INSERT INTO lk_erasures(id,subject_token,reason,verification,requested_by,at,changed_records) VALUES(?,?,'legacy_verified_request','legacy_verified_request',?,?,1)").bind('synthetic-locket-history','synthetic-locket-history',(await p.state()).actor.id,Date.now()).run()
  await page.reload()
  const recovery=page.getByRole('region',{name:'Historical erasure recovery',exact:true})
  await expect(recovery).toContainText('Personal-data entry and imports are paused')
  await recovery.getByLabel('Verified original email',{exact:true}).fill('synthetic-locket-history@example.test')
  await recovery.getByRole('checkbox').check()
  await shot('historical-recovery')
  await recovery.getByRole('button',{name:'Restore private protection',exact:true}).click()
  await expect(recovery).toHaveCount(0)
  expect((await p.state()).erasureRecovery).toHaveLength(0)
  await shot('historical-protection-restored')
 }finally{await p.close()}
})


for(const width of [1440,390])test(`Connection health read-only failure and recovery at ${width}px`,async({page})=>{
 let failing=true
 const p=await productPage(page,{width,bindings:{HUBSPOT_ACCESS_TOKEN:'synthetic-locket-79',SIGNATURE_DOCUSIGN_TOKEN:'synthetic-locket-80'},outboundResponse:async request=>new URL(request.url).hostname==='api.hubapi.com'?Response.json({portalId:123456}):failing?Response.json({error:'synthetic-locket-81'},{status:401}):Response.json({accountId:'synthetic-locket-account'})})
 try{
  const now=Date.UTC(2026,9,25,12);await p.h.setTime(now)
  await p.command('signature.connection.configure',{provider:'docusign',baseUrl:'https://demo.docusign.net/restapi/v2.1',accountId:'synthetic-locket-account',version:0})
  const calendar=await p.command('calendar.connect',{provider:'google',calendarId:'synthetic-locket-calendar',accessToken:'synthetic-locket-82',scope:'all_accessible',consent:true})
  await page.goto(p.origin+'/app#connections');await page.reload()
  await expect(page.getByRole('region',{name:'calendar:'+calendar.id+' connection',exact:true})).toContainText('Google Calendar')
  const hubspot=page.getByRole('region',{name:'hubspot connection',exact:true})
  await hubspot.getByRole('button',{name:'Check connection',exact:true}).click()
  await expect(hubspot).toContainText('Healthy');await expect(hubspot).toContainText('123456')
  const panel=page.getByRole('region',{name:'docusign connection',exact:true})
  const shot=async(name:string)=>{await page.evaluate(()=>window.scrollTo(0,0));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-INT-004-${name}.png`),fullPage:true})}}
  await expect(panel).toContainText('Unverified')
  await panel.getByRole('button',{name:'Check connection',exact:true}).click()
  await expect(panel).toContainText('Credential rejected')
  await expect(panel).toContainText('Accepted by provider; delivery unconfirmed')
  await shot('failed')
  failing=false
  await panel.getByRole('button',{name:'Retry read-only check',exact:true}).click()
  await expect(panel).toContainText('Healthy')
  await expect(panel).toContainText('Read probe succeeded')
  await expect(panel).toContainText('synthetic-locket-account')
  for(const link of await page.getByRole('navigation',{name:'Locket',exact:true}).getByRole('link').all()){
   const label='Open '+await link.getAttribute('aria-label')
   await link.focus();await expect(page.getByRole('tooltip',{name:label,exact:true})).toBeVisible()
   await link.blur();await page.mouse.move(0,0);await link.hover()
   await expect(page.getByRole('tooltip',{name:label,exact:true})).toBeVisible({timeout:1000});await page.mouse.move(0,0)
  }
  await expect(panel).toContainText('Last successful operation')
  await panel.getByLabel('Credential expiry (UTC)',{exact:true}).fill('2026-10-27T12:00')
  await panel.getByLabel('I confirm this owner-recorded expiry change.',{exact:true}).check()
  await panel.getByRole('button',{name:'Save credential expiry',exact:true}).click()
  await expect(panel).toContainText('Renew within seven days.')
  await p.h.scheduled(now);await page.reload()
  await expect(page.getByRole('region',{name:'docusign connection',exact:true})).toContainText('Renewal alert: Accepted by provider; delivery unconfirmed')
  await shot('expiry-warning')
  await panel.getByLabel('I confirm this owner-recorded expiry change.',{exact:true}).check()
  await panel.getByRole('button',{name:'Clear recorded expiry',exact:true}).click()
  await expect(panel).toContainText('Expiry unknown; no automatic expiry claim.')
  await shot('recovered')
 }finally{await p.close()}
})

for(const width of [1440,390])test(`Workforce SAML sign-in, Counsel provisioning and immediate session refusal at ${width}px`,async({page})=>{
 const {workforceBindings,enableWorkforce,provision,scim,oktaFake}=await import('../api/workforce-fixture.mjs')
 const idp=await oktaFake()
 const p=await productPage(page,{width,bindings:{...workforceBindings,WORKFORCE_SAML_SSO_URL:idp.origin+'/sso'}})
 idp.setInstallation(p.h)
 try{
  await enableWorkforce(p.h);const user=await provision(p.h)
  await page.context().clearCookies()
  const shot=async(name:string)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-INT-003-${name}.png`),fullPage:true})}}
  await page.goto(p.origin+'/signin')
  const link=page.getByRole('link',{name:'Continue with workforce SSO',exact:true});await expect(link).toBeVisible();await link.focus();await shot('sign-in')
  await link.click();await expect(page.getByRole('button',{name:'Sign in with Okta fake'})).toBeVisible();await page.getByRole('button',{name:'Sign in with Okta fake'}).click()
  await expect(page).toHaveURL(p.origin+'/app',{timeout:15000});await page.reload();await expect(page.getByText('Synthetic Counsel',{exact:true}).first()).toBeVisible();expect(await page.evaluate(async()=>(await(await fetch('/api/locket/state')).json()).actor.role)).toBe('counsel');await shot('counsel-session')
  for(const link of await page.getByRole('navigation',{name:'Locket',exact:true}).getByRole('link').all()){
   const label='Open '+await link.getAttribute('aria-label');await link.focus();await expect(page.getByRole('tooltip',{name:label,exact:true})).toBeVisible();await link.blur();await page.mouse.move(0,0);await link.hover();await expect(page.getByRole('tooltip',{name:label,exact:true})).toBeVisible({timeout:1000});await page.mouse.move(0,0)
  }
  await shot('navigation-tooltips')
  const patch=await scim(p.h,'Users/'+user.id,{method:'PATCH',body:{Operations:[{op:'replace',path:'active',value:false}]}});expect(patch.status).toBe(200)
  const refused=await page.evaluate(async()=>{const response=await fetch('/api/locket/commands',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({commandId:crypto.randomUUID(),type:'request.create',payload:{}})});return response.status});expect(refused).toBe(401)
  await page.reload();await expect(page.getByText('Locket could not load your agreements. Sign in again if your session ended.',{exact:true})).toBeVisible();await shot('session-revoked')
 }finally{await page.close();await p.close();await idp.close()}
})
