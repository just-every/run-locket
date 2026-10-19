import { test, expect } from '@playwright/test'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'

test.use({ locale: 'en-US', timezoneId: 'America/New_York' })
let websiteServer: Server, websiteOrigin: string
test.beforeAll(async () => {
  websiteServer = createServer((_request, response) => { response.setHeader('content-type','text/html'); response.end(`<main><h1>Customer website</h1><div id="terms"></div><script src="${origin}/api/locket/clickwrap/embed.js"></script></main>`) })
  await new Promise<void>(resolve => websiteServer.listen(0,'127.0.0.1',resolve))
  const address = websiteServer.address() as { port: number }
  websiteOrigin = `http://127.0.0.1:${address.port}`
})
test.afterAll(async () => { await new Promise<void>((resolve,reject) => websiteServer.close(error => error ? reject(error) : resolve())) })

const origin = process.env.LOCKET_BASE_URL || 'http://127.0.0.1:8787'
for (const width of [1440,390]) {
  test(`SIGN-004 counsel publishes, website embed prompts again, and acceptance browser exports at ${width}px`, async ({page,browser}) => {
    const entry=process.env.LOCKET_OPEN, key=process.env.CLICKWRAP_SIGNING_KEY
    if(!entry || !key) throw Error('This journey requires the private local owner entry and configured clickwrap signing key.')
    await page.setViewportSize({width,height:1000})
    await page.goto(entry)
    await page.waitForURL(url=>!url.hash.includes('rer-dev') && ['/app','/setup'].includes(url.pathname))
    if(new URL(page.url()).pathname==='/setup') {await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Finish setup',exact:true}).click();await page.waitForURL(url=>url.pathname==='/app')}
    await page.goto(origin+'/app#library')
    await expect(page.getByRole('heading',{name:'Library',exact:true})).toBeVisible()
    if(process.env.LOCKET_SCREENSHOTS) {await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.locator('.lk-titlebar').screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-clickwrap-library-entry.png`)})}
    await page.getByRole('link',{name:'Published terms and clickwrap acceptance',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Published terms',exact:true})).toBeVisible()
    const tag=randomUUID().slice(0,8), title=`Website terms ${width} ${tag}`, email=`customer-${width}-${tag}@example.test`
    const authoring=page.locator('details').filter({has:page.locator('summary',{hasText:/^Publish new terms$/})})
    if(!await authoring.evaluate(element=>(element as HTMLDetailsElement).open)) await authoring.locator('summary').click()
    await page.getByLabel('Terms name',{exact:true}).fill(title)
    await page.getByLabel('Terms type',{exact:true}).selectOption('tos')
    await page.getByLabel('Customer website origin',{exact:true}).fill(websiteOrigin)
    await page.getByLabel('Terms text',{exact:true}).fill('Customer terms: service fees are payable within 30 days.')
    if(process.env.LOCKET_SCREENSHOTS) await authoring.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-clickwrap-authoring.png`)})
    const partyName=`Website customer ${tag} Inc.`
    const partyResponse=await page.request.post(origin+'/api/locket/commands',{headers:{origin},data:{commandId:randomUUID(),type:'party.save',payload:{name:partyName,kind:'customer'}}})
    const partyResult=await partyResponse.json();expect(partyResult.ok).toBe(true)
    const partyId=partyResult.result.id
    await page.getByRole('button',{name:'Publish version 1',exact:true}).click()
    await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible()
    const state=await (await page.request.get(origin+'/api/locket/state')).json()
    const terms=state.clickwrapTerms.find((t:any)=>t.name===title)
    const assertion=(version:any)=>{
      const payload={installationOrigin:origin,siteOrigin:websiteOrigin,termsId:terms.id,versionId:version.id,digest:version.digest,signerId:'website-customer-'+width,email,nonce:randomUUID(),issuedAt:Date.now()-1000,expiresAt:Date.now()+120000}
      const body=Buffer.from(JSON.stringify(payload)).toString('base64url')
      return body+'.'+createHmac('sha256',key).update(body).digest('base64url')
    }
    const v1=state.clickwrapVersions.find((v:any)=>v.id===terms.current_version_id)
    if(process.env.LOCKET_SCREENSHOTS) {await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-clickwrap-published.png`),fullPage:true})}
    // This is a fixture website page, loading the real published embed. The
    // fresh context has no Locket membership or session, including on review.
    const customer=await browser.newContext({viewport:{width,height:1000},locale:'en-US',timezoneId:'America/New_York'})
    try {
      // Authorize only the local checkout gate, without a Locket account/session.
      await customer.addCookies((await page.context().cookies(origin)).filter(cookie=>cookie.name.startsWith('rer_dev_gate')))
      expect((await customer.request.get(origin+'/api/locket/state')).status()).toBe(401)
      const signedOut=await customer.newPage()
      await signedOut.goto(origin+'/api/locket/clickwrap/terms/'+terms.id)
      await expect(signedOut).toHaveURL(url=>url.pathname==='/signin' && url.searchParams.get('returnTo')==='/api/locket/clickwrap/terms/'+terms.id)
      await signedOut.close()
      const website=await customer.newPage()
      async function openReview(version:any) {
        await website.goto(websiteOrigin)
        await website.waitForFunction(()=>Boolean((window as any).LocketClickwrap))
        await website.evaluate(({termsId,identity})=>(window as any).LocketClickwrap.mount(document.querySelector('#terms'),{termsId,identity}),{termsId:terms.id,identity:assertion(version)})
        const opened=customer.waitForEvent('page')
        await website.getByRole('link',{name:'Review and accept terms',exact:true}).click()
        const review=await opened
        await expect(review.getByRole('heading',{name:title,exact:true})).toBeVisible()
        return review
      }
      let review=await openReview(v1)
      await expect(review.locator('#identity')).toContainText('Site-asserted identity (not identity-proofed)')
      await expect(review.getByRole('button',{name:'Accept',exact:true})).toBeDisabled()
      await review.getByRole('checkbox').check();await review.getByRole('button',{name:'Accept',exact:true}).click()
      await expect(review.getByRole('status')).toContainText('Accepted version 1.')
      expect(new URL(review.url()).hash).toBe('')
      await review.close()
      const already=await openReview(v1)
      await expect(already.getByRole('status')).toContainText('You have already accepted')
      await already.close()
      await page.locator('summary').filter({hasText:/^Publish next version$/}).click()
      await page.getByLabel('New terms text',{exact:true}).fill('Customer terms: service fees are payable within 45 days.')
      await page.getByRole('button',{name:'Publish next version',exact:true}).click()
      await expect(page.getByText('Version 2',{exact:true})).toBeVisible()
      const nextState=await (await page.request.get(origin+'/api/locket/state')).json()
      const v2=nextState.clickwrapVersions.find((v:any)=>v.terms_id===terms.id && v.number===2)
      review=await openReview(v2)
      await expect(review.getByRole('status')).toContainText('Review this version')
      await expect(review.getByRole('checkbox')).not.toBeChecked()
      if(process.env.LOCKET_SCREENSHOTS) await review.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-clickwrap-reaccept.png`),fullPage:true})
      await review.getByRole('checkbox').check();await review.getByRole('button',{name:'Accept',exact:true}).click()
      await expect(review.getByRole('status')).toContainText('Accepted version 2.')
      expect(await review.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
      if(process.env.LOCKET_SCREENSHOTS) await review.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-clickwrap-accepted.png`),fullPage:true})
      await review.close()
      await page.reload()
      await page.getByLabel('Search acceptances',{exact:true}).fill(email)
      await page.getByRole('button',{name:'Search acceptances',exact:true}).click()
      const evidence=page.locator('.lk-acceptance-browser')
      await expect(evidence.locator('[data-acceptance-id]')).toHaveCount(2)
      const firstVersion=evidence.locator('[data-acceptance-id]').filter({has:page.getByText(title+' · Version 1',{exact:true})})
      await firstVersion.getByLabel('Link to counterparty',{exact:true}).selectOption(partyId)
      await firstVersion.getByRole('button',{name:'Link counterparty',exact:true}).click()
      await expect(firstVersion.getByText('Counterparty: '+partyName,{exact:true})).toBeVisible()
      await firstVersion.locator('summary').filter({hasText:/^Captured evidence$/}).click()
      const exportEvent=page.waitForEvent('download')
      await evidence.getByRole('link',{name:'Export acceptance CSV',exact:true}).click()
      const download=await exportEvent, csv=await readFile((await download.path())!,'utf8')
      expect(csv).toContain(v1.digest);expect(csv).toContain(v2.digest);expect(csv).toContain(email)
      expect(csv.trim().split('\r\n')).toHaveLength(3)
      const saved=(await (await page.request.get(origin+'/api/locket/clickwrap/acceptances?'+new URLSearchParams({q:email}))).json()).rows
      for(const r of saved) {expect(csv).toContain(String(r.accepted_at));expect(csv).toContain(r.page_shown)}
      expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
      if(process.env.LOCKET_SCREENSHOTS) await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-clickwrap-acceptances.png`),fullPage:true})
    } finally {await customer.close()}
  })
}
