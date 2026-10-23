import { installationMail, installationMailLocal, installationMailReady } from './installation-mail'
import { requireRole } from './access'
import { auditSql,commit,type Ctx,type Handler } from './commands'
import { readArtifactBytes } from './artifacts'
import { fail,Problem,sha256,sql } from './model'
import { serviceClaim,serviceMessageDigest,servicePeople,type ServiceRow } from './service-level-records'
import { uptimeOrigin } from './service-level-evidence'

const email:Handler=async(c,p)=>{
 requireRole(c.actor,servicePeople,'send an approved service-credit claim')
 const e=await serviceClaim(c,p.claimId,p.claimVersion),f=e.claim
 if(c.actor.id!==e.a.owner_id)fail('FORBIDDEN','Only the agreement owner may send this supplier claim.',403)
 if(f.status!=='approved'||f.approved_by!==c.actor.id||f.approved_operator_version!==c.actor.operatorVersion||p.consent!==true||p.amountCents!==f.amount_cents||!f.message_digest||p.messageDigest!==f.message_digest||await serviceMessageDigest(f)!==f.message_digest)fail('APPROVAL','Approve the current exact USD amount, recipient and message before explicitly sending it.',409)
 if(e.kind==='uptime'&&(uptimeOrigin(c.env.UPTIME_ORIGIN)!==e.link.origin||!c.env.UPTIME_METRICS_KEY))fail('UPTIME_CONFIG','The authorized Uptime installation connection changed. Review the evidence connection before sending.',409)
 if(!installationMailReady(c.env))fail('MAIL_UNAVAILABLE','Configure the installation mail provider and sender before requesting email.',503)
 const noPrior=sql(`NOT EXISTS(SELECT 1 FROM ${e.dispatchTable} WHERE agreement_id=? AND monitor_id=? AND month=?)`,f.agreement_id,f.monitor_id,f.month)
 if(!(await c.db.prepare(`SELECT ${noPrior.sql} AS ok`).bind(...noPrior.params).first<{ok:number}>())?.ok)fail('ALREADY_SENT','This monitor and service month already have a send request. Inspect its outcome; no automatic resend is permitted.',409)
 const bytes=await readArtifactBytes(c.db,e.read.artifact_id)
 if(await sha256(bytes)!==e.read.response_sha256)fail('EVIDENCE','The immutable monitoring response digest does not match.',409)
 return {allowed:servicePeople,result:{id:c.commandId,claimId:f.id,status:'queued'},checks:[...e.checks,noPrior],writes:[sql(`INSERT INTO ${e.dispatchTable}(id,agreement_id,claim_id,monitor_id,month,claim_version,actor_id,recipient,sender,subject,message_text,message_digest,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'queued',?)`,c.commandId,f.agreement_id,f.id,f.monitor_id,f.month,f.version,c.actor.id,f.recipient,c.env.MAIL_FROM??'',f.subject,f.message_text,f.message_digest,c.now)],audit:[{action:'service-level.email.requested',agreementId:f.agreement_id,summary:'Agreement owner explicitly requested one email of the approved service-credit amount and exact supplier message before its claim deadline. Queued is not sent.'}]}
}
export async function dispatchServiceClaim(c:Ctx) {
 const native=await c.db.prepare('SELECT * FROM lk_service_level_dispatches WHERE id=?').bind(c.commandId).first<ServiceRow>(),table=native?'lk_service_level_dispatches':'lk_service_performance_dispatches'
 const d=native??await c.db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(c.commandId).first<ServiceRow>()
 if(!d||d.status!=='queued')return
 let claimed=false
 const attempt=crypto.randomUUID(),finish=async(status:string,receipt:string|null,code:string|null)=>{
  const unclaimed=status==='cancelled'&&!claimed,previous=unclaimed?'queued':'sending',token=unclaimed?null:attempt,audit=auditSql(c,{action:`service-level.email.${status}`,agreementId:d.agreement_id,summary:status==='accepted'?'The installation mail provider accepted the approved service-credit claim; mailbox delivery, timely receipt and credit recovery are unconfirmed.':status==='suppressed'?'Service-credit claim suppressed in local development or demo; no supplier email sent.':`Service-credit email outcome: ${status}. No automatic resend.`})
  await c.db.batch([c.db.prepare(`INSERT INTO lk_audit SELECT ${audit.params.map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=? AND status=? AND attempt_id IS ?)`).bind(...audit.params,d.id,previous,token),c.db.prepare(`UPDATE ${table} SET status=?,provider_message_id=?,outcome_code=? WHERE id=? AND status=? AND attempt_id IS ?`).bind(status,receipt,code,d.id,previous,token)])
 }
 try{
  const e=await serviceClaim({...c,now:Date.now()},d.claim_id,d.claim_version),f=e.claim
  if(c.actor.id!==d.actor_id||c.actor.id!==e.a.owner_id||f.status!=='approved'||f.approved_by!==c.actor.id||f.approved_operator_version!==c.actor.operatorVersion||f.message_digest!==d.message_digest||await serviceMessageDigest(f)!==d.message_digest||(e.kind==='uptime'&&(uptimeOrigin(c.env.UPTIME_ORIGIN)!==e.link.origin||!c.env.UPTIME_METRICS_KEY)))fail('APPROVAL','The approved claim, evidence connection, deadline or sender authority changed.',409)
  if(await sha256(await readArtifactBytes(c.db,e.read.artifact_id))!==e.read.response_sha256)fail('EVIDENCE','The original monitoring bytes do not match.',409)
  await commit(c,servicePeople,[...e.checks,sql(`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND status='queued')`,d.id)],[sql(`UPDATE ${table} SET status='sending',attempt_id=?,attempted_at=? WHERE id=? AND status='queued'`,attempt,Date.now(),d.id)])
 }catch(error){if(!(error instanceof Problem))throw error;return finish('cancelled',null,'authority_evidence_or_deadline_changed')}
 const own=await c.db.prepare(`SELECT attempt_id FROM ${table} WHERE id=?`).bind(d.id).first<{attempt_id:string}>()
 if(own?.attempt_id!==attempt)return
 claimed=true
 const claim=await c.db.prepare(`SELECT deadline_at FROM ${native?'lk_service_level_claims':'lk_service_performance_claims'} WHERE id=?`).bind(d.claim_id).first<{deadline_at:number}>()
 if(!claim||Date.now()>=claim.deadline_at)return finish('cancelled',null,'claim_deadline_passed')
 if(installationMailLocal(c.env))return finish('suppressed',null,'local_suppressed')
 if(!installationMailReady(c.env)||c.env.MAIL_FROM!==d.sender)return finish('rejected',null,'mail_unavailable_or_sender_changed')
 try{
  const result=await installationMail(c.env)!.send({deliveryId:d.id,from:d.sender,to:[d.recipient],subject:d.subject,text:d.message_text,html:'',headers:{}})
  return finish(result.status==='development'?'suppressed':result.status,result.providerMessageId,result.code??null)
 }catch{return finish('uncertain',null,'provider_outcome_unknown')}
}
export const serviceMailHandlers={'service-level.email':email}
