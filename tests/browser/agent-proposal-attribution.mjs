import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { productPage } from './product-harness.mjs'
import { attributionFixture, attributionJourney } from '../agent-door/proposal-attribution.mjs'
import { autonomousPolicy, heldPolicy } from '../../node_modules/@runeditrun/rer/modules/agent-door/conformance/crypto.mjs'

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
    const both = async (screen, check) => {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await check()
        await shot(screen, width)
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
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
    await both('pending', () => expect(card).toContainText('Prepared by ' + label))
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
    await both('approved', async () => {
      await expect(card).toContainText('Prepared by ' + label)
      await expect(card).toContainText('Approved by ' + state.actor.name)
    })

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
    assert.equal(exported.records.lk_proposals.find(row => row.id === id).prepared_label, label)
    assert.ok(exported.records.lk_audit.some(row => row.command_id === binding.command_id && row.actor_name === label))
    await both('activity-and-export', async () => {
      await expect(page.locator(`[data-audit-id="${prepareRow.id}"]`)).toContainText(label)
      await expect(page.locator(`[data-audit-id="${decisionRow.id}"]`)).toContainText(state.actor.name)
    })
    const proposals = page.getByRole('navigation', { name: 'Locket', exact: true }).getByRole('link', { name: 'Proposals', exact: true })
    await proposals.focus()
    await expect(page.getByRole('tooltip', { name: 'Open Proposals', exact: true })).toBeVisible()
    await proposals.blur()
    await proposals.hover()
    await expect(page.getByRole('tooltip', { name: 'Open Proposals', exact: true })).toBeVisible()

    // A company-policy approval releases only preparation. A different native
    // person still decides the resulting intake from their own signed-in session.
    await f.client.adopt(heldPolicy())
    const held = await f.client.tool('locket.proposals.prepare', { ...args, idempotency_key: randomUUID(),
      payload: { ...args.payload, title: 'synthetic-locket-held-intake' },
      evidence: ['The source records supplier EIN 12-3456789.'], person_confirmed: true })
    assert.equal(held.result?.resultType, 'input_required')
    assert.equal((await f.state()).proposals.length, state.proposals.length)
    assert.equal((await f.client.decideApproval(held)).ok, true)
    state = await f.state()
    const heldProposal = state.proposals.find(row => JSON.parse(row.payload).title === 'synthetic-locket-held-intake')
    assert.equal(heldProposal.status, 'pending')
    assert.equal(heldProposal.decided_by, null)
    assert.equal(heldProposal.prepared_label, label)
    await f.command('role.set', { operatorId: f.colleague.id, role: 'requester' })
    const colleague = (await f.state()).operators.find(row => row.id === f.colleague.id)
    await context.clearCookies()
    await context.addCookies(f.colleague.cookie.split('; ').map(pair => {
      const separator = pair.indexOf('=')
      return { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: f.origin,
        secure: true, httpOnly: true, sameSite: 'Lax' }
    }))
    await page.goto(f.origin + '/app#proposals')
    const heldCard = page.locator('.lk-proposal').filter({ hasText: 'synthetic-locket-held-intake' })
    await both('held-pending', async () => {
      await expect(heldCard).toContainText('Prepared by ' + label)
      await expect(heldCard.getByRole('button', { name: 'Record decision', exact: true })).toBeVisible()
    })
    await heldCard.getByRole('button', { name: 'Record decision', exact: true }).click()
    await page.getByRole('button', { name: /^Approved 2$/ }).click()
    await both('colleague-approved', async () => {
      await expect(heldCard).toContainText('Prepared by ' + label)
      await expect(heldCard).toContainText('Approved by ' + colleague.name)
    })
    const decided = (await f.state()).proposals.find(row => row.id === heldProposal.id)
    assert.equal(decided.decided_by, colleague.id)
    assert.equal(decided.prepared_command_id, heldProposal.prepared_command_id)
    const finalArchive = await f.archive()
    assert.equal(finalArchive.records.lk_proposals.find(row => row.id === decided.id).decided_by, colleague.id)
    assert.ok(finalArchive.records.lk_audit.some(row => row.action === 'proposal.approve' && row.actor_id === colleague.id && row.actor_name === colleague.name))
    console.log('PROBE BASE-AGENT-008 held browser: signed-in policy approval -> pending intake; authorized colleague decision -> distinct human approver and original agent preparer at 1440 and 390')
    console.log('PROBE BASE-AGENT-008 browser: real MCP intake -> pending agent for person, signed-in browser decision and archive download preserve separate identities; proposal and activity screens recorded at 1440 and 390')
  } finally { await f.close(); await context.close() }
} finally { await browser.close() }
