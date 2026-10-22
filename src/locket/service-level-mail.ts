import { requireRole } from './access'
import { auditSql,commit,type Ctx,type Handler } from './commands'
import { readArtifactBytes } from './artifacts'
import { fail,Problem,sha256,sql } from './model'
import { serviceClaim,serviceMessageDigest,servicePeople,type ServiceRow } from './service-level-records'
import { uptimeOrigin } from './service-level-evidence'

const local=(c:Ctx)=>c.env.AUTH_LOCAL==='true'||(c.env as {RER_DEMO?:string}).RER_DEMO==='1'
const email:Handler=async(c,p)=>{
 requireRole(c.actor,servicePeople,'send an approved service-credit claim')
 const e=await serviceClaim(c,p.claimId,p.claimVersion),f=e.claim
 if(c.actor.id!==e.a.owner_id)fail('FORBIDDEN','Only the agreement owner may send this supplier claim.',403)
 if(f.status!=='approved'||f.approved_by!==c.actor.id||f.approved_operator_version!==c.actor.operatorVersion||p.consent!==true||p.amountCents!==f.amount_cents||!f.message_digest||p.messageDigest!==f.message_digest||await serviceMessageDigest(f)!==f.message_digest)fail('APPROVAL','Approve the current exact USD amount, recipient and message before explicitly sending it.',409)
 if(uptimeOrigin(c.env.UPTIME_ORIGIN)!==e.link.origin||!c.env.UPTIME_METRICS_KEY)fail('UPTIME_CONFIG','The authorized Uptime installation connection changed. Review the evidence connection before sending.',409)
 if(!local(c)&&(!c.env.POSTMARK_SERVER_TOKEN||!c.env.MAIL_FROM))fail('MAIL_UNAVAILABLE','Configure server-only Postmark credentials and sender before requesting email.',503)
 const noPrior=sql('NOT EXISTS(SELECT 1 FROM lk_service_level_dispatches WHERE agreement_id=? AND monitor_id=? AND month=?)',f.agreement_id,f.monitor_id,f.month)
 if(!(await c.db.prepare(`SELECT ${noPrior.sql} AS ok`).bind(...noPrior.params).first<{ok:number}>())?.ok)fail('ALREADY_SENT','This monitor and service month already have a send request. Inspect its outcome; no automatic resend is permitted.',409)
 const bytes=await readArtifactBytes(c.db,e.read.artifact_id)
 if(await sha256(bytes)!==e.read.response_sha256)fail('EVIDENCE','The immutable monitoring response digest does not match.',409)
 return {allowed:servicePeople,result:{id:c.commandId,claimId:f.id,status:'queued'},checks:[...e.checks,noPrior],writes:[sql("INSERT INTO lk_service_level_dispatches(id,agreement_id,claim_id,monitor_id,month,claim_version,actor_id,recipient,sender,subject,message_text,message_digest,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'queued',?)",c.commandId,f.agreement_id,f.id,f.monitor_id,f.month,f.version,c.actor.id,f.recipient,c.env.MAIL_FROM??'',f.subject,f.message_text,f.message_digest,c.now)],audit:[{action:'service-level.email.requested',agreementId:f.agreement_id,summary:'Agreement owner explicitly requested one email of the approved service-credit amount and exact supplier message before its claim deadline. Queued is not sent.'}]}
}
export async function dispatchServiceClaim(c:Ctx) {
 const d=await c.db.prepare('SELECT * FROM lk_service_level_dispatches WHERE id=?').bind(c.commandId).first<ServiceRow>()
 if(!d||d.status!=='queued')return
 let claimed=false
 const attempt=crypto.randomUUID(),finish=async(status:string,receipt:string|null,code:string|null)=>{
  const unclaimed=status==='cancelled'&&!claimed,previous=unclaimed?'queued':'sending',token=unclaimed?null:attempt,audit=auditSql(c,{action:`service-level.email.${status}`,agreementId:d.agreement_id,summary:status==='accepted'?'Postmark accepted the approved service-credit claim; mailbox delivery, timely receipt and credit recovery are unconfirmed.':status==='suppressed'?'Service-credit claim suppressed in local development or demo; no supplier email sent.':`Service-credit email outcome: ${status}. No automatic resend.`})
  await c.db.batch([c.db.prepare(`INSERT INTO lk_audit SELECT ${audit.params.map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM lk_service_level_dispatches WHERE id=? AND status=? AND attempt_id IS ?)`).bind(...audit.params,d.id,previous,token),c.db.prepare('UPDATE lk_service_level_dispatches SET status=?,provider_message_id=?,outcome_code=? WHERE id=? AND status=? AND attempt_id IS ?').bind(status,receipt,code,d.id,previous,token)])
 }
 try{
  const e=await serviceClaim({...c,now:Date.now()},d.claim_id,d.claim_version),f=e.claim
  if(c.actor.id!==d.actor_id||c.actor.id!==e.a.owner_id||f.status!=='approved'||f.approved_by!==c.actor.id||f.approved_operator_version!==c.actor.operatorVersion||f.message_digest!==d.message_digest||await serviceMessageDigest(f)!==d.message_digest||uptimeOrigin(c.env.UPTIME_ORIGIN)!==e.link.origin||!c.env.UPTIME_METRICS_KEY)fail('APPROVAL','The approved claim, evidence connection, deadline or sender authority changed.',409)
  if(await sha256(await readArtifactBytes(c.db,e.read.artifact_id))!==e.read.response_sha256)fail('EVIDENCE','The original monitoring bytes do not match.',409)
  await commit(c,servicePeople,[...e.checks,sql("EXISTS(SELECT 1 FROM lk_service_level_dispatches WHERE id=? AND status='queued')",d.id)],[sql("UPDATE lk_service_level_dispatches SET status='sending',attempt_id=?,attempted_at=? WHERE id=? AND status='queued'",attempt,Date.now(),d.id)])
 }catch(error){if(!(error instanceof Problem))throw error;return finish('cancelled',null,'authority_evidence_or_deadline_changed')}
 const own=await c.db.prepare('SELECT attempt_id FROM lk_service_level_dispatches WHERE id=?').bind(d.id).first<{attempt_id:string}>()
 if(own?.attempt_id!==attempt)return
 claimed=true
 const claim=await c.db.prepare('SELECT deadline_at FROM lk_service_level_claims WHERE id=?').bind(d.claim_id).first<{deadline_at:number}>()
 if(!claim||Date.now()>=claim.deadline_at)return finish('cancelled',null,'claim_deadline_passed')
 if(local(c))return finish('suppressed',null,'local_suppressed')
 if(!c.env.POSTMARK_SERVER_TOKEN||!c.env.MAIL_FROM||c.env.MAIL_FROM!==d.sender)return finish('rejected',null,'mail_unavailable_or_sender_changed')
 try{
  const response=await fetch('https://api.postmarkapp.com/email',{method:'POST',redirect:'error',headers:{'content-type':'application/json',Accept:'application/json','X-Postmark-Server-Token':c.env.POSTMARK_SERVER_TOKEN},body:JSON.stringify({From:d.sender,To:d.recipient,Subject:d.subject,TextBody:d.message_text,MessageStream:'outbound'}),signal:AbortSignal.timeout(15000)}),body=await response.json().catch(()=>null) as {ErrorCode?:unknown;MessageID?:unknown}|null
  if(response.status===429)return finish('rate_limited',null,'postmark_429')
  if(response.status>=500)return finish('uncertain',null,'provider_outcome_unknown')
  if(!response.ok||typeof body?.ErrorCode==='number'&&body.ErrorCode!==0)return finish('rejected',null,'provider_rejected')
  if(body?.ErrorCode!==0||typeof body.MessageID!=='string'||!body.MessageID)return finish('uncertain',null,'provider_receipt_missing')
  return finish('accepted',body.MessageID,null)
 }catch{return finish('uncertain',null,'provider_outcome_unknown')}
}
export const serviceMailHandlers={'service-level.email':email}
