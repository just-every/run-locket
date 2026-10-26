import type { Bindings } from '../auth.server'
import { authority, requireRole } from './access'
import { encodeBase64, MAX_FILE_BYTES, PDF } from './artifacts'
import { auditSql, commit, type Ctx, type Handler } from './commands'
import { executionHandlers } from './execution'
import { fail, json, Problem, sql, text, type Actor } from './model'
import { agreementGuards, visibleAgreement } from './records'
import { commandNotifications } from './notification-events'
import { runNotifications } from './notification-dispatch'
import { signatureBase, signatureSecret, type SignatureConnection } from './signature-provider'
import { workflowWrites } from './workflow-history'

const enable: Handler = async (c, p) => {
  requireRole(c.actor, ['owner'], 'authorize automatic retrieval')
  if (p.consent !== true) fail('CONSENT', 'Approve automatic retrieval of this exact sent package using the connected Docusign account.')
  const a = await visibleAgreement(c, p.agreementId)
  const pkg = await c.db.prepare("SELECT * FROM lk_packages WHERE id=? AND agreement_id=? AND status='sent' AND provider='docusign'").bind(text(p, 'packageId', 100), a.id).first<any>()
  if (!pkg || a.status !== 'out_for_signature') fail('STATUS', 'Choose a current sent Docusign package.', 409)
  const connection = await c.db.prepare("SELECT * FROM lk_signature_connections WHERE provider='docusign'").first<SignatureConnection>()
  if (!connection) fail('SIGNATURE_CONFIG', 'Configure the Docusign connection first.', 503)
  signatureBase('docusign', connection.base_url, c.env)
  signatureSecret(c.env, 'docusign')
  const id = crypto.randomUUID()
  return { allowed: ['owner'], result: { id, status: 'waiting' },
    checks: [...agreementGuards(c, a, p), sql("EXISTS(SELECT 1 FROM lk_packages WHERE id=? AND status='sent' AND version_id=?)", pkg.id, a.current_version_id), sql("(SELECT version FROM lk_signature_connections WHERE provider='docusign')=?", connection.version)],
    writes: [sql("INSERT INTO lk_execution_retrievals VALUES(?,?,?,?,?,'waiting',0,?,NULL,NULL,NULL,?,?)", id, a.id, pkg.id, json(c.actor), connection.version, c.now, c.now, c.now)],
    audit: [{ action: 'execution.retrieval.authorize', agreementId: a.id, summary: 'Owner authorized retrieval and reconciliation of this exact sent Docusign package. Authorization ends with the owner session or connection revision.' }] }
}

const cancel: Handler = async (c, p) => {
  requireRole(c.actor, ['owner'], 'cancel automatic retrieval')
  const a = await visibleAgreement(c, p.agreementId)
  return { allowed: ['owner'], result: { status: 'cancelled' }, checks: agreementGuards(c, a, p), writes: [sql("UPDATE lk_execution_retrievals SET status='cancelled',updated_at=? WHERE agreement_id=? AND status IN ('waiting','retrying','retrieving')", c.now, a.id)], audit: [{ action: 'execution.retrieval.cancel', agreementId: a.id, summary: 'Owner cancelled automatic retrieval.' }] }
}
export const retrievalHandlers = { 'execution.retrieval.authorize': enable, 'execution.retrieval.cancel': cancel }

async function get(connection: SignatureConnection, token: string, path: string, binary = false) {
  const response = await fetch(connection.base_url + path, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${token}`, accept: binary ? PDF : 'application/json' } })
  if (!response.ok) throw new Error(`provider_http_${response.status}`)
  if (!binary) return response.json() as Promise<any>
  if (Number(response.headers.get('content-length')) > MAX_FILE_BYTES) throw new Error('provider_file_too_large')
  return boundedBytes(response.body, MAX_FILE_BYTES)
}

async function boundedBytes(body: ReadableStream<Uint8Array> | null, limit: number) {
  const reader = body?.getReader()
  if (!reader) throw new Error('provider_file_empty')
  const chunks: Uint8Array[] = []; let size = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) { await reader.cancel(); throw new Error('provider_file_too_large') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  if (!size) throw new Error('provider_file_empty')
  return bytes
}

/** Poll only packages explicitly authorized by a current owner. Downloads are
 * read-only and safely retried; reconciliation and custody share one guarded batch. */
export async function runExecutionRetrievals(env: Bindings, now: number, onlyId?: string) {
  const db = env.DB
  const rows = (await db.prepare("SELECT * FROM lk_execution_retrievals WHERE status IN ('waiting','retrying','retrieving') AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) AND (? IS NULL OR id=?) ORDER BY next_attempt_at LIMIT 10").bind(now, now, onlyId ?? null, onlyId ?? null).all<any>()).results
  let notify = false
  for (const row of rows) {
    const actor: Actor = JSON.parse(row.actor), c: Ctx = { env, db, actor, now, commandId: row.id }
    const lease = now + 120_000
    const claimed = await db.prepare("UPDATE lk_execution_retrievals SET status='retrieving',lease_until=?,updated_at=? WHERE id=? AND status IN ('waiting','retrying','retrieving') AND (lease_until IS NULL OR lease_until<=?) AND next_attempt_at<=?").bind(lease, now, row.id, now, now).run()
    if (!claimed.meta.changes) continue
    const jobCheck = sql("EXISTS(SELECT 1 FROM lk_execution_retrievals WHERE id=? AND status='retrieving' AND lease_until=?)", row.id, lease)
    try {
      const auth = authority(actor, ['owner'])
      if (!(await db.prepare(`SELECT ${auth.sql} AS ok`).bind(...auth.params).first<{ok:number}>())?.ok) throw new Problem('AUTHORITY', 'The authorizing owner session ended.', 403)
      const a = await visibleAgreement(c, row.agreement_id)
      const pkg = await db.prepare("SELECT * FROM lk_packages WHERE id=? AND agreement_id=? AND status='sent' AND version_id=?").bind(row.package_id, a.id, a.current_version_id).first<any>()
      const connection = await db.prepare("SELECT * FROM lk_signature_connections WHERE provider='docusign'").first<SignatureConnection>()
      if (!pkg || a.status !== 'out_for_signature' || !connection || connection.version !== row.connection_version) throw new Problem('STALE', 'The package or connection changed.', 409)
      signatureBase('docusign', connection.base_url, env)
      const token = signatureSecret(env, 'docusign'), path = `/accounts/${encodeURIComponent(connection.account_id!)}/envelopes/${encodeURIComponent(pkg.envelope_id)}`
      const envelope = await get(connection, token, path)
      if (envelope.envelopeId !== pkg.envelope_id) throw new Error('provider_envelope_mismatch')
      if (envelope.status !== 'completed') {
        await commit(c, ['owner'], [jobCheck, ...agreementGuards(c, a)], [sql("UPDATE lk_execution_retrievals SET status='waiting',lease_until=NULL,next_attempt_at=?,updated_at=? WHERE id=?", now + 60_000, now, row.id)])
        continue
      }
      // One signable PDF is the current automatic reconciliation boundary.
      // Multi-document packets remain held by EXEC-001's packet_documents check.
      const recipients = await get(connection, token, path + '/recipients')
      const signed = await get(connection, token, path + '/documents/combined', true)
      const certificate = await get(connection, token, path + '/documents/certificate', true)
      const completed = new Date(envelope.completedDateTime)
      if (!Number.isFinite(completed.getTime()) || !Array.isArray(recipients.signers) || !recipients.signers.length || recipients.signers.some((r:any) => r.status !== 'completed')) throw new Error('provider_completion_incomplete')
      const p = { agreementId: a.id, version: a.version, envelopeId: envelope.envelopeId, executedOn: completed.toISOString().slice(0, 10), documentConfirmed: true,
        signers: recipients.signers.map((r:any) => ({ name: r.name, email: r.email, signedAt: r.signedDateTime })),
        signed: { filename: `${a.reference}-signed.pdf`, mediaType: PDF, base64: encodeBase64(signed) }, certificate: { filename: `${a.reference}-certificate.pdf`, mediaType: PDF, base64: encodeBase64(certificate) } }
      const out = await executionHandlers['execution.record'](c, p), result = out.result as {executionId:string;status:string}
      await commit(c, ['owner'], [...(out.checks ?? []), jobCheck, sql("(SELECT version FROM lk_signature_connections WHERE provider='docusign')=?", connection.version)], [...out.writes,
        ...await commandNotifications(c, 'execution.record', p, out), ...await workflowWrites(c, out.audit), ...out.audit.map(entry => auditSql(c, entry)),
        sql("UPDATE lk_execution_retrievals SET status=?,execution_id=?,attempts=attempts+1,lease_until=NULL,last_error=NULL,updated_at=? WHERE id=?", result.status, result.executionId, now, row.id)])
      if(result.status==='reconciled')notify=true
    } catch (error) {
      const cancelled = error instanceof Problem && ['AUTHORITY','STALE','NOT_FOUND','STATUS','FORBIDDEN'].includes(error.code)
      // Store bounded diagnostic codes, never provider response bodies or tokens.
      const code = error instanceof Problem ? error.code : /^provider_[a-z0-9_]+$/.test(String((error as Error).message)) ? (error as Error).message : 'provider_read_failed'
      await db.prepare("UPDATE lk_execution_retrievals SET status=?,attempts=attempts+1,lease_until=NULL,last_error=?,next_attempt_at=?,updated_at=? WHERE id=? AND status='retrieving' AND lease_until=?").bind(cancelled ? 'cancelled' : 'retrying', code, now + Math.min(3_600_000, 30_000 * 2 ** Math.min(row.attempts, 7)), now, row.id, lease).run()
    }
  }
  if(notify)await runNotifications(env, now, false)
}

/** Docusign Connect HMAC authenticates the signal; status and files are still
 * retrieved from the configured account rather than trusted from the callback. */
export async function executionCompletionResponse(request: Request, env: Bindings): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/locket/events/docusign') return null
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const secret = (env as unknown as Record<string,unknown>).SIGNATURE_DOCUSIGN_CONNECT_SECRET
  if (typeof secret !== 'string' || !secret) return new Response('Not configured', { status: 503 })
  if (Number(request.headers.get('content-length')) > 262144) return new Response('Payload too large', { status: 413 })
  let bytes: Uint8Array
  try { bytes=await boundedBytes(request.body,262144) } catch { return new Response('Invalid or oversized payload',{status:413}) }
  let signature: Uint8Array
  try { signature = Uint8Array.from(atob(request.headers.get('x-docusign-signature-1') ?? ''), c => c.charCodeAt(0)) } catch { return new Response('Invalid signature', { status: 403 }) }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  if (!await crypto.subtle.verify('HMAC', key, signature as BufferSource, bytes as BufferSource)) return new Response('Invalid signature', { status: 403 })
  let event: any
  try { event = JSON.parse(new TextDecoder().decode(bytes)) } catch { return new Response('Invalid event', { status: 400 }) }
  if (event.event !== 'envelope-completed' || typeof event.data?.envelopeId !== 'string' || typeof event.data?.accountId !== 'string') return new Response(null, { status: 204 })
  const rows = (await env.DB.prepare("SELECT r.id FROM lk_execution_retrievals r JOIN lk_packages p ON p.id=r.package_id JOIN lk_signature_connections c ON c.provider=p.provider WHERE p.provider='docusign' AND p.envelope_id=? AND c.account_id=? AND c.version=r.connection_version AND r.status IN ('waiting','retrying')").bind(event.data.envelopeId, event.data.accountId).all<{id:string}>()).results
  for (const row of rows) {
    await env.DB.prepare("UPDATE lk_execution_retrievals SET next_attempt_at=? WHERE id=? AND status='waiting'").bind(Date.now(), row.id).run()
    await runExecutionRetrievals(env, Date.now(), row.id)
  }
  return new Response(null, { status: 204 })
}
