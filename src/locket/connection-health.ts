import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { requireRole } from './access'
import type { Handler } from './commands'
import { fail, sql, text } from './model'
import { channelEnv } from './approval-channel-config'
import { signatureBase } from './signature-provider'

export async function connectionRegistry(env:Bindings){
 const db=env.DB,chat=channelEnv(env),rows:any[]=[]
 if(env.MAIL_PROVIDER)rows.push({id:'mail',kind:'mail',account:env.MAIL_FROM??'Sender not configured',probe:false})
 if(env.QUICKBOOKS_REALM_ID)rows.push({id:'quickbooks',kind:'accounting',account:env.QUICKBOOKS_REALM_ID,probe:true})
 for(const id of ['slack','teams','nook'])if((chat as any)['APPROVAL_'+id.toUpperCase()+'_TOKEN'])rows.push({id,kind:'chat',account:id==='nook'?chat.APPROVAL_NOOK_ORIGIN??'Installation not configured':'Server-bound '+id+' account',probe:id!=='nook'})
 for(const c of(await db.prepare('SELECT * FROM lk_signature_connections').all<any>()).results)rows.push({id:c.provider,kind:'signing',account:c.account_id??c.base_url,configuredAt:c.configured_at,probe:c.provider==='docusign'})
 const health=(await db.prepare('SELECT * FROM lk_connection_health').all<any>()).results
 for(const row of rows){
  const observation=health.find(h=>h.id===row.id&&h.account===row.account&&h.checked_at>=(row.configuredAt??0))
  Object.assign(row,{status:'unverified',reason:'No supported read-only probe has completed.',last_success_at:null},observation??{})
  let ids:string[]=[]
  if(row.kind==='signing')ids=(await db.prepare('SELECT DISTINCT agreement_id FROM lk_packages WHERE provider=?').bind(row.id).all<{agreement_id:string}>()).results.map(a=>a.agreement_id)
  if(row.kind==='accounting')ids=(await db.prepare('SELECT DISTINCT agreement_id FROM lk_accounting_links').all<{agreement_id:string}>()).results.map(a=>a.agreement_id)
  if(row.kind==='chat')ids=(await db.prepare('SELECT DISTINCT r.agreement_id FROM lk_approval_channel_requests r JOIN lk_approval_channel_deliveries d ON d.request_id=r.id WHERE d.channel=?').bind(row.id).all<{agreement_id:string}>()).results.map(a=>a.agreement_id)
  if(row.kind==='mail')ids=(await db.prepare('SELECT DISTINCT agreement_id FROM lk_notifications').all<{agreement_id:string}>()).results.map(a=>a.agreement_id)
  row.agreementIds=ids
 }
 return rows
}
const check:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'check a connection')
 const id=text(p,'id',100),entry=(await connectionRegistry(c.env)).find(r=>r.id===id)
 if(!entry?.probe)fail('CONNECTION_PROBE','This integration has no supported read-only probe yet. Its state remains unverified.',409)
 let url='',token='',method='GET',sourceCheck=sql('1')
 if(id==='docusign'){
  const connection=await c.db.prepare("SELECT * FROM lk_signature_connections WHERE provider='docusign'").first<any>()
  url=signatureBase(id,connection.base_url,c.env)+'/accounts/'+encodeURIComponent(connection.account_id);token=(c.env as any).SIGNATURE_DOCUSIGN_TOKEN??''
  sourceCheck=sql("(SELECT version FROM lk_signature_connections WHERE provider='docusign')=?",connection.version)
 }else if(id==='quickbooks'){
  if(!/^\d+$/.test(c.env.QUICKBOOKS_REALM_ID??''))fail('CONNECTION_PROBE','Configure a valid accounting realm.',409)
  const host=c.env.QUICKBOOKS_SANDBOX==='true'?'sandbox-quickbooks.api.intuit.com':'quickbooks.api.intuit.com'
  url=`https://${host}/v3/company/${c.env.QUICKBOOKS_REALM_ID}/companyinfo/${c.env.QUICKBOOKS_REALM_ID}`;token=c.env.QUICKBOOKS_ACCESS_TOKEN??''
 }else if(id==='slack'){url='https://slack.com/api/auth.test';token=channelEnv(c.env).APPROVAL_SLACK_TOKEN??'';method='POST'}
 else if(id==='teams'){url='https://graph.microsoft.com/v1.0/me';token=channelEnv(c.env).APPROVAL_TEAMS_TOKEN??''}
 let status='failing',reason='credential_missing'
 if(token)try{
  const response=await fetch(url,{method,redirect:'manual',headers:{authorization:'Bearer '+token,accept:'application/json'},signal:AbortSignal.timeout(15000)})
  if(response.status===401||response.status===403)reason='credential_rejected'
  else if(response.status>=300&&response.status<400)reason='redirect_refused'
  else if(!response.ok)reason=response.status===429?'provider_rate_limited':'provider_unavailable'
  else{
   const data=await response.json() as any
   const valid=id==='slack'?data.ok===true&&typeof data.user_id==='string':id==='teams'?typeof data.id==='string':id==='quickbooks'?!!data.CompanyInfo:typeof data.accountId==='string'&&data.accountId===(await c.db.prepare("SELECT account_id FROM lk_signature_connections WHERE provider='docusign'").first<any>()).account_id
   if(valid){status='healthy';reason='read_probe_succeeded'}else reason='invalid_provider_receipt'
  }
 }catch{reason='provider_unreachable'}
 const prior=await c.db.prepare('SELECT * FROM lk_connection_health WHERE id=?').bind(id).first<any>(),version=prior?.version??0
 const incident=status==='failing'?(prior?.status==='failing'?prior.incident_id:crypto.randomUUID()):null
 const alert=status==='failing'?(prior?.status==='failing'?prior.alert_status:'pending'):null
 return{allowed:['owner'],result:{id,status,reason},checks:[sourceCheck,sql('COALESCE((SELECT version FROM lk_connection_health WHERE id=?),0)=?',id,version)],writes:[sql('INSERT INTO lk_connection_health VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account=excluded.account,status=excluded.status,reason=excluded.reason,checked_at=excluded.checked_at,last_success_at=excluded.last_success_at,incident_id=excluded.incident_id,alert_status=excluded.alert_status,version=excluded.version',id,entry.account,status,reason,c.now,status==='healthy'?c.now:prior?.last_success_at??null,incident,alert,version+1)],audit:[{action:'connection.check',summary:`Owner requested a read-only ${id} probe: ${status} (${reason}). No business operation was retried.`}]}
}
export async function alertConnectionFailure(env:Bindings,id:string){
 const db=env.DB,row=await db.prepare("SELECT * FROM lk_connection_health WHERE id=? AND status='failing' AND alert_status='pending'").bind(id).first<any>()
 if(!row)return
 const claimed=await db.prepare("UPDATE lk_connection_health SET alert_status='sending' WHERE id=? AND incident_id=? AND alert_status='pending'").bind(id,row.incident_id).run()
 if(!claimed.meta.changes)return
 let status='uncertain'
 try{
  const owner=await db.prepare("SELECT email FROM oa_operators WHERE role='owner' AND status='active'").first<{email:string}>(),mail=operatorMail(env)
  if(env.AUTH_LOCAL==='true'||(env as any).RER_DEMO==='1')status='suppressed'
  else if(!owner||!mail||!env.MAIL_FROM)status='rejected'
  else{
   const url=(env.AUTH_ORIGIN??'').replace(/\/$/,'')+'/app#connections'
   const sent=await mail.send({deliveryId:row.incident_id,from:env.MAIL_FROM,to:[owner.email],subject:'A Locket connection needs attention',text:'A connection check failed. Sign in to inspect its reason and affected agreements.\n\n'+url,html:'<p>A connection check failed. Sign in to Locket to inspect it.</p>',headers:{}})
   status=sent.status==='development'?'suppressed':sent.status
  }
 }catch{}
 await db.prepare("UPDATE lk_connection_health SET alert_status=? WHERE id=? AND incident_id=? AND alert_status='sending'").bind(status,id,row.incident_id).run()
}
export const connectionHandlers:Record<string,Handler>={'connection.check':check}
