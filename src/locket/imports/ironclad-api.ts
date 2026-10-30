import { authority, requireRole } from '../access'
import type { Ctx, Handler } from '../commands'
import { encodeBase64, readArtifactBytes, storeArtifact } from '../artifacts'
import { refuseErasedAddress } from '../erasure-addresses'
import { canonical, fail, integer, json, parse, sha256, sql, text } from '../model'
import { fullFieldsCheck } from '../repository-access'
import { normalizeRecords, readIroncladInput } from './ironclad'
import { IMPORT_LIMIT } from './zip'

const regions = { na1: 'https://na1.ironcladapp.com', eu1: 'https://eu1.ironcladapp.com', demo: 'https://demo.ironcladapp.com' }
function connection(c: Ctx) {
  const region = c.env.IRONCLAD_REGION ?? 'na1', origin = regions[region as keyof typeof regions], token = c.env.IRONCLAD_API_TOKEN
  if (!origin || !token) fail('IRONCLAD_CONNECTION', 'Configure the private Ironclad API token and region before reading records.', 409)
  return { origin, token, base: origin + '/public/api/v1' }
}
async function authorization(c: Ctx) {
  requireRole(c.actor, ['owner'], 'read Ironclad records')
  const a = authority(c.actor, ['owner']), f = fullFieldsCheck(c.actor)
  if (!await c.db.prepare(`SELECT 1 WHERE (${a.sql}) AND (${f.sql})`).bind(...a.params, ...f.params).first()) fail('AUTHORITY', 'Your owner session ended. Start a new explicitly authorized read.', 403)
}
async function bounded(response: Response) {
  if (!response.ok) { await response.body?.cancel(); fail('IRONCLAD_READ', `Ironclad returned HTTP ${response.status}. No agreements were imported.`, 502) }
  if (Number(response.headers.get('content-length')) > IMPORT_LIMIT) { await response.body?.cancel(); fail('IMPORT_SIZE', 'Split the Ironclad selection into smaller batches.', 413) }
  const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let total = 0
  if (!reader) fail('IRONCLAD_READ', 'Ironclad returned an empty response.', 502)
  for (;;) {
    const { value, done } = await reader.read(); if (done) break
    total += value.length
    if (total > IMPORT_LIMIT) { await reader.cancel(); fail('IMPORT_SIZE', 'Split the Ironclad selection into smaller batches.', 413) }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}
async function api(c: Ctx, path: string, body?: unknown) {
  await authorization(c)
  const config = connection(c)
  let response: Response
  try { response = await fetch(config.base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' }, ...(body ? { body: json(body) } : {}), redirect: 'manual', signal: AbortSignal.timeout(20_000) }) }
  catch { fail('IRONCLAD_READ', 'Ironclad could not be reached. No agreements were imported; retry the read explicitly.', 502) }
  const bytes = await bounded(response)
  await authorization(c)
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { fail('IRONCLAD_READ', 'Ironclad returned unreadable JSON.', 502) }
}
const start: Handler = async (c, p) => {
  await authorization(c)
  if (p.consent !== true) fail('CONSENT', 'Explicitly authorize reading the selected Ironclad records and their original documents.')
  const label = text(p, 'label', 200), records: any[] = [], pages: any[] = []
  let page = 0
  for (;;) {
    const response = await api(c, `/records?page=${page}&pageSize=100`)
    if (!Array.isArray(response.list)) fail('IRONCLAD_READ', 'The Records API returned no list.', 502)
    records.push(...response.list); pages.push(response)
    if (records.length > 250) fail('IRONCLAD_RECORDS', 'Export a selection of at most 250 records for this batch.')
    if (!response.list.length && response.count !== undefined && records.length < Number(response.count)) fail('IRONCLAD_READ','The Records API ended before its reported total; no partial selection is offered.',502)
    if (!response.list.length || (response.count !== undefined ? records.length >= Number(response.count) : response.list.length < Number(response.pageSize || 100))) break
    if (++page >= 250) fail('IRONCLAD_RECORDS', 'Split this API selection into smaller exports.')
  }
  normalizeRecords(records)
  c.erasureChecks = await refuseErasedAddress(c, 'import.preview', { records })
  const jobs: string[] = []
  for (let i=0;i<records.length;i+=100) {
    const job = await api(c,'/records/attachments/download-urls',{identifiers:records.slice(i,i+100).map(r=>r.id),type:'latestSignedCopy'})
    if (job.status !== 'processing' || typeof job.jobId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(job.jobId)) fail('IRONCLAD_READ','Ironclad returned no valid attachment job.',502)
    jobs.push(job.jobId)
  }
  const jobId = json(jobs)
  const id = crypto.randomUUID(), config = connection(c), binding = await sha256(canonical({ origin: config.origin, token: config.token }))
  const metadata = await storeArtifact({ filename:'records.json', mediaType:'application/json', bytes:new TextEncoder().encode(json({list:records,pages})) }, {agreementId:null,role:'import_source',sourceSystem:'ironclad-api',sourceId:id,provenance:{readId:id,imported:true},imported:true,actorId:c.actor.id,at:c.now})
  return { allowed: ['owner'], result: { id, status: records.length ? 'pending' : 'ready', records: records.length },
    writes: [...metadata.writes,sql('INSERT INTO lk_ironclad_reads(id,actor_id,session_id,label,origin,connection_digest,metadata,job_id,status,created_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,1)', id,c.actor.id,c.actor.sessionId,label,config.origin,binding,metadata.id,jobId,records.length?'pending':'ready',c.now)],
    audit: [{ action: 'import.ironclad.start', summary: `Authorized read of ${records.length} Ironclad repository records and attachment job. No agreements imported.` }] }
}
const poll: Handler = async (c, p) => {
  await authorization(c)
  const row = await c.db.prepare('SELECT * FROM lk_ironclad_reads WHERE id=? AND actor_id=? AND session_id=?').bind(text(p,'id',64),c.actor.id,c.actor.sessionId).first<any>()
  if (!row) fail('NOT_FOUND', 'No Ironclad read belongs to this owner session.', 404)
  if (row.version !== integer(p,'version',1)) fail('STALE', 'This attachment job changed. Reload before checking again.', 409)
  if (Date.now()-row.created_at > 30*60_000) fail('IRONCLAD_EXPIRED', 'This read expired after 30 minutes. Authorize a new read.',409)
  const config = connection(c)
  if (row.connection_digest !== await sha256(canonical({ origin: config.origin,token:config.token }))) fail('IRONCLAD_CONNECTION','The private connection changed. Authorize a new read.',409)
  const checks = [sql('EXISTS(SELECT 1 FROM lk_ironclad_reads WHERE id=? AND version=? AND session_id=?)',row.id,row.version,c.actor.sessionId)]
  let status = row.status, archive = row.archive, message = '', archiveBytes:Uint8Array|undefined
  const writes = [] as ReturnType<typeof sql>[]
  const metadataBytes = await readArtifactBytes(c.db,row.metadata)
  try {
    if (status === 'pending') {
      const jobs = parse<string[]>(row.job_id)
      const results = []
      for (const id of jobs) {
        const result=await api(c, `/records/attachments/download-urls/${encodeURIComponent(id)}`)
        if(result.jobId!==id)fail('IRONCLAD_READ','The provider returned a different attachment job identity.',502)
        results.push(result)
      }
      if (results.some(job=>job.status === 'processing')) message = 'Ironclad is preparing attachment download URLs. Check again when ready.'
      else if (results.some(job=>job.status !== 'complete')) { status='failed';message='Ironclad could not prepare attachments. Authorize a new read.' }
      else {
        const records = JSON.parse(new TextDecoder().decode(metadataBytes)).list as any[]
        const succeeded = results.flatMap(job=>Array.isArray(job.succeeded)?job.succeeded:[])
        const failed = results.flatMap(job=>Array.isArray(job.failed)?job.failed:[])
        const selected = new Set(records.map(r=>r.id)), outcomes = [...succeeded,...failed].map(r=>r.identifier)
        if (outcomes.length !== selected.size || new Set(outcomes).size !== selected.size || outcomes.some(id=>!selected.has(id))) fail('IRONCLAD_READ','Attachment job results do not match the selected record identities.',502)
        if (failed.length) fail('IRONCLAD_ATTACHMENT_FAILURE',`${failed.length} records could not supply attachments (${[...new Set(failed.map(r=>r.errorCode))].join(', ')}). No partial import is offered.`,502)
        const files: {path:string;base64:string}[] = []
        let total=metadataBytes.length
        const download = async (raw:string, authenticated=false):Promise<Uint8Array> => {
          let url:URL
          try {url=new URL(raw)} catch {fail('IRONCLAD_READ','An attachment has no valid download URL.',502)}
          if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.origin===config.origin || url.hostname==='storage.googleapis.com' || /^(?:[a-z0-9-]+\.)+(?:amazonaws\.com|storage\.googleapis\.com)$/.test(url.hostname))) fail('IRONCLAD_READ','Unsupported original-download destination.',502)
          if(authenticated && url.origin!==config.origin)fail('IRONCLAD_READ','Authenticated attachment destinations must belong to the configured provider.',502)
          await authorization(c)
          const response=await fetch(url,{headers:authenticated?{Authorization:'Bearer '+config.token}:{},redirect:'manual',signal:AbortSignal.timeout(20_000)})
          if(authenticated && [301,302,303,307,308].includes(response.status)) {
            const next=response.headers.get('location');await response.body?.cancel()
            if(!next)fail('IRONCLAD_READ','Attachment redirect has no destination.',502)
            return download(new URL(next,url).href)
          }
          const bytes=await bounded(response);await authorization(c)
          total+=bytes.length
          if(total>IMPORT_LIMIT)fail('IMPORT_SIZE','Split this API selection into smaller batches.',413)
          return bytes
        }
        for (const record of records) {
          const result=succeeded.find(r=>r.identifier===record.id)
          if(result.recordId!==record.id || result.ironcladId!==record.ironcladId || !record.attachments?.[result.fileKey] || result.filename!==record.attachments[result.fileKey].filename || !/^[a-f0-9]{64}$/i.test(result.fileHash) || !Number.isFinite(Date.parse(result.expiration)) || Date.parse(result.expiration)<=c.now)fail('IRONCLAD_READ','The attachment job identity, hash or expiry is invalid.',502)
          for(const [key,attachment] of Object.entries(record.attachments) as [string,any][]) {
            if(!attachment.filename || /[\/\\\x00-\x1f]/.test(attachment.filename))fail('IRONCLAD_READ','Attachment filenames must be plain names.',502)
            const bytes=await download(key===result.fileKey?result.downloadUrl:config.base+`/records/${encodeURIComponent(record.id)}/attachments/${encodeURIComponent(key)}`,key!==result.fileKey)
            if(key===result.fileKey && attachment.fileHash && attachment.fileHash.toLowerCase()!==result.fileHash.toLowerCase())fail('IRONCLAD_READ','Attachment metadata changed after the Records snapshot. Authorize a new read.',502)
            const digest=await sha256(bytes),expected=key===result.fileKey?result.fileHash:attachment.fileHash
            if(expected && digest!==expected.toLowerCase())fail('IRONCLAD_READ','Downloaded attachment digest differs from the provider metadata.',502)
            files.push({path:record.id+'/'+attachment.filename,base64:encodeBase64(bytes)})
          }
        }
        const source={label:row.label,manifest:{filename:'records.json',base64:encodeBase64(metadataBytes)},files}
        const input=await readIroncladInput(source)
        c.erasureChecks=await refuseErasedAddress(c,'import.preview',{records:input.records,files})
        // Custody holds exact downloaded bytes; signed URLs are never persisted.
        const bytes=new TextEncoder().encode(json(files))
        const stored=await storeArtifact({filename:'ironclad-attachments.json',mediaType:'application/json',bytes},{agreementId:null,role:'import_source',sourceSystem:'ironclad-api',sourceId:row.id,provenance:{readId:row.id,imported:true},imported:true,actorId:c.actor.id,at:c.now})
        writes.push(...stored.writes);archive=stored.id;archiveBytes=bytes;status='ready';message='Original attachments are ready for mapping and dry run.'
      }
    }
  } catch (error) {
    if ((error as any).code === 'AUTHORITY') throw error
    // Read errors are visible and explicit retry is safe; no native import was attempted.
    if ((error as any).code === 'IRONCLAD_ATTACHMENT_FAILURE') status='failed'
    message = (error as any).code ? (error as Error).message : 'Attachment read failed. Check the connection and retry explicitly.'
  }
  if(status==='ready'&&archive&&!archiveBytes)archiveBytes=await readArtifactBytes(c.db,archive)
  const input = status === 'ready' ? { label:row.label, manifest:{filename:'records.json',base64:encodeBase64(metadataBytes)}, ...(archiveBytes?{files:JSON.parse(new TextDecoder().decode(archiveBytes))}:{}) } : null
  return { allowed:['owner'], result:{id:row.id,status,message,version:row.version+1,input},checks,
    writes:[...writes,sql('UPDATE lk_ironclad_reads SET status=?,archive=?,message=?,checked_at=?,version=version+1 WHERE id=?',status,archive??null,message,c.now,row.id)],
    audit:[{action:'import.ironclad.poll',summary:`Ironclad attachment read ${status}: ${message}`}] }
}
export const ironcladApiHandlers: Record<string,Handler> = {'import.ironclad.start':start,'import.ironclad.poll':poll}
