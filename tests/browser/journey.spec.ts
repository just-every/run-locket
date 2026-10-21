import { test, expect, type Page, type Locator } from '@playwright/test'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pdf } from '../api/files.mjs'

const origin = process.env.LOCKET_BASE_URL || 'http://127.0.0.1:8787'
const shots = process.env.LOCKET_SCREENSHOTS
const panel = (page: Page, title: string) => page.locator('section, aside').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).last()

async function shot(page: Page, width: number, name: string) {
  if (!shots) return
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: join(shots, `${width}-${name}.png`), fullPage: true })
}
/** Submits a form through the real command door and waits for the saved state. */
async function submit(page: Page, scope: Locator, button: string) {
  const result = page.waitForResponse(r => r.url() === `${origin}/api/locket/commands` && r.request().method() === 'POST')
  await scope.getByRole('button', { name: button, exact: true }).click()
  const body = await (await result).json()
  expect(body.ok, JSON.stringify(body.error)).toBe(true)
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
  return body.result
}
async function expand(details: Locator) {
  if (!(await details.evaluate(d => (d as HTMLDetailsElement).open))) await details.locator('summary').click()
}
async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'page must not scroll sideways').toBeLessThanOrEqual(1)
}

for (const width of [1440, 390]) {
  test(`MOBILE-001 owner runs an agreement from request to renewal notice at ${width}px`, async ({ page }) => {
    const entry = process.env.LOCKET_OPEN
    if (!entry) throw new Error('Set LOCKET_OPEN privately to rer dev’s owner entry URL; this journey needs a real local installation.')
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    await page.setViewportSize({ width, height: 1000 })
    if (shots) {
      await mkdir(shots, { recursive: true })
      await page.goto(`${origin}/`)
      await page.screenshot({ path: join(shots, `${width}-lobby.png`), fullPage: true })
      await page.goto(`${origin}/signin`)
      await page.screenshot({ path: join(shots, `${width}-signin.png`), fullPage: true })
    }
    try {
      await page.goto(entry)
      await page.waitForURL(url => !url.hash.includes('rer-dev') && ['/app', '/setup'].includes(url.pathname))
    } catch { throw new Error('Owner entry failed; obtain a fresh local entry privately.') }
    if (new URL(page.url()).pathname === '/setup') {
      await shot(page, width, 'setup')
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
      await page.waitForURL(url => url.pathname === '/app')
    }
    const tag = `${width}-${crypto.randomUUID().slice(0, 6)}`

    // Library: an approved template and an active playbook.
    await page.goto(`${origin}/app#library`)
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()
    let scope = page.locator('details').filter({ hasText: 'New template' })
    await expand(scope)
    await scope.getByLabel('Name', { exact: true }).fill(`Supply ${tag}`)
    await scope.getByLabel('Type', { exact: true }).selectOption('supplier')
    await scope.getByLabel('Body', { exact: true }).fill('SUPPLY AGREEMENT\nBetween Olive Supply Co. and {{counterparty}}.\nGoods: {{goods}}.\n[[clause:liability]]\nThis agreement ends on June 30, 2027.')
    await scope.getByLabel('Fields', { exact: true }).fill('goods | Goods')
    await scope.getByLabel('Clauses', { exact: true }).fill('liability | Liability\ncap | Capped | Liability is capped at the fees paid in the prior 12 months.')
    await submit(page, scope, 'Save draft v1')
    await submit(page, page.locator('main'), 'Approve v1 for use')
    scope = page.locator('details').filter({ hasText: 'Draft a playbook version' })
    await expand(scope)
    await scope.getByLabel('Rules', { exact: true }).fill('liability | Limitation of liability | counsel\nPreferred: Liability capped at 12 months of fees.\nAlternative: Liability capped at 24 months of fees.')
    await submit(page, scope, 'Save playbook draft')
    await page.getByRole('button', { name: /^Activate v\d+$/ }).first().click()
    await expect(page.getByText(/v\d+ active/).first()).toBeVisible()
    await noOverflow(page)
    await shot(page, width, 'library')

    // Intake from the approved template.
    await page.goto(`${origin}/app#agreements`)
    await page.getByRole('link', { name: 'New request', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'New agreement request' })).toBeVisible()
    await page.getByLabel('Agreement title *').fill(`Harbor supply ${tag}`)
    await page.getByLabel('Request type *').selectOption('supplier')
    await page.getByLabel('Agreement value (USD)').fill('48000')
    await page.getByRole('radio', { name: 'New', exact: true }).check()
    await page.getByLabel('Name', { exact: true }).fill(`Harbor ${tag}`)
    await page.getByLabel('Template version').selectOption({ label: `Supply ${tag} v1` })
    await page.getByLabel('Goods *').fill('Packaging')
    await noOverflow(page)
    await shot(page, width, 'new-request')
    await submit(page, page.locator('main'), 'Create request')
    await page.waitForURL(url => url.hash.startsWith('#agreement/'))
    const agreementUrl = page.url().split('#')[0] + '#' + new URL(page.url()).hash.slice(1).split('/').slice(0, 2).join('/')

    // Versions: attach the required certificate, then submit.
    await expect(page.getByRole('heading', { name: 'Required attachments' })).toBeVisible()
    await page.locator('li').filter({ hasText: 'Certificate of insurance' }).locator('input[type=file]').setInputFiles({ name: 'coi.pdf', mimeType: 'application/pdf', buffer: pdf('Certificate of insurance') })
    await expect(page.getByText('Attached', { exact: true })).toBeVisible()
    await page.locator('li').filter({ hasText: 'Form W-9' }).locator('input[type=file]').setInputFiles({ name: 'w9.pdf', mimeType: 'application/pdf', buffer: pdf('Form W-9') })
    await expect(page.getByText('Attached', { exact: true })).toHaveCount(2)
    await submit(page, page.locator('main'), 'Submit for review')
    await expect(page.locator('.lk-subtitle').getByText('In review')).toBeVisible()
    await noOverflow(page)
    await shot(page, width, 'agreement-versions')

    // Review: a cited finding that needs counsel's exception.
    await page.getByRole('link', { name: 'Review', exact: true }).click()
    scope = panel(page, 'Record a finding on v1')
    await scope.getByLabel('Result').selectOption('breached')
    await scope.getByLabel('Exact passage').fill('Liability is capped at the fees paid in the prior 12 months.')
    await scope.getByLabel('Explanation').fill('Counterparty wants the cap removed; record for counsel.')
    await submit(page, scope, 'Record finding')
    await expect(page.locator('.lk-findings').getByText('Rule breached')).toBeVisible()
    await shot(page, width, 'agreement-review')

    // Approvals: owner records both decisions on the exact version.
    await page.getByRole('link', { name: 'Approvals', exact: true }).click()
    for (let i = 0; i < 2; i++) await submit(page, page.locator('.lk-route li').filter({ has: page.getByRole('button', { name: 'Record decision' }) }).first(), 'Record decision')
    await expect(page.locator('.lk-subtitle').getByText('Approved')).toBeVisible()
    await shot(page, width, 'agreement-approvals')

    // Signature: package and hand off to the existing provider.
    await page.getByRole('link', { name: 'Signature', exact: true }).click()
    scope = panel(page, 'Send for signature')
    await scope.getByLabel('Recipient 1 name').fill('Hana Park')
    await scope.getByLabel('Recipient 1 email').fill('hana@harbor.example')
    await submit(page, scope, 'Prepare signature package')
    await expect(page.getByRole('link', { name: 'Signature-ready PDF' })).toBeVisible()
    const pdfResponse = await page.request.get(origin + (await page.getByRole('link', { name: 'Signature-ready PDF' }).getAttribute('href')))
    expect((await pdfResponse.body()).subarray(0, 5).toString()).toBe('%PDF-')
    await page.getByLabel('Envelope ID').fill(`ENV-${tag}`)
    await submit(page, page.locator('main'), 'Mark sent')
    await expect(page.locator('.lk-subtitle').getByText('Out for signature')).toBeVisible()
    await shot(page, width, 'agreement-signature')

    // Execution: signed file and certificate reconcile.
    await page.getByRole('link', { name: 'Execution', exact: true }).click()
    scope = panel(page, 'Record the signed agreement')
    await scope.getByLabel('Signed PDF').setInputFiles({ name: 'signed.pdf', mimeType: 'application/pdf', buffer: await pdfResponse.body() })
    await scope.getByLabel('Certificate of completion (as issued by the provider)').setInputFiles({ name: 'Summary.pdf', mimeType: 'application/pdf', buffer: pdf(`Certificate ${tag}`) })
    await scope.getByLabel('Executed on').fill('2026-07-01')
    await scope.getByRole('checkbox').check()
    await submit(page, scope, 'Record execution')
    await expect(page.locator('.lk-subtitle').getByText('Executed')).toBeVisible()
    await expect(page.getByText(/matches the recorded handoff/)).toBeVisible()
    await shot(page, width, 'agreement-execution')

    // Terms: confirmed against the signed text, which opens a renewal.
    await page.getByRole('link', { name: 'Terms and obligations', exact: true }).click()
    for (const [key, value, quote] of [['end_date', '2027-06-30', 'This agreement ends on June 30, 2027.'], ['notice_days', '60', 'This agreement ends on June 30, 2027.']]) {
      scope = page.locator('details').filter({ hasText: 'Propose or correct a term' })
      await expand(scope)
      await scope.getByLabel('Term', { exact: true }).selectOption(key)
      await scope.getByLabel('Value', { exact: true }).fill(value)
      await scope.getByLabel('Words from the signed clause').fill(quote)
      await submit(page, scope, 'Propose term')
      await submit(page, page.locator('tr').filter({ hasText: 'Proposed' }).first(), 'Confirm')
    }
    await expect(page.getByText(/Notice deadline/).first()).toBeVisible()
    await shot(page, width, 'agreement-terms')

    // Renewals: decide, draft, approve, then record sending separately.
    await page.goto(`${origin}/app#renewals`)
    await page.getByRole('button', { name: `Harbor supply ${tag}` }).click()
    await submit(page, page.locator('main'), 'Record decision')
    scope = page.locator('details').filter({ hasText: 'Draft a notice' })
    await expand(scope)
    await scope.getByLabel('Recipient').fill('legal@harbor.example')
    await scope.getByLabel('Notice text').fill('We will renew on the existing terms.')
    await submit(page, scope, 'Save draft')
    await submit(page, page.locator('main'), 'Approve for sending')
    await expect(page.getByText('Approved, not sent')).toBeVisible()
    await page.getByLabel('Sent at').fill('2026-04-20T10:00')
    await submit(page, page.locator('main'), 'Record that it was sent')
    await expect(page.locator('.lk-card').getByText('Sent', { exact: true })).toBeVisible()
    await noOverflow(page)
    await shot(page, width, 'renewals')

    // Proposals: work prepared through the agent API, decided in the screen.
    await page.goto(`${origin}/app#proposals`)
    const agreementId = agreementUrl.split('/').pop()
    await page.evaluate(async id => {
      await fetch('/api/locket/commands', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId: crypto.randomUUID(), type: 'proposal.prepare', payload: { kind: 'terms', payload: { agreementId: id, terms: [{ key: 'governing_law', value: 'Delaware', citation: { quote: 'SUPPLY AGREEMENT' } }] }, evidence: ['Executed text, heading'], assumptions: 'Governing law is not stated; Delaware assumed from the parties.' } }) })
    }, agreementId)
    await page.reload()
    await expect(page.getByText('Terms and obligations').first()).toBeVisible()
    await shot(page, width, 'proposals')
    await submit(page, page.locator('main'), 'Record decision')
    await page.getByRole('button', { name: /^Approved/ }).click()
    await expect(page.getByText(/^Approved by/)).toBeVisible()

    // Imports: a DocuSign archive dry run, applied.
    await page.goto(`${origin}/app#imports`)
    const folder = await mkdtemp(join(tmpdir(), 'locket-archive-'))
    // Keep the documented report shape but use a fresh envelope identity so
    // rerunning this journey in its owned installation still imports one item.
    const sourceEnvelope = width === 1440 ? '3F2A9C10-5B7E-4D21-9A6B-1C2D3E4F5A60' : '7C1B2D3E-8F90-4A1B-BC2D-3E4F5A6B7C80'
    const envelope = crypto.randomUUID().toUpperCase()
    await mkdir(join(folder, envelope), { recursive: true })
    await writeFile(join(folder, envelope, 'Signed agreement.pdf'), pdf(`Archive agreement ${tag}`, 2))
    if (width === 1440) await writeFile(join(folder, envelope, 'Summary.pdf'), pdf(`Archive certificate ${tag}`))
    scope = panel(page, 'New DocuSign archive dry run')
    await scope.getByLabel('Batch name').fill(`Archive ${tag}`)
    await scope.getByLabel('Envelope report (CSV)').setInputFiles({ name: 'envelopes.csv', mimeType: 'text/csv', buffer: Buffer.from((await readFile('tests/fixtures/docusign-archive/envelopes.csv', 'utf8')).replaceAll(sourceEnvelope, envelope)) })
    await scope.getByLabel('Downloaded envelopes folder').setInputFiles(folder)
    // The fixture report is from an account that writes dates day first.
    await scope.getByLabel('Dates in the report are').selectOption('dmy')
    await submit(page, scope, 'Run dry run')
    await expect(page.getByText('To import', { exact: true })).toBeVisible()
    await submit(page, page.locator('main'), 'Apply this dry run (1 agreement)')
    await expect(page.getByText(/^Applied /)).toBeVisible()
    await noOverflow(page)
    await shot(page, width, 'imports')

    // Register, search and the agreement summary.
    await page.goto(`${origin}/app#agreements`)
    await page.getByRole('searchbox').fill(`Harbor supply ${tag}`)
    await expect(page.locator('.lk-board-card')).toHaveCount(1)
    await page.getByRole('searchbox').fill('')
    await expect(page.getByRole('link', { name: `Harbor supply ${tag}`, exact: true })).toBeVisible()
    await noOverflow(page)
    await shot(page, width, 'agreements')

    // Activity and people.
    await page.goto(`${origin}/app#activity`)
    await expect(page.getByRole('heading', { name: 'Activity log' })).toBeVisible()
    const activity = page.locator('.lk-activity-log')
    await activity.getByLabel('Agreement', { exact: true }).selectOption(agreementId!)
    await activity.getByLabel('Action', { exact: true }).selectOption('approval.approved')
    await activity.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await expect(activity).toHaveAttribute('aria-busy', 'false')
    await expect(activity.locator('[data-audit-id]').getByText('Approved', { exact: true }).first()).toBeVisible()
    await noOverflow(page)
    await shot(page, width, 'activity')
    expect(errors, errors.join('\n')).toEqual([])
  })
}

test.describe('Configurable intake forms', () => {
  test.use({ ignoreHTTPSErrors: true, actionTimeout: 15000, locale: 'en-US', timezoneId: 'America/New_York' })
for (const width of [1440, 390]) test(`INTAKE-002 supplier form previews, publishes, freezes routes and limits launching at ${width}px`, async ({ page }) => {
  const { metadataPage } = await import('./metadata-page.mjs')
  const { intakeFormJourney } = await import('./intake-form-journey.mjs')
  const p = await metadataPage(page, width)
  try { await intakeFormJourney(page, width, p) } finally { await p.close() }
})

})


test.describe('Request queue',()=>{
 test.use({ignoreHTTPSErrors:true,actionTimeout:15000,timezoneId:'America/New_York'})
 for(const width of [1440,390])test(`INTAKE-006 request assignment, cancellation and service levels at ${width}px`,async({page})=>{
  const {metadataPage}=await import('./metadata-page.mjs')
  const {queueJourney}=await import('./queue-journey.mjs')
  const p=await metadataPage(page,width)
  try{await queueJourney(page,width,p)}finally{await p.close()}
 })
})
