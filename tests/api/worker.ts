import { locketResponse } from '../../src/locket/api'
import { authResponse } from '../../src/auth.server'

export default {
  async fetch(request: Request, env: any) {
    return (await locketResponse(request, env)) ?? (await authResponse(request, env)) ?? new Response('Not found', { status: 404 })
  },
}
