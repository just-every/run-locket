import type { Bindings } from '../../auth.server'
import { fail, object, text } from '../model'

export interface SiteIdentity {
  installationOrigin: string; siteOrigin: string; termsId: string; versionId: string; digest: string
  signerId: string; email: string; nonce: string; issuedAt: number; expiresAt: number
}
export function siteOrigin(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { return fail('INVALID', 'Use a complete HTTPS site origin.') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.origin !== value || (url.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname))) fail('INVALID', 'Use an HTTPS origin without a path (HTTP is allowed on localhost).')
  return url.origin
}
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

/** Customer servers sign base64url(JSON) with HMAC-SHA256. Never a browser secret. */
export async function siteIdentity(request: Request, env: Bindings): Promise<SiteIdentity | null> {
  const authorization = request.headers.get('authorization')
  if (authorization === null) return null
  const key = env.CLICKWRAP_SIGNING_KEY
  if (!key || key.length < 32) fail('CONFIGURATION', 'External clickwrap is not configured. Ask the installation owner to configure its signing key.', 503)
  if (!authorization.startsWith('Bearer ')) fail('AUTH', 'Use a signed site identity.', 401)
  try {
    const token = authorization.slice(7)
    if (token.length > 6000) throw new Error()
    const parts = token.split('.')
    if (parts.length !== 2) throw new Error()
    const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    if (!await crypto.subtle.verify('HMAC', cryptoKey, decode(parts[1]) as BufferSource, new TextEncoder().encode(parts[0]))) throw new Error()
    const p = object(JSON.parse(new TextDecoder().decode(decode(parts[0]))))
    const result: SiteIdentity = {
      installationOrigin: text(p, 'installationOrigin', 300), siteOrigin: siteOrigin(text(p, 'siteOrigin', 300)),
      termsId: text(p, 'termsId', 100), versionId: text(p, 'versionId', 100), digest: text(p, 'digest', 64),
      signerId: text(p, 'signerId', 200), email: text(p, 'email', 254), nonce: text(p, 'nonce', 100),
      issuedAt: Number(p.issuedAt), expiresAt: Number(p.expiresAt),
    }
    const now = Date.now()
    if (result.installationOrigin !== new URL(request.url).origin || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email) || result.nonce.length < 16 || !Number.isSafeInteger(result.issuedAt) || !Number.isSafeInteger(result.expiresAt) || result.issuedAt > now || result.expiresAt <= now || result.expiresAt - result.issuedAt > 600_000 || result.expiresAt <= result.issuedAt) throw new Error()
    return result
  } catch { return fail('AUTH', 'The site identity is invalid or expired. Return to the website for a new acceptance link.', 401) }
}
