import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { productPage } from './product-harness.mjs'
import { attributionFixture, attributionJourney } from '../agent-door/proposal-attribution.mjs'
import { autonomousPolicy } from '../../node_modules/@runeditrun/rer/modules/agent-door/conformance/crypto.mjs'

// The native journey covers both company policies; browser assertions run at
// desktop width, with the same changed screens also recorded on the phone.
await attributionJourney()
const browser = await chromium.launch({ headless: true,
  ...(process.env.LOCKET_CHROMIUM ? { executablePath: process.env.LOCKET_CHROMIUM } : {}),
  args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'],
})
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  const f = await attributionFixture(options => productPage(page, { ...options, width: 1440 }))
  try {
    const shot = async (screen, width) => {
      await page.setViewportSize({ width, height: 1000 })
      if (process.env.LOCKET_SCREENSHOTS) {
        await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-proposal-${screen}.png`), fullPage: true })
      }
    }
    const both = async screen => { await shot(screen, 1440); await shot(screen, 390); await page.setViewportSize({ width: 1440, height: 1000 }) }
    await f.client.adopt(autonomousPolicy())
    const args = { payload: { title: 'synthetic-locket-browser-intake', type: 'other',
      party: { name: 'synthetic-locket-browser', kind: 'supplier' } },
    evidence: ['synthetic-locket-browser request'], idempotency_key: randomUUID() }
    const prepared = await f.client.tool('locket.proposals.prepare', { ...args, prepared_by: 'synthetic-locket-forged', person_confirmed: true })
    assert.equal(prepared.result?.isError, false)
    const id = prepared.result.structuredContent.id
    let state = await f.state()
    const p = state.proposals.find(row => row.id === id), label = 'Agent door conformance for ' + state.actor.name
    assert.equal(p.prepared_label, label)
    assert.equal(p.status, 'pending')
    await page.goto(f.origin + '/app#proposals')
    await expect(page.getByRole('heading', { name: 'Proposals', exact: true })).toBeVisible()
    const card = page.locator('.lk-proposal').filter({ hasText: args.payload.title })
    await expect(card).toContainText('Prepared by ' + label)
    await expect(card.getByRole('button', { name: 'Record decision', exact: true })).toBeVisible()
    await both('pending')
    await card.getByLabel('Comment (optional)', { exact: true }).fill('Synthetic owner reviewed the intake')
    await card.getByRole('button', { name: 'Record decision', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Approved 1$/ })).toBeVisible()
    await page.getByRole('button', { name: /^Approved 1$/ }).click()
    await expect(card).toContainText('Prepared by ' + label)
    await expect(card).toContainText('Approved by ' + state.actor.name)
    await expect(card.getByRole('button', { name: 'Record decision', exact: true })).toHaveCount(0)
    state = await f.state()
    const approved = state.proposals.find(row => row.id === id)
    assert.equal(approved.decided_by, state.actor.id)
    assert.equal(approved.status, 'approved')
    assert.equal(approved.prepared_command_id, p.prepared_command_id)
    await both('approved')

    await page.goto(f.origin + '/app#activity')
    await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible()
    const prepareRow = state.audit.find(row => row.command_id === p.prepared_command_id)
    const decisionRow = state.audit.find(row => row.action === 'proposal.approve')
    await expect(page.locator(`[data-audit-id="${prepareRow.id}"]`)).toContainText(label)
    await expect(page.locator(`[data-audit-id="${decisionRow.id}"]`)).toContainText(state.actor.name)
    await expect(page.locator(`[data-audit-id="${decisionRow.id}"]`)).not.toContainText(label)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Export complete archive (JSON with files)', exact: true }).click(),
    ])
    const chunks = []
    for await (const chunk of await download.createReadStream()) chunks.push(chunk)
    const exported = JSON.parse(Buffer.concat(chunks).toString())
    const binding = exported.records.lk_proposal_agents.find(row => row.proposal_id === id)
    const agent = exported.records.lk_agent_commands.find(row => row.command_id === binding.command_id)
    assert.equal(agent.agent_name + ' for ' + agent.sponsor_name, label)
    assert.equal(exported.records.lk_proposals.find(row => row.id === id).decided_by, state.actor.id)
    assert.ok(exported.records.lk_audit.some(row => row.command_id === binding.command_id && row.actor_name === label))
    await both('activity-and-export')
    const proposals = page.getByRole('navigation', { name: 'Locket', exact: true }).getByRole('link', { name: 'Proposals', exact: true })
    await proposals.focus()
    await expect(page.getByRole('tooltip', { name: 'Open Proposals', exact: true })).toBeVisible()
    await proposals.blur()
    await proposals.hover()
    await expect(page.getByRole('tooltip', { name: 'Open Proposals', exact: true })).toBeVisible()
    console.log('PROBE BASE-AGENT-008 browser: real MCP intake -> pending agent for person, signed-in browser decision and archive download preserve separate identities; proposal and activity screens recorded at 1440 and 390')
  } finally { await f.close(); await context.close() }
} finally { await browser.close() }
