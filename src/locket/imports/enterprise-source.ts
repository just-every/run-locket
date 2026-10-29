import { commit, auditSql, type Ctx } from '../commands'
import { operationObservation } from '../connection-observations'
import { alertConnectionFailure } from '../connection-health'
import { authority, may } from '../access'
import { decodeBase64 } from '../artifacts'
import { fail, object, sha256, text } from '../model'
import { readKitInput, type KitInput } from './docusign'
import { readTable } from './spreadsheet'

export const enterpriseKits = ['icertis', 'agiloft'] as const
export type EnterpriseKit = typeof enterpriseKits[number]
export interface ApiProfile {
  release: string; documentation: string; baseUrl: string
  listPath: string; recordsKey: string; nextKey?: string; idColumn: string
  readPath?: string; recordKey?: string; documentsPath?: string; documentsKey?: string
  documentName?: string; documentUrl?: string; documentRole?: string
  attachmentFields?: string[]; knowledgeBase?: string; table?: string
}
const pick = (value: any, path = ''): any => path ? path.split('.').reduce((v, k) => v?.[k], value) : value

/** Only a server-installed, tenant-documented read profile may choose endpoints.
 * Credentials never enter commands, reviewed source snapshots or URL parameters. */
async function readEnterpriseInput(c: Ctx, p: Record<string, unknown>, kit: EnterpriseKit): Promise<KitInput & { api?: { release: string; documentation: string } }> {
  if (p.source !== 'api') return readKitInput({ ...p, dateFormat: p.dateFormat ?? 'iso' })
  if (p.consent !== true) fail('CONSENT', 'Authorize this read-only source import explicitly.')
  const env = c.env as any, prefix = kit.toUpperCase(), token = env[prefix + '_IMPORT_TOKEN'], rawProfile = env[prefix + '_IMPORT_PROFILE']
  if (!token || !rawProfile) fail('IMPORT_CONNECTION', 'Install the private read credential and tenant-documented API profile first.', 409)
  let profile: ApiProfile
  try { profile = JSON.parse(rawProfile) } catch { fail('IMPORT_CONNECTION', 'The server API profile is invalid.', 409) }
  if (!profile.release || !profile.documentation || !profile.idColumn) fail('IMPORT_CONNECTION', 'The profile must record its release, tenant documentation and identity column.', 409)
  let base: URL
  try { base = new URL(profile.baseUrl) } catch { fail('IMPORT_CONNECTION','The configured source URL is invalid.',409) }
  if (base.protocol !== 'https:' || base.username || base.password || base.port || base.search || base.hash || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(base.hostname) || /^(?:\d+\.)+\d+$/.test(base.hostname) || /\.(local|localhost)$/i.test(base.hostname)) fail('IMPORT_CONNECTION', 'Use a public HTTPS source origin.', 409)
  const at = Date.now(), artifacts: { path: string; bytes: Uint8Array; sha256: string }[] = [], snapshots: any[] = []
  let bytesRead = 0, calls = 0
  const read = async (path: string, params: Record<string, string> = {}, binary = false) => {
    const auth = authority(c.actor, may.imports)
    if (!await c.db.prepare(`SELECT 1 WHERE ${auth.sql}`).bind(...auth.params).first()) fail('AUTHORITY', 'Import authority ended before the next provider read.', 403)
    if (++calls > 600 || Date.now() - at > 90_000) fail('IMPORT_LIMIT', 'The source read reached its bound. Select a smaller saved search.', 413)
    const url = new URL(path, base)
    if (url.origin !== base.origin || url.username || url.password || url.hash) fail('IMPORT_CONNECTION', 'A source endpoint or download left the configured origin.', 409)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    let response: Response
    try { response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual', signal: AbortSignal.timeout(15_000) }) } catch { fail('IMPORT_PROVIDER', 'The source read failed; no agreements were imported. Review the connection and run a new dry run.', 502) }
    if (!response.ok) fail('IMPORT_PROVIDER', `The source refused a read (HTTP ${response.status}); no agreements were imported.`, 502)
    const reader = response.body?.getReader(), chunks: Uint8Array[] = []
    if (reader) while (true) {
      const { done, value } = await reader.read(); if (done) break
      bytesRead += value.length
      if (bytesRead > 6 * 1024 * 1024) { await reader.cancel(); fail('IMPORT_SIZE', 'The source exceeds 6 MB. Select a smaller search.', 413) }
      chunks.push(value)
    }
    const bytes = new Uint8Array(chunks.reduce((n, v) => n + v.length, 0)); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    if (binary) return bytes
    let value: any
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { fail('IMPORT_PROVIDER', 'The source did not return valid JSON.', 502) }
    if (new TextDecoder().decode(bytes).includes(token)) fail('IMPORT_PROVIDER','The source returned credential-bearing content; it was not retained.',502)
    // Keep the exact original JSON, with no request URL, headers or credentials.
    artifacts.push({ path: `_api/response-${artifacts.length + 1}.json`, bytes, sha256: await sha256(bytes) })
    snapshots.push(value)
    return value
  }
  const rows: Record<string, string>[] = [], documents: Record<string, string[]> = {}
  const common: Record<string, string> = kit === 'agiloft' ? { $KB: profile.knowledgeBase ?? '', $table: profile.table ?? 'contract' } : {}
  let next = profile.listPath
  const visited = new Set<string>()
  while (next) {
    if (visited.has(next) || visited.size >= 20) fail('IMPORT_PROVIDER', 'The source pagination repeats or exceeds twenty pages.', 502)
    visited.add(next)
    const result = await read(next, common), records = pick(result, profile.recordsKey)
    if (!Array.isArray(records)) fail('IMPORT_PROVIDER', 'The source list does not match the documented profile.', 502)
    for (const record of records) {
      if (rows.length >= 100) fail('IMPORT_LIMIT', 'Select at most 100 source records per reviewed batch.', 413)
      let row: any = record
      if (kit === 'agiloft') row = pick(await read(profile.readPath ?? 'EWRead', { ...common, $id: String(record) }), profile.recordKey ?? 'result')
      if(!row || typeof row!=='object' || Array.isArray(row))fail('IMPORT_PROVIDER','The source record does not match the documented profile.',502)
      row = object(row, 'source record')
      const rawId = row[profile.idColumn]
      if (typeof rawId !== 'string' && !(typeof rawId === 'number' && Number.isSafeInteger(rawId))) fail('IMPORT_PROVIDER','A source identity is invalid.',502)
      const id = text({id:String(rawId)}, 'id', 200)
      if (Object.hasOwn(documents, id)) fail('IMPORT_PROVIDER', 'The source returned a repeated record identity.', 502)
      documents[id] = []
      rows.push(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])))
      if (kit === 'icertis') {
        if (!profile.documentsPath) fail('IMPORT_CONNECTION', 'The ICI profile needs its documented Document List path.', 409)
        const body = await read(profile.documentsPath.replaceAll('{id}', encodeURIComponent(id))), docs = pick(body, profile.documentsKey ?? 'documents')
        if (!Array.isArray(docs)) fail('IMPORT_PROVIDER', 'The Document List does not match the documented profile.', 502)
        for (const doc of docs) {
          const name = text(doc, profile.documentName ?? 'name', 200), path = `${id}/${name}`
          const bytes = await read(text(doc, profile.documentUrl ?? 'url', 1000), {}, true) as Uint8Array
          artifacts.push({ path, bytes, sha256: await sha256(bytes) }); documents[id].push(path)
        }
      } else {
        for (const field of profile.attachmentFields ?? []) {
          const body = await read('EWAttachInfo', { ...common, $id: id, $field: field }), docs = pick(body, profile.documentsKey ?? 'result')
          if (!Array.isArray(docs)) fail('IMPORT_PROVIDER', 'EWAttachInfo did not return the documented attachment list.', 502)
          for (const doc of docs) {
            const name = text(doc, 'name', 200)
            if (!Number.isInteger(doc.position) || doc.position < 0 || !Number.isInteger(doc.size) || doc.size < 0) fail('IMPORT_PROVIDER', 'An attachment position or size is invalid.', 502)
            const path = `${id}/${field}/${name}`, bytes = await read('EWRetrieve', { ...common, $id: id, $field: field, $position: String(doc.position) }, true) as Uint8Array
            if (bytes.length !== doc.size) fail('IMPORT_PROVIDER', 'An attachment differs from its listed size.', 502)
            artifacts.push({ path, bytes, sha256: await sha256(bytes) }); documents[id].push(path)
          }
        }
      }
    }
    const value = profile.nextKey ? pick(result, profile.nextKey) : null
    if (value !== null && value !== undefined && value !== '' && typeof value !== 'string') fail('IMPORT_PROVIDER', 'The next-page value is invalid.', 502)
    next = value || ''
  }
  if (p.manifest) {
    const exported = await readKitInput({...p,dateFormat:'iso'})
    const metadata = readTable(exported.manifest.filename,exported.manifest.bytes)
    for (const original of metadata.rows) {
      const id=original[profile.idColumn], remote=rows.find(r=>r[profile.idColumn]===id)
      if (remote) {
        for (const [column,value] of Object.entries(original)) {
          if(value&&remote[column]&&value!==remote[column]) fail('IMPORT_SOURCE_CONFLICT','Export and API metadata disagree. Review a consistent snapshot before importing.',409)
          if(value)remote[column]=value
        }
      } else rows.push(original)
    }
    artifacts.push({path:'_source/'+exported.manifest.filename,bytes:exported.manifest.bytes,sha256:exported.manifest.sha256})
    for(const f of exported.files) {
      const held=artifacts.find(a=>a.path===f.path)
      if(held&&held.sha256!==f.sha256)fail('IMPORT_SOURCE_CONFLICT','Export and API document bytes disagree.',409)
      if(!held)artifacts.push(f)
    }
  }
  const header = [...new Set(rows.flatMap(r => Object.keys(r)))]
  const csv = [header, ...rows.map(r => header.map(h => r[h] ?? ''))].map(row => row.map(v => '"' + v.replaceAll('"', '""') + '"').join(',')).join('\r\n')
  if(rows.length>100)fail('IMPORT_LIMIT','Select at most 100 combined source records.',413)
  const bytes = new TextEncoder().encode(csv)
  // API snapshots and document bytes are retained by the same journal as exports.
  const input = await readKitInput({ label: p.label, dateFormat: 'iso', manifest: { filename: `${kit}-api.csv`, base64: encode(bytes) }, files: artifacts.map(f => ({ path: f.path, base64: encode(f.bytes) })) })
  return { ...input, api: { release: profile.release, documentation: profile.documentation } }
}
function encode(bytes: Uint8Array) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s) }


export async function enterpriseInput(c: Ctx, p: Record<string, unknown>, kit: EnterpriseKit) {
  if(p.source!=='api')return readEnterpriseInput(c,p,kit)
  let account='Configured source (identity unverified)'
  try { account=new URL(JSON.parse((c.env as any)[kit.toUpperCase()+'_IMPORT_PROFILE']).baseUrl).origin } catch {}
  try {
    const result=await readEnterpriseInput(c,p,kit)
    await commit(c,may.imports,[],[operationObservation(kit+'-import',account,c.now,true,'source_read_completed_identity_unverified'),auditSql(c,{action:'import.source.read',summary:`${kit} read-only source snapshot completed; vendor identity remains unverified.`})])
    return result
  } catch(error) {
    if((error as {code?:string}).code==='IMPORT_PROVIDER') {
      await commit(c,may.imports,[],[operationObservation(kit+'-import',account,c.now,false,'source_read_failed_no_new_agreements'),auditSql(c,{action:'import.source.failed',summary:`${kit} read-only source import failed; no source snapshot was accepted.`})])
      await alertConnectionFailure(c.env,kit+'-import')
    }
    throw error
  }
}
