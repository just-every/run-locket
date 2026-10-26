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
import { builtinModules } from 'node:module'

let bundled
async function worker() {
  bundled ??= (await build({ entryPoints: ['tests/api/worker.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], target: 'es2022', external: ['node:*', 'cloudflare:*'], alias: Object.fromEntries(builtinModules.filter(n=>!n.startsWith('node:')).map(n=>[n,'node:'+n])), banner: { js: "import {createRequire} from 'node:module'; const require=createRequire('/locket-worker.mjs');" }, loader: { '.css': 'text', '.svg': 'text' }, logLevel: 'silent' })).outputFiles[0].text
  return bundled
}

async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  return port
}

export async function installation({ bindings = {}, mailResponse, outboundResponse } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'locket-api-'))
  const setup = randomBytes(32).toString('hex')
  // Production-shaped: local runtimes suppress mail, so invitation links leave
  // through the real Resend sender and are captured at the network edge.
  const origin = `https://127.0.0.1:${await freePort()}`, mails = []
  const script = await worker()
  const workerBindings = { AUTH_LOCAL: 'false', AUTH_ORIGIN: origin, OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: randomBytes(32).toString('hex'), SETUP_TOKEN: setup, MAIL_PROVIDER: 'resend', MAIL_FROM: 'auth@example.test', MAIL_API_KEY: 'test-only-key', ...bindings }
  const runtimeOptions = () => ({
    ...convertV4MiniflareOptions({
      host: '127.0.0.1', port: Number(new URL(origin).port), https: true, modules: true, script, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'],
      bindings: workerBindings,
      outboundService: async request => {
        if(outboundResponse && ((request.method==='GET'&&['api.resend.com','api.postmarkapp.com'].includes(new URL(request.url).hostname)) || ['api.hubapi.com','slack.com','hooks.slack.com','demo.docusign.net','www.docusign.net','api.hellosign.com'].includes(new URL(request.url).hostname) || /^api\.[a-z0-9-]+\.(adobesign|echosign|documents\.adobe)\.com$/.test(new URL(request.url).hostname) || ['PANTRY_ORIGIN','APPROVAL_NOOK_ORIGIN','SIGNATURE_INKWELL_ORIGIN'].some(key=>workerBindings[key]&&new URL(request.url).origin===workerBindings[key]) || ['www.googleapis.com','graph.microsoft.com'].includes(new URL(request.url).hostname)||/^(sandbox-)?quickbooks\.api\.intuit\.com$/.test(new URL(request.url).hostname) || new URL(request.url).origin===new URL(workerBindings.AI_BASE_URL??'https://api.openai.com/v1').origin || workerBindings.UPTIME_ORIGIN&&new URL(request.url).origin===workerBindings.UPTIME_ORIGIN || workerBindings.LINEN_ORIGIN&&new URL(request.url).origin===workerBindings.LINEN_ORIGIN))return outboundResponse(request)
        if(request.url==='https://api.postmarkapp.com/email'){
          const raw=await request.json();mails.push({...raw,from:raw.From,to:[raw.To],subject:raw.Subject,text:raw.TextBody,html:raw.HtmlBody});
          return mailResponse ? mailResponse(mails.at(-1)) : Response.json({ErrorCode:0,MessageID:`synthetic-locket-postmark-${mails.length}`})
        }
        if (request.url !== 'https://api.resend.com/emails') throw new Error('Unexpected test network destination')
        mails.push(await request.json())
        return mailResponse ? mailResponse(mails.at(-1)) : Response.json({ id: `test-receipt-${mails.length}` })
      },
    }),
    resourcePersistencePath: root,
  })
  const mf = new Miniflare(runtimeOptions())
  try {
    await mf.ready
    let db = await mf.getD1Database('DB')
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
    let owner = client(ownerCookie)
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
    async function signIn(email) {
      const sent = await request('/auth/magic-link', { method: 'POST', body: { email } })
      assert.equal(sent.status, 202)
      const link = new URL(mails.at(-1).text.match(/https?:\/\/[^\s]+/)[0])
      const confirmed = await request('/auth/confirm', { method: 'POST', body: { token: link.searchParams.get('token') } })
      assert.equal(confirmed.status, 303)
      return client(confirmed.headers.getSetCookie().map(v => v.split(';')[0]).join('; '))
    }
    return { mf, get db() { return db }, origin, request, get owner() { return owner }, set owner(value) { owner = value }, invite, signIn, mails, async rotateSessionSecret(secret) { workerBindings.SESSION_SECRET = secret; await mf.setOptions(runtimeOptions()); db = await mf.getD1Database('DB') }, async setTime(at) { workerBindings.TEST_NOW = String(at); await mf.setOptions(runtimeOptions()); db = await mf.getD1Database('DB') }, async scheduled(at) { const result = await (await mf.getWorker()).scheduled({ scheduledTime: new Date(at), cron: '0 * * * *' }); assert.equal(result.outcome, 'ok', JSON.stringify(result)) }, async close() { await mf.dispose(); await rm(root, { recursive: true, force: true }) } }
  } catch (error) {
    await mf.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
