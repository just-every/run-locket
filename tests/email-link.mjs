import {queuedEntrypoint} from '@runeditrun/rer/queued-entry';
const queued=await queuedEntrypoint(import.meta.url,'verify:email-link');if(queued!==null)process.exit(queued);
// Locket's one end-to-end email-link test: the emitted Worker claims the owner,
// mails a sign-in link through the real Resend sender (captured at the network
// edge; local runtimes suppress mail), and the link signs in through
// confirmation. Dev identity never replaces this path.
import assert from 'node:assert/strict'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const socket = createServer()
await new Promise(done => socket.listen(0, '127.0.0.1', done))
const port = socket.address().port
await new Promise(done => socket.close(done))
const origin = `https://127.0.0.1:${port}`, directory = await mkdtemp(join(tmpdir(), 'locket-email-link-'))
const server = resolve('dist/server'), config = JSON.parse(await readFile(join(server, 'wrangler.json'), 'utf8'))
const secret = () => randomBytes(32).toString('base64url'), owner = 'owner@example.test', setupToken = secret(), mails = []
const mf = new Miniflare({
  ...convertV4MiniflareOptions({
    host: '127.0.0.1', port, https: true, modulesRoot: server,
    modules: [config.main, ...(await readdir(join(server, 'assets'))).filter(file => file.endsWith('.js')).map(file => `assets/${file}`)].map(file => ({ type: 'ESModule', path: join(server, file) })),
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    assets: { directory: resolve('dist/client'), routerConfig: { has_user_worker: true } },
    d1Databases: { DB: 'locket-email-link' },
    bindings: { AUTH_LOCAL: 'false', AUTH_ORIGIN: origin, OWNER_EMAIL: owner, SESSION_SECRET: secret(), SETUP_TOKEN: setupToken, MAIL_PROVIDER: 'resend', MAIL_FROM: 'auth@example.test', MAIL_API_KEY: 'test-only-key' },
    outboundService: async request => {
      if (request.url !== 'https://api.resend.com/emails') throw new Error('Unexpected test network destination')
      mails.push(await request.json())
      return Response.json({ id: `test-receipt-${mails.length}` })
    },
  }),
  resourcePersistencePath: directory,
})
const call = (path, { method = 'GET', body, cookie } = {}) => mf.dispatchFetch(origin + path, { method, redirect: 'manual', headers: { ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
try {
  await mf.ready
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir('migrations/core')).filter(name => name.endsWith('.sql')).sort()) {
    await db.batch(unstable_splitSqlQuery(await readFile(join('migrations/core', file), 'utf8')).map(sql => db.prepare(sql)))
  }
  assert.equal((await call('/health')).status, 200, 'emitted Worker is healthy')
  assert.equal((await call('/auth/bootstrap', { method: 'POST', body: { token: setupToken, displayName: 'Owner' } })).status, 303, 'owner claimed')
  assert.equal((await call('/auth/magic-link', { method: 'POST', body: { email: owner } })).status, 202, 'sign-in link mailed')
  assert.equal(mails.length, 1, 'one message left through the provider')
  assert.deepEqual(mails[0].to, [owner])
  const link = new URL(mails[0].text.match(/https?:\/\/[^\s]+/)[0])
  assert.equal(link.origin, origin)
  assert.equal((await call(link.pathname + link.search)).status, 200, 'confirmation page')
  const confirmed = await call('/auth/confirm', { method: 'POST', body: { token: link.searchParams.get('token') } })
  assert.equal(confirmed.status, 303)
  const cookie = confirmed.headers.getSetCookie().map(line => line.split(';')[0]).join('; ')
  const session = await call('/auth/session', { cookie })
  assert.equal(session.status, 200)
  assert.equal((await session.json()).operator.email, owner)
  console.log('Email-link sign-in passed against the emitted Worker: claim, provider-edge mail, confirmation, session')
} finally {
  await mf.dispose()
  await rm(directory, { recursive: true, force: true })
}
