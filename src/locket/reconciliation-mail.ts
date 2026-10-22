import { auditSql, commit, type Ctx, type Handler } from './commands'
import { requireRole } from './access'
import { fail, Problem, sql } from './model'
import { currentEvidence, finding, humanReconciliationRoles, messageDigest, type ReconciliationRow } from './reconciliation-records'

const local=(c:Ctx)=>c.env.AUTH_LOCAL==='true'||(c.env as {RER_DEMO?:string}).RER_DEMO==='1'
const send:Handler=async(c,p)=>{
 requireRole(c.actor,humanReconciliationRoles,'send the approved credit request')
 const f=await finding(c,p.findingId,p.findingVersion),e=await currentEvidence(c,f)
 if(c.actor.id!==f.owner_id)fail('FORBIDDEN','Only the finding owner sends its approved supplier message.',403)
 if(f.status!=='approved'||f.approved_by!==f.owner_id||!f.finance_by||f.finance_operator_version!==e.finance.person.version)fail('APPROVAL','Current finance confirmation and finding-owner message approval are required.',409)
 if(p.consent!==true||p.messageDigest!==f.message_digest||!f.message_digest||await messageDigest(f)!==f.message_digest)fail('APPROVAL','Explicitly authorize sending the exact approved recipient, subject and message.',409)
 if(!local(c)&&(!c.env.POSTMARK_SERVER_TOKEN||!c.env.MAIL_FROM))fail('MAIL_UNAVAILABLE','Configure server-only Postmark credentials and the sender before requesting email.',503)
 if(await c.db.prepare('SELECT id FROM lk_reconciliation_dispatches WHERE finding_id=?').bind(f.id).first())fail('ALREADY_SENT','This finding already has a send request. Inspect its outcome; uncertain attempts are never automatically resent.',409)
 return {allowed:humanReconciliationRoles,result:{id:c.commandId,findingId:f.id,status:'queued'},checks:[...e.checks,sql('NOT EXISTS(SELECT 1 FROM lk_reconciliation_dispatches WHERE finding_id=?)',f.id)],writes:[sql("INSERT INTO lk_reconciliation_dispatches(id,finding_id,agreement_id,finding_version,actor_id,recipient,sender,subject,message_text,message_digest,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'queued',?)",c.commandId,f.id,f.agreement_id,f.version,c.actor.id,f.recipient,c.env.MAIL_FROM??'',f.subject,f.message_text,f.message_digest,c.now)],audit:[{action:'reconciliation.email.requested',agreementId:f.agreement_id,summary:'Finding owner explicitly requested email of the exact approved credit request. Queued is not sent; no accounting entry was posted.'}]}
}
/** One durable claim precedes the network call. A lost response remains uncertain
 * or sending and never becomes a second supplier email on command replay. */
export async function dispatchReconciliation(c:Ctx) {
 const d=await c.db.prepare('SELECT * FROM lk_reconciliation_dispatches WHERE id=?').bind(c.commandId).first<ReconciliationRow>()
 if(!d||d.status!=='queued')return
 const attempt=crypto.randomUUID()
 const finish=async(status:string,receipt:string|null,code:string|null)=>{
  const action=auditSql(c,{action:`reconciliation.email.${status}`,agreementId:d.agreement_id,summary:status==='accepted'?'Postmark accepted the exact approved credit request; mailbox delivery and credit recovery remain unconfirmed.':status==='suppressed'?'Credit request suppressed in local development or demo; no email was sent.':`Credit-request email outcome: ${status}. No automatic resend.`})
  const expected=status==='cancelled'?'queued':'sending',token=status==='cancelled'?null:attempt
  await c.db.batch([
   c.db.prepare(`INSERT INTO lk_audit SELECT ${action.params.map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM lk_reconciliation_dispatches WHERE id=? AND status=? AND attempt_id IS ?)`).bind(...action.params,d.id,expected,token),
   c.db.prepare('UPDATE lk_reconciliation_dispatches SET status=?,provider_message_id=?,outcome_code=? WHERE id=? AND status=? AND attempt_id IS ?').bind(status,receipt,code,d.id,expected,token),
  ])
 }
 try{
  const f=await finding(c,d.finding_id,d.finding_version),e=await currentEvidence(c,f)
  if(c.actor.id!==d.actor_id||c.actor.id!==f.owner_id||f.status!=='approved'||f.approved_by!==f.owner_id||f.message_digest!==d.message_digest||await messageDigest(f)!==d.message_digest||f.finance_operator_version!==e.finance.person.version)fail('APPROVAL','The approved finding or sender authority changed.',409)
  await commit(c,humanReconciliationRoles,[...e.checks,sql("EXISTS(SELECT 1 FROM lk_reconciliation_dispatches WHERE id=? AND status='queued')",d.id)],[sql("UPDATE lk_reconciliation_dispatches SET status='sending',attempt_id=?,attempted_at=? WHERE id=? AND status='queued'",attempt,c.now,d.id)])
 }catch(error){if(!(error instanceof Problem))throw error;return finish('cancelled',null,'authority_or_source_changed')}
 const claimed=await c.db.prepare('SELECT attempt_id FROM lk_reconciliation_dispatches WHERE id=?').bind(d.id).first<{attempt_id:string}>()
 if(claimed?.attempt_id!==attempt)return
 if(local(c))return finish('suppressed',null,'local_suppressed')
 if(!c.env.POSTMARK_SERVER_TOKEN||!c.env.MAIL_FROM||c.env.MAIL_FROM!==d.sender)return finish('rejected',null,'mail_unavailable_or_sender_changed')
 try{
  const response=await fetch('https://api.postmarkapp.com/email',{method:'POST',redirect:'manual',headers:{'content-type':'application/json',accept:'application/json','X-Postmark-Server-Token':c.env.POSTMARK_SERVER_TOKEN},body:JSON.stringify({From:d.sender,To:d.recipient,Subject:d.subject,TextBody:d.message_text,MessageStream:'outbound'}),signal:AbortSignal.timeout(15000)})
  const body=await response.json().catch(()=>null) as {MessageID?:unknown;ErrorCode?:unknown}|null
  if(response.status===429)return finish('rate_limited',null,'postmark_429')
  if(response.status>=500)return finish('uncertain',null,'provider_outcome_unknown')
  if(!response.ok||typeof body?.ErrorCode==='number'&&body.ErrorCode!==0)return finish('rejected',null,'provider_rejected')
  if(body?.ErrorCode!==0||typeof body.MessageID!=='string'||!body.MessageID)return finish('uncertain',null,'provider_receipt_missing')
  return finish('accepted',body.MessageID,null)
 }catch{return finish('uncertain',null,'provider_outcome_unknown')}
}
export const reconciliationMailHandlers={'reconciliation.email':send}
