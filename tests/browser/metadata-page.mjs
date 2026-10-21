import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { productPage } from './product-harness.mjs'
export async function metadataPage(page, width) {
  if (!process.env.LOCKET_METADATA_LIVE) return productPage(page, { width })
  const origin = process.env.LOCKET_BASE_URL
  await page.setViewportSize({ width, height: 1000 })
  await page.goto(process.env.LOCKET_OPEN)
  await page.waitForURL(url => !url.hash.includes('rer-dev') && ['/app','/setup'].includes(url.pathname))
  if (new URL(page.url()).pathname === '/setup') {
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/app')
  }
  const owner = {
    request: async (path, options = {}) => {
      const response = await page.request.fetch(origin + path, { method: options.method ?? 'GET', headers: { origin }, ...(options.body ? { data: options.body } : {}) })
      return { status: response.status(), json: () => response.json(), text: () => response.text(), headers: { get: key => response.headers()[key] }, arrayBuffer: async () => response.body() }
    },
    command: async (type, payload) => {
      const response = await page.request.post(origin + '/api/locket/commands', { headers: { origin }, data: { type, payload, commandId: randomUUID() } })
      const result = await response.json()
      assert.equal(result.ok, true, JSON.stringify(result.error))
      return result.result
    },
    state: async () => (await page.request.get(origin + '/api/locket/state')).json(),
  }
  return { owner, origin, close: async () => {} }
}
