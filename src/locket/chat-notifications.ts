import { observeChat } from './connection-observations'
import type { Bindings } from '../auth.server'
import { may, requireRole } from './access'
import { channelEnv } from './approval-channel-config'
import { channelLocal, channelScheduler } from './approval-channel-dispatch'
import { auditSql, guardSql, type Ctx, type Handler } from './commands'
import { fail, integer, json, list, oneOf, sql, text, type Actor, type Sql } from './model'
import { notificationSourceChecks } from './notification-sources'
import { activeHumanSql, notificationBatch, notificationCheck, notificationLink, notificationPeople, notificationPreferences, notificationReaderSql, type NotificationRow } from './notifications'
import { hiddenFields, policyVersionCheck, repositoryPolicy } from './repository-access'

export const chatChannels=['slack','teams','nook'] as const
export const chatTables=['lk_chat_preferences','lk_chat_identities','lk_chat_deliveries']
export async function chatPreferences(db:D1Database,id:string){
 const p=await db.prepare('SELECT channels,version FROM lk_chat_preferences WHERE operator_id=?').bind(id).first<{channels:string;version:number}>()
 return {channels:p?JSON.parse(p.channels) as string[]:[],version:p?.version??0}
}
const preferenceCheck=(id:string,version:number)=>sql('COALESCE((SELECT version FROM lk_chat_preferences WHERE operator_id=?),0)=?',id,version)
const preferences:Handler=async(c,p)=>{
 requireRole(c.actor,notificationPeople,'choose chat status notifications')
 if(p.operatorId!==undefined&&p.operatorId!==c.actor.id)fail('FORBIDDEN','Choose only your own notification channels.',403)
 const version=integer(p,'version',0),channels=list(p,'channels',3).map(v=>oneOf({v},'v',chatChannels))
 if(new Set(channels).size!==channels.length)fail('INVALID','Choose each channel once.')
 if((await chatPreferences(c.db,c.actor.id)).version!==version)fail('STALE','Chat choices changed. Reload.',409)
 return {allowed:notificationPeople,result:{version:version+1},checks:[preferenceCheck(c.actor.id,version)],writes:[sql('INSERT INTO lk_chat_preferences VALUES(?,?,1,?) ON CONFLICT(operator_id) DO UPDATE SET channels=excluded.channels,version=lk_chat_preferences.version+1,updated_at=excluded.updated_at',c.actor.id,json(channels),c.now)],audit:[{action:'notification.chat.preferences',summary:'Changed own chat status consent; existing events are never backfilled.'}]}
}
const identify:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'map chat identities')
 const channel=oneOf(p,'channel',chatChannels),providerId=text(p,'providerId',300),operatorId=text(p,'operatorId',100),version=integer(p,'version',0)
 if(/[\s<>"\\]/.test(providerId))fail('INVALID','Use an exact provider member identity.')
 const prior=await c.db.prepare('SELECT version FROM lk_chat_identities WHERE channel=? AND provider_id=?').bind(channel,providerId).first<{version:number}>()
 if((prior?.version??0)!==version)fail('STALE','This identity mapping changed. Reload.',409)
 const other=await c.db.prepare('SELECT provider_id FROM lk_chat_identities WHERE channel=? AND operator_id=? AND provider_id<>?').bind(channel,operatorId,providerId).first()
 if(other)fail('INVALID','This member already has a provider identity. Reassign the existing mapping first.')
 return {allowed:may.manageRoles,result:{channel,version:version+1},checks:[activeHumanSql(operatorId),sql('COALESCE((SELECT version FROM lk_chat_identities WHERE channel=? AND provider_id=?),0)=?',channel,providerId,version)],writes:[sql('INSERT INTO lk_chat_identities VALUES(?,?,?,1,?) ON CONFLICT(channel,provider_id) DO UPDATE SET operator_id=excluded.operator_id,version=lk_chat_identities.version+1,updated_at=excluded.updated_at',channel,providerId,operatorId,c.now)],audit:[{action:'notification.chat.identity',summary:`Owner mapped a ${channel} member to an active Locket person; mapping grants no agreement access.`}]}
}
export const chatHandlers:Record<string,Handler>={'notification.chat.preferences':preferences,'notification.chat.identity':identify}

/** Run after the notification insert, inside the same business transaction. */
export function chatNotificationWrites(notificationId:string):Sql[]{
 return [sql(`INSERT INTO lk_chat_deliveries(id,notification_id,channel,destination,binding_version,preference_version,status)
 SELECT lower(hex(randomblob(16))),n.id,j.value,b.destination,b.version,p.version,'queued'
 FROM lk_notifications n JOIN lk_chat_preferences p ON p.operator_id=n.recipient_id
 JOIN json_each(p.channels) j JOIN lk_approval_channel_bindings b ON b.operator_id=n.recipient_id AND b.channel=j.value
 WHERE n.id=? AND n.kind<>'channel_approval'
 ON CONFLICT(notification_id,channel) DO NOTHING`,notificationId)]
}
interface Delivery {id:string;notification_id:string;channel:string;destination:string;binding_version:number;preference_version:number}
function provider(env:Bindings,channel:string){
 const cfg=channelEnv(env)
 if(channel==='slack')return {origin:'https://slack.com',prefix:'/api/',token:cfg.APPROVAL_SLACK_TOKEN}
 if(channel==='teams')return {origin:'https://graph.microsoft.com',prefix:'/v1.0/',token:cfg.APPROVAL_TEAMS_TOKEN}
 // Nook's Slack compatibility remains NOOK-063. Never invent membership proof.
 return null
}
async function members(c:Ctx,d:Pick<Delivery,'channel'|'destination'>):Promise<string[]>{
 const p=provider(c.env,d.channel)
 if(!p?.token)throw new Error('membership_unavailable')
 const path=d.channel==='teams'?`chats/${encodeURIComponent(d.destination)}/members`:`conversations.members?channel=${encodeURIComponent(d.destination)}&limit=1000`
 const response=await fetch(p.origin+p.prefix+path,{headers:{authorization:`Bearer ${p.token}`},redirect:'manual',signal:AbortSignal.timeout(15000)})
 if(!response.ok)throw new Error('membership_unavailable')
 const body=await response.json() as any
 if(d.channel==='teams'){
  if(body['@odata.nextLink']||!Array.isArray(body.value)||!body.value.length||body.value.length>1000||body.value.some((v:any)=>typeof v.userId!=='string'||!v.userId))throw new Error('membership_incomplete')
  return [...new Set<string>(body.value.map((v:any)=>v.userId))]
 }
 if(body.ok!==true||body.response_metadata?.next_cursor||!Array.isArray(body.members)||!body.members.length||body.members.length>1000||body.members.some((v:any)=>typeof v!=='string'||!v))throw new Error('membership_incomplete')
 // The connected Slack bot is a service principal, not a human audience member.
 const auth=await fetch(p.origin+p.prefix+'auth.test',{headers:{authorization:`Bearer ${p.token}`},redirect:'manual',signal:AbortSignal.timeout(15000)})
 if(!auth.ok)throw new Error('membership_unavailable')
 const identity=await auth.json() as any
 if(identity.ok!==true||typeof identity.bot_id!=='string'||!identity.bot_id||typeof identity.user_id!=='string')throw new Error('membership_unavailable')
 const humans=[...new Set<string>(body.members)].filter(id=>id!==identity.user_id)
 if(!humans.length)throw new Error('membership_incomplete')
 return humans
}
export async function chatAudienceChecks(c:Ctx,d:Pick<Delivery,'channel'|'destination'>,n:Pick<NotificationRow,'agreement_id'|'recipient_id'>){
 const ids=await members(c,d),checks:Sql[]=[];let recipientPresent=false
 for(const id of ids){
  const mapping=await c.db.prepare('SELECT operator_id,version FROM lk_chat_identities WHERE channel=? AND provider_id=?').bind(d.channel,id).first<{operator_id:string;version:number}>()
  if(!mapping)throw new Error('audience_not_authorized')
  if(mapping.operator_id===n.recipient_id)recipientPresent=true
  if((await hiddenFields(c.db,{...channelScheduler,id:mapping.operator_id})).length)throw new Error('audience_not_authorized')
  checks.push(...notificationReaderSql(c.actor,n.agreement_id,mapping.operator_id),sql('EXISTS(SELECT 1 FROM lk_chat_identities WHERE channel=? AND provider_id=? AND operator_id=? AND version=?)',d.channel,id,mapping.operator_id,mapping.version))
 }
 if(!recipientPresent)throw new Error('recipient_not_in_conversation')
 return checks
}
async function post(c:Ctx,d:Delivery,n:NotificationRow){
 const p=provider(c.env,d.channel)!,url=notificationLink(c.env,n)
 const message=/approval/.test(n.kind)?'An agreement needs approval in Locket.':n.kind==='signature'?'An agreement has a signature update in Locket.':n.kind==='mention'?'You were mentioned in Locket.':'An agreement has an update in Locket.'
 const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
 const body=d.channel==='teams'?{body:{contentType:'html',content:`${message} <a href="${escape(url)}">Open Locket</a>`}}:{channel:d.destination,text:`${message}\n${url}`,unfurl_links:false,unfurl_media:false}
 const path=d.channel==='teams'?`chats/${encodeURIComponent(d.destination)}/messages`:'chat.postMessage'
 const response=await fetch(p.origin+p.prefix+path,{method:'POST',redirect:'manual',headers:{authorization:`Bearer ${p.token}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)})
 if(response.status===429)return {status:'rate_limited',code:'provider_rate_limited',id:null}
 if(response.status>=500)return {status:'uncertain',code:'provider_outcome_unknown',id:null}
 if(!response.ok)return {status:'rejected',code:'provider_rejected',id:null}
 const result=await response.json() as any,id=d.channel==='teams'?result.id:result.ok===true?result.ts:null
 return typeof id==='string'?{status:'accepted',code:null,id}:{status:'uncertain',code:'invalid_provider_receipt',id:null}
}
export async function runChatNotifications(env:Bindings,now:number){
 const c:Ctx={env,db:env.DB,actor:channelScheduler,now,commandId:crypto.randomUUID()}
 const rows=(await env.DB.prepare("SELECT * FROM lk_chat_deliveries WHERE status='queued' ORDER BY id").all<Delivery>()).results
 for(const d of rows){
  const n=await env.DB.prepare('SELECT * FROM lk_notifications WHERE id=?').bind(d.notification_id).first<NotificationRow>();if(!n)continue
  c.commandId=d.id
  const attempt=crypto.randomUUID()
  const finish=async(status:string,code:string|null,id:string|null=null,claimed=false)=>{
   const own=sql('EXISTS(SELECT 1 FROM lk_chat_deliveries WHERE id=? AND status=? AND attempt_id IS ?)',d.id,claimed?'sending':'queued',claimed?attempt:null)
   const audit=auditSql(c,{action:'notification.chat.'+status,agreementId:n.agreement_id,summary:status==='accepted'?`${d.channel} provider accepted a generic update; delivery and reading are unconfirmed.`:`${d.channel} update ${status}: ${code??'unknown'}. No automatic resend.`},'scheduler')
   await notificationBatch(c.db,[sql(`INSERT INTO lk_audit SELECT ${audit.params.map(()=>'?').join(',')} WHERE ${own.sql}`,...audit.params,...own.params),sql(`UPDATE lk_chat_deliveries SET status=?,code=?,provider_message_id=?,completed_at=? WHERE id=? AND (${own.sql})`,status,code,id,now,d.id,...own.params)])
  }
  const pref=await chatPreferences(c.db,n.recipient_id)
  if(pref.version!==d.preference_version||!pref.channels.includes(d.channel)){await finish('suppressed','personal_channels_changed');continue}
  if(channelLocal(env)){await finish('suppressed','local_or_demo');continue}
  const np=await notificationPreferences(c.db,n.recipient_id)
  // Until chat batching exists, digest consent cannot become immediate messages.
  if(np.digest){await finish('suppressed','chat_digest_not_available');continue}
  const policy=await repositoryPolicy(c.db),source=await notificationSourceChecks(c,n)
  if(!source.ready)continue
  let audience:Sql[]
  try{audience=await chatAudienceChecks(c,d,n)}catch{await finish('suppressed','audience_unverified');continue}
  const checks=[...audience,...source.checks,...notificationReaderSql(c.actor,n.agreement_id,n.recipient_id),policyVersionCheck(policy.version),preferenceCheck(n.recipient_id,pref.version),sql('COALESCE((SELECT digest FROM lk_person_preferences WHERE operator_id=?),0)=0',n.recipient_id),sql('EXISTS(SELECT 1 FROM lk_approval_channel_bindings WHERE operator_id=? AND channel=? AND destination=? AND version=?)',n.recipient_id,d.channel,d.destination,d.binding_version)]
  if(!await notificationCheck(c.db,checks)){await finish('cancelled','authority_or_source_changed');continue}
  const guard=crypto.randomUUID()
  try{await notificationBatch(c.db,[guardSql(guard,checks),sql("UPDATE lk_chat_deliveries SET status='sending',attempt_id=?,attempted_at=? WHERE id=? AND status='queued'",attempt,now,d.id),sql('DELETE FROM lk_guard WHERE id=?',guard)])}catch(error){if(!/LOCKET_GUARD/.test(String(error)))throw error;await finish('cancelled','authority_or_source_changed');continue}
  if((await c.db.prepare('SELECT attempt_id FROM lk_chat_deliveries WHERE id=?').bind(d.id).first<{attempt_id:string}>())?.attempt_id!==attempt)continue
  const result=await post(c,d,n).catch(()=>({status:'uncertain',code:'provider_outcome_unknown',id:null}));await finish(result.status,result.code,result.id,true);await observeChat(env,d.channel,result.status==='accepted',result.code??'chat_send_succeeded')
 }
}
export async function chatState(env:Bindings,actor:Actor,visible:Set<string>){
 const preferences=await chatPreferences(env.DB,actor.id)
 const identities=actor.role==='owner'?(await env.DB.prepare('SELECT channel,provider_id,operator_id,version FROM lk_chat_identities').all()).results:[]
 const deliveries=(await env.DB.prepare('SELECT d.id,d.channel,d.status,d.code,n.agreement_id,n.kind FROM lk_chat_deliveries d JOIN lk_notifications n ON n.id=d.notification_id WHERE n.recipient_id=? ORDER BY n.created_at DESC').bind(actor.id).all<{agreement_id:string}>()).results.filter(d=>visible.has(d.agreement_id))
 return {preferences,identities,deliveries}
}
