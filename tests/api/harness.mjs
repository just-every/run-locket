// A real Worker (the Locket API and Base auth) on Miniflare with D1 and every
// migration applied. Each installation owns a temporary directory and closes it.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'
import { build } from 'esbuild'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

let bundled
async function worker() {
  bundled ??= (await build({ entryPoints: ['tests/api/worker.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022', external: ['node:*', 'cloudflare:*'], loader: { '.css': 'text', '.svg': 'text' }, logLevel: 'silent' })).outputFiles[0].text
  return bundled
}

async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  return port
}

export async function installation() {
  const root = await mkdtemp(join(tmpdir(), 'locket-api-'))
  const setup = randomBytes(32).toString('hex')
  // Production-shaped: local runtimes suppress mail, so invitation links leave
  // through the real Resend sender and are captured at the network edge.
  const origin = `https://127.0.0.1:${await freePort()}`, mails = []
  const script = await worker()
  const mf = new Miniflare({
    ...convertV4MiniflareOptions({
      host: '127.0.0.1', port: Number(new URL(origin).port), https: true, modules: true, script, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'],
      bindings: { AUTH_LOCAL: 'false', AUTH_ORIGIN: origin, OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: randomBytes(32).toString('hex'), SETUP_TOKEN: setup, MAIL_PROVIDER: 'resend', MAIL_FROM: 'auth@example.test', MAIL_API_KEY: 'test-only-key' },
      outboundService: async request => {
        if (request.url !== 'https://api.resend.com/emails') throw new Error('Unexpected test network destination')
        mails.push(await request.json())
        return Response.json({ id: `test-receipt-${mails.length}` })
      },
    }),
    resourcePersistencePath: root,
  })
  try {
    await mf.ready
    const db = await mf.getD1Database('DB')
    for (const file of (await readdir('migrations/core')).filter(n => n.endsWith('.sql')).sort()) {
      const sql = await readFile('migrations/core/' + file, 'utf8')
      await db.batch(unstable_splitSqlQuery(sql).map(q => db.prepare(q)))
    }
    const request = (path, { method = 'GET', body, as, headers = {} } = {}) =>
      mf.dispatchFetch(origin + path, { method, redirect: 'manual', headers: { origin, 'content-type': 'application/json', ...(as ? { cookie: as } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    const boot = await request('/auth/bootstrap', { method: 'POST', body: { token: setup, displayName: 'Olive Owner' } })
    assert.equal(boot.status, 303, await boot.text())
    const ownerCookie = boot.headers.getSetCookie().map(v => v.split(';')[0]).join('; ')
    const client = cookie => ({
      cookie,
      request: (path, opts = {}) => request(path, { as: cookie, ...opts }),
      async command(type, payload, opts = {}) {
        const res = await request('/api/locket/commands', { method: 'POST', as: cookie, body: { commandId: opts.commandId ?? randomUUID(), type, payload } })
        const body = await res.json()
        if (opts.error) {
          assert.equal(body.ok, false, `${type} should fail with ${opts.error}: ${JSON.stringify(body)}`)
          assert.equal(body.error.code, opts.error, JSON.stringify(body))
          return body
        }
        assert.equal(res.status, 200, `${type}: ${JSON.stringify(body)}`)
        return body.result
      },
      async state() {
        const res = await request('/api/locket/state', { as: cookie })
        assert.equal(res.status, 200)
        return res.json()
      },
    })
    const owner = client(ownerCookie)
    /** Invite through Base auth, accept through the emailed link, then give a Locket role. */
    async function invite(email, role) {
      const res = await owner.request('/auth/invite', { method: 'POST', body: { email, displayName: email.split('@')[0], role: 'member' } })
      assert.equal(res.status, 202, await res.text())
      const link = new URL(mails.at(-1).text.match(/https?:\/\/[^\s]+/)[0])
      assert.equal(link.origin, origin)
      const confirmed = await request('/auth/confirm', { method: 'POST', body: { token: link.searchParams.get('token') } })
      assert.equal(confirmed.status, 303, await confirmed.text())
      const person = client(confirmed.headers.getSetCookie().map(v => v.split(';')[0]).join('; '))
      const session = await (await person.request('/auth/session')).json()
      person.id = session.operator.id
      if (role) await owner.command('role.set', { operatorId: person.id, role })
      return person
    }
    return { mf, db, origin, request, owner, invite, async close() { await mf.dispose(); await rm(root, { recursive: true, force: true }) } }
  } catch (error) {
    await mf.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
