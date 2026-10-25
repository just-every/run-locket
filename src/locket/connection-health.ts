import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { requireRole } from './access'
import type { Handler } from './commands'
import { fail, sql, text } from './model'
import { channelEnv } from './approval-channel-config'
import { probeConnection } from './connection-probe'
import { providerExpiryWrite } from './connection-expiry'
import { expiryHandler } from './connection-expiry'

export async function connectionRegistry(env:Bindings){
 const db=env.DB,chat=channelEnv(env),rows:any[]=[]
 if((env as any).HUBSPOT_ACCESS_TOKEN)rows.push({id:'hubspot',kind:'crm',account:'Server-bound HubSpot account',probe:true})
 if(env.MAIL_PROVIDER)rows.push({id:'mail',kind:'mail',account:env.MAIL_FROM??'Sender not configured',probe:['resend','postmark'].includes(env.MAIL_PROVIDER)})
 if(env.QUICKBOOKS_REALM_ID)rows.push({id:'quickbooks',kind:'accounting',account:env.QUICKBOOKS_REALM_ID,probe:true})
 for(const id of ['slack','teams','nook'])if((chat as any)['APPROVAL_'+id.toUpperCase()+'_TOKEN'])rows.push({id,kind:'chat',account:id==='nook'?chat.APPROVAL_NOOK_ORIGIN??'Installation not configured':'Server-bound '+id+' account',probe:id!=='nook'})
 for(const c of(await db.prepare('SELECT * FROM lk_signature_connections').all<any>()).results)rows.push({id:c.provider,kind:'signing',account:c.account_id??c.base_url,configuredAt:c.configured_at,connectionVersion:c.version,probe:c.provider!=='inkwell'})
 for(const c of(await db.prepare('SELECT id,provider,calendar_id,created_at,version FROM lk_calendar_connections').all<any>()).results)rows.push({id:'calendar:'+c.id,sourceId:c.id,kind:'calendar',label:c.provider==='google'?'Google Calendar':'Outlook Calendar',account:c.provider+' calendar '+c.calendar_id,connectionVersion:c.version,probe:true})
 if(env.POSTMARK_SERVER_TOKEN)rows.push({id:'exchange-mail',kind:'mail',account:env.MAIL_FROM??'Sender not configured',probe:true})
 if(env.UPTIME_ORIGIN&&env.UPTIME_METRICS_KEY)rows.push({id:'uptime',kind:'monitoring',account:env.UPTIME_ORIGIN,probe:false})
 if(env.LINEN_ORIGIN&&env.LINEN_MCP_TOKEN)rows.push({id:'linen',kind:'tickets',account:env.LINEN_ORIGIN,probe:false})
 const health=(await db.prepare('SELECT * FROM lk_connection_health').all<any>()).results
 const expiries=(await db.prepare('SELECT * FROM lk_connection_expiries').all<any>()).results
 for(const row of rows){
  const observation=health.find(h=>h.id===row.id&&h.account===row.account&&h.checked_at>=(row.configuredAt??0))
  Object.assign(row,{status:'unverified',reason:'No supported read-only probe has completed.',last_success_at:null,last_sync_at:null,provider_account:null},observation??{})
  const expiry=expiries.find(e=>e.id===row.id)
  row.credentialExpiry=expiry?(expiry.account===row.account&&expiry.connection_version===(row.connectionVersion??0)?expiry:{version:expiry.version}):null
  let ids:string[]=[]
  if(row.kind==='signing')ids=(await db.prepare('SELECT DISTINCT agreement_id FROM lk_packages WHERE provider=?').bind(row.id).all<{agreement_id:string}>()).results.map(a=>a.agreement_id)
  if(row.kind==='accounting')ids=(await db.prepare('SELECT DISTINCT agreement_id FROM lk_accounting_links').all<{agreement_id:string}>()).results.map(a=>a.agreement_id)
  if(row.kind==='chat')ids=(await db.prepare('SELECT r.agreement_id FROM lk_approval_channel_requests r JOIN lk_approval_channel_deliveries d ON d.request_id=r.id WHERE d.channel=? UNION SELECT n.agreement_id FROM lk_chat_deliveries d JOIN lk_notifications n ON n.id=d.notification_id WHERE d.channel=?').bind(row.id,row.id).all<{agreement_id:string}>()).results.map(a=>a.agreement_id)
  if(row.kind==='calendar')ids=(await db.prepare('SELECT DISTINCT agreement_id FROM lk_calendar_events WHERE connection_id=?').bind(row.sourceId).all<{agreement_id:string}>()).results.map(a=>a.agreement_id)
  if(row.id==='uptime')ids=(await db.prepare('SELECT DISTINCT agreement_id FROM lk_service_level_links').all<{agreement_id:string}>()).results.map(a=>a.agreement_id)
  if(row.id==='linen')ids=(await db.prepare("SELECT DISTINCT agreement_id FROM lk_service_performance_reports WHERE source_kind='linen' AND json_extract(connection,'$.origin')=?").bind(row.account).all<{agreement_id:string}>()).results.map(a=>a.agreement_id)
  if(row.kind==='mail')ids=(await db.prepare('SELECT DISTINCT agreement_id FROM lk_notifications').all<{agreement_id:string}>()).results.map(a=>a.agreement_id)
  if(row.id==='exchange-mail')ids=(await db.prepare("SELECT DISTINCT agreement_id FROM lk_exchanges WHERE channel='email'").all<{agreement_id:string}>()).results.map(a=>a.agreement_id)
  row.agreementIds=ids
 }
 return rows
}
const check:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'check a connection')
 const id=text(p,'id',100),entry=(await connectionRegistry(c.env)).find(r=>r.id===id)
 if(!entry?.probe)fail('CONNECTION_PROBE','This integration has no supported read-only probe yet. Its state remains unverified.',409)
 const sourceCheck=entry.kind==='signing'?sql('(SELECT version FROM lk_signature_connections WHERE provider=?)=?',id,entry.connectionVersion):entry.kind==='calendar'?sql('(SELECT version FROM lk_calendar_connections WHERE id=?)=?',entry.sourceId,entry.connectionVersion):sql('1')
 const {status,reason,providerAccount,expiresAt}=await probeConnection(c.env,entry,c.now)
 const prior=await c.db.prepare('SELECT * FROM lk_connection_health WHERE id=?').bind(id).first<any>(),version=prior?.version??0
 const incident=status==='failing'?(prior?.status==='failing'?prior.incident_id:crypto.randomUUID()):null
 const alert=status==='failing'?(prior?.status==='failing'?prior.alert_status:'pending'):null
 return{allowed:['owner'],result:{id,status,reason},checks:[sourceCheck,sql('COALESCE((SELECT version FROM lk_connection_health WHERE id=?),0)=?',id,version)],writes:[...(expiresAt!==null?[providerExpiryWrite(entry,expiresAt,c.now)]:[]),sql('INSERT INTO lk_connection_health(id,account,status,reason,checked_at,last_success_at,incident_id,alert_status,version,provider_account) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account=excluded.account,status=excluded.status,reason=excluded.reason,checked_at=excluded.checked_at,last_success_at=excluded.last_success_at,incident_id=excluded.incident_id,alert_status=excluded.alert_status,version=excluded.version,provider_account=excluded.provider_account',id,entry.account,status,reason,c.now,status==='healthy'?c.now:prior?.last_success_at??null,incident,alert,version+1,providerAccount)],audit:[{action:'connection.check',summary:`Owner requested a read-only ${id} probe: ${status} (${reason}). No business operation was retried.`}]}
}
export async function alertConnectionFailure(env:Bindings,id:string){
 const db=env.DB,row=await db.prepare("SELECT * FROM lk_connection_health WHERE id=? AND status='failing' AND alert_status='pending'").bind(id).first<any>()
 if(!row)return
 const claimed=await db.prepare("UPDATE lk_connection_health SET alert_status='sending' WHERE id=? AND incident_id=? AND alert_status='pending'").bind(id,row.incident_id).run()
 if(!claimed.meta.changes)return
 let status='uncertain'
 try{
  const owner=await db.prepare("SELECT email FROM oa_operators WHERE role='owner' AND status='active'").first<{email:string}>(),mail=operatorMail(env,{health:false})
  if(env.AUTH_LOCAL==='true'||(env as any).RER_DEMO==='1')status='suppressed'
  else if(!owner||!mail||!env.MAIL_FROM)status='rejected'
  else{
   const url=(env.AUTH_ORIGIN??'').replace(/\/$/,'')+'/app#connections'
   const sent=await mail.send({deliveryId:row.incident_id,from:env.MAIL_FROM,to:[owner.email],subject:'A Locket connection needs attention',text:'A connection operation or check failed. Sign in to inspect its reason and affected agreements.\n\n'+url,html:'<p>A connection operation or check failed. Sign in to Locket to inspect it.</p>',headers:{}})
   status=sent.status==='development'?'suppressed':sent.status
  }
 }catch{}
 await db.prepare("UPDATE lk_connection_health SET alert_status=? WHERE id=? AND incident_id=? AND alert_status='sending'").bind(status,id,row.incident_id).run()
}
export const connectionHandlers:Record<string,Handler>={'connection.check':check,'connection.expiry':expiryHandler}
