// Every channel reaches the existing decision handler as the current Base actor.
import type { Bindings } from '../auth.server'
import { may, requireRole, roleSql, visibleSql } from './access'
import { rulePendingSql } from './approval-rules'
import { type Ctx, type Handler } from './commands'
import { fail, json, oneOf, optionalText, sql, text, type Actor, type Sql } from './model'
import { notificationCheck, notificationPeople, notificationWrites } from './notifications'
import { agreementGuards, currentVersion, requireStatus, visibleAgreement, type AgreementRow, type VersionRow } from './records'
import { requireFullFields } from './repository-access'
import { decisionContext, reviewHandlers, routing, type Requirement } from './review'
import { channelPreferences, channelPreferenceCheck } from './approval-channel-config'

export interface ChannelRequest {
 id:string;event_key:string;agreement_id:string;agreement_version:number;version_id:string;version_digest:string;context_digest:string
 kind:'commercial'|'exception';deviation_id:string|null;rule_pending_id:string|null;recipient_id:string;recipient_email:string;requested_by:string;source:string;created_at:number
}
export const requestLink=(env:Bindings,id:string)=>`${new URL(env.AUTH_ORIGIN).origin}/app#approval-request/${encodeURIComponent(id)}`
export const readChannelRequest=(db:D1Database,id:string)=>db.prepare('SELECT * FROM lk_approval_channel_requests WHERE id=?').bind(id).first<ChannelRequest>()
export function requestCurrentChecks(c:Ctx,r:ChannelRequest):Sql[]{
 return [sql("EXISTS(SELECT 1 FROM lk_agreements a JOIN lk_versions v ON v.id=a.current_version_id WHERE a.id=? AND a.status='in_review' AND v.id=? AND v.digest=?)",r.agreement_id,r.version_id,r.version_digest),
 sql('NOT EXISTS(SELECT 1 FROM lk_approvals WHERE agreement_id=? AND version_id=? AND version_digest=? AND context_digest=? AND kind=? AND deviation_id IS ? AND invalidated_at IS NULL)',r.agreement_id,r.version_id,r.version_digest,r.context_digest,r.kind,r.deviation_id),
 visibleSql({...c.actor,id:r.recipient_id},r.agreement_id),
 sql(`EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND o.email=? AND (${roleSql}) IN (SELECT value FROM json_each(?)))`,r.recipient_id,r.recipient_email,r.recipient_id,json(r.kind==='exception'?['owner','counsel','approver']:['owner','approver','counsel'])),
 ...(r.rule_pending_id?[rulePendingSql(r.rule_pending_id,r.agreement_id,r.recipient_id)]:[])]
}
export async function channelRecipient(c:Ctx,a:AgreementRow,target:Requirement,recipientId:string){
 const row=await c.db.prepare(`SELECT o.email,${roleSql} AS role FROM oa_operators o WHERE o.id=? AND o.status='active'`).bind(recipientId,recipientId).first<{email:string;role:Actor['role']}>()
 if(!row||!target.roles.includes(row.role)||row.role!=='owner'&&a.requester_id===recipientId)fail('RECIPIENT','Choose an active approver for this approval step with current agreement access.',400)
 const checks=[visibleSql({...c.actor,id:recipientId},a.id),sql(`EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND o.email=? AND (${roleSql}) IN (SELECT value FROM json_each(?)))`,recipientId,row.email,recipientId,json(target.roles))]
 let pendingId:string|null=null
 if(target.approverId){
  const pending=await c.db.prepare('SELECT id,escalation_id FROM lk_rule_pending WHERE agreement_id=? AND step_id=? AND active=1').bind(a.id,target.deviationId).first<{id:string;escalation_id:string|null}>()
  if(!pending)fail('RECIPIENT','This named approval step is not unlocked.',409)
  if(row.role!=='owner'&&recipientId!==(target.away?target.delegateId:target.approverId)&&recipientId!==pending.escalation_id)fail('RECIPIENT','Choose the current named approver or away delegate.',400)
  pendingId=pending.id;checks.push(rulePendingSql(pendingId,a.id,recipientId))
 }
 if(!await notificationCheck(c.db,checks))fail('RECIPIENT','The recipient cannot currently review this agreement or act on this step.',400)
 await requireFullFields(c.db,{...c.actor,id:recipientId,role:row.role})
 return {email:row.email,checks,pendingId}
}
export async function channelRequestWrites(c:Ctx,a:AgreementRow,v:VersionRow,target:Requirement,recipientId:string,eventKey:string,source:string,id=c.commandId){
 const recipient=await channelRecipient(c,a,target,recipientId),context=await decisionContext(c.db,a,v)
 if(await c.db.prepare('SELECT 1 FROM lk_approvals WHERE agreement_id=? AND version_id=? AND context_digest=? AND kind=? AND deviation_id IS ? AND invalidated_at IS NULL').bind(a.id,v.id,context.digest,target.kind,target.deviationId).first())fail('ALREADY_DECIDED','This approval step is already decided.',409)
 const preference=await channelPreferences(c.db,recipientId)
 const bindings=(await c.db.prepare('SELECT * FROM lk_approval_channel_bindings WHERE operator_id=?').bind(recipientId).all<{channel:string;destination:string;version:number}>()).results
 const writes=[sql('INSERT INTO lk_approval_channel_requests VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,eventKey,a.id,a.version,v.id,v.digest,context.digest,target.kind,target.deviationId,recipient.pendingId,recipientId,recipient.email,c.actor.id,source,c.now)]
 for(const channel of preference.channels){
  const binding=bindings.find(b=>b.channel===channel),available=channel==='word'||channel==='phone'
  writes.push(sql('INSERT INTO lk_approval_channel_deliveries(id,request_id,channel,destination,binding_version,preference_version,status,code) VALUES(?,?,?,?,?,?,?,?)',crypto.randomUUID(),id,channel,binding?.destination??null,binding?.version??null,preference.version,available?'available':!['email','word','phone'].includes(channel)&&!binding?'suppressed':'queued',!['email','word','phone'].includes(channel)&&!binding?'destination_unbound':null))
 }
 // The existing reminder scheduler sees every baseline request, including chat-only requests.
 // This bridge is already settled: channel dispatch is the only initial sender.
 if(target.kind==='commercial'&&!target.deviationId&&(source==='manual'||source==='automatic'))writes.push(sql("INSERT INTO lk_approval_mail(id,agreement_id,agreement_version,version_id,version_digest,recipient_id,recipient_email,review_url,status,created_at,code) VALUES(?,?,?,?,?,?,?,?,'suppressed',?,'channel_request_bridge')",id,a.id,a.version,v.id,v.digest,recipientId,recipient.email,requestLink(c.env,id),c.now))
 writes.push(...notificationWrites(c,{key:'channel:'+eventKey,agreementId:a.id,recipientId,kind:'approval'}))
 // Initial notifications are owned by this durable channel outbox, not a second email sender.
 writes.push(sql("UPDATE lk_notifications SET email_status='suppressed',code='approval_channel_outbox' WHERE event_key=? AND recipient_id=?",'channel:'+eventKey,recipientId))
 return {id,writes,checks:[...agreementGuards(c,a),...recipient.checks,channelPreferenceCheck(recipientId,preference.version),sql('NOT EXISTS(SELECT 1 FROM lk_approval_channel_requests WHERE event_key=?)',eventKey)],reviewUrl:requestLink(c.env,id)}
}
export async function currentChannelChecks(c:Ctx,r:ChannelRequest):Promise<Sql[]> {
 const a=await visibleAgreement({...c,actor:{...c.actor,id:r.recipient_id}},r.agreement_id),v=await currentVersion(c,a)
 const target=(await routing(c.db,a)).find(t=>t.kind===r.kind&&(t.deviationId??null)===r.deviation_id)
 if(!target)fail('NOT_REQUIRED','This approval is no longer required.',409)
 const recipient=await channelRecipient(c,a,target,r.recipient_id),context=await decisionContext(c.db,a,v)
 if(context.digest!==r.context_digest)fail('NOT_CURRENT','The approval context changed.',409)
 return [...requestCurrentChecks(c,r),...recipient.checks,sql('(SELECT version FROM lk_agreements WHERE id=?)=?',a.id,a.version)]
}

const request:Handler=async(c,p)=>{
 requireRole(c.actor,may.review,'request an approval through personal channels')
 const a=await visibleAgreement(c,p.agreementId);requireStatus(a,['in_review'],'request approval')
 const v=await currentVersion(c,a)
 if(p.versionId!==v.id)fail('NOT_CURRENT','The version changed. Reload before requesting approval.',409)
 const kind=oneOf(p,'kind',['commercial','exception'] as const),deviationId=optionalText(p,'deviationId',200),recipientId=text(p,'recipientId',100)
 const target=(await routing(c.db,a)).find(r=>r.kind===kind&&(r.deviationId??null)===deviationId)
 if(!target)fail('NOT_REQUIRED','This approval is not part of the current route.',409)
 const prepared=await channelRequestWrites(c,a,v,target,recipientId,'manual:'+c.commandId,'manual')
 return {allowed:may.review,result:{id:prepared.id,status:'queued',reviewUrl:prepared.reviewUrl},checks:[...prepared.checks,...agreementGuards(c,a,p)],writes:prepared.writes,audit:[{action:'approval.channel.requested',agreementId:a.id,summary:'Requested generic approval through the recipient’s personal channels; provider receipt does not confirm delivery.'}]}
}
const decide:Handler=async(c,p)=>{
 const id=text(p,'requestId',100),row=await readChannelRequest(c.db,id)
 if(!row||row.recipient_id!==c.actor.id)fail('NOT_FOUND','No approval request is available for this account.',404)
 const a=await visibleAgreement(c,row.agreement_id),v=await currentVersion(c,a),context=await decisionContext(c.db,a,v)
 if(row.version_id!==v.id||row.version_digest!==v.digest||row.context_digest!==context.digest)fail('NOT_CURRENT','The version or decision context you reviewed changed. Reload to see the current version before deciding.',409,{agreementId:a.id,currentVersionId:v.id})
 if(p.versionId!==row.version_id||p.versionDigest!==row.version_digest||p.contextDigest!==row.context_digest)fail('NOT_CURRENT','Review this exact version and decision context before deciding.',409)
 const out=await reviewHandlers['approval.decide'](c,{agreementId:a.id,version:a.version,versionId:row.version_id,kind:row.kind,deviationId:row.deviation_id,decision:p.decision,reason:p.reason})
 out.checks=[...(out.checks??[]),...requestCurrentChecks(c,row),sql('EXISTS(SELECT 1 FROM lk_approval_channel_requests WHERE id=? AND recipient_id=?)',id,c.actor.id)]
 out.audit.push({action:'approval.channel.decided',agreementId:a.id,summary:`Authenticated recipient decided from the ${row.source} approval request on the exact reviewed version.`})
 return out
}
export const approvalChannelHandlers:Record<string,Handler>={'approval.channel.request':request,'approval.channel.decide':decide}

/** A cached acknowledgement is still a scoped read under today's authority. */
export async function authorizeChannelResult(c:Ctx,type:string,p:Record<string,unknown>){
 if(type==='approval.channel.configure'||type==='approval.channel.bind')requireRole(c.actor,may.manageRoles,'read approval channel settings outcomes')
 else if(type==='approval.channel.preferences')requireRole(c.actor,notificationPeople,'read own approval channel preferences')
 else if(type==='approval.channel.request'){
  requireRole(c.actor,may.review,'read an approval request outcome')
  await visibleAgreement(c,p.agreementId)
 }else if(type==='approval.channel.decide'){
  const r=await readChannelRequest(c.db,text(p,'requestId',100))
  if(!r||r.recipient_id!==c.actor.id)fail('NOT_FOUND','No approval request is available for this account.',404)
  const a=await visibleAgreement(c,r.agreement_id),target=(await routing(c.db,a)).find(t=>t.kind===r.kind&&(t.deviationId??null)===r.deviation_id)
  if(!target)fail('NOT_FOUND','This approval step is no longer available.',404)
  requireRole(c.actor,target.roles,'read an approval decision outcome')
 }
}

/** Authenticated read only; forwarded links neither reveal a record nor grant authority. */
export async function approvalChannelRequestView(env:Bindings,actor:Actor,id:string){
 requireRole(actor,notificationPeople,'read an approval request')
 const c:Ctx={env,db:env.DB,actor,now:Date.now(),commandId:crypto.randomUUID()},r=await readChannelRequest(env.DB,id)
 if(!r||r.recipient_id!==actor.id)fail('NOT_FOUND','No approval request is available for this account.',404)
 await requireFullFields(env.DB,actor)
 const a=await visibleAgreement(c,r.agreement_id),v=await currentVersion(c,a),context=await decisionContext(c.db,a,v)
 const target=(await routing(env.DB,a)).find(t=>t.kind===r.kind&&(t.deviationId??null)===r.deviation_id)
 let eligible=false
 if(target)try{await channelRecipient(c,a,target,actor.id);eligible=true}catch{eligible=false}
 const current=r.version_id===v.id&&r.version_digest===v.digest&&r.context_digest===context.digest
 return {request:{id:r.id,versionId:r.version_id,versionDigest:r.version_digest,contextDigest:r.context_digest,source:r.source},agreement:{id:a.id,title:a.title,status:a.status},version:{id:v.id,number:v.number,digest:v.digest,text:v.text},files:(await env.DB.prepare('SELECT id,filename FROM lk_artifacts WHERE version_id=?').bind(v.id).all<{id:string;filename:string}>()).results,findings:(await env.DB.prepare("SELECT id,clause_key,result,explanation,quote FROM lk_deviations WHERE version_id=? AND result!='met'").bind(v.id).all()).results,context:context.context,label:target?.label??'Approval',current,canDecide:current&&eligible&&(!target?.approverId||actor.role==='owner'||actor.id===(target.away?target.delegateId:target.approverId))&&await notificationCheck(c.db,requestCurrentChecks(c,r)),currentReviewUrl:`/app#agreement/${encodeURIComponent(a.id)}/review`}
}
