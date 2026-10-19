import type { Bindings } from '../../auth.server'
import { currentActor } from '../access'
import { runCommand, runSiteCommand, type Ctx } from '../commands'
import { canonical, fail, object, sha256, text } from '../model'
import { siteIdentity } from './identity'
import { acceptanceNeeded, acceptanceOutcome, clickwrapHandlers, termsVersion } from './records'
import { acceptancePage, embedScript } from './page'

const headers = { 'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff' }
/** Called before currentActor: customer-site users need no Locket account. */
export async function publicClickwrapResponse(request: Request, env: Bindings): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname.slice('/api/locket/clickwrap'.length)
  if (!url.pathname.startsWith('/api/locket/clickwrap/')) return null
  if (request.method === 'GET' && path === '/embed.js') return new Response(embedScript, {headers:{...headers,'content-type':'text/javascript; charset=utf-8'}})
  if (request.method === 'GET' && /^\/terms\/[^/]+$/.test(path)) {
    await termsVersion(env, decodeURIComponent(path.slice('/terms/'.length)))
    return acceptancePage()
  }
  if (request.method === 'GET' && path.startsWith('/published/')) {
    const terms = await termsVersion(env, decodeURIComponent(path.slice('/published/'.length)))
    return Response.json({terms}, {headers})
  }
  if (request.method !== 'POST' || !['/show','/accept'].includes(path)) return null
  if (request.headers.get('sec-fetch-dest') === 'iframe' || request.headers.get('sec-fetch-dest') === 'frame') fail('CONSENT', 'Acceptance must open in its own window.', 403)
  let input: unknown
  try { input = await request.json() } catch { fail('INVALID', 'The request body is not JSON.') }
  const body = object(input), site = await siteIdentity(request, env)
  const actor = site ? { id:`site:${JSON.stringify([site.siteOrigin,site.signerId])}`,name:site.email,email:site.email,role:'viewer' as const,sessionId:'',operatorVersion:0 } : await currentActor(request, env)
  const termsId = text(body, 'termsId', 100)
  let digest = ''
  if (site && path === '/accept') {
    if (site.termsId !== termsId || site.versionId !== body.versionId || site.digest !== body.digest) fail('AUTH', 'The site identity does not match the requested terms.', 403)
    if (typeof body.commandId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.commandId)) fail('INVALID', 'commandId must be a UUID.')
    digest = await sha256(canonical({ type: 'clickwrap.accept', payload: body }))
    const prior = await env.DB.prepare('SELECT actor_id,digest,result FROM lk_commands WHERE id=?').bind(body.commandId).first<{ actor_id: string; digest: string; result: string }>()
    if (prior) {
      if (prior.actor_id !== actor.id || prior.digest !== digest) fail('IDEMPOTENCY', 'This command identity was already used for different content.', 409)
      return Response.json({ok:true,result:JSON.parse(prior.result)}, {headers})
    }
  }
  const terms = await termsVersion(env, termsId)
  if (site && (site.termsId !== termsId || site.siteOrigin !== terms.site_origin || site.versionId !== terms.version_id || site.digest !== terms.digest)) fail('STALE', 'This link does not match the current published terms. Return to the website for a new link.', 409)
  if (path === '/show') return Response.json({terms,required:await acceptanceNeeded(env,terms,site?'site_asserted':'base_session',site?.signerId??actor.id,site?.siteOrigin??url.origin),identity:{account:site?.signerId??actor.id,email:actor.email,label:site?'Site-asserted identity (not identity-proofed)':'Base current session'}}, {headers})
  const c: Ctx = {env,db:env.DB,actor,now:Date.now(),commandId:String(body.commandId),request}
  const result = site ? await runSiteCommand(c, await acceptanceOutcome(c,body,site), digest) : await runCommand(env,actor,{commandId:body.commandId,type:'clickwrap.accept',payload:body},clickwrapHandlers,request)
  return Response.json({ok:true,result}, {headers})
}
