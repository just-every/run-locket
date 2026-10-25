import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { requireRole } from './access'
import type { Ctx, Outcome } from './commands'
import { connectionRegistry } from './connection-health'
import { fail, integer, sql, text } from './model'

const warningWindow=7*86400000
export async function expiryHandler(c:Ctx,p:Record<string,unknown>):Promise<Outcome>{
 requireRole(c.actor,['owner'],'record a connection credential expiry')
 const id=text(p,'id',100),version=integer(p,'version',0)
 const entry=(await connectionRegistry(c.env)).find(r=>r.id===id)
 if(!entry)fail('CONNECTION','Choose a configured connection.',404)
 const at=p.expiresAt===null?null:integer(p,'expiresAt',1)
 if(at!==null&&(!Number.isSafeInteger(at)||at>8640000000000000))fail('INVALID','Record a valid credential expiry time.')
 if(p.consent!==true)fail('CONSENT','Confirm this owner-recorded expiry; it does not verify or replace the credential.')
 return {allowed:['owner'],result:{id},checks:[...(entry.kind==='signing'?[sql('(SELECT version FROM lk_signature_connections WHERE provider=?)=?',id,entry.connectionVersion)]:[]),sql('COALESCE((SELECT version FROM lk_connection_expiries WHERE id=?),0)=?',id,version)],writes:[sql(`INSERT INTO lk_connection_expiries VALUES(?,?,?,?,?,?,?,NULL,?)
 ON CONFLICT(id) DO UPDATE SET account=excluded.account,expires_at=excluded.expires_at,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at,version=excluded.version,alert_id=excluded.alert_id,alert_status=NULL,connection_version=excluded.connection_version`,id,entry.account,at,c.actor.id,c.now,version+1,crypto.randomUUID(),entry.connectionVersion??0)],audit:[{action:'connection.expiry',summary:`Owner recorded ${at===null?'an unknown': 'the known'} credential expiry for ${id}; credentials were not read or changed.`}]}
}

/** Hourly warning, one send claim per owner-recorded expiry revision. */
export async function runConnectionExpiry(env:Bindings,now:number){
 for(const entry of await connectionRegistry(env)){
  const expiry=entry.credentialExpiry
  if(!expiry?.expires_at||expiry.expires_at>now+warningWindow||expiry.alert_status)continue
  const claimed=await env.DB.prepare("UPDATE lk_connection_expiries SET alert_status='sending' WHERE id=? AND version=? AND alert_status IS NULL").bind(entry.id,expiry.version).run()
  if(!claimed.meta.changes)continue
  let status='uncertain'
  try{
   const owner=await env.DB.prepare("SELECT email FROM oa_operators WHERE role='owner' AND status='active'").first<{email:string}>(),mail=operatorMail(env)
   if(env.AUTH_LOCAL==='true'||(env as any).RER_DEMO==='1')status='suppressed'
   else if(!owner||!mail||!env.MAIL_FROM)status='rejected'
   else{
    const url=(env.AUTH_ORIGIN??'').replace(/\/$/,'')+'/app#connections'
    const sent=await mail.send({deliveryId:expiry.alert_id,from:env.MAIL_FROM,to:[owner.email],subject:'A Locket credential needs renewal',text:'An owner-recorded connection credential expiry is within seven days or has passed. Sign in to inspect and renew it.\n\n'+url,html:'<p>A connection credential needs renewal. Sign in to Locket to inspect it.</p>',headers:{}})
    status=sent.status==='development'?'suppressed':sent.status
   }
  }catch{}
  await env.DB.prepare("UPDATE lk_connection_expiries SET alert_status=? WHERE id=? AND version=? AND alert_status='sending'").bind(status,entry.id,expiry.version).run()
 }
}
