import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pdf } from '../api/files.mjs'

test.use({ locale: 'en-US', timezoneId: 'America/New_York' })
const origin = process.env.LOCKET_BASE_URL || 'http://127.0.0.1:8787'
test(`DRAFT-003 indemnity fallback insertion and executed acceptance at 1440px and 390px`, async ({ page }) => {
  test.setTimeout(240_000)
  for (const width of [1440, 390]) {
    const entry = process.env.LOCKET_OPEN
    if (!entry) throw new Error('Set LOCKET_OPEN privately to the local owner entry URL.')
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(entry)
    await page.waitForURL(url => !url.hash.includes('rer-dev') && ['/app', '/setup'].includes(url.pathname))
    if (new URL(page.url()).pathname === '/setup') {
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
      await page.waitForURL(url => url.pathname === '/app')
    }
    const command = async (type: string, payload: object) => {
      const response = await page.request.post(`${origin}/api/locket/commands`, { headers: { origin }, data: { commandId: crypto.randomUUID(), type, payload } })
      const body = await response.json()
      expect(body.ok, JSON.stringify(body.error)).toBe(true)
      return body.result
    }
    const state = async () => (await page.request.get(`${origin}/api/locket/state`)).json()
    const tag = crypto.randomUUID().slice(0, 8)
    const preferred = `Each party indemnifies the other for negligence ${tag}.`
    const fallback = `Each party indemnifies the other for gross negligence ${tag}.`
    const template = await command('template.create', { name: `Indemnity ${tag}`, type: 'nda', body: 'NDA\n[[clause:indemnity]]', fields: [], clauses: [{ key: 'indemnity', title: `Indemnity ${tag}`, notes: 'Use mutual wording.', variants: [{ id: 'preferred', label: 'Preferred', text: preferred }, { id: 'fallback1', label: 'Fallback one', text: fallback, notes: 'Use when preferred is rejected.' }, { id: 'fallback2', label: 'Fallback two', text: `Indemnity for misconduct ${tag}.` }, { id: 'walk-away', label: 'Walk-away', text: `No indemnity ${tag}.` }] }] })
    await command('template.decide', { versionId: template.versionId, decision: 'approve' })
    const playbook = await command('playbook.draft', { rules: [{ key: 'indemnity', title: 'Mutual indemnity', preferred, alternatives: [fallback], authority: 'counsel' }] })
    await command('playbook.activate', { id: playbook.id })
    const request = await command('request.create', { title: `Clause negotiation ${tag}`, type: 'nda', party: { name: `Counterparty ${tag}`, kind: 'customer' }, templateVersionId: template.versionId, fields: {} })
    await page.goto(`${origin}/app#agreement/${request.id}`)
    await page.getByRole('button', { name: 'Add v2', exact: true }).click()
    const library = page.getByRole('region', { name: 'Approved clause library' })
    await library.getByRole('searchbox', { name: 'Search clauses by topic' }).fill(`indemnity ${tag}`)
    const row = library.locator('li').filter({ hasText: 'Fallback one' })
    await expect(row.getByText('Use when preferred is rejected.', { exact: false })).toBeVisible()
    await expect(row.getByText(/0 accepted/)).toBeVisible()
    if (process.env.LOCKET_SCREENSHOTS) {
      await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-draft-003-insertion.png`), fullPage: true })
    }
    await row.getByRole('button', { name: 'Choose Fallback one' }).click()
    await library.getByLabel('Passage to replace').fill(preferred)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    if (process.env.LOCKET_SCREENSHOTS) await library.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-draft-003-insertion-panel.png`) })
    const response = page.waitForResponse(r => r.url() === `${origin}/api/locket/commands` && r.request().method() === 'POST')
    await library.getByRole('button', { name: 'Insert clause into new version' }).click()
    const inserted = await (await response).json()
    expect(inserted.ok).toBe(true)
    await expect(page.getByText('Library wording in v2', { exact: true })).toBeVisible()
    await expect(page.locator('details').filter({ has: page.getByText('Library wording in v2', { exact: true }) }).getByText(new RegExp(template.versionId))).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    if (process.env.LOCKET_SCREENSHOTS) await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-draft-003-provenance.png`), fullPage: true })
    let s = await state(), a = s.agreements.find((x: any) => x.id === request.id)
    const version = s.versions.find((x: any) => x.id === a.current_version_id)
    expect(JSON.parse(version.fields).clauseLibrary[0].variantId).toBe('fallback1')
    await command('agreement.submit', { agreementId: a.id, version: a.version })
    s = await state(); a = s.agreements.find((x: any) => x.id === request.id)
    await command('approval.decide', { agreementId: a.id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' })
    s = await state(); a = s.agreements.find((x: any) => x.id === request.id)
    const pkg = await command('package.prepare', { agreementId: a.id, version: a.version, provider: 'docusign', recipients: [{ name: 'Alex', email: 'alex@example.test', action: 'sign' }] })
    s = await state(); a = s.agreements.find((x: any) => x.id === request.id)
    await command('package.sent', { agreementId: a.id, version: a.version, packageId: pkg.packageId, envelopeId: `ENV-${tag}` })
    s = await state(); a = s.agreements.find((x: any) => x.id === request.id)
    await command('execution.record', { agreementId: a.id, version: a.version, envelopeId: `ENV-${tag}`, executedOn: '2026-10-19', documentConfirmed: true, signers: [{ name: 'Alex', email: 'alex@example.test' }], signed: { filename: 'signed.pdf', base64: (await (await page.request.get(origin + '/api/locket/files/' + pkg.pdfArtifactId)).body()).toString('base64') }, certificate: { filename: 'certificate.pdf', base64: pdf(`Certificate ${tag}`).toString('base64') } })
    await page.goto(`${origin}/app#library`)
    await page.reload()
    await page.getByRole('searchbox', { name: 'Search clauses by topic' }).fill(`indemnity ${tag}`)
    const accepted = page.getByRole('region', { name: 'Approved clause library' }).locator('li').filter({ hasText: 'Fallback one' })
    await expect(accepted.getByText(/1 accepted/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    if (process.env.LOCKET_SCREENSHOTS) {
      await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-draft-003-clause-library.png`), fullPage: true })
      const authoring = page.locator('details').filter({ has: page.locator('summary', { hasText: /^New template$/ }) })
      await authoring.locator('summary').click()
      await authoring.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-draft-003-authoring.png`) })
    }

  }
})


test.describe('Word template authoring',()=>{
 test.use({ignoreHTTPSErrors:true})
 for(const width of [1440,390])test(`DRAFT-004 uploads Word, marks four fields and an optional paragraph, previews, approves and generates as requester at ${width}px`,async({page})=>{
  const {productPage}=await import('./product-harness.mjs'),{wordTemplateFixture,wordLineItems}=await import('../api/word-template-fixture.mjs')
  const product=await productPage(page,{width}),f=wordTemplateFixture()
  const shot=async(name:string)=>{if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-draft-004-${name}.png`),fullPage:true})}const overflowing=await page.evaluate(()=>[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>({tag:e.tagName,class:e.className,right:e.getBoundingClientRect().right})));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),JSON.stringify(overflowing)).toBe(true)}
  const click=async(scope:any,name:string)=>{const pending=page.waitForResponse(r=>r.url()===product.origin+'/api/locket/commands'&&r.request().method()==='POST');await scope.getByRole('button',{name,exact:true}).click();const body=await(await pending).json();expect(body.ok,JSON.stringify(body.error)).toBe(true);await expect(page.locator('main')).toHaveAttribute('aria-busy','false');return body.result}
  try{
   const requester=await product.h.invite('synthetic-locket-browser-requester@example.test','requester')
   await page.goto(product.origin+'/app#library')
   await page.getByText('Author a template from Word',{exact:true}).click()
   await page.getByLabel('Word template name',{exact:true}).fill('Firm NDA')
   await page.getByLabel('Word template type',{exact:true}).selectOption('nda')
   await page.getByLabel('Existing Word document',{exact:true}).setInputFiles({name:'firm-nda.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:f.source})
   const uploaded=await click(page,'Upload Word template')
   const editor=page.getByRole('region',{name:'Word template v1',exact:true})
   await expect(editor.getByLabel('Word source text',{exact:true})).toHaveValue(f.text)
   for(const mark of f.marks){
    await editor.getByLabel('Word source text',{exact:true}).evaluate((element:any,range:any)=>{element.focus();element.setSelectionRange(range.start,range.end);element.dispatchEvent(new Event('select',{bubbles:true}))},mark)
    await page.keyboard.press('Shift')
    await expect(editor.getByText('Selected: '+mark.quote,{exact:true})).toBeVisible()
    await editor.getByLabel('Mark kind',{exact:true}).selectOption(mark.kind)
    await editor.getByLabel('Field or clause name',{exact:true}).fill(mark.name)
    await editor.getByLabel('Field or clause label',{exact:true}).fill(mark.label)
    await click(editor,'Mark selection')
   }
   await expect(editor.getByRole('button',{name:'Remove Data processing',exact:true})).toBeVisible()
   await editor.getByText('Set repeating USD pricing table',{exact:true}).click()
   await click(editor,'Use pricing table')
   await expect(editor).toContainText('Repeating USD pricing table configured.')
   const fillPrices=async(scope:any)=>{for(let i=0;i<wordLineItems.length;i++){if(i)await scope.getByRole('button',{name:'Add line item',exact:true}).click();const item=wordLineItems[i];await scope.getByLabel(`Item ${i+1} description`,{exact:true}).fill(item.description);await scope.getByLabel(`Item ${i+1} quantity`,{exact:true}).fill(item.quantity);await scope.getByLabel(`Item ${i+1} unit price (USD)`,{exact:true}).fill(item.unitPrice)}}

   await shot('marked')
   const labels:Record<string,string>={firm:'Our firm *',customer:'Other party *',effective:'Effective date *',purpose:'Purpose *'}
   for(const[name,answer]of Object.entries(f.fields))await editor.getByLabel(labels[name],{exact:true}).fill(answer as string)
   await editor.getByLabel('Data processing wording',{exact:true}).selectOption('omit')
   await fillPrices(editor)
   await click(editor,'Preview Word document')
   const text=editor.getByLabel('Word preview text',{exact:true})
   await expect(text).toContainText('North & South LLP and Ridgeway Services')
   await expect(text).not.toContainText('Data processing requires')
   await expect(text).toContainText('1426.00')
   await expect(editor.getByRole('link',{name:'Download populated Word preview'})).toBeVisible()
   await shot('preview')
   await click(page,'Approve v1 for use')
   await expect(editor.getByRole('button',{name:'Mark selection',exact:true})).toHaveCount(0)
   await shot('approved')
   await page.context().clearCookies()
   await page.context().addCookies(requester.cookie.split('; ').map((pair:string)=>{const at=pair.indexOf('=');return{name:pair.slice(0,at),value:pair.slice(at+1),url:product.origin,secure:true,httpOnly:true,sameSite:'Lax' as const}}))
   await page.goto(product.origin+'/app#new')
   await page.getByLabel('Agreement title *',{exact:true}).fill('Requester NDA from Word')
   await page.getByLabel('Request type *',{exact:true}).selectOption('nda')
   await page.getByLabel('Name',{exact:true}).fill('Ridgeway Services')
   for(const[name,answer]of Object.entries(f.fields))await page.getByLabel(labels[name],{exact:true}).fill(answer as string)
   await page.getByLabel('Data processing wording',{exact:true}).selectOption('include')
   await fillPrices(page)
   const generated=await click(page,'Create request')
   await expect(page.getByRole('banner')).toContainText('Requester NDA from Word')
   const state=await product.state(),version=state.versions.find((v:any)=>v.id===generated.versionId)
   expect(version.text).toContain('Data processing requires written instructions.')
   expect(version.text).toContain('North & South LLP and Ridgeway Services')
   expect(version.template_version_id).toBe(uploaded.versionId)
   expect(JSON.parse(version.fields).pricing.totalCents).toBe(142600)
   const original=state.artifacts.find((a:any)=>a.version_id===generated.versionId&&a.role==='original')
   expect((await requester.request(`/api/locket/files/${original.id}`)).status).toBe(200)
   await shot('requester-generated')
   await page.getByRole('button',{name:'Add v2',exact:true}).click()
   const add=page.getByRole('region',{name:'Add v2',exact:true})
   await add.getByText('Attach signing PDF for v1',{exact:true}).click()
   const rendition=pdf(version.text)
   await add.getByLabel('PDF',{exact:true}).setInputFiles({name:'reviewed.pdf',mimeType:'application/pdf',buffer:rendition})
   await click(add,'Attach PDF')
   const withPDF=(await product.state()).versions.find((v:any)=>v.id===generated.versionId)
   expect(withPDF.digest).not.toBe(version.digest)
   await shot('signing-pdf')
   await add.getByText('Generate from an approved template',{exact:true}).click()
   const generator=add.locator('form').filter({has:page.getByRole('button',{name:'Generate version',exact:true})})
   for(const[name,answer]of Object.entries(f.fields))await generator.getByLabel(labels[name],{exact:true}).fill(answer as string)
   await fillPrices(generator)
   const revision=await click(generator,'Generate version')
   const revised=(await product.state()).versions.find((v:any)=>v.id===revision.versionId)
   expect(JSON.parse(revised.fields).pricing.totalCents).toBe(142600)
   await shot('regenerated')
  }finally{await product.close()}
 })
})
