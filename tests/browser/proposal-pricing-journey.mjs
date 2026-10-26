// The real product component and authenticated Worker show the accepted pricing at both required sizes.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { productPage } from './product-harness.mjs'

const output = process.env.LOCKET_SCREENSHOTS
if (!output) throw Error('Set LOCKET_SCREENSHOTS to an evidence directory outside the checkout.')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.env.LOCKET_CHROMIUM?{executablePath:process.env.LOCKET_CHROMIUM}:{}), args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
try {
  for (const provider of ['platter','pandadoc']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })
    const page = await context.newPage()
    const proposal = { id: 'synthetic-locket-1', revision: 1, status: 'accepted', title: 'Accepted customer service', clientName: 'Synthetic customer', currency: 'GBP', scope: 'Provide hosted services.', terms: 'Initial term 12 months. Start 2026-11-01.', options: [{ id: 'selected', cents: 67500, tables: [{ lines: [{ name: 'Service', description: 'Hosted seats', quantity: '1.5', unitPrice: '500.00', grossCents: 75000, lineTotalCents: 67500 }] }], optionalItems: [{ id: 'backup', label: 'Premium backup', unitCents: 10000, min: 1, max: 5, quantity: 1, editable: true }, { id: 'unused', label: 'Not selected', unitCents: 50000, min: 1, max: 1, quantity: 1, editable: false }] }], acceptance: { revision: 1, optionId: 'selected', totalCents: 97500, currency: 'GBP', selection: { optionId: 'selected', totalCents: 97500, items: [{ id: 'backup', label: 'Premium backup', quantity: 3, unitCents: 10000, totalCents: 30000 }] } } }
    const product = await productPage(page, { width, bindings: { PLATTER_ORIGIN: 'https://platter.example.test', PLATTER_TOKEN: 'synthetic-locket-1', PANDADOC_API_KEY:'synthetic-locket-2', TEST_NOW: '1793016000000' }, outboundResponse: async request => {
      if(provider==='pandadoc'){
        const path=new URL(request.url).pathname
        if(path.endsWith('/download-protected')){const {PDFDocument}=await import('pdf-lib');const doc=await PDFDocument.create();doc.addPage().drawText('Customer: Synthetic customer\n'+proposal.terms,{x:50,y:750,size:11,lineHeight:18});return new Response(await doc.save())}
        assert.equal(path,'/public/v1/documents/synthetic-locket-1/details')
        return Response.json({id:proposal.id,name:proposal.title,status:'document.completed',content_date_modified:'2026-10-26T12:00:00Z',recipients:[{id:'synthetic-locket-3',has_completed:true,recipient_type:'signer'}],grand_total:{amount:'1050.00',currency:'GBP'},pricing:{tables:[{currency:'GBP',is_included_in_total:true,total:'1050.00',items:[{name:'Service',description:'Hosted seats',price:'500.00',qty:'1.5',subtotal:'750.00',options:{}},{name:'Premium backup',price:'100.00',qty:'3',subtotal:'300.00',options:{optional:true,optional_selected:true}},{name:'Not selected',price:'500.00',qty:1,subtotal:'500.00',options:{optional:true,optional_selected:false}}]}]}})
      }
      assert.equal(new URL(request.url).pathname, '/api/platter/agent/context')
      return Response.json({ proposals: [proposal] })
    } })
    try {
      const imported = await product.command('proposal.import', { proposalId: proposal.id, consent: true, usdRate: '1.25',...(provider==='pandadoc'?{provider,customerName:'Synthetic customer',completedRecipientIds:['synthetic-locket-3']}:{}) })
      await page.goto(product.origin + `/app#agreement/${imported.id}/versions`)
      await page.getByRole('heading', { name: 'accepted-proposal.pdf', exact: true }).waitFor()
      const paper = page.locator('.lk-paper')
      await paper.getByText(new RegExp(`1.5 x GBP 500.00; net GBP ${provider==='pandadoc'?'750':'675'}.00`)).waitFor()
      assert.match(await paper.innerText(), /Premium backup/)
      assert.doesNotMatch(await paper.innerText(), /Not selected/)
      assert.match(await paper.innerText(), /recorded rate 1.25 USD per GBP/)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      const agreements = page.getByRole('navigation', { name: 'Locket', exact: true }).getByRole('link', { name: 'Agreements', exact: true })
      await agreements.focus()
      await page.getByRole('tooltip', { name: 'Open Agreements', exact: true }).waitFor()
      await page.screenshot({ path: join(output, `${width}-${provider}-pricing-document.png`), fullPage: true })
      await agreements.blur()
      await agreements.hover()
      await page.getByRole('tooltip', { name: 'Open Agreements', exact: true }).waitFor()
      await page.getByRole('link', { name: 'Details and access', exact: true }).click()
      await page.getByText('GBP', { exact: false }).first().waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      await page.screenshot({ path: join(output, `${width}-${provider}-pricing-details.png`), fullPage: true })
      console.log(`PASS ${provider} ${width}: accepted fractional and discounted pricing, selected optional item, recorded currency mapping, document and details, focus and hover tooltip`)
    } finally { await product.close(); await context.close() }
  }
} finally { await browser.close() }
