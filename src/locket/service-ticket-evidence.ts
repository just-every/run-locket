import { fail, sha256 } from './model'

// Published Linen implementation, read at 2000a899562f7501452309bcf881a40a3339e9e2:
// src/features/mcp/{protocol,tools,projection,authority}.ts and
// src/features/work/{core,sla-policies,sla-clock}.ts. No REST session is used.
const contractRef = 'https://github.com/just-every/run-linen/tree/2000a899562f7501452309bcf881a40a3339e9e2/src/features/mcp'
type ClockBasis = 'business' | 'calendar' | 'unknown'
interface Target {
  startedAt: string | null; dueAt: string | null; metAt: string | null
  state: 'met' | 'breached' | 'running' | 'paused'; breachedAt: string | null
}
export interface LinenTicketRecord {
  recordId: string; queueId: string; revision: number; state: string
  createdAt: string | null; firstPublicResponseAt: string | null
  resolvedAt: string | null; closedAt: string | null; dueAt: string | null; deliveredAt: null
  resolutionBasis: 'closure_only' | 'unknown'
  responseDueAt: string | null; clockBasis: ClockBasis
  sla: { policyId: string; policyRevision: number; firstResponse: Target; resolution: Target } | null
  provenance: { createdAt: string; firstPublicResponseAt: string; resolvedAt: string; dueAt: string; deliveredAt: null }
}
export interface LinenTicketSelection {
  installation: string; credential: string; queueIds: string[]; recordIds: string[]
}

export function linenOrigin(value: unknown): string {
  let url: URL
  try { url = new URL(String(value)) } catch { fail('LINEN_CONFIG', 'Configure the exact HTTPS Linen installation.', 409) }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) || /^(?:\d+\.)+\d+$/.test(url.hostname) ||
      /\.(?:local|localhost)$/i.test(url.hostname) || url.hostname === 'app.happytohelp.com')
    fail('LINEN_CONFIG', 'Use the exact public HTTPS Linen origin without credentials, path, port or query.', 409)
  return url.origin
}

/** Exact-id reads need only work.read + work.get and the owner's queue grant.
 * No list/search/history/attachments or write tools are ever invoked. Raw MCP
 * projections contain identities/conversation: the caller must first hold the
 * owner's exact installation, queue, record and original-evidence consent. */
export async function readLinenTicketEvidence(selection: LinenTicketSelection) {
  const origin = linenOrigin(selection.installation), sourcePath = `${origin}/api/mcp`
  selectedIds(selection.recordIds, 20, 'record'); selectedIds(selection.queueIds, 20, 'queue')
  if (typeof selection.credential !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(selection.credential))
    fail('LINEN_CONFIG', 'The server-only Linen MCP credential is missing or invalid.', 409)
  const signal = AbortSignal.timeout(15000), records: LinenTicketRecord[] = [], warnings: string[] = []
  const responses: { recordId: string; requestId: string; sha256: string; body: string }[] = []
  let totalBytes = 0
  for (const [index, recordId] of selection.recordIds.entries()) {
    const requestId = `locket-ticket-${index + 1}`
    let response: Response, bytes: Uint8Array
    try {
      response = await fetch(sourcePath, {
        method: 'POST', headers: { Authorization: `Bearer ${selection.credential}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method: 'tools/call', params: { name: 'work.get', arguments: { workId: recordId } } }),
        redirect: 'manual', signal,
      })
      if (!response.ok) {
        await response.body?.cancel()
        fail('LINEN_UNAVAILABLE', 'Linen refused or redirected the selected record read. No credential followed a redirect and no partial evidence is used.', 502)
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel(); fail('LINEN_DATA', 'Linen did not return its published JSON MCP response.', 502)
      }
      bytes = await boundedBytes(response, signal)
    } catch (error) {
      if ((error as { code?: string }).code?.startsWith('LINEN_')) throw error
      fail('LINEN_UNAVAILABLE', 'Linen could not be read within the evidence bounds. No partial evidence is used.', 502)
    }
    totalBytes += bytes.length
    if (totalBytes > 2 * 1024 * 1024) fail('LINEN_DATA', 'The selected Linen evidence exceeds 2 MiB; narrow the exact record selection.', 502)
    let body: string, rpc: any
    try { body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); rpc = JSON.parse(body) }
    catch { fail('LINEN_DATA', 'Linen returned invalid UTF-8 JSON; no partial evidence is used.', 502) }
    if (!rpc || rpc.jsonrpc !== '2.0' || rpc.id !== requestId || Array.isArray(rpc))
      fail('LINEN_DATA', 'Linen response identity does not match the selected read.', 502)
    if (rpc.error) fail('LINEN_RECORD_UNAVAILABLE', 'A selected Linen record is missing, withheld or denied, or its MCP tool/credential is unavailable. No partial cohort is used.', 502)
    if (rpc.result?.isError !== false || !rpc.result.structuredContent ||
        !Array.isArray(rpc.result.content) || rpc.result.content.length !== 1 || rpc.result.content[0]?.type !== 'text')
      fail('LINEN_DATA', 'Linen did not return its published work.get projection.', 502)
    const row = rpc.result.structuredContent
    if (typeof row !== 'object' || Array.isArray(row) || rpc.result.content[0].text !== JSON.stringify(row))
      fail('LINEN_DATA', 'Linen text and structured projections disagree or are not a ticket object.', 502)
    // get is an unpaginated single-record tool. Never silently accept a list,
    // truncated page or provider continuation as a complete selected cohort.
    if (row.id !== recordId || 'items' in row || 'nextOffset' in row || 'nextCursor' in row)
      fail('LINEN_DATA', 'Linen returned another record or a paginated response for an exact-id read.', 502)
    if (!row.group || !selection.queueIds.includes(row.group.id))
      fail('LINEN_SCOPE', 'A selected Linen record is outside the explicitly authorized queues. No partial evidence is used.', 409)
    records.push(normalize(row, warnings))
    responses.push({ recordId, requestId, sha256: await sha256(bytes), body })
  }
  warnings.push('Linen work.get does not publish verified fulfillment or delivery evidence; deliveredAt is unknown. Its resolution SLA achievement is derived from ticket closure, not independently verified resolution.')
  // A lossless original-response envelope, not a synthesized provider report.
  // Each body's UTF-8 bytes and original SHA-256 can be recovered independently.
  const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, provider: 'linen', sourcePath, contractRef, responses }))
  if (bytes.length > 4 * 1024 * 1024) fail('LINEN_DATA', 'The lossless Linen evidence envelope exceeds 4 MiB; narrow the exact record selection.', 502)
  return { provider: 'linen' as const, sourcePath, bytes, sha256: await sha256(bytes), records, warnings: [...new Set(warnings)] }
}

function selectedIds(value: unknown, maximum: number, kind: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.length || value.length > maximum || new Set(value).size !== value.length ||
      value.some(id => typeof id !== 'string' || !id.trim() || id.length > 200 || /[\x00-\x1f\x7f]/.test(id)))
    fail('LINEN_SCOPE', `Choose 1 to ${maximum} distinct explicit Linen ${kind} ids.`, 409)
}
function timestamp(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)))
    fail('LINEN_DATA', 'Linen returned an invalid timestamp; no elapsed time is inferred.', 502)
  const normalized = new Date(value).toISOString()
  if (normalized.slice(0, 19) !== value.slice(0, 19)) fail('LINEN_DATA', 'Linen returned an invalid calendar timestamp.', 502)
  return normalized
}
function target(value: any, name: string): Target {
  if (!value || value.target !== name || !['met', 'breached', 'running', 'paused'].includes(value.state))
    fail('LINEN_DATA', 'Linen returned an invalid SLA target projection.', 502)
  return { startedAt: timestamp(value.startedAt), dueAt: timestamp(value.dueAt), metAt: timestamp(value.metAt), state: value.state, breachedAt: timestamp(value.breachedAt) }
}
function normalize(row: any, warnings: string[]): LinenTicketRecord {
  if (!['open', 'paused', 'closed', 'cancelled'].includes(row.state) || !Number.isSafeInteger(row.revision) || row.revision < 1)
    fail('LINEN_DATA', 'Linen returned an invalid ticket state or revision.', 502)
  const createdAt = timestamp(row.created_at), firstPublicResponseAt = timestamp(row.response_at)
  const closedAt = timestamp(row.closed_at), nativeResolutionAt = row.state === 'closed' ? closedAt : null
  let sla: LinenTicketRecord['sla'] = null, clockBasis: ClockBasis = 'unknown'
  if (row.sla !== null && row.sla !== undefined) {
    const policy = row.sla.policy
    if (!policy || typeof policy.id !== 'string' || !policy.id || !Number.isSafeInteger(policy.revision) || policy.revision < 1 || !['business', 'calendar'].includes(policy.hours))
      fail('LINEN_DATA', 'Linen returned an invalid SLA policy projection.', 502)
    clockBasis = policy.hours
    sla = { policyId: policy.id, policyRevision: policy.revision, firstResponse: target(row.sla.firstResponse, 'first_response'), resolution: target(row.sla.resolution, 'resolution') }
    if (sla.firstResponse.metAt !== firstPublicResponseAt || sla.resolution.metAt !== nativeResolutionAt ||
        sla.firstResponse.startedAt !== createdAt || sla.resolution.startedAt !== createdAt)
      fail('LINEN_DATA', 'Linen ticket and SLA achievement timestamps disagree; no performance conclusion is inferred.', 502)
    if (clockBasis === 'business') warnings.push('Linen supplies business-calendar SLA target instants but withholds the calendar and location. Business elapsed minutes and equivalence to the signed contractual calendar remain unknown.')
    else warnings.push('Linen calendar-hour targets include the provider policy and pauses; the signed contractual clock and exclusions require separate confirmation.')
  } else warnings.push('A selected Linen ticket has no published bound SLA policy; contractual due time and clock basis remain unknown.')
  const resolvedAt = sla?.resolution.metAt ?? null
  if (resolvedAt) warnings.push('A Linen resolution metAt is backed only by ticket closure. Contractual resolution is unknown unless the confirmed signed definition explicitly accepts that observation.')
  if (!createdAt || !firstPublicResponseAt || !resolvedAt) warnings.push('Some selected ticket achievement timestamps are absent. Missing observations remain unknown, not zero or a completed response/resolution.')
  for (const value of [firstPublicResponseAt, resolvedAt]) if (value && createdAt && value < createdAt)
    fail('LINEN_DATA', 'Linen achievement predates ticket creation; no performance conclusion is inferred.', 502)
  return {
    recordId: row.id, queueId: row.group.id, revision: row.revision, state: row.state,
    createdAt, firstPublicResponseAt, resolvedAt, closedAt, resolutionBasis: resolvedAt ? 'closure_only' : 'unknown', dueAt: sla?.resolution.dueAt ?? null, deliveredAt: null,
    responseDueAt: sla?.firstResponse.dueAt ?? null, clockBasis, sla,
    provenance: { createdAt: 'created_at', firstPublicResponseAt: 'response_at', resolvedAt: 'sla.resolution.metAt (provider derives this from closed_at when state=closed)', dueAt: 'sla.resolution.dueAt', deliveredAt: null },
  }
}
async function boundedBytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length') ?? 0) > 1024 * 1024 || !response.body) {
    await response.body?.cancel(); fail('LINEN_DATA', 'Linen returned no body or more than 1 MiB for one selected record.', 502)
  }
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const next = await reader.read(); if (next.done) break
      size += next.value.length
      if (size > 1024 * 1024) { await reader.cancel(); fail('LINEN_DATA', 'Linen record exceeds 1 MiB; no partial evidence is used.', 502) }
      parts.push(next.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return bytes
}
