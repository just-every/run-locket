import type { Bindings } from '../auth.server'
import { may, visibleSql } from './access'
import { syncRulePending } from './approval-rules'
import { auditSql, commit, guardSql, type Ctx } from './commands'
import { Problem, sql, type Actor } from './model'
import { currentVersion, type AgreementRow } from './records'
import { decisionContext, routing } from './review'
import { channelEnv, channelPreferences, channelSettings, channelSettingsCheck } from './approval-channel-config'
import { channelRequestWrites } from './approval-channel-requests'
import { channelScheduler, dispatchApprovalChannels } from './approval-channel-dispatch'

/** Reconciliation is opt-in, idempotent and creates no historical requests for
 * completed work. Current unlocked named steps and unassigned route roles only. */
export async function runApprovalChannels(env:Bindings,now=Date.now()){
 const settings=await channelSettings(env.DB)
 if(settings.automatic){
  await syncRulePending(env,now)
  const c:Ctx={env,db:env.DB,actor:channelScheduler,now,commandId:crypto.randomUUID()}
  const agreements=(await env.DB.prepare("SELECT * FROM lk_agreements WHERE status='in_review'").all<AgreementRow>()).results
  for(const a of agreements){
   const v=await currentVersion(c,a),context=await decisionContext(env.DB,a,v)
   for(const target of await routing(env.DB,a)){
    const pending=target.approverId?await env.DB.prepare('SELECT recipient_id FROM lk_rule_pending WHERE agreement_id=? AND step_id=? AND active=1').bind(a.id,target.deviationId).first<{recipient_id:string|null}>():null
    const recipients=target.approverId?(pending?.recipient_id?[{id:pending.recipient_id}]:[]):(await env.DB.prepare(`SELECT o.id FROM oa_operators o LEFT JOIN lk_roles r ON r.operator_id=o.id WHERE o.status='active' AND (CASE WHEN o.role='owner' THEN 'owner' ELSE COALESCE(r.role,'viewer') END) IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(target.roles)).all<{id:string}>()).results
    for(const person of recipients){
     const key=`automatic:${a.id}:${context.digest}:${target.kind}:${target.deviationId??'baseline'}:${person.id}`
     if(await env.DB.prepare('SELECT 1 FROM lk_approval_channel_requests WHERE event_key=?').bind(key).first())continue
     c.commandId=crypto.randomUUID()
     try{
      const out=await channelRequestWrites(c,a,v,target,person.id,key,'automatic'),guard=crypto.randomUUID()
      await env.DB.batch([guardSql(guard,[...out.checks,channelSettingsCheck(settings.version),sql("EXISTS(SELECT 1 FROM lk_approval_channel_settings WHERE id='installation' AND automatic=1)")]),...out.writes,auditSql(c,{action:'approval.channel.automatic',agreementId:a.id,summary:'Created a generic approval request for a currently eligible route recipient through personal channels.'},'scheduler'),sql('DELETE FROM lk_guard WHERE id=?',guard)].map(s=>env.DB.prepare(s.sql).bind(...s.params)))
     }catch(error){if(error instanceof Problem||/LOCKET_GUARD|UNIQUE constraint/.test(String(error)))continue;throw error}
    }
   }
  }
  // Existing in-app events remain; this channel outbox exclusively owns their
  // external send. Do not relabel any attempted or completed notification.
  await env.DB.prepare(`UPDATE lk_notifications SET email_status='suppressed',code='approval_channel_outbox'
   WHERE source_kind IS NULL AND kind IN ('approval','rule_approval','rule_approval_reminder','rule_approval_escalation')
   AND email_status IN ('pending','immediate','digest') AND delivery_id IS NULL
   AND EXISTS(SELECT 1 FROM lk_approval_channel_requests r WHERE r.agreement_id=lk_notifications.agreement_id AND r.recipient_id=lk_notifications.recipient_id AND r.version_id=(SELECT current_version_id FROM lk_agreements WHERE id=r.agreement_id))`).run()
 }
 // Rule reminders and escalations already carry the configured business-day
 // intervals, delegate routing, access fence and four-hour manual limit.
 const reminders=(await env.DB.prepare(`SELECT e.*,p.step_id FROM lk_rule_reminder_events e JOIN lk_rule_pending p ON p.id=e.pending_id WHERE p.active=1`).all<any>()).results
 for(const e of reminders){
  const original=await env.DB.prepare('SELECT 1 FROM lk_approval_channel_requests WHERE rule_pending_id=?').bind(e.pending_id).first()
  if(!original)continue
  const key='rule-reminder:'+e.id
  if(await env.DB.prepare('SELECT 1 FROM lk_approval_channel_requests WHERE event_key=?').bind(key).first())continue
  const c:Ctx={env,db:env.DB,actor:channelScheduler,now,commandId:crypto.randomUUID()}
  const a=await env.DB.prepare("SELECT * FROM lk_agreements WHERE id=? AND status='in_review'").bind(e.agreement_id).first<AgreementRow>()
  if(!a)continue
  const target=(await routing(env.DB,a)).find(t=>t.deviationId===e.step_id);if(!target)continue
  try{
   const out=await channelRequestWrites(c,a,await currentVersion(c,a),target,e.recipient_id,key,e.kind),guard=crypto.randomUUID()
   await env.DB.batch([guardSql(guard,out.checks),...out.writes,auditSql(c,{action:'approval.channel.'+e.kind,agreementId:a.id,summary:'Routed the configured rule reminder through current personal approval channels.'},'scheduler'),sql('DELETE FROM lk_guard WHERE id=?',guard)].map(s=>env.DB.prepare(s.sql).bind(...s.params)))
   await env.DB.prepare("UPDATE lk_notifications SET email_status='suppressed',code='approval_channel_outbox' WHERE event_key=? AND recipient_id=? AND email_status IN ('pending','immediate','digest') AND delivery_id IS NULL").bind(e.id,e.recipient_id).run()
  }catch(error){if(error instanceof Problem||/LOCKET_GUARD|UNIQUE constraint/.test(String(error)))continue;throw error}
 }
 await dispatchApprovalChannels(env,now)
}

/** Called before the old baseline reminder sender claims its email. Returning
 * null leaves legacy explicit-email requests on their existing delivery path. */
export async function dispatchChannelReminder(c:Ctx,id:string,person:boolean){
 const reminder=await c.db.prepare('SELECT * FROM lk_approval_reminders WHERE id=?').bind(id).first<any>()
 if(!reminder)return null
 const original=await c.db.prepare('SELECT 1 FROM lk_approval_channel_requests WHERE agreement_id=? AND version_id=? AND recipient_id=? AND kind=\'commercial\' AND deviation_id IS NULL').bind(reminder.agreement_id,reminder.version_id,reminder.approver_id).first()
 if(!original)return null
 const receipt=async()=>{const row=await c.db.prepare('SELECT status,code FROM lk_approval_reminders WHERE id=?').bind(id).first<{status:string;code:string|null}>();return {id,status:row!.status,code:row!.code,recipientId:reminder.recipient_id,kind:reminder.kind,provider:null,providerMessageId:null}}
 if(reminder.status!=='queued')return receipt()
 const a=await c.db.prepare("SELECT * FROM lk_agreements WHERE id=? AND status='in_review'").bind(reminder.agreement_id).first<AgreementRow>()
 if(!a)return null
 const target=(await routing(c.db,a)).find(t=>t.kind==='commercial'&&!t.deviationId);if(!target)return null
 const key='baseline-reminder:'+id
 if(!await c.db.prepare('SELECT 1 FROM lk_approval_channel_requests WHERE event_key=?').bind(key).first()){
  try{
   const out=await channelRequestWrites({...c,commandId:crypto.randomUUID()},a,await currentVersion(c,a),target,reminder.recipient_id,key,reminder.kind)
   const checks=[...out.checks,sql("EXISTS(SELECT 1 FROM lk_approval_reminders WHERE id=? AND status='queued' AND version_id=? AND version_digest=?)",id,a.current_version_id,reminder.version_digest),...(person?[visibleSql(c.actor,a.id)]:[])]
   const writes=[...out.writes,sql("UPDATE lk_approval_reminders SET status='suppressed',code='personal_approval_channels' WHERE id=? AND status='queued'",id),auditSql(c,{action:'approval.channel.reminder',agreementId:a.id,summary:'Routed a configured reminder through personal approval channels.'},person?c.actor.role:'scheduler')]
   if(person)await commit(c,may.review,checks,writes)
   else{const guard=crypto.randomUUID();await c.db.batch([guardSql(guard,checks),...writes,sql('DELETE FROM lk_guard WHERE id=?',guard)].map(s=>c.db.prepare(s.sql).bind(...s.params)))}
  }catch(error){
   if(!(error instanceof Problem)&&!/LOCKET_GUARD|UNIQUE constraint/.test(String(error)))throw error
   if(!await c.db.prepare('SELECT 1 FROM lk_approval_channel_requests WHERE event_key=?').bind(key).first()){
    await c.db.prepare("UPDATE lk_approval_reminders SET status='cancelled',code='authority_or_record_changed' WHERE id=? AND status='queued'").bind(id).run()
    return receipt()
   }
  }
 }
 await dispatchApprovalChannels(c.env,c.now)
 return receipt()
}

export async function approvalChannelState(env:Bindings,actor:Actor,visible:Set<string>){
 const preferences=await channelPreferences(env.DB,actor.id),settings=await channelSettings(env.DB)
 const requests=(await env.DB.prepare('SELECT id,agreement_id,version_id,kind,deviation_id,recipient_id,source,created_at FROM lk_approval_channel_requests ORDER BY created_at DESC').all<any>()).results.filter(r=>visible.has(r.agreement_id))
 const own=requests.filter(r=>r.recipient_id===actor.id),ids=new Set(requests.map(r=>r.id))
 const deliveries=(await env.DB.prepare('SELECT id,request_id,channel,status,provider_message_id,code,attempted_at,completed_at FROM lk_approval_channel_deliveries').all<any>()).results.filter(d=>ids.has(d.request_id)).map(d=>({...d,agreement_id:requests.find(r=>r.id===d.request_id)?.agreement_id}))
 const bindings=(await env.DB.prepare('SELECT operator_id,channel,destination,version FROM lk_approval_channel_bindings').all<any>()).results.filter(b=>actor.role==='owner'||b.operator_id===actor.id)
 const cfg=channelEnv(env)
 return {preferences,settings,bindings,requests:own,deliveries,providers:{email:!!env.MAIL_FROM,slack:!!cfg.APPROVAL_SLACK_TOKEN,teams:!!cfg.APPROVAL_TEAMS_TOKEN,nook:!!cfg.APPROVAL_NOOK_TOKEN&&!!cfg.APPROVAL_NOOK_ORIGIN}}
}
export const approvalChannelTables=['lk_approval_channel_settings','lk_approval_channel_bindings','lk_approval_channel_preferences','lk_approval_channel_requests','lk_approval_channel_deliveries']
