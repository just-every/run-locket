import type { Bindings } from '../auth.server'
import { channelEnv } from './approval-channel-config'
import { signatureBase, signatureSecret } from './signature-provider'

class ProbeFailure extends Error {}
const identity=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=300&&!/[\x00-\x20\x7f]/.test(value)
async function read(url:string,token:string,{method='GET',basic=false,postmark=false}={}){
 const response=await fetch(url,{method,redirect:'manual',headers:{...(postmark?{'X-Postmark-Server-Token':token}:{authorization:basic?'Basic '+btoa(token+':'):'Bearer '+token}),accept:'application/json'},signal:AbortSignal.timeout(15000)})
 if(!response.ok)throw new ProbeFailure(response.status===401||response.status===403?'credential_rejected':response.status>=300&&response.status<400?'redirect_refused':response.status===429?'provider_rate_limited':'provider_unavailable')
 try{return await response.json() as any}catch{throw new ProbeFailure('invalid_provider_receipt')}
}
export async function probeConnection(env:Bindings,entry:any,now:number){
 let providerAccount:string|null=null,expiresAt:number|null=null
 try{
  const id=entry.id
  let data:any
  if(entry.kind==='signing'){
   const c=await env.DB.prepare('SELECT * FROM lk_signature_connections WHERE provider=?').bind(id).first<any>()
   const base=signatureBase(id,c.base_url,env),token=signatureSecret(env,id)
   data=await read(base+(id==='docusign'?'/accounts/'+encodeURIComponent(c.account_id):id==='adobe-acrobat-sign'?'/users/me':'/account'),token,{basic:id==='dropbox-sign'})
   const account=id==='docusign'?data.accountId:id==='dropbox-sign'?data.account?.account_id:data.id
   if(identity(account)&&(id!=='docusign'||account===c.account_id))providerAccount=account
  }else if(id==='hubspot'){
   const token=(env as any).HUBSPOT_ACCESS_TOKEN??''
   if(!token)throw new ProbeFailure('credential_missing')
   data=await read('https://api.hubapi.com/account-info/v3/details',token)
   if(Number.isSafeInteger(data.portalId)&&data.portalId>0){
    providerAccount=String(data.portalId)
    // OAuth metadata is read only. Private-app tokens may not expose this door.
    // Never retain the URL, raw metadata, token or provider error body.
    try{
     const metadata=await read('https://api.hubapi.com/oauth/v1/access-tokens/'+encodeURIComponent(token),token)
     if(metadata.hub_id===data.portalId&&Number.isSafeInteger(metadata.expires_in)&&metadata.expires_in>=0&&metadata.expires_in<=366*86400)expiresAt=now+metadata.expires_in*1000
    }catch{}
   }
  }else if(id==='quickbooks'){
   const realm=env.QUICKBOOKS_REALM_ID??'',token=env.QUICKBOOKS_ACCESS_TOKEN??''
   if(!/^\d+$/.test(realm)||!token)throw new ProbeFailure('credential_missing')
   const host=env.QUICKBOOKS_SANDBOX==='true'?'sandbox-quickbooks.api.intuit.com':'quickbooks.api.intuit.com'
   data=await read(`https://${host}/v3/company/${realm}/companyinfo/${realm}`,token)
   if(data.CompanyInfo?.Id===realm)providerAccount=realm
  }else if(id==='slack'||id==='teams'){
   const token=id==='slack'?channelEnv(env).APPROVAL_SLACK_TOKEN:channelEnv(env).APPROVAL_TEAMS_TOKEN
   if(!token)throw new ProbeFailure('credential_missing')
   data=await read(id==='slack'?'https://slack.com/api/auth.test':'https://graph.microsoft.com/v1.0/me',token,{method:id==='slack'?'POST':'GET'})
   const account=id==='slack'&&data.ok===true?data.user_id:id==='teams'?data.id:null
   if(identity(account))providerAccount=account
   else if(data.ok===false&&['token_expired','token_revoked','invalid_auth','account_inactive'].includes(data.error))throw new ProbeFailure('credential_rejected')
  }else if(entry.kind==='calendar'){
   const c=await env.DB.prepare('SELECT * FROM lk_calendar_connections WHERE id=?').bind(entry.sourceId).first<any>()
   const google=c.provider==='google'
   const calendar=await read(google?'https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(c.calendar_id):'https://graph.microsoft.com/v1.0/me/calendars/'+encodeURIComponent(c.calendar_id),c.token)
   if(!identity(calendar.id)||(calendar.id!==c.calendar_id&&c.calendar_id!=='primary'))throw new ProbeFailure('invalid_provider_receipt')
   data=await read(google?'https://www.googleapis.com/oauth2/v2/userinfo':'https://graph.microsoft.com/v1.0/me',c.token)
   if(identity(data.id))providerAccount=data.id
  }else if(id==='mail'||id==='exchange-mail'){
   const token=id==='exchange-mail'?env.POSTMARK_SERVER_TOKEN:env.MAIL_API_KEY
   if(!token)throw new ProbeFailure('credential_missing')
   if(id==='exchange-mail'||env.MAIL_PROVIDER==='postmark'){
    data=await read('https://api.postmarkapp.com/server',token,{postmark:true})
    if(Number.isSafeInteger(data.ID)&&data.ID>0)providerAccount=String(data.ID)
   }else{
    data=await read('https://api.resend.com/domains',token)
    const domain=(env.MAIL_FROM??'').match(/@([^>\s]+)>?$/)?.[1]?.toLowerCase()
    const match=Array.isArray(data.data)?data.data.find((d:any)=>d.name===domain&&d.status==='verified'&&identity(d.id)):null
    if(match)providerAccount=match.id
   }
  }
  if(!providerAccount)throw new ProbeFailure('invalid_provider_receipt')
  return {status:'healthy',reason:'read_probe_succeeded',providerAccount,expiresAt}
 }catch(error){return {status:'failing',reason:error instanceof ProbeFailure?error.message:'provider_unreachable',providerAccount:null,expiresAt:null}}
}
