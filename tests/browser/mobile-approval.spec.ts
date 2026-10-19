import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { file, pdf } from '../api/files.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })

for (const width of [1440, 390]) {
  test(`MOBILE-001 opens the received approval email, refuses a replaced version, approves the current version and uploads signed evidence at ${width}px`, async ({ page }) => {
    const product = await productPage(page, { width })
    const { h, origin, command, state } = product
    try {
      const tag = crypto.randomUUID().slice(0, 8)
      const approver = await h.invite(`approver-${tag}@example.test`, 'approver')
      const created = await command('request.create', { title: `Phone approval ${tag}`, type: 'nda', party: { name: `Counterparty ${tag}`, kind: 'customer' }, file: file('review.pdf', pdf(`Confidentiality ${tag}`)), text: `Confidentiality ${tag}` })
      let s = await state(), a = s.agreements.find((x: any) => x.id === created.id)
      await command('agreement.submit', { agreementId: a.id, version: a.version })
      await page.goto(`${origin}/app#agreement/${a.id}/review`)
      const email = page.getByRole('region', { name: 'Email approval link', exact: true })
      await email.getByLabel('Approval email recipient').selectOption(approver.id)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
      if (process.env.LOCKET_SCREENSHOTS) {
        await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
        await email.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-mobile-001-email-command.png`) })
      }
      const sentResponse = page.waitForResponse(r => r.url() === `${origin}/api/locket/commands` && r.request().method() === 'POST')
      await email.getByRole('button', { name: 'Email approval link', exact: true }).click()
      const sent = await (await sentResponse).json()
      expect(sent.ok, JSON.stringify(sent.error)).toBe(true)
      expect(sent.result.status).toBe('queued')
      expect(sent.mailReceipt.status).toBe('accepted')
      await expect(page.getByRole('status')).toContainText('The mail provider accepted the approval email')
      if (process.env.LOCKET_SCREENSHOTS) await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-mobile-001-provider-receipt.png`), fullPage: true })
      const received = h.mails.at(-1)
      const link = received.text.match(/https?:\/\/[^\s]+/)[0]
      expect(link).toBe(`${origin}/app#agreement/${a.id}/review`)
      expect(received.to).toEqual([`approver-${tag}@example.test`])
      await page.context().clearCookies()
      await page.context().addCookies(approver.cookie.split('; ').map((pair: string) => {
        const i = pair.indexOf('=')
        return { name: pair.slice(0, i), value: pair.slice(i + 1), url: origin, secure: true, httpOnly: true, sameSite: 'Lax' as const }
      }))
      await page.goto(link)
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Review findings', exact: true })).toBeVisible()
      await page.getByRole('navigation', { name: 'Agreement sections' }).getByRole('link', { name: 'Approvals', exact: true }).click()
      const route = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Approval route for v1', exact: true }) })
      await expect(route.getByRole('button', { name: 'Record decision', exact: true })).toBeVisible()
      s = await state(); a = s.agreements.find((x: any) => x.id === created.id)
      await command('version.upload', { agreementId: a.id, version: a.version, kind: 'counterparty', file: file('current.pdf', pdf(`Current confidentiality ${tag}`)), text: `Current confidentiality ${tag}` })
      await route.getByRole('button', { name: 'Record decision', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('the one you reviewed was replaced')
      await page.getByRole('button', { name: 'Reload records', exact: true }).click()
      const currentRoute = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Approval route for v2', exact: true }) })
      await expect(currentRoute).toBeVisible()
      const decisionResponse = page.waitForResponse(r => r.url() === `${origin}/api/locket/commands` && r.request().method() === 'POST')
      await currentRoute.getByRole('button', { name: 'Record decision', exact: true }).click()
      const decision = await (await decisionResponse).json()
      expect(decision.ok, JSON.stringify(decision.error)).toBe(true)
      s = await state(); a = s.agreements.find((x: any) => x.id === created.id)
      const v = s.versions.find((x: any) => x.id === a.current_version_id)
      expect(decision.result.versionDigest).toBe(v.digest)
      expect(s.approvals.find((x: any) => x.id === decision.result.id).actor_id).toBe(approver.id)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
      if (process.env.LOCKET_SCREENSHOTS) {
        await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-mobile-001-email-approval.png`), fullPage: true })
      }
      const pkg = await command('package.prepare', { agreementId: a.id, version: a.version, provider: 'docusign', recipients: [{ name: 'Alex', email: 'alex@example.test', action: 'sign' }] })
      s = await state(); a = s.agreements.find((x: any) => x.id === created.id)
      await command('package.sent', { agreementId: a.id, version: a.version, packageId: pkg.packageId, envelopeId: `ENV-${tag}` })
      await page.goto(`${origin}/app#agreement/${a.id}/execution`)
      await page.reload()
      const execution = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Record the signed agreement', exact: true }) })
      const signed = pdf(`Signed paper from phone files ${tag}`)
      await execution.getByLabel('Signed PDF', { exact: true }).setInputFiles({ name: 'phone-signed.pdf', mimeType: 'application/pdf', buffer: signed })
      await execution.getByLabel('Certificate of completion (as issued by the provider)').setInputFiles({ name: 'certificate.pdf', mimeType: 'application/pdf', buffer: pdf(`Provider certificate ${tag}`) })
      await execution.getByLabel('Executed on', { exact: true }).fill('2026-10-19')
      await execution.getByRole('checkbox').check()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
      if (process.env.LOCKET_SCREENSHOTS) await execution.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-mobile-001-file-upload.png`) })
      const executionResponse = page.waitForResponse(r => r.url() === `${origin}/api/locket/commands` && r.request().method() === 'POST')
      await execution.getByRole('button', { name: 'Record execution', exact: true }).click()
      const recorded = await (await executionResponse).json()
      expect(recorded.ok, JSON.stringify(recorded.error)).toBe(true)
      expect(recorded.result.status).toBe('reconciled')
      s = await state()
      const evidence = s.executions.find((x: any) => x.id === recorded.result.executionId)
      const downloaded = await approver.request(`/api/locket/files/${evidence.signed_artifact_id}`)
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(signed)
      await expect(page.getByRole('heading', { name: 'Execution evidence', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
      if (process.env.LOCKET_SCREENSHOTS) await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-mobile-001-signed-file.png`), fullPage: true })
    } finally {
      await product.close()
    }
  })
}
