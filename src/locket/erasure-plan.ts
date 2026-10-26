import type { Ctx } from './commands'
import { getDocumentProxy } from 'unpdf'
import { privacyChecks } from './privacy-access'
import { retainedOriginalSql } from './retained-originals'
import { canonical, fail, json, parse, sha256, sql, type Sql } from './model'
import { readArtifactBytes } from './artifacts'
export const erasureFields:Record<string,string[]>={lk_accounting_reads:['content'],lk_accounting_schedules:['payload','citation'],lk_privileged_notes:['body'],lk_access_exceptions:['reason'],lk_redacted_renditions:['text'],lk_remediation_requirements:['requirement','citation','source'],lk_remediation_requests:['recipient','source','sender','stop_reference'],lk_remediation_occurrences:['subject','message_text'],lk_remediation_evidence:['assessment','confirmation'],lk_service_performance_terms:['citation','config'],lk_service_performance_reports:['metrics','source_name','source_reference','window_note'],lk_service_performance_claims:['content','recipient','subject','message_text'],lk_service_performance_dispatches:['recipient','subject','message_text'],lk_service_level_terms:['citation','interpretation'],lk_service_level_claims:['content','recipient','subject','message_text'],lk_service_level_dispatches:['recipient','subject','message_text'],lk_negotiation_outcomes:['quote','evidence'],lk_playbook_issues:['description','evidence'],lk_playbook_recommendations:['wording','analysis','reason'],lk_reconciliation_interpretations:['interpretation','citation'],lk_reconciliation_scans:['content'],lk_reconciliation_findings:['content','recipient','subject','message_text','finance_note','rejection_reason'],lk_reconciliation_dispatches:['recipient','subject','message_text'],lk_family_analyses:['sources','conflicts','choices','reason'],lk_renewal_briefs:['content'],lk_price_caps:['value','citation'],lk_comments:['body','quote','external_author_name','external_author_email'],lk_notices:['recipient','body'],lk_notice_letters:['recipient'],lk_notice_dispatches:['recipient','subject','message_text'],lk_notice_sources:['recipient','alternate_address'],lk_notice_plans:['recipient','acknowledgment'],lk_notice_events:['detail'],lk_notice_tracking:['detail'],lk_notification_deliveries:['recipient_email'],lk_approval_reminders:['recipient_email'],lk_deadline_reminders:['recipient_email'],lk_approval_mail:['recipient_email'],lk_exchanges:['recipient_name','recipient_email','contact_consent']}
export interface KeptRecord {table:string;id:string;agreementId:string|null;reason:string;authorizer:string;holdReason?:string}
export interface ErasurePatch {table:string;id:string;agreementId:string|null;before:Record<string,unknown>;after:Record<string,unknown>}
export interface DraftDisposition {id:string;version:number;held:boolean;files:{id:string;role:string}[];versions:string[]}
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
/** Unicode word boundaries also protect Ann from Annual and address substrings. */
export function privacyWords(needles:string[],replacement:(s:string)=>string){
 const alternatives=[...new Set(needles)].filter(Boolean).sort((a,b)=>b.length-a.length).map(needle=>needle.includes('@')?`(?<![\\p{L}\\p{N}_@.+-])${escape(needle)}(?![\\p{L}\\p{N}_@+-]|\\.[\\p{L}\\p{N}])`:`(?<![\\p{L}\\p{N}_])${escape(needle)}(?![\\p{L}\\p{N}_])`).join('|')
 const pattern=new RegExp(alternatives,'giu')
 return (value:string)=>value.replace(pattern,match=>replacement(match))
}
export async function erasurePlan(c:Ctx,email:string,token:string){
 const parties=(await c.db.prepare('SELECT * FROM lk_parties').all<any>()).results
 const contacts=parties.flatMap(r=>parse<any[]>(r.contacts??'[]')).filter(r=>r.email.toLowerCase()===email)
 if(!contacts.length&&!parties.some(r=>r.email?.toLowerCase()===email))fail('NOT_FOUND','No current counterparty contact has that email.',404)
 const names=[...new Set<string>(contacts.map(r=>r.name).filter(Boolean))]
 const replacement=`erased-${token}@invalid.example`,scrub=privacyWords([email,...names],match=>match.toLowerCase()===email?replacement:'[erased person]')
 const masks=privacyWords([email,...names],()=> '[erased person]')
 const agreements=(await c.db.prepare('SELECT * FROM lk_agreements').all<any>()).results
 const holds=(await c.db.prepare('SELECT * FROM lk_legal_holds WHERE active=1 ORDER BY agreement_id').all<any>()).results
 const holdById=new Map(holds.map(h=>[h.agreement_id,h]))
 const serviceClaims=(await c.db.prepare('SELECT id,sources FROM lk_service_level_claims UNION ALL SELECT id,sources FROM lk_service_performance_claims').all<{id:string;sources:string}>()).results
 const deliveries=(await c.db.prepare('SELECT delivery_id,agreement_id FROM lk_notifications WHERE delivery_id IS NOT NULL').all<any>()).results
 const sourceAgreements=(table:string,r:any):string[]=>{
  const ids=[r.agreement_id,r.root_id].filter(Boolean)
  if(table==='lk_playbook_recommendations')ids.push(...parse<any>(r.analysis).citations.map((v:any)=>v.agreementId))
  if(table==='lk_family_analyses')ids.push(...parse<any>(r.facts).members.map((m:any)=>m.id))
  if((table.startsWith('lk_reconciliation_')||table.startsWith('lk_service_level_')||table.startsWith('lk_service_performance_'))&&typeof r.sources==='string')ids.push(...parse<any[]>(r.sources).map(s=>s.id))
  if((table==='lk_service_level_dispatches'||table==='lk_service_performance_dispatches')){const claim=serviceClaims.find(c=>c.id===r.claim_id);if(claim)ids.push(...parse<any[]>(claim.sources).map(s=>s.id))}
  return [...new Set<string>(ids)]
 }
 const heldFor=(table:string,r:any)=>table==='lk_parties'?holds.filter(h=>agreements.some(a=>a.id===h.agreement_id&&a.party_id===r.id)):table==='lk_notification_deliveries'?holds.filter(h=>deliveries.some(n=>n.delivery_id===r.id&&n.agreement_id===h.agreement_id)):holds.filter(h=>sourceAgreements(table,r).includes(h.agreement_id))
 const patches:ErasurePatch[]=[],retained:KeptRecord[]=[],checks:Sql[]=[],related=new Set<string>(),scope:unknown[]=[]
 const retain=(table:string,r:any,held:any[])=>{
  for(const h of held)retained.push({table,id:r.id??r.agreement_id,agreementId:h.agreement_id,reason:'legal_hold',authorizer:h.set_by,holdReason:masks(h.reason)})
 }
 const patch=(table:string,r:any,after:Record<string,unknown>)=>{
  const changed=Object.fromEntries(Object.entries(after).filter(([key,v])=>v!==r[key]))
  if(!Object.keys(changed).length)return
  const held=heldFor(table,r)
  for(const id of sourceAgreements(table,r))related.add(id)
  if(held.length){retain(table,r,held);return}
  const before=Object.fromEntries([...Object.keys(changed),...(['version','revision'].filter(k=>k in r))].map(k=>[k,r[k]]))
  patches.push({table,id:r.id,agreementId:r.agreement_id??null,before,after:changed})
  checks.push(sql(`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND ${Object.keys(before).map(k=>`${k} IS ?`).join(' AND ')})`,r.id,...Object.values(before)))
 }
 for(const r of parties){
  const next=parse<any[]>(r.contacts??'[]').map(v=>v.email.toLowerCase()===email?{name:'[erased person]',email:replacement,title:null}:v)
  if(next.some(v=>v.email===replacement)||r.email?.toLowerCase()===email){
   agreements.filter(a=>a.party_id===r.id).forEach(a=>related.add(a.id))
   patch('lk_parties',r,{contacts:json(next),email:r.email?.toLowerCase()===email?null:r.email})
  }
 }

 for(const[table,columns]of Object.entries(erasureFields)){
  const rows=(await c.db.prepare(`SELECT * FROM ${table}`).all<any>()).results
  scope.push([table,rows.length]);checks.push(sql(`(SELECT COUNT(*) FROM ${table})=?`,rows.length))
  for(const r of rows)patch(table,r,Object.fromEntries(columns.filter(k=>typeof r[k]==='string').map(k=>[k,scrub(r[k])])))
 }
 scope.push(['lk_parties',parties.length]);checks.push(sql('(SELECT COUNT(*) FROM lk_parties)=?',parties.length))
 const contracted=new Set((await c.db.prepare(`SELECT a.id FROM lk_agreements a WHERE ${retainedOriginalSql()}`).all<{id:string}>()).results.map(a=>a.id))
 const drafts:DraftDisposition[]=[]
 const allVersions=(await c.db.prepare('SELECT * FROM lk_versions').all<any>()).results,artifacts=(await c.db.prepare('SELECT * FROM lk_artifacts').all<any>()).results
 for(const[table,rows]of [['lk_agreements',agreements],['lk_versions',allVersions],['lk_artifacts',artifacts]] as const){scope.push([table,rows.length]);checks.push(sql(`(SELECT COUNT(*) FROM ${table})=?`,rows.length))}
 for(const a of agreements){
  const versions=allVersions.filter(v=>v.agreement_id===a.id),files=artifacts.filter(f=>f.agreement_id===a.id)
  let named=related.has(a.id)||versions.some(v=>typeof v.text==='string'&&scrub(v.text)!==v.text)||files.some(f=>scrub(f.filename)!==f.filename)
  if(!named&&a.status==='draft')for(const f of files){
   const bytes=await readArtifactBytes(c.db,f.id)
   let body=new TextDecoder().decode(bytes)
   if(f.media_type==='application/pdf'){
    let doc
    try{doc=await getDocumentProxy(bytes);for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n),content=await page.getTextContent();body+=' '+content.items.map(item=>'str' in item?item.str:'').join(' ')}}
    catch{fail('ERASURE_REVIEW','A draft PDF cannot be inspected. The owner must provide a readable rendition before erasure.',409)}
    finally{await doc?.loadingTask.destroy()}
   }
   if(scrub(body)!==body){named=true;break}
  }
  if(!named)continue
  related.add(a.id)
  if(a.status==='draft'&&!contracted.has(a.id)){
   if(holdById.has(a.id))for(const f of files)retain('lk_artifacts',f,[holdById.get(a.id)])
   drafts.push({id:a.id,version:a.version,held:holdById.has(a.id),files:files.map(f=>({id:f.id,role:f.role})),versions:versions.map(v=>v.id)})
   checks.push(sql('(SELECT version FROM lk_agreements WHERE id=?)=?',a.id,a.version))
  }else if(['executed','imported'].includes(a.status)||contracted.has(a.id)){
   for(const f of files)retained.push({table:'lk_artifacts',id:f.id,agreementId:a.id,reason:'retained_by_law',authorizer:c.actor.id})
   for(const e of(await c.db.prepare('SELECT id FROM lk_executions WHERE agreement_id=?').bind(a.id).all<{id:string}>()).results)retained.push({table:'lk_executions',id:e.id,agreementId:a.id,reason:'retained_by_law',authorizer:c.actor.id})
  }
 }
 for(const r of(await c.db.prepare('SELECT id,agreement_id FROM lk_audit').all<any>()).results)if(related.has(r.agreement_id))retained.push({table:'lk_audit',id:r.id,agreementId:r.agreement_id,reason:'retained_by_law',authorizer:c.actor.id})
 // Reads of restricted records append audit events; retained audit is a receipt,
 // not a mutable part of the business-data preview fingerprint.
 const privacyScope={partyIds:parties.filter(r=>parse<any[]>(r.contacts??'[]').some(v=>v.email.toLowerCase()===email)||r.email?.toLowerCase()===email||agreements.some(a=>related.has(a.id)&&a.party_id===r.id)).map(r=>r.id),agreementIds:[...related]}
 if(c.actor.role!=='owner'&&patches.some(p=>!p.agreementId&&!['lk_parties','lk_notification_deliveries'].includes(p.table)))fail('FORBIDDEN','The owner must handle records without an agreement scope.',403)
 for(const patch of patches)if(patch.table==='lk_notification_deliveries'){
  const ids=deliveries.filter(d=>d.delivery_id===patch.id).map(d=>d.agreement_id)
  if(c.actor.role!=='owner'&&!ids.length)fail('FORBIDDEN','The owner must handle notifications without an agreement scope.',403)
  privacyScope.agreementIds.push(...ids)
 }
 checks.push(...await privacyChecks(c,privacyScope))
 const fingerprint=await sha256(canonical({token,patches,drafts,holds,scope}))
 checks.push(sql("(SELECT COALESCE(json_group_array(json_object('agreement',agreement_id,'version',version)),'[]') FROM (SELECT agreement_id,version FROM lk_legal_holds WHERE active=1 ORDER BY agreement_id))=?",json(holds.sort((a,b)=>a.agreement_id.localeCompare(b.agreement_id)).map(h=>({agreement:h.agreement_id,version:h.version})))))
 return{privacyScope,patches,retained,drafts,checks,fingerprint,replacement,related:[...related]}
}
