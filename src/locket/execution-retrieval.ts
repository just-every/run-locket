import { runExecutionFollowups } from './execution-followups'
import { completedPackage, retrievalProviders } from './execution-provider'
import type { Bindings } from '../auth.server'
import { authority, requireRole } from './access'
import { encodeBase64, MAX_FILE_BYTES, PDF } from './artifacts'
import { auditSql, commit, type Ctx, type Handler } from './commands'
import { executionHandlers } from './execution'
import { fail, json, Problem, sha256, sql, text, type Actor, type Sql } from './model'
import { agreementGuards, visibleAgreement } from './records'
import { commandNotifications } from './notification-events'
import { runNotifications } from './notification-dispatch'
import { signatureBase, signatureSecret, type SignatureConnection } from './signature-provider'
import { workflowWrites } from './workflow-history'
import { fullFieldsCheck, requireFullFields } from './repository-access'

/** Retain the exact decision inputs, rather than following a mutable package ID. */
async function packageBinding(c: Ctx, pkg: any, connection: SignatureConnection, providerFiles?: {signedName:string;certificateName:string}) {
  const artifacts = (await c.db.prepare("SELECT id,sha256 FROM lk_artifacts WHERE id IN (?,?) ORDER BY id").bind(pkg.pdf_artifact_id, pkg.manifest_artifact_id).all<{id:string;sha256:string}>()).results
  if (artifacts.length !== 2) fail('STALE', 'The sent package evidence is incomplete.', 409)
  return json({ packageId: pkg.id, agreementId: pkg.agreement_id, versionId: pkg.version_id,
    versionDigest: pkg.version_digest, provider: pkg.provider, envelopeId: pkg.envelope_id,
    pdfArtifactId: pkg.pdf_artifact_id, manifestArtifactId: pkg.manifest_artifact_id,
    manifestDigest: await sha256(pkg.manifest), artifacts,
    connection: { provider: connection.provider, baseUrl: connection.base_url, accountId: connection.account_id, version: connection.version }, ...(providerFiles?{providerFiles}:{}) })
}

function bindingCheck(binding: string, manifest: string) {
  const b = JSON.parse(binding)
  return sql(`EXISTS(SELECT 1 FROM lk_packages p JOIN lk_signature_connections c ON c.provider=p.provider
    WHERE p.id=? AND p.agreement_id=? AND p.version_id=? AND p.version_digest=? AND p.provider=? AND p.envelope_id=?
    AND p.pdf_artifact_id=? AND p.manifest_artifact_id=? AND p.manifest=? AND p.status='sent'
    AND c.base_url=? AND c.account_id=? AND c.version=?
    AND NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN lk_artifacts a ON a.id=json_extract(expected.value,'$.id')
      WHERE a.id IS NULL OR a.sha256<>json_extract(expected.value,'$.sha256')))`,
    b.packageId, b.agreementId, b.versionId, b.versionDigest, b.provider, b.envelopeId,
    b.pdfArtifactId, b.manifestArtifactId, manifest, b.connection.baseUrl, b.connection.accountId, b.connection.version, json(b.artifacts))
}

const enable: Handler = async (c, p) => {
  requireRole(c.actor, ['owner'], 'authorize automatic retrieval')
  if (p.consent !== true) fail('CONSENT', 'Approve automatic retrieval of this exact sent package using its connected signing account.')
  const a = await visibleAgreement(c, p.agreementId)
  const pkg = await c.db.prepare("SELECT * FROM lk_packages WHERE id=? AND agreement_id=? AND status='sent'").bind(text(p, 'packageId', 100), a.id).first<any>()
  if (!pkg || a.status !== 'out_for_signature') fail('STATUS', 'Choose a current sent package.', 409)
  if (!retrievalProviders.includes(pkg.provider)) fail('RETRIEVAL_UNSUPPORTED', 'Automatic retrieval is supported for Docusign, Acrobat Sign and Dropbox Sign only. Record other provider evidence manually.', 409)
  const providerFiles=pkg.provider==='dropbox-sign'?{signedName:text(p,'signedName',200),certificateName:text(p,'certificateName',200)}:undefined
  if (providerFiles && (providerFiles.signedName===providerFiles.certificateName || Object.values(providerFiles).some(name=>!name.toLowerCase().endsWith('.pdf') || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')))) fail('RETRIEVAL_FILES','Name the distinct signed PDF and provider audit-trail PDF in the ZIP. Never assign one file to both roles.',409)
  const connection = await c.db.prepare("SELECT * FROM lk_signature_connections WHERE provider=?").bind(pkg.provider).first<SignatureConnection>()
  if (!connection) fail('SIGNATURE_CONFIG', 'Configure this signing connection first.', 503)
  signatureBase(pkg.provider, connection.base_url, c.env)
  signatureSecret(c.env, pkg.provider)
  if (await c.db.prepare("SELECT 1 FROM lk_execution_retrievals WHERE package_id=? AND status IN ('waiting','retrying','retrieving')").bind(pkg.id).first()) fail('RETRIEVAL_ACTIVE', 'Cancel the current authorization before authorizing this package again.', 409)
  const binding = await packageBinding(c, pkg, connection, providerFiles), id = crypto.randomUUID()
  return { allowed: ['owner'], result: { id, status: 'waiting' },
    checks: [...agreementGuards(c, a, p), bindingCheck(binding, pkg.manifest), sql("NOT EXISTS(SELECT 1 FROM lk_execution_retrievals WHERE package_id=? AND status IN ('waiting','retrying','retrieving'))", pkg.id)],
    writes: [sql("INSERT INTO lk_execution_retrievals (id,agreement_id,package_id,actor,connection_version,status,attempts,next_attempt_at,created_at,updated_at,binding,outcomes) VALUES(?,?,?,?,?,'waiting',0,?,?,?,?,'[]')", id, a.id, pkg.id, json(c.actor), connection.version, c.now, c.now, c.now, binding)],
    audit: [{ action: 'execution.retrieval.authorize', agreementId: a.id, summary: `Owner authorized retrieval and reconciliation of this exact sent ${pkg.provider} package. Authorization ends with the owner session or connection revision.` }] }
}

const cancel: Handler = async (c, p) => {
  requireRole(c.actor, ['owner'], 'cancel automatic retrieval')
  const a = await visibleAgreement(c, p.agreementId)
  return { allowed: ['owner'], result: { status: 'cancelled' }, checks: agreementGuards(c, a, p), writes: [sql("UPDATE lk_execution_retrievals SET status='cancelled',lease_until=NULL,outcomes=json_insert(outcomes,'$[#]',json(?)),updated_at=? WHERE agreement_id=? AND status IN ('waiting','retrying','retrieving')", json({status:'cancelled',code:'owner_cancelled',at:c.now,actorId:c.actor.id}), c.now, a.id)], audit: [{ action: 'execution.retrieval.cancel', agreementId: a.id, summary: 'Owner cancelled automatic retrieval.' }] }
}
export const retrievalHandlers = { 'execution.retrieval.authorize': enable, 'execution.retrieval.cancel': cancel }

async function get(connection: SignatureConnection, token: string, path: string, binary = false) {
  const response = await fetch(connection.base_url + path, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { authorization: connection.provider==='dropbox-sign'?`Basic ${btoa(token+':')}`:`Bearer ${token}`, accept: binary ? 'application/octet-stream' : 'application/json' } })
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
    let attemptChecks: Sql[] = [jobCheck, fullFieldsCheck(actor)]
    try {
      const auth = authority(actor, ['owner'])
      if (!(await db.prepare(`SELECT ${auth.sql} AS ok`).bind(...auth.params).first<{ok:number}>())?.ok) throw new Problem('AUTHORITY', 'The authorizing owner session ended.', 403)
      await requireFullFields(db, actor)
      const a = await visibleAgreement(c, row.agreement_id)
      const pkg = await db.prepare("SELECT * FROM lk_packages WHERE id=? AND agreement_id=? AND status='sent' AND version_id=?").bind(row.package_id, a.id, a.current_version_id).first<any>()
      const connection = pkg ? await db.prepare("SELECT * FROM lk_signature_connections WHERE provider=?").bind(pkg.provider).first<SignatureConnection>() : null
      if (!pkg || a.status !== 'out_for_signature' || !connection || connection.version !== row.connection_version) throw new Problem('STALE', 'The package or connection changed.', 409)
      const providerFiles=row.binding?JSON.parse(row.binding).providerFiles:undefined
      if (!row.binding || await packageBinding(c, pkg, connection, providerFiles) !== row.binding) throw new Problem('STALE', 'The exact authorized package changed. A new owner decision is required.', 409)
      const checks = [jobCheck, bindingCheck(row.binding, pkg.manifest), fullFieldsCheck(actor), ...agreementGuards(c, a)]
      attemptChecks = checks
      // Guard the actual attempt before any network read, and repeat at the result write.
      await commit(c, ['owner'], checks, [])
      signatureBase(pkg.provider, connection.base_url, env)
      const token = signatureSecret(env, pkg.provider)
      const evidence = await completedPackage(connection, pkg.envelope_id, async (path, binary) => {
        await commit(c, ['owner'], checks, [])
        return get(connection, token, path, binary)
      }, providerFiles)
      if (!evidence) {
        await commit(c, ['owner'], checks, [sql("UPDATE lk_execution_retrievals SET status='waiting',attempts=attempts+1,outcomes=json_insert(outcomes,'$[#]',json(?)),lease_until=NULL,next_attempt_at=?,updated_at=? WHERE id=?", json({status:'waiting',at:now}), now + 60_000, now, row.id)])
        continue
      }
      // One signable PDF is the current automatic reconciliation boundary.
      // Multi-document packets remain held by EXEC-001's packet_documents check.
      const p = { agreementId: a.id, version: a.version, envelopeId: pkg.envelope_id, executedOn: evidence.completed.toISOString().slice(0, 10), documentConfirmed: true,
        signers: evidence.signers,
        signed: { filename: `${a.reference}-signed.pdf`, mediaType: PDF, base64: encodeBase64(evidence.signed) }, certificate: { filename: `${a.reference}-certificate.pdf`, mediaType: PDF, base64: encodeBase64(evidence.certificate) } }
      const out = await executionHandlers['execution.record'](c, p), result = out.result as {executionId:string;status:string}
      await commit(c, ['owner'], [...(out.checks ?? []), ...checks], [...out.writes,
        ...await commandNotifications(c, 'execution.record', p, out), ...await workflowWrites(c, out.audit), ...out.audit.map(entry => auditSql(c, entry)),
        sql("UPDATE lk_execution_retrievals SET status=?,execution_id=?,attempts=attempts+1,outcomes=json_insert(outcomes,'$[#]',json(?)),lease_until=NULL,last_error=NULL,updated_at=? WHERE id=?", result.status, result.executionId, json({status:result.status,executionId:result.executionId,at:now}), now, row.id)])
      if(result.status==='reconciled')notify=true
    } catch (error) {
      const terminal = (error: unknown) => error instanceof Problem && ['AUTHORITY','STALE','NOT_FOUND','STATUS','FORBIDDEN','FIELD_ACCESS'].includes(error.code)
      // A failed read is also a result: it cannot schedule another attempt under
      // consent that ended while the request was outstanding.
      let outcome = error
      const codeOf = (error: unknown) => error instanceof Problem ? error.code : /^provider_[a-z0-9_]+$/.test(String((error as Error).message)) ? (error as Error).message : 'provider_read_failed'
      if (!terminal(outcome)) {
        const code = codeOf(outcome)
        try {
          await commit(c, ['owner'], attemptChecks, [sql("UPDATE lk_execution_retrievals SET status='retrying',attempts=attempts+1,outcomes=json_insert(outcomes,'$[#]',json(?)),lease_until=NULL,last_error=?,next_attempt_at=?,updated_at=? WHERE id=?", json({status:'retrying',code,at:now}), code, now + Math.min(3_600_000, 30_000 * 2 ** Math.min(row.attempts, 7)), now, row.id)])
          continue
        } catch (guardError) { if (!terminal(guardError)) throw guardError; outcome = guardError }
      }
      // End only this owned lease. A concurrent explicit cancellation keeps its
      // own decision and timestamp; no evidence or notification is committed.
      const code = codeOf(outcome)
      await db.prepare("UPDATE lk_execution_retrievals SET status='cancelled',attempts=attempts+1,outcomes=json_insert(outcomes,'$[#]',json(?)),lease_until=NULL,last_error=?,updated_at=? WHERE id=? AND status='retrieving' AND lease_until=?").bind(json({status:'cancelled',code,at:now}), code, now, row.id, lease).run()
    }
  }
  await runExecutionFollowups(env, now)
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
