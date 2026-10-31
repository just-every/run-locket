import { createAgentDoor, CORE_CAPABILITIES, type Trust } from '../modules/agent-door/index.ts'
import { runtimeBindings, type Bindings } from '../auth.server'
import { locketPeople } from './people'
import { tools } from './tools'
import { resources } from './resources'
import { prompts } from './prompts'
import { businessSettings } from './business'
import { agentManifest, agentInstructions, agentDocumentationPage, limits } from './documentation'

export function agentTrust(env: Bindings): Trust | null {
  const issuer = env.RER_OWNER_CLAIM_ISSUER, installationId = env.RER_OWNER_CLAIM_INSTALLATION_ID
  if (![issuer, installationId, env.RER_OWNER_CLAIM_PUBLIC_KEYS].some(Boolean)) return null
  if (!issuer || !installationId || !env.RER_OWNER_CLAIM_PUBLIC_KEYS) throw new Error('Incomplete agent trust')
  return { issuer, installationId, appOrigin: env.RER_OWNER_CLAIM_APP_ORIGIN ?? env.AUTH_ORIGIN, publicKeys: JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS) }
}

export const notTools = [
  { clauses: ['NEG-002'], reason: 'device' },
  { clauses: ['SIGN-001'], reason: 'screen' },
  { clauses: ['INT-004'], reason: 'connector' },
  { clauses: ['MOVE-001'], reason: 'import-door' },
  { clauses: ['OPS-001'], reason: 'installation' },
] as const

export async function locketAgentDoor(original: Bindings) {
  const env = runtimeBindings(original)
  const options = { capabilities: [...CORE_CAPABILITIES, 'prompts'], seed: 'locket', name: String(await businessSettings(env).resolve('display_name', 'Locket')), specialist: 'contract operations clerk', db: env.DB,
    origin: env.AUTH_ORIGIN, trust: agentTrust(env), people: locketPeople(env), tools: tools(env), resources: resources(env), prompts: prompts(), notTools: notTools.map(item => ({ ...item, clauses: [...item.clauses] })), limits,
  } satisfies Parameters<typeof createAgentDoor>[0]
  const door = createAgentDoor(options)
  const manifest = agentManifest(options)
  return { ...door, async handle(request: Request) {
    if (new URL(request.url).pathname === '/docs/agents') return request.method === 'GET'
      ? agentDocumentationPage(manifest) : new Response(null, { status: 405, headers: { Allow: 'GET' } })
    const response = await door.handle(request)
    if (response?.status !== 200 || new URL(request.url).pathname !== '/mcp') return response
    const rpc = await response.clone().json() as { result?: { instructions?: string } }
    if (typeof rpc.result?.instructions !== 'string') return response
    await response.body?.cancel()
    rpc.result.instructions = agentInstructions(manifest)
    return Response.json(rpc, { status: response.status, headers: response.headers })
  } }
}
