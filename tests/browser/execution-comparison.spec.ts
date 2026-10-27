import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { file, pdf } from '../api/files.mjs'
import { executionFieldsPdf } from '../api/execution-fields-fixture.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })

async function connection(page: any, width: number) {
  if (!process.env.LOCKET_EXECUTION_LIVE) return productPage(page, { width })
  const origin = process.env.LOCKET_BASE_URL
  const entry = process.env.LOCKET_OPEN
  if (!origin || !entry) throw Error('Live execution journey requires the private owner entry and installation origin.')
  await page.setViewportSize({ width, height: 1000 })
  await page.goto(entry)
  await page.waitForURL((url: URL) => !url.hash.includes('rer-dev') && ['/app', '/setup'].includes(url.pathname))
  if (new URL(page.url()).pathname === '/setup') {
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
    await page.waitForURL((url: URL) => url.pathname === '/app')
  }
  return {
    origin,
    state: async () => (await page.request.get(origin + '/api/locket/state')).json(),
    command: async (type: string, payload: object) => {
      const response = await page.request.post(origin + '/api/locket/commands', { headers: { origin }, data: { commandId: randomUUID(), type, payload } })
      const body = await response.json()
      expect(body.ok, JSON.stringify(body.error)).toBe(true)
      return body.result
    },
    close: async () => {},
  }
}

test(`AGENT-006 changed signed liability is visible and held until reasoned acceptance at 1440px/390px`, async ({ page }) => {
  for (const width of [1440, 390]) {
    const product = await connection(page, width)
    const { command, state, origin } = product
    const shot = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      if (process.env.LOCKET_SCREENSHOTS) {
        await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-agent-006-${name}.png`), fullPage: true })
      }
    }
    const click = async (label: string) => {
      const pending = page.waitForResponse(response => response.url() === origin + '/api/locket/commands' && response.request().method() === 'POST')
      await page.getByRole('button', { name: label, exact: true }).click()
      const body = await (await pending).json()
      expect(body.ok, JSON.stringify(body.error)).toBe(true)
      await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
      return body.result
    }
    try {
      const tag = randomUUID().slice(0, 8)
      const approvedText = `Agreement ${tag}. Liability cap is USD 100000.`
      const returnedText = approvedText.replace('100000', '1000000')
      const approved = pdf(approvedText), returned = pdf(returnedText)
      const request = await command('request.create', { title: `Northwind services agreement ${tag}`, type: 'nda', party: { name: `Northwind Technology Inc. ${tag}`, kind: 'customer' }, file: file('approved-liability.pdf', approved), text: approvedText })
      const agreement = async () => (await state()).agreements.find((a: any) => a.id === request.id)
      let a = await agreement()
      await command('agreement.submit', { agreementId: a.id, version: a.version })
      a = await agreement()
      await command('approval.decide', { agreementId: a.id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' })
      a = await agreement()
      const pkg = await command('package.prepare', { agreementId: a.id, version: a.version, provider: 'docusign', recipients: [{ name: 'Alex', email: 'alex@example.test', action: 'sign' }] })
      a = await agreement()
      await command('package.sent', { agreementId: a.id, version: a.version, packageId: pkg.packageId, envelopeId: `ENV-${tag}` })
      await page.goto(origin + `/app#agreement/${a.id}/execution`)
      await page.reload() // Public API fixture commands ran after the live app initially loaded.
      await page.getByLabel('Signed PDF', { exact: true }).setInputFiles({ name: 'returned-liability.pdf', mimeType: 'application/pdf', buffer: returned })
      await page.getByLabel('Certificate of completion (as issued by the provider)').setInputFiles({ name: 'certificate.pdf', mimeType: 'application/pdf', buffer: pdf(`Provider certificate ${tag}`) })
      await page.getByLabel('Executed on', { exact: true }).fill('2026-10-20')
      await page.getByRole('checkbox', { name: 'I checked that this signed file is the packaged document.' }).check()
      const recorded = await click('Record execution')
      expect(recorded.status).toBe('needs_review')
      const comparison = page.getByRole('region', { name: 'Signed document comparison' })
      await expect(comparison.getByRole('heading', { name: 'PDF text comparison' })).toBeVisible()
      await expect(comparison).toContainText('Approved page 1')
      await expect(comparison).toContainText('Returned page 1')
      await expect(comparison.locator('blockquote').filter({ hasText: 'Liability cap is USD 100000.' })).toBeVisible()
      await expect(comparison.locator('blockquote').filter({ hasText: 'Liability cap is USD 1000000.' })).toBeVisible()
      expect((await agreement()).status).toBe('out_for_signature')
      await shot('changed-cap-held')
      const reason = 'Reviewed the increased liability cap and accept the signed terms.'
      page.once('dialog', dialog => dialog.accept(reason))
      await click('Accept with reason')
      await expect(page.getByText(reason, { exact: false })).toBeVisible()
      expect((await agreement()).status).toBe('executed')
      await page.reload()
      await expect(page.getByRole('region', { name: 'Signed document comparison' })).toContainText('Liability cap is USD 1000000.')
      expect((await state()).executions.find((e: any) => e.id === recorded.executionId).resolution).toBe(reason)
      await shot('accepted-with-history')
    } finally {
      await product.close()
    }
  }
  await automaticRetrievalBrowserJourney(page)
  await executionFollowupBrowserJourney(page)
})


test(`AGENT-006 empty initials hold matching text and field evidence persists after acceptance at 1440px/390px`, async ({ page }) => {
  for (const width of [1440, 390]) {
    const product = await connection(page, width)
    const { command, state, origin } = product
    const shot = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      if (process.env.LOCKET_SCREENSHOTS) {
        await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-agent-006-fields-${name}.png`), fullPage: true })
      }
    }
    const click = async (label: string) => {
      const pending = page.waitForResponse(response => response.url() === origin + '/api/locket/commands' && response.request().method() === 'POST')
      await page.getByRole('button', { name: label, exact: true }).click()
      const body = await (await pending).json()
      expect(body.ok, JSON.stringify(body.error)).toBe(true)
      await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
      return body.result
    }
    try {
      for (const clean of [false, true]) {
        const tag = randomUUID().slice(0, 8)
        const text = `Agreement ${tag}. Liability cap is USD 100000.`
        const approved = await executionFieldsPdf(text)
        const returned = await executionFieldsPdf(text, { signature: 'present', initials: clean ? 'AP' : '' })
        const request = await command('request.create', { title: `Structured signing ${tag}`, type: 'nda', party: { name: `Customer ${tag}`, kind: 'customer' }, file: file('approved-fields.pdf', approved), text })
        const agreement = async () => (await state()).agreements.find((a: any) => a.id === request.id)
        let a = await agreement()
        await command('agreement.submit', { agreementId: a.id, version: a.version })
        a = await agreement()
        await command('approval.decide', { agreementId: a.id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' })
        a = await agreement()
        const pkg = await command('package.prepare', { agreementId: a.id, version: a.version, provider: 'docusign', recipients: [{ name: 'Alex', email: 'alex@example.test', action: 'sign' }] })
        a = await agreement()
        await command('package.sent', { agreementId: a.id, version: a.version, packageId: pkg.packageId, envelopeId: `ENV-${tag}` })
        await page.goto(origin + `/app#agreement/${a.id}/execution`)
        await page.reload()
        await page.getByLabel('Signed PDF', { exact: true }).setInputFiles({ name: 'returned-fields.pdf', mimeType: 'application/pdf', buffer: returned })
        await page.getByLabel('Certificate of completion (as issued by the provider)').setInputFiles({ name: 'certificate.pdf', mimeType: 'application/pdf', buffer: pdf(`Synthetic certificate ${tag}`) })
        await page.getByLabel('Executed on', { exact: true }).fill('2026-10-20')
        await page.getByRole('checkbox', { name: 'I checked that this signed file is the packaged document.' }).check()
        const result = await click('Record execution')
        expect(result.checks.find((c: any) => c.check === 'text').ok).toBe(true)
        expect(result.status).toBe(clean ? 'reconciled' : 'needs_review')
        const evidence = page.getByRole('region', { name: 'Signature and initials field evidence' })
        await expect(evidence.getByRole('heading', { name: 'Signature and initials fields' })).toBeVisible()
        await expect(evidence).toContainText('Customer.signature · page 1 · signature · value present, unverified')
        await expect(evidence).toContainText(`Customer.initials · page 1 · initials · ${clean ? 'value present, unverified' : 'empty'}`)
        expect((await agreement()).status).toBe(clean ? 'executed' : 'out_for_signature')
        await shot(clean ? 'present' : 'held')
        if (!clean) {
          const reason = 'Counsel reviewed the missing initials and accepts the separately supplied execution evidence.'
          page.once('dialog', dialog => dialog.accept(reason))
          await click('Accept with reason')
          await expect(page.getByText(reason, { exact: false })).toBeVisible()
          expect((await agreement()).status).toBe('executed')
          await page.reload()
          await expect(evidence).toContainText('Customer.initials · page 1 · initials · empty')
          await shot('accepted')
        }
        const execution = (await state()).executions.find((e: any) => e.id === result.executionId)
        expect(await (await page.request.get(origin + '/api/locket/files/' + execution.signed_artifact_id)).body()).toEqual(returned)
      }
    } finally { await product.close() }
  }
})

async function automaticRetrievalBrowserJourney(page: any) {
  const { team, library, outForSignature } = await import('../api/setup.mjs')
  for (const width of [1440,390]) {
    let signed:Buffer, failDownload=true
    const certificate=pdf('synthetic-locket-1 certificate')
    const product=await productPage(page,{width,bindings:{SIGNATURE_DOCUSIGN_TOKEN:'synthetic-locket-1'},outboundResponse:async(request:Request)=>{
      const path=new URL(request.url).pathname
      if(path.endsWith('/recipients'))return Response.json({signers:[{name:'Hana Park',email:'hana@harbour.example',status:'completed'},{name:'Olive Owner',email:'owner@example.test',status:'completed'}]})
      if(path.endsWith('/documents/combined'))return failDownload?new Response('Unavailable',{status:503}):new Response(signed)
      if(path.endsWith('/documents/certificate'))return new Response(certificate)
      return Response.json({envelopeId:decodeURIComponent(path.split('/').at(-1)!),status:'completed',completedDateTime:'2026-10-26T12:00:00Z'})
    }})
    try{
      const tm=await team(product.h),lib=await library(product.h,tm),{id,pkg}=await outForSignature(product.h,tm,lib)
      signed=Buffer.from(await(await product.owner.request('/api/locket/files/'+pkg.pdfArtifactId)).arrayBuffer())
      await product.command('signature.connection.configure',{provider:'docusign',baseUrl:'https://demo.docusign.net/restapi/v2.1',accountId:'synthetic-locket-1',version:0})
      await page.goto(product.origin+`/app#agreement/${id}/execution`)
      const railControl=page.getByRole('navigation',{name:'Locket'}).getByRole('link',{name:'Portfolio',exact:true})
      await railControl.focus()
      await expect(page.getByRole('tooltip',{name:'Open Portfolio',exact:true})).toBeVisible()
      await railControl.blur()
      await railControl.hover()
      await expect(page.getByRole('tooltip',{name:'Open Portfolio',exact:true})).toBeVisible()
      await page.mouse.move(0,0)
      const consent=page.getByRole('checkbox',{name:'Retrieve and reconcile this exact sent package from the connected Docusign account.'})
      await expect(consent).not.toBeChecked();await consent.check()
      await page.getByRole('button',{name:'Authorize retrieval',exact:true}).click()
      await expect(page.getByText('Provider returned HTTP 503',{exact:false})).toBeVisible()
      await expect(page.getByText('Unsigned. No executed file is recorded.',{exact:true})).toBeVisible()
      expect((await product.state()).agreements.find((a:any)=>a.id===id).status).toBe('out_for_signature')
      const shot=async(name:string)=>{
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
        if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-EXEC-002-${name}.png`),fullPage:true})}
      }
      await shot('retrying')
      const prior=(await product.state()).executionRetrievals.find((r:any)=>r.agreement_id===id)
      await page.getByRole('button',{name:'Cancel retrieval',exact:true}).click()
      await expect(page.getByRole('button',{name:'Authorize retrieval',exact:true})).toBeVisible()
      await expect(consent).not.toBeChecked()
      await shot('renewed-consent')
      await consent.check()
      await page.getByRole('button',{name:'Authorize retrieval',exact:true}).click()
      await expect(page.getByRole('button',{name:'Cancel retrieval',exact:true})).toBeVisible()
      const jobs=(await product.state()).executionRetrievals.filter((r:any)=>r.agreement_id===id)
      expect(jobs).toHaveLength(2)
      expect(jobs.find((r:any)=>r.id===prior.id).status).toBe('cancelled')
      const job=jobs.find((r:any)=>r.id!==prior.id)
      failDownload=false;await product.h.scheduled(job.next_attempt_at+1)
      await page.reload()
      await expect(page.getByText('Reconciled',{exact:true})).toHaveCount(2)
      await expect(page.getByRole('link',{name:'Signed PDF',exact:true})).toBeVisible()
      await expect(page.getByRole('link',{name:'Provider certificate',exact:true})).toBeVisible()
      expect((await product.state()).agreements.find((a:any)=>a.id===id).status).toBe('executed')
      await shot('reconciled')
    }finally{await product.close()}
  }
}

async function executionFollowupBrowserJourney(page:any) {
 const {followupProvider,prepareFollowupFixture}=await import('../api/execution-followup-journey.mjs')
 for(const width of [1440,390]){
  const edge=followupProvider(),product=await productPage(page,{width,...edge})
  try{
   const f=await prepareFollowupFixture(product.h,edge)
   await page.goto(product.origin+`/app#agreement/${f.id}/execution`)
   const section=page.getByRole('region',{name:'Execution follow-up actions'})
   await section.getByLabel('Execution action').selectOption('google-drive')
   await section.getByLabel('Destination folder ID').fill('synthetic-locket-folder')
   // The destination is configured through the public command used by Settings.
   await f.tm.owner.command('execution.destination.configure',{kind:'google-drive',accountId:'synthetic-locket-owner@example.test',revision:0})
   await page.reload()
   await section.getByLabel('Execution action').selectOption('google-drive')
   await section.getByLabel('Destination folder ID').fill('synthetic-locket-folder')
   await expect(section.getByText('Destination account:',{exact:false})).toContainText('synthetic-locket-owner@example.test')
   const consent=section.getByRole('checkbox',{name:'I authorize only this displayed action, exact package and destination.'})
   await expect(consent).not.toBeChecked();await consent.check()
   const shot=async(name:string)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-EXEC-002-${name}.png`),fullPage:true})}}
   await shot('filing-consent')
   await section.getByRole('button',{name:'Authorize separate action',exact:true}).click()
   await expect(section.getByText('Waiting',{exact:true})).toBeVisible()
   expect(edge.writes).toHaveLength(0)
   await f.tm.owner.command('execution.retrieval.authorize',f.base)
   await f.complete();await page.reload()
   await expect(section.getByText('Completed',{exact:true})).toBeVisible()
   await expect(section.getByText('"sha256":',{exact:false})).toBeVisible()
   expect(edge.writes.filter((w:any)=>w.kind==='google-drive')).toHaveLength(2)
   await shot('filed-outcome')
  }finally{await product.close()}
 }
}
