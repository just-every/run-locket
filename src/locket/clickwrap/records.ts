import type { Bindings } from '../../auth.server'
import { fullReaders, may, requireRole } from '../access'
import { type Handler, type Ctx, type Outcome } from '../commands'
import { fail, integer, oneOf, optionalText, sha256, sql, text, type Actor } from '../model'
import { siteOrigin, type SiteIdentity } from './identity'

export async function termsVersion(env: Bindings, id: string) {
  const row = await env.DB.prepare('SELECT t.*,v.id AS version_id,v.number,v.body,v.digest,v.require_reacceptance,v.published_at FROM lk_clickwrap_terms t JOIN lk_clickwrap_versions v ON v.id=t.current_version_id WHERE t.id=?').bind(id).first<any>()
  if (!row) fail('NOT_FOUND', 'No published terms with that identity.', 404)
  return row
}
export const currentTermsCheck = (t: any) => sql('EXISTS(SELECT 1 FROM lk_clickwrap_terms WHERE id=? AND current_version_id=? AND version=?)', t.id, t.version_id, t.version)

const publish: Handler = async (c, p) => {
  requireRole(c.actor, fullReaders, 'publish clickwrap terms')
  const existing = optionalText(p, 'termsId', 100)
  const old = existing ? await termsVersion(c.env, existing) : null
  if (old && integer(p, 'version', 1) !== old.version) fail('STALE', 'Terms changed; reload before publishing.', 409)
  const id = old?.id ?? crypto.randomUUID(), versionId = crypto.randomUUID()
  const name = old?.name ?? text(p, 'name', 120), kind = old?.kind ?? oneOf(p, 'kind', ['tos','dpa','partner'] as const)
  const origin = old?.site_origin ?? siteOrigin(text(p, 'siteOrigin', 300))
  const body = text(p, 'body', 200_000), digest = await sha256(body), number = (old?.number ?? 0) + 1
  if (p.requireReacceptance !== undefined && typeof p.requireReacceptance !== 'boolean') fail('INVALID', 'requireReacceptance must be true or false.')
  const required = old ? p.requireReacceptance !== false : true
  return {
    allowed: fullReaders, result: { id, versionId, number, digest }, checks: old ? [currentTermsCheck(old)] : [],
    writes: [
      ...(old ? [sql('UPDATE lk_clickwrap_terms SET current_version_id=?,version=version+1 WHERE id=?', versionId, id)] : [sql('INSERT INTO lk_clickwrap_terms VALUES(?,?,?,?,?,?,?,?)', id, name, kind, origin, versionId, 1, c.actor.id, c.now)]),
      sql('INSERT INTO lk_clickwrap_versions VALUES(?,?,?,?,?,?,?,?)', versionId, id, number, body, digest, required ? 1 : 0, c.actor.id, c.now),
    ], audit: [{ action: 'clickwrap.publish', summary: `Published ${name} v${number}, SHA-256 ${digest}; reacceptance ${required ? 'required' : 'optional'}.` }],
  }
}

export async function acceptanceNeeded(env: Bindings, t: any, kind: string, account: string, origin: string) {
  const row = await env.DB.prepare(`SELECT 1 AS accepted FROM lk_clickwrap_acceptances a JOIN lk_clickwrap_versions v ON v.id=a.version_id WHERE a.terms_id=? AND a.identity_kind=? AND a.account_id=? AND a.site_origin=? AND v.number >= (SELECT COALESCE(MAX(number),1) FROM lk_clickwrap_versions WHERE terms_id=? AND require_reacceptance=1) LIMIT 1`).bind(t.id, kind, account, origin, t.id).first()
  return !row
}

/** The two doors produce the same exact evidence; all client evidence fields are ignored. */
export async function acceptanceOutcome(c: Ctx, p: Record<string, unknown>, site: SiteIdentity | null): Promise<Outcome> {
  const acceptRoles = may.read.filter(role => role !== 'agent')
  if (!site) requireRole(c.actor, acceptRoles, 'accept terms (agents prepare proposals only)')
  if (!c.request) fail('INVALID', 'Acceptance requires an HTTP request.')
  const t = await termsVersion(c.env, text(p, 'termsId', 100))
  if (p.accepted !== true) fail('CONSENT', 'Read the terms, select the checkbox and press Accept.')
  if (text(p, 'versionId', 100) !== t.version_id || text(p, 'digest', 64) !== t.digest) fail('STALE', 'A newer terms version is available. Reload and review it before accepting.', 409)
  const origin = new URL(c.request.url).origin
  if (site && (site.termsId !== t.id || site.siteOrigin !== t.site_origin || site.versionId !== t.version_id || site.digest !== t.digest)) fail('AUTH', 'The site identity does not match these published terms.', 403)
  const identityKind = site ? 'site_asserted' : 'base_session'
  const account = site?.signerId ?? c.actor.id, email = site?.email ?? c.actor.email
  const siteURL = site?.siteOrigin ?? origin
  const id = crypto.randomUUID(), page = `${origin}/api/locket/clickwrap/terms/${encodeURIComponent(t.id)}`
  // Page shown is the hosted acceptance surface, never a caller-supplied URL.
  const ip = c.request.headers.get('CF-Connecting-IP') ?? '', ua = (c.request.headers.get('user-agent') ?? '').slice(0, 2000)
  const checks = [currentTermsCheck(t)]
  if (site) checks.push(sql('? > ?', site.expiresAt, Date.now()), sql('NOT EXISTS(SELECT 1 FROM lk_clickwrap_acceptances WHERE nonce=?)', site.nonce))
  else checks.push(sql('EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND email=? AND status=\'active\')', c.actor.id, email))
  return {
    allowed: site ? may.read : acceptRoles, result: { id, termsId: t.id, versionId: t.version_id, digest: t.digest, acceptedAt: c.now }, checks,
    writes: [sql('INSERT INTO lk_clickwrap_acceptances VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, t.id, t.version_id, t.digest, identityKind, account, email, site ? null : c.actor.id, siteURL, null, c.now, ip, ua, page, site?.siteOrigin ?? origin, site?.nonce ?? null, 0)],
    audit: [{ action: 'clickwrap.accept', summary: `Accepted ${t.name} v${t.number}, SHA-256 ${t.digest}; ${identityKind === 'site_asserted' ? 'site-asserted identity (not identity-proofed)' : 'Base current session'}: ${account} (${email}).` }],
  }
}
const accept: Handler = async (c, p) => acceptanceOutcome(c, p, null)

// A link is a counsel annotation; captured acceptance evidence stays immutable.
const link: Handler = async (c, p) => {
  requireRole(c.actor, fullReaders, 'link acceptance evidence to a counterparty')
  const id = text(p, 'acceptanceId', 100), party = text(p, 'partyId', 100)
  const acceptance = await c.db.prepare('SELECT party_id FROM lk_clickwrap_acceptances WHERE id=?').bind(id).first<any>()
  const record = await c.db.prepare('SELECT id,version FROM lk_parties WHERE id=?').bind(party).first<any>()
  if (!acceptance || !record) fail('NOT_FOUND', 'Choose an acceptance and counterparty you can access.', 404)
  if (p.currentPartyId !== acceptance.party_id) fail('STALE', 'The counterparty link changed. Reload before linking.', 409)
  return { allowed: fullReaders, result: { id, partyId: party },
    checks: [sql('EXISTS(SELECT 1 FROM lk_clickwrap_acceptances WHERE id=? AND party_id IS ?)', id, acceptance.party_id), sql('EXISTS(SELECT 1 FROM lk_parties WHERE id=? AND version=?)', party, record.version)],
    writes: [sql('UPDATE lk_clickwrap_acceptances SET party_id=? WHERE id=?', party, id)],
    audit: [{ action: 'clickwrap.link', summary: `Linked acceptance ${id} to counterparty ${party}.` }] }

}

export const clickwrapHandlers: Record<string, Handler> = { 'clickwrap.publish': publish, 'clickwrap.accept': accept, 'clickwrap.link': link }

export async function acceptanceRecords(env: Bindings, actor: Actor, params: URLSearchParams) {
  requireRole(actor, may.read, 'read clickwrap acceptances')
  const conditions: string[] = [], values: unknown[] = []
  if (!fullReaders.includes(actor.role)) { conditions.push('a.operator_id=?'); values.push(actor.id) }
  for (const [param, column] of [['terms','a.terms_id'],['party','a.party_id']] as const) if (params.get(param)) { conditions.push(`${column}=?`); values.push(params.get(param)) }
  const q = params.get('q')?.trim().toLowerCase()
  if (q) { conditions.push("instr(lower(a.account_id||' '||a.email||' '||t.name||' '||COALESCE(p.name,'')||' '||a.digest),?)>0"); values.push(q) }
  const rows = (await env.DB.prepare(`SELECT a.*,t.name AS terms_name,v.number AS terms_number,p.name AS counterparty FROM lk_clickwrap_acceptances a JOIN lk_clickwrap_terms t ON t.id=a.terms_id JOIN lk_clickwrap_versions v ON v.id=a.version_id LEFT JOIN lk_parties p ON p.id=a.party_id ${conditions.length ? 'WHERE '+conditions.join(' AND ') : ''} ORDER BY a.accepted_at DESC,a.id`).bind(...values).all<any>()).results
  return rows
}
export function acceptanceCsv(rows: any[]) {
  const columns = ['id','terms_id','terms_name','version_id','terms_number','digest','identity_kind','account_id','email','site_origin','party_id','counterparty','accepted_at','ip','user_agent','page_shown','source_page','imported']
  const cell = (v: unknown) => '"'+String(v ?? '').replace(/^(\s*[=+@-])/, "'$1").replaceAll('"','""')+'"'
  return [columns.map(cell).join(','), ...rows.map(r => columns.map(k => cell(r[k])).join(','))].join('\r\n')+'\r\n'
}
