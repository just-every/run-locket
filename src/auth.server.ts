import { workforceSettings } from './locket/workforce'
import { workforceSamlResponse, samlAvailable, samlIssuers } from './locket/workforce-saml'
import { createDependencies } from './modules/dependencies/index.mjs'
import { createOwnerClaimHandler, createIdpOwnerClaimHandler } from './modules/owner-claim/index.mjs'
import { firstRunResponse } from './base/setup'
import { fontDocumentResponse } from './base/font-response'
import { framedDocument } from './frame'
import { createOperatorAuth, createAuthHandler, createSignInHandler, type AuthConfig } from './modules/operator-auth/index.mjs'
import { operatorMail } from './mail.server.mjs'
import branding from './branding.json'

// The edition's declared theme (public/rer-theme.css), as Base frames link it.
const theme = { href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor }

export interface Bindings {
 UPTIME_ORIGIN?:string
 UPTIME_METRICS_KEY?:string
 LINEN_ORIGIN?:string
 LINEN_MCP_TOKEN?:string
 /** Owner deployment attestation: provider contract prohibits training on contract text. */
 AI_TRAINING_PROHIBITED?:string
 AI_ENABLED?:string
 AI_MODEL?:string
 AI_BASE_URL?:string
 AI_API_KEY?:string
 MODELS_SERVICE?:string
 MODELS_KEY?:string
 QUICKBOOKS_ACCESS_TOKEN?: string
 QUICKBOOKS_REALM_ID?: string
 QUICKBOOKS_SANDBOX?: string
 /** Server-only HMAC key for customer-site clickwrap identity assertions. */
 CLICKWRAP_SIGNING_KEY?: string
 /** Resend endpoint signing key; never returned to a browser. */
 NOTICE_RESEND_WEBHOOK_SECRET?: string
 DB: D1Database
 /** Built browser files; hosted deploys run the Worker first (staticAssetResponse). */
 ASSETS?: Fetcher
 RER_DEPLOY_SOURCE?: string
 RER_DEPLOY_FINGERPRINT?: string
 RER_VERSION?: { id: string }
 IDENTITY_PROVIDER?: string
 AUTH_ORIGIN: string
 AUTH_LOCAL?: string
 RER_DEV_ORIGIN?: string
 /** Local runtimes only: the checkout's key gate and dev identity switch. Deploy refuses both. */
 RER_MODELS_SERVICE?: string
 RER_MODELS_KEY?: string
 RER_DEV_KEY?: string
 RER_DEV_IDENTITY?: string
 RER_OWNER_CLAIM_PUBLIC_KEYS?: string
 RER_OWNER_CLAIM_ISSUER?: string
 RER_OWNER_CLAIM_INSTALLATION_ID?: string
 RER_INSTALLATION_ID?: string
 RER_MANAGEMENT_ORIGIN?: string
 OWNER_EMAIL: string
 SESSION_SECRET: string
 INSTALLATION_KEY?: string
 INSTALLATION_KEY_PREVIOUS?: string
 SETUP_TOKEN?: string
 MAIL_PROVIDER?: 'development' | 'rer' | 'resend' | 'sendgrid' | 'cloudflare' | 'postmark'
 MAIL_RELAY_URL?: string
 MAIL_FROM?: string
 POSTMARK_REPLY_DOMAIN?: string
 POSTMARK_INBOUND_SECRET?: string
 POSTMARK_SERVER_TOKEN?: string
 MAIL_API_KEY?: string
 MAIL_ACCOUNT_ID?: string
}

export const runtimeBindings = (env: Bindings): Bindings => env.RER_DEV_ORIGIN && env.AUTH_LOCAL === 'true' ? { ...env, AUTH_ORIGIN: env.RER_DEV_ORIGIN } : env
export const authConfig = (env: Bindings): AuthConfig => ({ dependencies: true, externalIssuers: samlIssuers(env), origin: env.AUTH_ORIGIN, local: env.AUTH_LOCAL === 'true', OWNER_EMAIL: env.OWNER_EMAIL, SESSION_SECRET: env.SESSION_SECRET, INSTALLATION_KEY: env.INSTALLATION_KEY, INSTALLATION_KEY_PREVIOUS: env.INSTALLATION_KEY_PREVIOUS, SETUP_TOKEN: env.SETUP_TOKEN, MAIL_FROM: env.MAIL_FROM, branding: { productName: branding.name, accentColor: branding.primaryColor, signInPath: '/signin', theme: theme.href } })
export function operatorAuth(env: Bindings) {
 const auth=createOperatorAuth({ db: env.DB, config: authConfig(env), mailSender: operatorMail(env), clientIp: request => request.headers.get('CF-Connecting-IP') ?? '' })
 const getSession=auth.getSession.bind(auth)
 const managedSession: typeof auth.getSession=async request=>{
  const session=await getSession(request)
  if(session&&session.operator.role!=='owner'&&await env.DB.prepare('SELECT id FROM lk_workforce_users WHERE id=?').bind(session.operator.id).first()&&!await workforceSettings(env))return null
  return session
 }
 return {...auth,getSession:managedSession}
}

const privateHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' }
export async function authResponse(request: Request, original: Bindings): Promise<Response | null> {
 const env = runtimeBindings(original), url = new URL(request.url)
 const workforce=await workforceSamlResponse(request,env)
 if(workforce)return workforce
 if (url.pathname.startsWith('/.well-known/rer-') || url.pathname.startsWith('/auth/dependencies/')) {
  const linked = await createDependencies({ db: env.DB, INSTALLATION_KEY: env.INSTALLATION_KEY, INSTALLATION_KEY_PREVIOUS: env.INSTALLATION_KEY_PREVIOUS, origin: env.AUTH_ORIGIN, name: branding.name, provider: env.IDENTITY_PROVIDER, local: env.AUTH_LOCAL === 'true', auth: operatorAuth(env), claimOwner: token => createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:()=>request.headers.get('CF-Connecting-IP')??''})(new Request(env.AUTH_ORIGIN+'/auth/owner-claim',{method:'POST',headers:{Host:new URL(env.AUTH_ORIGIN).host,Origin:env.AUTH_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({token})})) }).handle(request)
  if (linked) return linked
 }
 if (url.pathname === '/auth/owner-claim' && env.RER_OWNER_CLAIM_PUBLIC_KEYS) {
  return createOwnerClaimHandler({ db: env.DB, authConfig: authConfig(env), clientIp: req => req.headers.get('CF-Connecting-IP') ?? '',
   issuer: env.RER_OWNER_CLAIM_ISSUER!, installationId: env.RER_OWNER_CLAIM_INSTALLATION_ID!, appOrigin: env.AUTH_ORIGIN,
   expectedEmail: env.OWNER_EMAIL, publicKeys: JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS) })(request)
 }
 if (url.pathname === '/auth/owner-claim') return createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:req=>req.headers.get('CF-Connecting-IP')??''})(request)
 // The shared server-rendered sign-in page: plain forms that work before any script.
 if (url.pathname === '/signin') {
  const page = await createSignInHandler(operatorAuth(env), { defaultReturnTo: '/setup', links: async()=>await samlAvailable(env)?[{href:'/auth/saml/start',label:'Continue with workforce SSO'}]:[] })(request)
  if (page) return framedDocument(await fontDocumentResponse(page))
 }
 if (url.pathname.startsWith('/auth/')) return framedDocument(await fontDocumentResponse(await createAuthHandler(operatorAuth(env))(request)))
 if (url.pathname === '/setup' || url.pathname === '/app' || url.pathname.startsWith('/app/')) {
  const setup = await firstRunResponse(request, env, operatorAuth(env), { theme })
  if (setup) return framedDocument(setup)
 }
 // Signed-out visitors sign in first; signed-in ones get the Locket workspace (src/routes/app.tsx).
 if (url.pathname === '/app') {
  const session = await operatorAuth(env).getSession(request)
  if (!session) return new Response(null, { status: 303, headers: { ...privateHeaders, location: '/signin?returnTo=%2Fapp' } })
 }
 return null
}
