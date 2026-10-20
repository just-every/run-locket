// Test-only static host for the actual product component, compiled afresh from
// source. API/auth requests go to the real Worker+D1 installation; only the mail
// provider network edge is faked by that installation. No application API is
// intercepted or replaced. This host does not exercise Start's document shell.
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { installation } from '../api/harness.mjs'

let product
async function assets() {
  product ??= build({ stdin: { contents: "import React from 'react'; import {createRoot} from 'react-dom/client'; import {LocketApp} from './src/ui/app'; createRoot(document.getElementById('root')).render(React.createElement(LocketApp));", resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', outdir: '/test-app', entryNames: 'product', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.svg': 'dataurl' }, logLevel: 'silent' })
  return product
}

export async function productPage(page, { width = 1440, bindings = {} } = {}) {
  const h = await installation({ bindings })
  try {
    const built = await assets()
    const script = built.outputFiles.find(f => f.path.endsWith('.js')).text
    const css = built.outputFiles.find(f => f.path.endsWith('.css'))?.text ?? ''
    await page.setViewportSize({ width, height: 1000 })
    await page.context().addCookies(h.owner.cookie.split('; ').map(pair => {
      const separator = pair.indexOf('=')
      return { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: h.origin, secure: true, httpOnly: true, sameSite: 'Lax' }
    }))
    const mime = { '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
    const publicRoot = resolve('public')
    const matcher = url => url.origin === h.origin && (['/app', '/test-app.js', '/test-app.css', '/rer-theme.css'].includes(url.pathname) || /^\/(fonts|brand)\//.test(url.pathname))
    const host = async route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/app') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/rer-theme.css"><link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/test-app.css"></head><body><div id="root"></div><script type="module" src="/test-app.js"></script></body></html>' })
      if (path === '/test-app.js') return route.fulfill({ contentType: 'text/javascript', body: script })
      if (path === '/test-app.css') return route.fulfill({ contentType: 'text/css', body: css })
      const file = resolve(publicRoot, '.' + path)
      if (!file.startsWith(publicRoot + '/')) return route.fulfill({ status: 404 })
      return route.fulfill({ contentType: mime[extname(file)] ?? 'application/octet-stream', body: await readFile(file) })
    }
    await page.route(matcher, host)
    return { h, origin: h.origin, owner: h.owner, command: h.owner.command, state: h.owner.state, async close() { try { if (!page.isClosed()) await page.unroute(matcher, host) } finally { await h.close() } } }
  } catch (error) {
    await h.close()
    throw error
  }
}
