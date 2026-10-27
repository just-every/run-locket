import type { Bindings } from '../auth.server'
import { requireRole } from './access'
import { encodeBase64, MAX_FILE_BYTES, readArtifactBytes } from './artifacts'
import { auditSql, commit, type Ctx, type Handler } from './commands'
import { canonical, fail, json, integer, oneOf, sha256, sql, text } from './model'
import { agreementGuards, visibleAgreement } from './records'
import { fullFieldsCheck, policyVersionCheck, repositoryPolicy } from './repository-access'
import { completeModelCommand, modelHandlers, modelSettings } from './model-settings'

const kinds = ['extraction','google-drive','onedrive','sharepoint','chest','hubspot'] as const
function secret(env: Bindings, kind: string) {
 const key = kind === 'chest' ? 'CHEST_TOKEN' : kind === 'google-drive' ? 'EXECUTION_GOOGLE_DRIVE_TOKEN' : kind === 'hubspot' ? 'HUBSPOT_ACCESS_TOKEN' : 'EXECUTION_MICROSOFT_TOKEN'
 const value = (env as unknown as Record<string, unknown>)[key]
 if (typeof value !== 'string' || !value) fail('FOLLOWUP_CONFIG', `Configure ${key} in private installation settings.`, 503)
 return value
}
async function packageIdentity(c: Ctx, id: string, agreementId: string) {
 const p = await c.db.prepare('SELECT * FROM lk_packages WHERE id=? AND agreement_id=?').bind(id,agreementId).first<any>()
 if (!p || !['sent','completed'].includes(p.status)) fail('STATUS','Choose the exact sent package.',409)
 return canonical({id:p.id,versionId:p.version_id,digest:p.version_digest,manifest:p.manifest,envelope:p.envelope_id})
}
function packageCheck(binding: string) {
 const b=JSON.parse(binding)
 return sql("EXISTS(SELECT 1 FROM lk_packages p JOIN lk_agreements a ON a.id=p.agreement_id WHERE p.id=? AND p.version_id=? AND p.version_digest=? AND p.manifest=? AND p.envelope_id=? AND p.status IN ('sent','completed') AND a.current_version_id=p.version_id)",b.id,b.versionId,b.digest,b.manifest,b.envelope)
}
const configure: Handler = async(c,p) => {
 requireRole(c.actor,['owner'],'configure an execution destination')
 const kind=oneOf(p,'kind',['google-drive','onedrive','sharepoint','chest','hubspot'] as const), accountId=text(p,'accountId',100), revision=integer(p,'revision')
 secret(c.env,kind)
 if(kind==='chest'){
  const origin=(c.env as any).CHEST_ORIGIN
  if(origin!==accountId || new URL(accountId).origin!==accountId || new URL(accountId).protocol!=='https:') fail('FOLLOWUP_CONFIG','Use the exact privately configured Chest HTTPS origin.',409)
 }
 return {allowed:['owner'],result:{kind,revision:revision+1},checks:[sql('COALESCE((SELECT revision FROM lk_execution_destinations WHERE kind=?),0)=?',kind,revision)],writes:[sql('INSERT INTO lk_execution_destinations VALUES(?,?,?,?,?) ON CONFLICT(kind) DO UPDATE SET account_id=excluded.account_id,revision=excluded.revision,configured_by=excluded.configured_by,configured_at=excluded.configured_at',kind,accountId,revision+1,c.actor.id,c.now)],audit:[{action:'execution.destination.configure',summary:`Owner configured ${kind} account ${accountId} at revision ${revision+1}. Earlier waiting decisions are stale.`}]}
}
const authorize: Handler = async(c,p) => {
 requireRole(c.actor,['owner'],'authorize execution follow-up')
 if (p.consent !== true) fail('CONSENT','Explicitly authorize this separate execution action.',409)
 const a = await visibleAgreement(c,p.agreementId), packageId = text(p,'packageId',100), kind = oneOf(p,'kind',kinds)
 const binding = await packageIdentity(c,packageId,a.id)
 const target = kind === 'extraction' ? {simulated:p.simulated === true,settingsVersion:(await modelSettings(c.db)).version} : kind === 'hubspot'
  ? {accountId:text(p,'accountId',100),dealId:text(p,'dealId',100),property:text(p,'property',100),value:text(p,'value',100),connectionRevision:integer(p,'connectionRevision',1)}
  : {accountId:text(p,'accountId',100),folderId:text(p,'folderId',200),namingRule:text(p,'namingRule',200),connectionRevision:integer(p,'connectionRevision',1)}
 let destinationCheck = sql('1')
 if (kind !== 'extraction') {
  secret(c.env,kind)
  destinationCheck=sql('EXISTS(SELECT 1 FROM lk_execution_destinations WHERE kind=? AND account_id=? AND revision=?)',kind,(target as any).accountId,(target as any).connectionRevision)
  if (!await c.db.prepare(`SELECT 1 WHERE ${destinationCheck.sql}`).bind(...destinationCheck.params).first()) fail('STALE','Configure and review the current destination account revision first.',409)
 }
 if (typeof target.namingRule === 'string' && (!target.namingRule.includes('{reference}') || !target.namingRule.includes('{role}') || /[\\/]/.test(target.namingRule) || target.namingRule.replace(/\{(reference|role)\}/g,'').includes('{'))) fail('NAMING_RULE','Use a filename rule containing {reference} and {role}, without path separators.')
 const destination = canonical(target), id = crypto.randomUUID()
 if (await c.db.prepare("SELECT 1 FROM lk_execution_followups WHERE package_id=? AND kind=? AND destination=? AND status IN ('waiting','uncertain','completed')").bind(packageId,kind,destination).first()) fail('DUPLICATE','This exact follow-up already has a decision.',409)
 return {allowed:['owner'],result:{id},checks:[...agreementGuards(c,a,p),packageCheck(binding),destinationCheck],writes:[sql("INSERT INTO lk_execution_followups VALUES(?,?,?,?,?,?,?,'waiting',NULL,?,?)",id,a.id,packageId,json(c.actor),binding,kind,destination,c.now,c.now)],audit:[{action:'execution.followup.authorize',agreementId:a.id,summary:`Owner separately authorized ${kind} for the exact package and displayed destination: ${destination}. Retrieval consent grants none of these actions.`}]}
}
const cancel: Handler = async(c,p) => {
 requireRole(c.actor,['owner'],'cancel execution follow-up')
 const a = await visibleAgreement(c,p.agreementId), id = text(p,'id',100)
 return {allowed:['owner'],result:{id},checks:[...agreementGuards(c,a,p)],writes:[sql("UPDATE lk_execution_followups SET status='cancelled',updated_at=? WHERE id=? AND agreement_id=? AND status='waiting'",c.now,id,a.id)],audit:[{action:'execution.followup.cancel',agreementId:a.id,summary:'Owner cancelled a waiting execution action.'}]}
}
export const followupHandlers = {'execution.destination.configure':configure,'execution.followup.authorize':authorize,'execution.followup.cancel':cancel}

async function request(url: string, token: string, init: RequestInit = {}) {
 const response = await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(10_000),headers:{...(token?{authorization:`Bearer ${token}`} : {}),...init.headers}})
 if (!response.ok && !(init.method===undefined && response.status===302)) throw Error(`provider_http_${response.status}`)
 return response
}
async function fileCopy(c: Ctx, row: any, target: any, artifactId: string, role: string, guardedRequest: typeof request) {
 const bytes = await readArtifactBytes(c.db,artifactId), a = await visibleAgreement(c,row.agreement_id)
 const name = target.namingRule.replaceAll('{reference}',a.reference).replaceAll('{role}',role) + (target.namingRule.endsWith('.pdf')?'':'.pdf')
 const token = secret(c.env,row.kind)
 let response:Response, downloadUrl:string
 if(row.kind==='chest'){
  if((c.env as any).CHEST_ORIGIN!==target.accountId) throw Error('provider_account_mismatch')
  const base=target.accountId+'/api/chest/integrations/v1/items'
  const receipt:any=await(await guardedRequest(base,token,{method:'POST',headers:{'content-type':'application/json','idempotency-key':row.id+'-'+role},body:json({parent:target.folderId,name,base64:encodeBase64(bytes)})})).json()
  if(typeof receipt.id!=='string') throw Error('provider_filing_mismatch')
  const metadata:any=await(await guardedRequest(base+'/'+encodeURIComponent(receipt.id),token)).json()
  if(metadata.id!==receipt.id || metadata.name!==name || metadata.parent!==target.folderId || typeof metadata.version!=='string') throw Error('provider_filing_mismatch')
  downloadUrl=base+'/'+encodeURIComponent(receipt.id)+'/bytes/'+encodeURIComponent(metadata.version)
 } else if (row.kind === 'google-drive') {
  const identity:any=await (await guardedRequest('https://www.googleapis.com/drive/v3/about?fields=user',token)).json()
  if (identity.user?.emailAddress!==target.accountId) throw Error('provider_account_mismatch')
  const boundary = 'locket-'+crypto.randomUUID()
  const header = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${json({name,parents:[target.folderId],appProperties:{locketDecision:row.id,sha256:await sha256(bytes)}})}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`)
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`), body = new Uint8Array(header.length+bytes.length+tail.length)
  body.set(header);body.set(bytes,header.length);body.set(tail,header.length+bytes.length)
  response = await guardedRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,parents',token,{method:'POST',headers:{'content-type':`multipart/related; boundary=${boundary}`},body:body as BodyInit})
  const receipt:any = await response.json()
  if (!receipt.id || receipt.name!==name || !receipt.parents?.includes(target.folderId)) throw Error('provider_filing_mismatch')
  downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(receipt.id)}?alt=media`
 } else {
  const base = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(target.accountId)}/items/${encodeURIComponent(target.folderId)}`
  response = await guardedRequest(`${base}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=fail`,token,{method:'PUT',headers:{'content-type':'application/pdf'},body:bytes as BodyInit})
  const receipt:any = await response.json()
  if (!receipt.id || receipt.name!==name || receipt.parentReference?.id!==target.folderId || receipt.parentReference?.driveId!==target.accountId) throw Error('provider_filing_mismatch')
  downloadUrl = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(target.accountId)}/items/${encodeURIComponent(receipt.id)}/content`
 }
 let copy = await guardedRequest(downloadUrl,token)
 if(copy.status===302){
  if(!['onedrive','sharepoint'].includes(row.kind))throw Error('provider_redirect_refused')
  let redirect:URL
  try{redirect=new URL(copy.headers.get('location')??'')}catch{throw Error('provider_redirect_refused')}
  if(redirect.protocol!=='https:' || redirect.username || redirect.password || redirect.port || !/\.(sharepoint\.com|1drv\.com)$/.test(redirect.hostname))throw Error('provider_redirect_refused')
  // Microsoft issues an authenticated original URL. Never forward the Graph
  // bearer credential, retain its query, or follow another redirect.
  copy=await guardedRequest(redirect.href,'',{headers:{accept:'application/pdf'}})
  if(copy.status===302)throw Error('provider_redirect_refused')
 }
 const reader=copy.body?.getReader()
 if(!reader)throw Error('provider_file_empty')
 const chunks:Uint8Array[]=[];let size=0
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_FILE_BYTES){await reader.cancel();throw Error('provider_file_too_large')};chunks.push(value)}
 const downloaded=new Uint8Array(size);let offset=0
 for(const chunk of chunks){downloaded.set(chunk,offset);offset+=chunk.length}
 const digest = await sha256(downloaded)
 if (digest!==await sha256(bytes)) throw Error('provider_filing_digest_mismatch')
 return {role,name,sha256:digest}
}

/** Outbound actions claim uncertainty before sending. Neither retries nor a new
 * session can silently resend a write whose outcome is unknown. */
export async function runExecutionFollowups(env: Bindings, now: number, onlyId?: string) {
 const rows = (await env.DB.prepare("SELECT f.*,e.id AS execution_id,e.signed_artifact_id,e.certificate_artifact_id FROM lk_execution_followups f JOIN lk_executions e ON e.package_id=f.package_id AND e.status='reconciled' WHERE f.status='waiting' AND (? IS NULL OR f.id=?) ORDER BY f.created_at").bind(onlyId??null,onlyId??null).all<any>()).results
 for (const row of rows) {
  const c:Ctx = {env,db:env.DB,actor:JSON.parse(row.actor),now,commandId:row.id}
  let claimed = false
  try {
   const a = await visibleAgreement(c,row.agreement_id), policy = await repositoryPolicy(c.db)
   if (a.status!=='executed' || await packageIdentity(c,row.package_id,a.id)!==row.binding) throw Error('stale_package')
   const target=JSON.parse(row.destination)
   const connectionCheck=row.kind==='extraction'?sql("COALESCE((SELECT version FROM lk_model_settings WHERE id='installation'),0)=?",target.settingsVersion):sql('EXISTS(SELECT 1 FROM lk_execution_destinations WHERE kind=? AND account_id=? AND revision=?)',row.kind,target.accountId,target.connectionRevision)
   const checks = [...agreementGuards(c,a),packageCheck(row.binding),connectionCheck,fullFieldsCheck(c.actor),policyVersionCheck(policy.version),sql("EXISTS(SELECT 1 FROM lk_execution_followups WHERE id=? AND status='waiting')",row.id)]
   await commit(c,['owner'],checks,[sql("UPDATE lk_execution_followups SET status='uncertain',updated_at=? WHERE id=?",now,row.id)])
   claimed=true
   const resultChecks = [...checks.slice(0,-1),sql("EXISTS(SELECT 1 FROM lk_execution_followups WHERE id=? AND status='uncertain')",row.id)]
   const guardedRequest:typeof request=async(...args)=>{await commit(c,['owner'],resultChecks,[]);return request(...args)}
   let outcome:unknown, status='completed'
   if (row.kind==='extraction') {
    const out = await modelHandlers['model.run'](c,{agreementId:a.id,task:'extraction',simulated:target.simulated,consent:true})
    await commit(c,['owner'],resultChecks,[...out.writes,...out.audit.map(entry=>auditSql(c,entry))])
    outcome=await completeModelCommand(c,'model.run',out.result)
    if((outcome as any).status!=='proposed')status='uncertain'
   } else if (row.kind==='hubspot') {
    const token=secret(env,row.kind), url=`https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(target.dealId)}`
    const account:any=await (await guardedRequest('https://api.hubapi.com/account-info/v3/details',token)).json()
    if (String(account.portalId)!==target.accountId) throw Error('provider_account_mismatch')
    await guardedRequest(url,token,{method:'PATCH',headers:{'content-type':'application/json'},body:json({properties:{[target.property]:target.value}})})
    const readback:any=await (await guardedRequest(url+'?properties='+encodeURIComponent(target.property),token)).json()
    if (String(readback.id)!==target.dealId || readback.properties?.[target.property]!==target.value) throw Error('provider_crm_mismatch')
    outcome={dealId:readback.id,properties:{[target.property]:target.value}}
   } else {
    const copies=[]
    for (const [artifact,role] of [[row.signed_artifact_id,'signed'],[row.certificate_artifact_id,'certificate']]) {
     await commit(c,['owner'],resultChecks,[])
     copies.push(await fileCopy(c,row,target,artifact,role,guardedRequest))
    }
    outcome={copies}
   }
   await commit(c,['owner'],resultChecks,[sql("UPDATE lk_execution_followups SET status=?,outcome=?,updated_at=? WHERE id=?",status,json(outcome),now,row.id),auditSql(c,{action:status==='completed'?'execution.followup.complete':'execution.followup.uncertain',agreementId:a.id,summary:`Separately authorized ${row.kind}: ${status}; outcome evidence retained.`})])
  } catch (error) {
   const code = /^provider_[a-z0-9_]+$/.test(String((error as Error).message)) ? (error as Error).message : 'authority_source_or_configuration_changed'
   await env.DB.prepare("UPDATE lk_execution_followups SET status=?,outcome=?,updated_at=? WHERE id=? AND status=?").bind(claimed?'uncertain':'cancelled',json({code,noAutomaticResend:true}),now,row.id,claimed?'uncertain':'waiting').run()
  }
 }
}
