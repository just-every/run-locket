import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'

test.use({ ignoreHTTPSErrors: true })

test(`NOTIFY-001 / APPROVE-004 owner routing preserves personal delivery choices at 1440px and 390px`, async ({ page }) => {
  test.setTimeout(240_000)
  for (const width of [1440, 390]) {
  const product = await productPage(page, { width })
  const { h, origin, owner } = product
  try {
    const tag = randomUUID().slice(0, 8)
    const approver = await h.invite(`approver-${tag}@example.test`, 'approver')
    const viewer = await h.invite(`viewer-${tag}@example.test`, 'viewer')
    const personal = { timezone: 'America/Los_Angeles', digest: true, email: true, inApp: true }
    await approver.command('notification.preferences', personal)
    const initial = await owner.state()

    await page.goto(`${origin}/app`)
    await page.getByRole('navigation', { name: 'Locket', exact: true }).getByRole('link', { name: 'Activity', exact: true }).click()
    const preferences = page.getByRole('region', { name: 'Reminder preferences', exact: true })
    await preferences.getByLabel('Person', { exact: true }).selectOption(initial.actor.id)
    await expect(preferences.getByLabel('Time zone', { exact: true })).toBeEnabled()
    await expect(preferences.getByRole('checkbox', { name: /^Daily digest:/ })).toBeEnabled()

    await preferences.getByLabel('Person', { exact: true }).selectOption(approver.id)
    const timezone = preferences.getByLabel('Time zone', { exact: true })
    const digest = preferences.getByRole('checkbox', { name: /^Daily digest:/ })
    await expect(timezone).toBeDisabled()
    await expect(timezone).toHaveValue(personal.timezone)
    await expect(digest).toBeDisabled()
    await expect(digest).toBeChecked()
    await preferences.getByLabel('Approval delegate', { exact: true }).selectOption(initial.actor.id)
    await preferences.getByLabel('Alternate recipient', { exact: true }).selectOption(viewer.id)

    const saved = page.waitForResponse(response => response.url() === `${origin}/api/locket/commands` && response.request().method() === 'POST' && response.request().postDataJSON().type === 'preferences.set')
    await preferences.getByRole('button', { name: 'Save preferences', exact: true }).click()
    const reply = await (await saved).json()
    expect(reply.ok, JSON.stringify(reply.error)).toBe(true)
    await expect(preferences.getByRole('button', { name: 'Save preferences', exact: true })).toBeEnabled()
    expect((await approver.state()).notifications.preferences).toEqual(personal)
    const state = await owner.state()
    expect(state.approvalReminders.preferences.find((row: any) => row.operator_id === approver.id)).toMatchObject({
      timezone: personal.timezone, digest: 1, delegate_id: initial.actor.id, alternate_id: viewer.id,
    })
    await page.reload()
    await preferences.getByLabel('Person', { exact: true }).selectOption(approver.id)
    await expect(timezone).toBeDisabled()
    await expect(timezone).toHaveValue(personal.timezone)
    await expect(digest).toBeDisabled()
    await expect(digest).toBeChecked()
    await expect(preferences.getByLabel('Approval delegate', { exact: true })).toHaveValue(initial.actor.id)
    await expect(preferences.getByLabel('Alternate recipient', { exact: true })).toHaveValue(viewer.id)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    if (process.env.LOCKET_SCREENSHOTS) {
      await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-NOTIFY-001-APPROVE-004-personal-policy.png`), fullPage: true })
    }
  } finally {
    await product.close()
  }

  }
})
