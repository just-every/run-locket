import { may, requireRole } from './access'
import { fileInput, isPdf, storeArtifact } from './artifacts'
import type { Ctx, Handler } from './commands'
import { readablePages } from './execution-comparison'
import { date, fail, integer, json, object, sql, text } from './model'
import { bump } from './records'
import { remediationRequirement, type RemediationRow } from './remediation-records'

type Field = {value:string|number|null;page:number|null;quote:string|null;status:'match'|'mismatch'|'unknown';reason:string}
export type Assessment = {fields:Record<string,Field>;status:'rejected'|'needs_confirmation'|'matched';reasons:string[]}
/** Only explicitly labelled, unambiguous PDF fields count as machine evidence. */
export function assessRemediation(pages:string[]|null,requirement:any,kind:string):Assessment {
 const fields:Record<string,Field>={}
 const extract=(key:string,pattern:RegExp,convert:(v:string)=>string|number|null,check:(v:any)=>boolean,reason:string)=>{
  const hits=pages?.flatMap((page,index)=>Array.from(page.matchAll(pattern),m=>({quote:m[0],page:index+1,value:convert(m[1].trim())})))??[]
  const values=new Set(hits.map(h=>h.value))
  const hit=hits[0]
  if(!hit||hit.value===null||values.size!==1)fields[key]={value:null,page:null,quote:null,status:'unknown',reason:`${key} could not be read unambiguously; a person must review the original.`}
  else fields[key]={...hit,status:check(hit.value)?'match':'mismatch',reason:check(hit.value)?`${key} matches the confirmed requirement.`:reason}
 }
 if(kind==='coi'){
  extract('coverageCents',/(?:Coverage|Limit)\s*:\s*(?:USD\s*|\$)([\d,]+(?:\.\d{1,2})?)/gi,v=>{const cents=Math.round(Number(v.replace(/,/g,''))*100);return /^\d+(?:\.\d{1,2})?$/.test(v.replace(/,/g,''))&&Number.isSafeInteger(cents)?cents:null},v=>v>=requirement.coverageCents,`Coverage is below the required USD ${(requirement.coverageCents/100).toFixed(2)}.`)
  extract('insured',/Named insured\s*:\s*([^\r\n;]+?)(?=\s*(?:;|Coverage\s*:|Limit\s*:|Effective\s*:|Expires\s*:| - page \d|$))/gi,v=>v,v=>v.toLowerCase()===requirement.insured.toLowerCase(),'The named insured does not match the confirmed requirement.')
  const calendar=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v?v:null
  extract('validFrom',/(?:Effective|Valid from)\s*:\s*(\d{4}-\d{2}-\d{2})/gi,calendar,v=>v<=requirement.validFrom,'Coverage starts after the required date.')
  extract('validThrough',/(?:Expires|Expiration|Valid through)\s*:\s*(\d{4}-\d{2}-\d{2})/gi,calendar,v=>v>=requirement.validThrough,'Coverage expires before the required date.')
  fields.original={value:null,page:null,quote:null,status:'unknown',reason:'Matching PDF text does not verify the issuer, authenticity or unstructured conditions. A person must review the original certificate.'}
 }else fields.document={value:null,page:null,quote:null,status:'unknown',reason:'A person must confirm this document satisfies the exact signed requirement.'}
 const values=Object.values(fields),status=values.some(f=>f.status==='mismatch')?'rejected':values.some(f=>f.status==='unknown')?'needs_confirmation':'matched'
 return {fields,status,reasons:values.filter(f=>f.status!=='match').map(f=>f.reason)}
}
function completion(c:Ctx,e:Awaited<ReturnType<typeof remediationRequirement>>,artifactId:string,evidenceId:string) {
 return [sql("UPDATE lk_obligations SET status='done',done_by=?,done_at=?,evidence_artifact_id=?,evidence_note=? WHERE id=?",c.actor.id,c.now,artifactId,`Verified remediation evidence ${evidenceId}`,e.o.id),sql("UPDATE lk_remediation_occurrences SET status='cancelled',outcome_code='obligation_completed' WHERE status='pending' AND request_id IN (SELECT id FROM lk_remediation_requests WHERE requirement_id=?)",e.r.id),bump(c,e.a)]
}
const upload:Handler=async(c,p)=>{
 requireRole(c.actor,may.review,'submit obligation evidence')
 const e=await remediationRequirement(c,p.requirementId),file=fileInput(p.file)
 if(!isPdf(file))fail('INVALID','Submit the original evidence PDF.')
 const stored=await storeArtifact(file,{agreementId:e.a.id,role:'attachment',provenance:{obligationEvidence:e.o.id,remediationRequirement:e.r.id},actorId:c.actor.id,at:c.now})
 const assessment=assessRemediation(await readablePages(file.bytes),JSON.parse(e.r.requirement),e.r.kind),id=crypto.randomUUID()
 return {allowed:may.review,result:{id,status:assessment.status,assessment,artifactId:stored.id},checks:e.checks,writes:[...stored.writes,sql('INSERT INTO lk_remediation_evidence(id,agreement_id,requirement_id,artifact_id,sha256,assessment,status,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)',id,e.a.id,e.r.id,stored.id,stored.sha256,json(assessment),assessment.status,c.actor.id,c.now),...(assessment.status==='matched'?completion(c,e,stored.id,id):[])],audit:[{action:'remediation.evidence',agreementId:e.a.id,summary:assessment.status==='matched'?'Returned PDF matches every confirmed requirement; obligation completed with original evidence.':`Returned PDF ${assessment.status}: ${assessment.reasons.join(' ')}`}]}
}
const confirm:Handler=async(c,p)=>{
 requireRole(c.actor,may.review,'confirm unreadable evidence')
 const proof=await c.db.prepare('SELECT * FROM lk_remediation_evidence WHERE id=?').bind(p.evidenceId).first<RemediationRow>()
 if(!proof)fail('NOT_FOUND','No returned evidence.',404)
 const e=await remediationRequirement(c,proof.requirement_id)
 if(c.actor.id!==e.o.owner_id)requireRole(c.actor,may.confirmTerms,'confirm another person’s obligation evidence')
 if(proof.status!=='needs_confirmation')fail('EVIDENCE','Only unknown evidence can receive human confirmation; known mismatches cannot be waived.',409)
 const assessment=JSON.parse(proof.assessment) as Assessment,requirement=JSON.parse(e.r.requirement),values=object(p.values,'values'),reason=text(p,'reason',4000)
 for(const [key,field] of Object.entries(assessment.fields)){
  if(field.status==='mismatch')fail('EVIDENCE','Known mismatches cannot be overridden.',409)
  if(field.status!=='unknown')continue
  if(key==='coverageCents'&&integer(values,key,0)<requirement.coverageCents)fail('EVIDENCE','Confirmed coverage is below the requirement.',409)
  if(key==='insured'&&text(values,key).toLowerCase()!==requirement.insured.toLowerCase())fail('EVIDENCE','Confirmed insured does not match.',409)
  if(key==='validFrom'&&date(values,key)>requirement.validFrom)fail('EVIDENCE','Confirmed coverage begins too late.',409)
  if(key==='validThrough'&&date(values,key)<requirement.validThrough)fail('EVIDENCE','Confirmed coverage expires too early.',409)
  if(key==='document'&&values.document!==true)fail('EVIDENCE','Confirm that the original document satisfies the exact requirement.',409)
  if(key==='original'&&values.original!==true)fail('EVIDENCE','Review the original certificate, including its source and conditions, before confirming.',409)
 }
 return {allowed:may.review,result:{id:proof.id,status:'confirmed'},checks:[...e.checks,sql("(SELECT status FROM lk_remediation_evidence WHERE id=?)='needs_confirmation'",proof.id)],writes:[sql("UPDATE lk_remediation_evidence SET status='confirmed',confirmed_by=?,confirmed_at=?,confirmation=? WHERE id=?",c.actor.id,c.now,json({values,reason}),proof.id),...completion(c,e,proof.artifact_id,proof.id)],audit:[{action:'remediation.confirm',agreementId:e.a.id,summary:'Person reviewed the original and confirmed only unknown fields against the requirement; obligation completed without waiver.'}]}
}
export const remediationEvidenceHandlers={'remediation.evidence':upload,'remediation.confirm':confirm}
