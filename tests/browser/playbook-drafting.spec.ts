import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { draftingFixture, draftingFake, modelBindings, topics } from '../api/playbook-drafting-fixture.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US' })

test('PLAY-002 counsel drafts from two templates and twenty executed agreements, reviews nine rules and approves eight for future supplier use', async ({ page }) => {
 test.setTimeout(240_000)
 const calls: any[] = [], p = await productPage(page, { width: 1440, bindings: modelBindings, outboundResponse: draftingFake(calls) })
 try {
  const f = await draftingFixture(p.h)
  await page.context().clearCookies()
  await page.context().addCookies(f.counsel.cookie.split('; ').map((pair: string) => {
   const i = pair.indexOf('=')
   return { name: pair.slice(0, i), value: pair.slice(i + 1), url: p.origin, secure: true, httpOnly: true, sameSite: 'Lax' as const }
  }))
  await page.goto(p.origin + '/app#library')
  const panel = page.getByRole('region', { name: 'Playbooks from templates and history', exact: true })
  await expect(panel).toBeVisible()
  const shot = async (name: string, target = panel) => {
   if (!process.env.LOCKET_SCREENSHOTS) return
   await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
   for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await target.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-playbook-drafting-${name}.png`) })
   }
   await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await panel.getByText('Choose sources and draft rules', { exact: true }).click()
  const form = panel.locator('form').first()
  for (const t of f.templates) await form.locator(`input[value="${t.versionId}"]`).check()
  for (const a of f.agreements) await form.locator(`input[value="${a.id}"]`).check()
  await form.getByRole('checkbox', { name: 'Supplier', exact: true }).check()
  await form.getByRole('checkbox', { name: 'I approve sending the selected templates, signed pages and recorded source observations to the displayed model for this request.', exact: true }).check()
  await expect(panel).toContainText('Playbook drafting: not evaluated')
  await shot('sources', form)
  await form.getByRole('button', { name: 'Draft simulated playbook rules', exact: true }).click()
  const draft = panel.getByRole('article', { name: /^Drafted playbook / })
  await expect(draft).toContainText('2 approved templates · 20 executed agreements')
  await expect(draft).toContainText('0 accepted · 0 edited · 0 rejected · 9 pending')
  expect(calls).toHaveLength(1)
  const before = await f.counsel.state()
  expect(before.playbooks.find((b: any) => b.status === 'active').id).toBe(f.source.id)
  await panel.getByText('Choose sources and draft rules', { exact: true }).click()
  const first = draft.getByRole('article', { name: 'Proposed rule topic0', exact: true })
  await first.getByText(/^Exact source citations/).click()
  await expect(first).toContainText('signed page 1')
  const sourceLink = first.getByRole('link', { name: 'Open cited signed original', exact: true }).first()
  const download = await f.counsel.request(await sourceLink.getAttribute('href'))
  expect(download.status).toBe(200)
  await shot('exact-evidence', first)
  await first.getByText(/^Exact source citations/).click()
  for (let i = 0; i < topics.length; i++) {
   const rule = draft.getByRole('article', { name: `Proposed rule topic${i}`, exact: true })
   await rule.getByText(`Review ${topics[i]}`, { exact: true }).click()
   await rule.getByLabel('Rule decision', { exact: true }).selectOption(i < 6 ? 'accept' : i < 8 ? 'edit' : 'reject')
   if (i === 6 || i === 7) {
    await rule.getByLabel('Preferred position', { exact: true }).fill(`Counsel edited ${topics[i]}: written approval required.`)
    await rule.getByLabel('Exception authority', { exact: true }).selectOption('counsel')
   }
   await rule.getByLabel('Rule decision reason', { exact: true }).fill(i < 6 ? 'Counsel reviewed exact cited originals.' : i < 8 ? 'Counsel amended wording and authority for the chosen scope.' : 'Counsel rejects this proposed position.')
   await rule.getByRole('button', { name: `Save ${topics[i]} decision`, exact: true }).click()
   await expect(rule).toContainText('Decision retained:')
   await rule.getByText(`Review ${topics[i]}`, { exact: true }).click()
  }
  await expect(draft).toContainText('6 accepted · 2 edited · 1 rejected · 0 pending')
  const review = draft.getByRole('article', { name: 'Proposed rule topic6', exact: true })
  await expect(review).toContainText('Counsel edited Renewal: written approval required.')
  await shot('counsel-decisions', review)
  await draft.getByRole('checkbox', { name: 'I reviewed every rule and its evidence, and approve publishing the accepted and edited wording to the shared playbook for this exact future scope.', exact: true }).check()
  await draft.getByLabel('Playbook approval reason', { exact: true }).fill('Publish these eight rules for future supplier agreements after reviewing all originals and unknown outcomes.')
  await draft.getByRole('button', { name: 'Approve new scoped playbook version', exact: true }).click()
  await expect(draft).toContainText('Approved by')
  await expect(draft.getByRole('button', { name: 'Approve new scoped playbook version', exact: true })).toHaveCount(0)
  const after = await f.counsel.state(), book = after.playbooks.find((b: any) => b.status === 'active')
  expect(JSON.parse(book.rules)).toHaveLength(8)
  expect(after.deviations.find((d: any) => d.id === f.agreements[0].finding.id).playbook_version_id).toBe(f.source.id)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await shot('approved-scope', draft.locator('p').last())
 } finally { await p.close() }
})
