// Local-only Worker entry. vite.config.ts loads it only for `vite dev`; the
// deployed main stays src/server.ts, and `rer build` refuses any output that
// contains the dev layer. It adds dev sign-in, personas and the Dev title and name suffix.
import worker from './server'
import { withDevIdentity } from './modules/operator-auth/dev/index.mjs'
import { authConfig, runtimeBindings, type Bindings } from './auth.server'
import { devPersonas } from './dev-personas'
import { withDevAi } from './modules/ai/dev/index.mjs'
import { fontDocumentResponse } from './base/font-response'
import { framedDocument } from './frame'

const development = withDevAi<Bindings, typeof worker>(worker, { bindings: runtimeBindings })
const signedIn = withDevIdentity<Bindings, typeof worker>(development, { bindings: runtimeBindings, config: authConfig, personas: devPersonas })

// The dev layer serves its one-click /signin and its /__dev/key hand-off itself. /signin gets the same fonts and frame
// as the deployed sign-in page; the hand-off gets the fonts, where Locket's own tokens are (/fonts/fonts.css).
export default {
  ...signedIn,
  async fetch(request, env, execution) {
    const response = await signedIn.fetch!(request, env, execution)
    const { pathname } = new URL(request.url)
    if (pathname === '/signin') return (await framedDocument(await fontDocumentResponse(response))) ?? response
    return pathname === '/__dev/key' ? (await fontDocumentResponse(response)) ?? response : response
  },
} satisfies ExportedHandler<Bindings>
