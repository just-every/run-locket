import type { Bindings } from '../auth.server'
import { may, roleSql } from './access'
import { auditSql, guardSql, type Ctx } from './commands'
import { installationMail, installationMailLocal, installationMailReady } from './installation-mail'
import { Problem, sql, type Actor } from './model'
import { remediationRequest, type RemediationRow } from './remediation-records'
import { remediationDigest } from './remediation'

/** Both cron and explicit send use the same one-use durable claim. No session is fabricated. */
export async function dispatchRemediation(c:Ctx,occurrenceId:string) {
 const occurrence=await c.db.prepare('SELECT * FROM lk_remediation_occurrences WHERE id=?').bind(occurrenceId).first<RemediationRow>()
 if(!occurrence||occurrence.status!=='pending'||occurrence.send_at>c.now)return
 const attempt=crypto.randomUUID()
 let claimed=false
 const finish=async(status:string,receipt:string|null,code:string|null)=>{
  const previous=claimed?'sending':'pending',token=claimed?attempt:null
  const audit=auditSql(c,{action:`remediation.mail.${status}`,agreementId:occurrence.agreement_id,summary:status==='accepted'?'Installation mail provider accepted the approved request. Delivery and receipt remain unconfirmed.':`Remediation request ${status}: ${code??''}. Uncertain attempts are never resent.`},'scheduler')
  await c.db.batch([
   c.db.prepare(`INSERT INTO lk_audit SELECT ${audit.params.map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM lk_remediation_occurrences WHERE id=? AND status=? AND attempt_id IS ?)`).bind(...audit.params,occurrence.id,previous,token),
   c.db.prepare('UPDATE lk_remediation_occurrences SET status=?,provider_message_id=?,outcome_code=? WHERE id=? AND status=? AND attempt_id IS ?').bind(status,receipt,code,occurrence.id,previous,token)
  ])
 }
 try {
  const e=await remediationRequest(c,occurrence.request_id),r=e.request
  if(r.status!=='approved'||r.approved_by!==e.o.owner_id||c.actor.id!==r.approved_by||c.actor.operatorVersion!==r.operator_version||!may.review.includes(c.actor.role)||await remediationDigest(r.recipient,JSON.parse(r.source),e.occurrences)!==r.digest)return finish('cancelled',null,'authority_or_approval_changed')
  if(!installationMailReady(c.env)||r.sender!==(c.env.MAIL_FROM??''))return finish('cancelled',null,'sender_changed_or_unavailable')
  const guard=crypto.randomUUID(),checks=[...e.checks,
   sql("EXISTS(SELECT 1 FROM lk_remediation_requests WHERE id=? AND status='approved' AND approved_by=? AND operator_version=? AND digest=?)",r.id,c.actor.id,c.actor.operatorVersion,r.digest),
   sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND version=?)",c.actor.id,c.actor.operatorVersion),sql(`${roleSql} IN (SELECT value FROM json_each(?))`,c.actor.id,JSON.stringify(may.review)),
   sql("EXISTS(SELECT 1 FROM lk_remediation_occurrences WHERE id=? AND status='pending' AND send_at<=?)",occurrence.id,c.now)]
  await c.db.batch([guardSql(guard,checks),sql("UPDATE lk_remediation_occurrences SET status='sending',attempt_id=?,attempted_at=? WHERE id=? AND status='pending'",attempt,c.now,occurrence.id),sql('DELETE FROM lk_guard WHERE id=?',guard)].map(s=>c.db.prepare(s.sql).bind(...s.params)))
  const own=await c.db.prepare('SELECT attempt_id FROM lk_remediation_occurrences WHERE id=?').bind(occurrence.id).first<{attempt_id:string}>()
  if(own?.attempt_id!==attempt)return
  claimed=true
  if(installationMailLocal(c.env))return finish('suppressed',null,'local_suppressed')
  try {
   const result=await installationMail(c.env)!.send({deliveryId:occurrence.id,from:r.sender,to:[r.recipient],subject:occurrence.subject,text:occurrence.message_text,html:'',headers:{}})
   return finish(result.status==='development'?'suppressed':result.status,result.providerMessageId,result.code??null)
  }catch{return finish('uncertain',null,'provider_outcome_unknown')}
 }catch(error){if(error instanceof Problem||/LOCKET_GUARD/.test(String(error)))return finish('cancelled',null,'authority_or_source_changed');throw error}
}
export async function runRemediation(env:Bindings,now:number) {
 const rows=(await env.DB.prepare("SELECT o.*,r.approved_by FROM lk_remediation_occurrences o JOIN lk_remediation_requests r ON r.id=o.request_id WHERE o.status='pending' AND r.status='approved' AND o.send_at<=? ORDER BY o.send_at,o.id").bind(now).all<RemediationRow>()).results
 for(const row of rows){
  const person=await env.DB.prepare(`SELECT id,display_name,email,version,${roleSql} AS locket_role FROM oa_operators WHERE id=? AND status='active'`).bind(row.approved_by,row.approved_by).first<RemediationRow>()
  const actor:Actor=person?{id:person.id,name:person.display_name,email:person.email,operatorVersion:person.version,role:person.locket_role,sessionId:''}:{id:row.approved_by,name:'Remediation scheduler',email:'',operatorVersion:0,role:'viewer',sessionId:''}
  await dispatchRemediation({env,db:env.DB,actor,now,commandId:row.id},row.id)
 }
}
