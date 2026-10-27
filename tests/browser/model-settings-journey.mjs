// Real product screens and guarded Worker commands; only the provider edge is simulated.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { productPage } from './product-harness.mjs'
import { modelBindings, modelFake, modelFixture } from '../api/model-settings-fixture.mjs'

const browser = await chromium.launch({ headless: true, ...(process.env.LOCKET_CHROMIUM ? { executablePath: process.env.LOCKET_CHROMIUM } : {}), args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
try {
 for (const width of [1440, 390]) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true }), page = await context.newPage(), calls = []
  const p = await productPage(page, { width, bindings: { ...modelBindings, TEST_NOW: String(Date.parse('2026-10-17T16:00:00Z')) }, outboundResponse: modelFake(calls) })
  try {
   const f = await modelFixture(p.h)
   const shot = async name => {
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
    if (!fits) console.log(await page.evaluate(() => [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).map(e => ({ tag:e.tagName, class:e.className, right:e.getBoundingClientRect().right, text:e.textContent.slice(0,80) })).slice(0,15)))
    assert.equal(fits, true, `${name} fits ${width}`)
    if (process.env.LOCKET_SCREENSHOTS) {
     await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
     await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-model-${name}.png`), fullPage: true })
    }
   }
   await page.goto(p.origin + '/app#agreements')
   await page.locator('.lk-account summary').click()
   await page.getByRole('link', { name: 'Settings', exact: true }).click()
   await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
   const settings = page.getByRole('region', { name: 'AI and OCR settings', exact: true })
   await settings.getByLabel('Enable AI for this installation', { exact: true }).check()
   await settings.getByLabel('Model provider', { exact: true }).selectOption('anthropic')
   await settings.getByLabel('Exact model', { exact: true }).fill('synthetic-locket-1')
   await settings.getByLabel('My provider agreement prohibits training and retains no input or output', { exact: true }).check()
   await settings.getByLabel('OCR provider', { exact: true }).selectOption('document-ai')
   await settings.getByLabel('Input estimate (USD per million tokens)', { exact: true }).fill('2')
   await settings.getByLabel('Output estimate (USD per million tokens)', { exact: true }).fill('10')
   await settings.getByRole('button', { name: 'Save model settings', exact: true }).click()
   await expect(page.getByRole('region', { name: 'Live model evaluations', exact: true })).toContainText('anthropic · synthetic-locket-1')
   assert.equal((await p.state()).models.settings.ocrProvider, 'document-ai')
   await expect(page.getByRole('region', { name: 'Live model evaluations', exact: true })).toContainText('review: not evaluated')
   await shot('settings')
   const request = page.getByRole('region', { name: 'Model requests', exact: true }), records = page.getByRole('region', { name: 'Model output records', exact: true })
   await request.getByLabel('Agreement for model request', { exact: true }).selectOption(f.supplier.id)
   await request.getByLabel('I approve sending this version and its playbook for this request', { exact: true }).check()
   await expect(request.getByRole('button', { name: 'Run evaluated review', exact: true })).toBeDisabled()
   await p.h.owner.command('model.run', { agreementId: f.supplier.id, task: 'review', consent: true }, { error: 'EVALUATION_REQUIRED' })
   assert.equal(calls.length, 0)
   for (const task of ['review', 'extraction']) {
    await request.getByLabel('I approve sending this version and its playbook for this request', { exact: true }).check()
    await request.getByRole('button', { name: `Simulate ${task}`, exact: true }).click()
    const record = records.getByRole('article', { name: `${task} output record`, exact: true })
    await expect(record).toContainText('Provider simulation · proposed')
    await expect(record).toContainText('anthropic · synthetic-locket-1')
    await expect(record).toContainText('Prompt version (SHA-256)')
    await expect(record).toContainText(f.playbookId)
    await expect(record).toContainText('Input document digests')
    await expect(record).toContainText('Invoices are payable within 30 days.')
    await record.getByRole('button', { name: `Accept ${task} proposal record`, exact: true }).click()
    await expect(record).toContainText('Provider simulation · accepted')
    await expect(record).not.toContainText('Not accepted')
   }
   assert.equal(calls.length, 2)
   const usage = page.getByRole('region', { name: 'Monthly model usage', exact: true })
   await expect(usage).toContainText('2026-10 UTC')
   await expect(usage).toContainText('Live estimated cost: $0.0000 USD')
   await expect(usage).toContainText('Simulated estimated cost: $0.0140 USD')
   await expect(usage).toContainText('2,000 input tokens · 1,000 output tokens')
   await shot('records-and-usd')
   await settings.getByLabel('Disable AI for NDA', { exact: true }).check()
   await settings.getByRole('button', { name: 'Save model settings', exact: true }).click()
   await expect(settings.getByRole('button', { name: 'Save model settings', exact: true })).toBeEnabled()
   await request.getByLabel('Agreement for model request', { exact: true }).selectOption(f.nda.id)
   await request.getByLabel('I approve sending this version and its playbook for this request', { exact: true }).check()
   await request.getByRole('button', { name: 'Simulate review', exact: true }).click()
   await expect(page.getByRole('alert')).toContainText('AI is switched off')
   assert.equal(calls.length, 2)
   await shot('nda-refused')
   const agreements = page.getByRole('navigation', { name: 'Locket', exact: true }).getByRole('link', { name: 'Agreements', exact: true })
   await agreements.focus()
   await expect(page.getByRole('tooltip', { name: 'Open Agreements', exact: true })).toBeVisible()
   await shot('focus-tooltip')
   await agreements.blur(); await agreements.hover()
   await expect(page.getByRole('tooltip', { name: 'Open Agreements', exact: true })).toBeVisible()
   console.log(`PASS ${width}: owner provider and OCR settings, refused unevaluated review, simulated review and extraction records with acceptance, exact monthly USD, NDA switch-off, focus and hover tooltip`)
  } finally { await p.close(); await context.close() }
 }
} finally { await browser.close() }
