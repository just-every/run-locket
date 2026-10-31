import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

/** Compare the built, ordinary docs door with current MCP discovery. */
export default async function documentationJourney(c, { phase, surface }) {
  const listed = (await c.mcp('tools/list')).result.tools
  const templates = (await c.mcp('resources/templates/list')).result.resourceTemplates
  const prompts = (await c.mcp('prompts/list')).result.prompts
  const discovery = (await c.mcp('server/discover')).result
  for (const version of ['2026-07-28', '2025-11-25']) {
    const initialized = (await c.mcp('initialize', { protocolVersion: version, capabilities: {} }, { version })).result
    assert.equal(initialized.instructions, discovery.instructions)
  }
  const instructions = discovery.instructions
  assert.ok(instructions.includes(surface.specialist))
  assert.ok(instructions.includes('/docs/agents'))
  const named = [...instructions.matchAll(/^[^\n]+: (locket\.[\w.]+) — /gm)].map(match => match[1]).filter(name => !prompts.some(prompt => prompt.name === name))
  assert.deepEqual(named.sort(), listed.map(tool => tool.name).sort())
  const pageResponse = await c.request('/docs/agents')
  assert.equal(pageResponse.status, 200)
  assert.equal(pageResponse.headers.get('cache-control'), 'no-store')
  await pageResponse.body?.cancel()
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'],
  })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      assert.equal(url.origin, c.origin)
      const response = await c.request(url.pathname + url.search)
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) })
    })
    await page.goto(c.origin + '/docs/agents')
    await page.getByRole('heading', { name: 'Agent reference', exact: true }).waitFor()
    const rendered = await page.locator('main').evaluate(main => {
      const tools = [...main.querySelectorAll('p')].filter(p => p.firstElementChild?.tagName === 'CODE' && p.querySelector('strong')).map(p => ({
        name: p.firstElementChild.textContent,
        scope: p.nextElementSibling.querySelector('code').textContent,
        rows: [...p.nextElementSibling.nextElementSibling.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)),
      }))
      const section = name => {
        const heading = [...main.querySelectorAll('h2')].find(h => h.textContent === name)
        const nodes = []
        for (let node = heading.nextElementSibling; node && node.tagName !== 'H2'; node = node.nextElementSibling) nodes.push(node)
        return nodes
      }
      return { tools,
        resources: section('Resource templates').flatMap(node => [...node.querySelectorAll('code')].map(code => code.textContent)).filter(text => text.includes('://')),
        prompts: section('Specialist prompts').flatMap(node => [...node.querySelectorAll('code')].map(code => code.textContent)).filter(text => text.startsWith('locket.')),
        capacity: section('Capacity and protocol').map(node => node.textContent).join(' '),
        errors: section('Error recovery').flatMap(node => [...node.querySelectorAll('tbody tr td:first-child code')].map(code => code.textContent)),
        content: main.textContent,
      }
    })
    assert.deepEqual(rendered.tools.map(tool => tool.name).sort(), listed.map(tool => tool.name).sort())
    assert.deepEqual(rendered.resources.sort(), templates.map(item => item.uriTemplate).sort())
    assert.deepEqual(rendered.prompts.sort(), prompts.map(prompt => prompt.name).sort())
    for (const actual of rendered.tools) {
      const tool = listed.find(tool => tool.name === actual.name)
      assert.equal(actual.scope, tool._meta['com.runeditrun/scope'])
      assert.deepEqual(actual.rows.map(row => row[0]).sort(), [...tool._meta['com.runeditrun/classes']].sort())
      for (const [cls, ids, proof] of actual.rows) {
        const steps = surface.journey.filter(step => step.tool === actual.name && step.expect.some(item => item.class === cls))
        assert.ok(steps.length, 'Every documented class needs an executable native fixture')
        assert.deepEqual(ids.split(', '), steps.map(step => step.id))
        for (const step of steps) {
          assert.ok(proof.includes(`BASE-AGENT-006.2.autonomous.${step.id}`))
          assert.ok(proof.includes(`BASE-AGENT-006.2.held.${step.id}`))
        }
      }
      assert.ok(instructions.includes(`scope ${actual.scope}; possible classes ${tool._meta['com.runeditrun/classes'].join(', ')}`))
    }
    for (const value of Object.values(discovery._meta['com.runeditrun/limits'])) assert.ok(rendered.capacity.includes(String(value)))
    for (const code of ['policy_unset', 'policy_blocked', 'agents_paused', 'approval_required', 'capability_not_declared', 'rate_limited', 'revision_conflict', 'idempotency_conflict']) assert.ok(rendered.errors.includes(code))
    assert.ok(rendered.content.includes(surface.specialist))
    const layout = await page.locator('main').evaluate(main => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      smallText: [...main.querySelectorAll('p, td, th, code, a')].some(node => Number.parseFloat(getComputedStyle(node).fontSize) < 13),
      iconOnly: [...document.querySelectorAll('button, a')].some(node => !node.textContent.trim()),
    }))
    assert.deepEqual(layout, { overflow: false, smallText: false, iconOnly: false })
    if (process.env.RER_AGENT_PROOF_DIR && phase === 'autonomous') {
      await mkdir(process.env.RER_AGENT_PROOF_DIR, { recursive: true })
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.screenshot({ path: join(process.env.RER_AGENT_PROOF_DIR, `agent-reference-${width}.png`), fullPage: true })
      }
    }
    await context.close()
    console.log(`PROBE BASE-AGENT-013 docs ${phase}: built /docs/agents and MCP discovery -> exact tools, resource templates, prompts, scopes, class fixtures, limits and typed error guidance; readable browser page at 1440`)
  } finally { await browser.close() }
}
