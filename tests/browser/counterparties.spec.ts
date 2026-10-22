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
  const x=await erasureFixture(p.h),row=x.rows[x.held.id]
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
 }finally{await p.close()}
})
