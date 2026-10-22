import type { Bindings } from '../auth.server'
import type { Actor } from './model'
import { fail, json, sha256, sql } from './model'
import { auditInsert } from './audit'
import { commit, type Ctx } from './commands'
import { customFields } from './custom-fields'
import { readArtifactBytes } from './artifacts'
import { repositoryPolicy, policyVersionCheck, requireFullFields } from './repository-access'
import { bulkItems, bulkOperation, bulkOperationView, readableBulkProposal } from './repository-bulk'
import { may, requireRole, visibleSetSql } from './access'
import { bulkCsv } from './repository-bulk-csv'
import { bulkRoles, selectionCheck, type BulkSnapshot } from './repository-bulk-model'
import { visibleAgreement, type AgreementRow } from './records'
import { storedZip } from './repository-bulk-zip'

const headers={'cache-control':'no-store','x-content-type-options':'nosniff'}
export async function repositoryBulkResponse(request:Request,env:Bindings,actor:Actor):Promise<Response|null>{
 const url=new URL(request.url)
 if(request.method!=='GET'||url.pathname!=='/api/locket/repository/bulk')return null
 const c:Ctx={env,db:env.DB,actor,now:Date.now(),commandId:crypto.randomUUID(),request}
 const id=url.searchParams.get('operationId')
 if(!id){
  // Reading operation names/counts never returns saved record snapshots.
  await requireFullFields(env.DB,actor)
  requireRole(actor,may.prepare,'read bulk work')
  const candidates=(await env.DB.prepare("SELECT id,actor_id,status,version,created_at FROM lk_repository_bulk WHERE actor_id=? OR status='proposed' ORDER BY created_at DESC LIMIT 30").bind(actor.id).all<any>()).results
  const rows=[]
  for(const row of candidates)if(row.actor_id===actor.id||(actor.role!=='agent'&&await readableBulkProposal(c,row.id)))rows.push({id:row.id,status:row.status,version:row.version,created_at:row.created_at})
  return Response.json({operations:rows},{headers})
 }
 const op=await bulkOperation(c,id),format=url.searchParams.get('format')
 if(format!=='csv'&&format!=='zip'){
  const offset=Number(url.searchParams.get('offset')??0)
  if(!Number.isSafeInteger(offset)||offset<0)fail('INVALID','offset must be a non-negative integer.')
  return Response.json(await bulkOperationView(c,op.id,offset),{headers})
 }
 requireRole(actor,bulkRoles,'export selected repository records')
 const items=await bulkItems(c,op.id),ids=items.map(i=>i.agreement_id),access=visibleSetSql(actor,ids)
 if(!await c.db.prepare(`SELECT 1 WHERE ${access.sql}`).bind(...access.params).first())fail('NOT_FOUND','The selection contains agreements you can no longer access.',404)
 const agreements=(await c.db.prepare('SELECT * FROM lk_agreements WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id').bind(json(ids)).all<AgreementRow>()).results,policy=await repositoryPolicy(c.db)
 const checks=[selectionCheck(c,agreements),policyVersionCheck(policy.version)]
 if(format==='csv'){
  if(op.status!=='selected')fail('STATUS','Export a fresh selection before editing its metadata CSV.',409)
  // Baseline metadata is useful only while the selected revisions are current.
  for(const i of items)if(agreements.find(a=>a.id===i.agreement_id)!.version!==(JSON.parse(i.snapshot) as BulkSnapshot).agreement.version)fail('STALE','The selection changed. Select again before exporting CSV.',409)
  const csv=bulkCsv(items,await customFields(c.db))
  await commit(c,bulkRoles,checks,[auditInsert(c,agreements.map(a=>({action:'repository.bulk.csv',agreementId:a.id,summary:`Bulk operation ${op.id}: exported metadata for an exact CSV update.`})))])
  return new Response(csv,{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="locket-metadata.csv"'}})
 }
 const artifacts=(await c.db.prepare("SELECT id,agreement_id,version_id,role,filename,size,sha256,imported,source_system,source_id FROM lk_artifacts WHERE agreement_id IN (SELECT value FROM json_each(?)) AND role IN ('original','signed','certificate') ORDER BY agreement_id,role,id").bind(json(agreements.map(a=>a.id))).all<any>()).results
 const entries=artifacts.map(a=>({...a,path:`${a.agreement_id}/${a.role}/${a.id}-${String(a.filename).replace(/[\\/\u0000-\u001f]/g,'_')}`}))
 const bytes=entries.reduce((n,a)=>n+a.size+new TextEncoder().encode(a.path).length*2+76,0)
 if(entries.length+1>65535||bytes>0xffffffff-1024*1024)fail('ZIP_SIZE','Select fewer files for a ZIP smaller than 4 GB.',413)
 const manifest=new TextEncoder().encode(JSON.stringify({operationId:op.id,exportedAt:new Date(c.now).toISOString(),agreements:agreements.map(a=>({id:a.id,reference:a.reference,files:entries.filter(e=>e.agreement_id===a.id).length})),files:entries},null,2))
 await commit(c,bulkRoles,checks,[auditInsert(c,agreements.map(a=>({action:'repository.bulk.zip',agreementId:a.id,summary:`Bulk operation ${op.id}: requested exact originals, signed files and certificates with SHA-256 manifest.`})))])
 const stream=storedZip([{name:'manifest.json',bytes:async()=>manifest},...entries.map(a=>({name:a.path,bytes:async()=>{
  const content=await readArtifactBytes(c.db,a.id)
  if(content.length!==a.size||await sha256(content)!==a.sha256)fail('DIGEST','Stored file failed its byte-custody check.',409)
  await requireFullFields(c.db,actor)
  const agreement=await visibleAgreement(c,a.agreement_id)
  // Recheck current session, role, policy, record and file custody before each
  // artifact enters the stream. Revocation aborts a download still in flight.
  await commit(c,bulkRoles,[selectionCheck(c,[agreement]),policyVersionCheck(policy.version),sql('EXISTS(SELECT 1 FROM lk_artifacts WHERE id=? AND sha256=? AND size=?)',a.id,a.sha256,a.size)],[])
  return content
 }}))])
 return new Response(stream,{headers:{...headers,'content-type':'application/zip','content-disposition':'attachment; filename="locket-agreements.zip"'}})
}
