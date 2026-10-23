// One claimed attempt per delivery, even when the provider outcome is unknown.
import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { auditSql, guardSql, type Ctx } from './commands'
import { Problem, sql, type Actor, type Sql } from './model'
import { notificationCheck, notificationPreferences, type NotificationRow } from './notifications'
import { hiddenFields, policyVersionCheck, repositoryPolicy } from './repository-access'
import { channelEnv, channelPreferences, channelPreferenceCheck } from './approval-channel-config'
import { readChannelRequest, currentChannelChecks, requestLink, type ChannelRequest } from './approval-channel-requests'

interface Delivery {id:string;request_id:string;channel:string;destination:string|null;binding_version:number|null;preference_version:number;status:string;attempt_id:string|null}
export const channelScheduler:Actor={id:'locket-scheduler',name:'Locket scheduler',email:'',role:'viewer',sessionId:'',operatorVersion:0}
export const channelLocal=(env:Bindings)=>env.AUTH_LOCAL==='true'||(env as {RER_DEMO?:string}).RER_DEMO==='1'
const generic='An agreement is waiting for your approval in Locket. Sign in to review the exact version and record your decision.'
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
const context=(env:Bindings,now:number):Ctx=>({env,db:env.DB,actor:channelScheduler,commandId:crypto.randomUUID(),now})

async function send(c:Ctx,r:ChannelRequest,d:Delivery):Promise<{status:string;messageId:string|null;code:string|null}>{
 const env=channelEnv(c.env),url=requestLink(env,r.id)
 if(channelLocal(env))return {status:'suppressed',messageId:null,code:'local_or_demo'}
 if(d.channel==='email'){
  const mail=operatorMail(env)
  if(!mail||!env.MAIL_FROM)return {status:'rejected',messageId:null,code:'mail_unavailable'}
  const result=await mail.send({deliveryId:d.id,from:env.MAIL_FROM,to:[r.recipient_email],subject:'Approval requested in Locket',text:`${generic}\n\n${url}`,html:`<p>${generic}</p><p><a href="${escape(url)}">Review and decide in Locket</a></p>`,headers:{}})
  return {status:result.status==='development'?'suppressed':result.status,messageId:result.providerMessageId,code:result.code??null}
 }
 const slackBody={channel:d.destination,text:`${generic}\n${url}`,unfurl_links:false,unfurl_media:false,blocks:[{type:'section',text:{type:'plain_text',text:generic}},{type:'actions',elements:[{type:'button',text:{type:'plain_text',text:'Review and decide'},url,action_id:'locket_review'}]}]}
 let endpoint:string,token:string|undefined,body:unknown
 if(d.channel==='teams'){
  endpoint=`https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(d.destination!)}/messages`;token=env.APPROVAL_TEAMS_TOKEN
  body={body:{contentType:'html',content:`${generic}<br><attachment id="locket-review"></attachment>`},attachments:[{id:'locket-review',contentType:'application/vnd.microsoft.card.adaptive',content:JSON.stringify({type:'AdaptiveCard',version:'1.2',body:[{type:'TextBlock',text:generic,wrap:true}],actions:[{type:'Action.OpenUrl',title:'Review and decide',url}]})}]}
 }else if(d.channel==='slack'){endpoint='https://slack.com/api/chat.postMessage';token=env.APPROVAL_SLACK_TOKEN;body=slackBody}
 else if(d.channel==='nook'){
  if(!env.APPROVAL_NOOK_ORIGIN)return {status:'rejected',messageId:null,code:'nook_unconfigured'}
  const origin=new URL(env.APPROVAL_NOOK_ORIGIN)
  if(origin.protocol!=='https:'||origin.origin!==env.APPROVAL_NOOK_ORIGIN||origin.username||origin.password)return {status:'rejected',messageId:null,code:'nook_origin_invalid'}
  endpoint=origin.origin+'/api/slack/chat.postMessage';token=env.APPROVAL_NOOK_TOKEN;body=slackBody
 }else return {status:'rejected',messageId:null,code:'unsupported_channel'}
 if(!token||!d.destination)return {status:'rejected',messageId:null,code:'channel_unconfigured'}
 const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)})
 if(response.status===429)return {status:'rate_limited',messageId:null,code:'provider_rate_limited'}
 if(response.status>=500)return {status:'uncertain',messageId:null,code:'provider_outcome_unknown'}
 if(!response.ok)return {status:'rejected',messageId:null,code:'provider_rejected'}
 const result=await response.json() as {ok?:boolean;ts?:string;id?:string}
 if(d.channel==='teams')return typeof result.id==='string'?{status:'accepted',messageId:result.id,code:null}:{status:'uncertain',messageId:null,code:'invalid_provider_receipt'}
 return result.ok===true&&typeof result.ts==='string'?{status:'accepted',messageId:result.ts,code:null}:result.ok===false?{status:'rejected',messageId:null,code:'provider_rejected'}:{status:'uncertain',messageId:null,code:'invalid_provider_receipt'}
}

export async function dispatchApprovalChannels(env:Bindings,now=Date.now(),requestId?:string){
 const c=context(env,now)
 const rows=(await env.DB.prepare("SELECT * FROM lk_approval_channel_deliveries WHERE status='queued' AND (? IS NULL OR request_id=?) ORDER BY id").bind(requestId??null,requestId??null).all<Delivery>()).results
 for(const d of rows){
  const r=await readChannelRequest(env.DB,d.request_id);if(!r)continue
  c.commandId=r.id
  const attempt=crypto.randomUUID(),preferences=await channelPreferences(env.DB,r.recipient_id),notifications=await notificationPreferences(env.DB,r.recipient_id)
  const finish=async(status:string,code:string|null,messageId:string|null=null,claimed=false)=>{
   const audit=auditSql(c,{action:`approval.channel.${status}`,agreementId:r.agreement_id,summary:status==='accepted'?`${d.channel} provider accepted the generic approval request; delivery and reading are unconfirmed.`:status==='uncertain'?`${d.channel} outcome is unknown; this attempt will not be retried automatically.`:`${d.channel} approval request: ${status}${code?' ('+code+')':''}.`},'scheduler')
   await env.DB.batch([env.DB.prepare('UPDATE lk_approval_channel_deliveries SET status=?,code=?,provider_message_id=?,completed_at=?,attempt_id=COALESCE(attempt_id,?) WHERE id=? AND status=? AND attempt_id IS ?').bind(status,code,messageId,now,attempt,d.id,claimed?'sending':'queued',claimed?attempt:null),env.DB.prepare(`INSERT INTO lk_audit SELECT ${audit.params.map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM lk_approval_channel_deliveries WHERE id=? AND status=? AND attempt_id IS ?)`).bind(...audit.params,d.id,status,attempt)])
  }
  if(!preferences.channels.includes(d.channel as any)||preferences.version!==d.preference_version){await finish('suppressed','personal_channels_changed');continue}
  if(d.channel==='email'&&!notifications.email){await finish('suppressed','email_disabled');continue}
  const policy=await repositoryPolicy(env.DB)
  let live:Sql[]
  try{live=await currentChannelChecks(c,r)}catch{await finish('cancelled','authority_or_record_changed');continue}
  const checks=[...live,channelPreferenceCheck(r.recipient_id,preferences.version),policyVersionCheck(policy.version)]
  if(d.channel!=='email')checks.push(sql('EXISTS(SELECT 1 FROM lk_approval_channel_bindings WHERE operator_id=? AND channel=? AND destination=? AND version=?)',r.recipient_id,d.channel,d.destination,d.binding_version))
  if(d.channel==='email'){
   checks.push(sql('COALESCE((SELECT email FROM lk_person_preferences WHERE operator_id=?),1)=1',r.recipient_id))
   if(notifications.digest){
    // The existing shared daily digest owns this email, with the same source guards.
    const eventKey='channel-digest:'+r.id
    await env.DB.batch([
     env.DB.prepare("INSERT INTO lk_notifications(id,event_key,agreement_id,recipient_id,kind,created_at,version_id,version_digest,in_app,email_status) VALUES(?,?,?,?,'channel_approval',?,?,?,0,'digest') ON CONFLICT DO NOTHING").bind(crypto.randomUUID(),eventKey,r.agreement_id,r.recipient_id,now,r.version_id,r.version_digest),
     env.DB.prepare("UPDATE lk_approval_channel_deliveries SET status='suppressed',code='daily_digest' WHERE id=? AND status='queued'").bind(d.id),
    ])
    continue
   }else checks.push(sql('COALESCE((SELECT digest FROM lk_person_preferences WHERE operator_id=?),0)=0',r.recipient_id))
  }
  if((await hiddenFields(env.DB,{...channelScheduler,id:r.recipient_id})).length||!await notificationCheck(env.DB,checks)){await finish('cancelled','authority_or_record_changed');continue}
  const guard=crypto.randomUUID()
  try{await env.DB.batch([guardSql(guard,checks),sql("UPDATE lk_approval_channel_deliveries SET status='sending',attempt_id=?,attempted_at=? WHERE id=? AND status='queued'",attempt,now,d.id),sql('DELETE FROM lk_guard WHERE id=?',guard)].map(s=>env.DB.prepare(s.sql).bind(...s.params)))}catch(error){if(error instanceof Problem||/LOCKET_GUARD/.test(String(error))){await finish('cancelled','authority_or_record_changed');continue}throw error}
  const claimed=await env.DB.prepare('SELECT attempt_id FROM lk_approval_channel_deliveries WHERE id=?').bind(d.id).first<{attempt_id:string}>()
  if(claimed?.attempt_id!==attempt)continue
  try{const result=await send(c,r,d);await finish(result.status,result.code,result.messageId,true)}catch{await finish('uncertain','provider_outcome_unknown',null,true)}
 }
}

/** Shared digest hooks: every contained request repeats authority, route,
 * personal channels and version checks in the shared sender's atomic claim. */
export async function channelDigestChecks(c:Ctx,event:NotificationRow){
 const r=await readChannelRequest(c.db,event.event_key.slice('channel-digest:'.length))
 if(!r||r.recipient_id!==event.recipient_id)return {ready:true,checks:[sql('0')]}
 try{
  const preferences=await channelPreferences(c.db,r.recipient_id)
  if(!preferences.channels.includes('email'))return {ready:true,checks:[sql('0')]}
  return {ready:true,checks:[...await currentChannelChecks(c,r),channelPreferenceCheck(r.recipient_id,preferences.version),sql("EXISTS(SELECT 1 FROM lk_approval_channel_deliveries WHERE request_id=? AND channel='email' AND status='suppressed' AND code='daily_digest')",r.id)]}
 }catch{return {ready:true,checks:[sql('0')]}}
}
export function channelDigestOutcome(event:NotificationRow,status:string,messageId:string|null,code:string|null,ownership:Sql):Sql[]{
 return [sql(`UPDATE lk_approval_channel_deliveries SET status=?,provider_message_id=?,code=? WHERE request_id=? AND channel='email' AND status='suppressed' AND code='daily_digest' AND (${ownership.sql})`,status,messageId,code,event.event_key.slice('channel-digest:'.length),...ownership.params)]
}
