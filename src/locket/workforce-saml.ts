import { SAML, ValidateInResponseTo } from '@node-saml/node-saml'
import { DOMParser } from '@xmldom/xmldom'
import { authConfig, type Bindings } from '../auth.server'
import { createOperatorAuth } from '../modules/operator-auth/index.mjs'
import { sha256 } from './model'
import { workforceSettings, type WorkforceBindings } from './workforce'

const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}
const cookieName='__Host-locket_saml'
const cookie=(value:string,age=300)=>`${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${age}`
function configuration(env:WorkforceBindings){
 const issuer=env.WORKFORCE_SAML_ISSUER,entryPoint=env.WORKFORCE_SAML_SSO_URL,cert=env.WORKFORCE_SAML_CERT
 if(!issuer||!entryPoint||!cert)return null
 const url=new URL(entryPoint)
 if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Invalid workforce endpoint')
 return {issuer,entryPoint,cert,callback:env.AUTH_ORIGIN+'/auth/saml/callback',entity:env.AUTH_ORIGIN+'/auth/saml/metadata'}
}
export async function samlAvailable(env:Bindings){return !!configuration(env as WorkforceBindings)&&!!await workforceSettings(env)}
export function samlIssuers(env:Bindings){const configured=configuration(env as WorkforceBindings);return configured?[configured.issuer]:[]}
function requiredAttributes(xml:string,c:{issuer:string;callback:string},requestId:string){
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('DTD refused')
 const doc=new DOMParser({errorHandler:{warning(){throw new Error('Invalid XML')},error(){throw new Error('Invalid XML')},fatalError(){throw new Error('Invalid XML')}}}).parseFromString(xml,'text/xml')
 const root=doc.documentElement,assertions=doc.getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:assertion','Assertion')
 if(root.localName!=='Response'||root.namespaceURI!=='urn:oasis:names:tc:SAML:2.0:protocol'||root.getAttribute('Destination')!==c.callback||root.getAttribute('InResponseTo')!==requestId||assertions.length!==1)throw new Error('Wrong response scope')
 const assertion=assertions[0],issuers=assertion.getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:assertion','Issuer'),conditions=assertion.getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:assertion','Conditions'),confirmations=assertion.getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:assertion','SubjectConfirmation')
 if(issuers.length!==1||issuers[0].textContent!==c.issuer||conditions.length!==1||!conditions[0].hasAttribute('NotOnOrAfter')||confirmations.length!==1)throw new Error('Wrong assertion scope')
 const confirmation=confirmations[0],data=confirmation.getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:assertion','SubjectConfirmationData')
 if(confirmation.getAttribute('Method')!=='urn:oasis:names:tc:SAML:2.0:cm:bearer'||data.length!==1||data[0].getAttribute('Recipient')!==c.callback||data[0].getAttribute('InResponseTo')!==requestId||!data[0].hasAttribute('NotOnOrAfter'))throw new Error('Wrong confirmation scope')
}
export async function workforceSamlResponse(request:Request,env:Bindings):Promise<Response|null>{
 const url=new URL(request.url)
 if(!url.pathname.startsWith('/auth/saml/'))return null
 try{
  const c=configuration(env as WorkforceBindings),s=await workforceSettings(env)
  if(!c||!s||url.origin!==env.AUTH_ORIGIN)return new Response('Workforce sign-in is not enabled.',{status:403,headers})
  const fingerprint=await sha256(JSON.stringify({...c,version:s.version})),db=env.DB
  if(url.pathname==='/auth/saml/metadata'&&request.method==='GET'){
   const saml=new SAML({issuer:c.entity,callbackUrl:c.callback,entryPoint:c.entryPoint,idpCert:c.cert})
   return new Response(saml.generateServiceProviderMetadata(null,null),{headers:{...headers,'content-type':'application/samlmetadata+xml'}})
  }
  if(url.pathname==='/auth/saml/start'&&request.method==='GET'){
   if(request.headers.get('sec-fetch-site')==='cross-site')throw new Error('Cross-site start')
   const browser=crypto.randomUUID(),ip=await sha256(request.headers.get('CF-Connecting-IP')??'unknown')
   await db.prepare('DELETE FROM lk_saml_requests WHERE expires_at<?').bind(Date.now()).run()
   const count=await db.prepare('SELECT COUNT(*) n FROM lk_saml_requests WHERE ip_hash=?').bind(ip).first<{n:number}>()
   if((count?.n??0)>=30)return new Response('Too many sign-in attempts. Try again later.',{status:429,headers})
   const saml=new SAML({issuer:c.entity,callbackUrl:c.callback,entryPoint:c.entryPoint,idpCert:c.cert,validateInResponseTo:ValidateInResponseTo.always,cacheProvider:{
    async saveAsync(id,value){const createdAt=Date.now();await db.prepare('INSERT INTO lk_saml_requests VALUES(?,?,?,?,?,?,NULL)').bind(id,value,await sha256(browser),fingerprint,ip,createdAt+300000).run();return {value,createdAt}},async getAsync(){return null},async removeAsync(){return null},
   }})
   const location=await saml.getAuthorizeUrlAsync('',undefined,{})
   return new Response(null,{status:303,headers:{...headers,location,'set-cookie':cookie(browser)}})
  }
  if(url.pathname!=='/auth/saml/callback'||request.method!=='POST')return new Response('No such sign-in door.',{status:404,headers})
  if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))throw new Error('Wrong body type')
  const body=await request.text();if(body.length>1500000)throw new Error('Response too large')
  const form=new URLSearchParams(body),response=form.get('SAMLResponse')
  if(form.getAll('SAMLResponse').length!==1||!response||!/^[A-Za-z0-9+/=\r\n]+$/.test(response))throw new Error('Invalid response')
  const xml=Buffer.from(response,'base64').toString('utf8'),id=xml.match(/\bInResponseTo=["']([^"']+)["']/)?.[1]
  if(!id)throw new Error('Unsolicited assertion')
  const matches=(request.headers.get('cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(cookieName+'='))
  if(matches.length!==1)throw new Error('Missing browser correlation')
  const browser=matches[0].slice(cookieName.length+1)
  const row=await db.prepare('UPDATE lk_saml_requests SET consumed_at=? WHERE id=? AND browser_hash=? AND configuration=? AND expires_at>? AND consumed_at IS NULL RETURNING *').bind(Date.now(),id,await sha256(browser),fingerprint,Date.now()).first<any>()
  if(!row)throw new Error('Expired or replayed response')
  if(/<!DOCTYPE|<!ENTITY|Algorithm=["'][^"']*(?:sha1|md5)/i.test(xml))throw new Error('Unsafe XML or signature algorithm')
  const saml=new SAML({issuer:c.entity,callbackUrl:c.callback,entryPoint:c.entryPoint,idpIssuer:c.issuer,idpCert:c.cert,audience:c.entity,wantAuthnResponseSigned:true,wantAssertionsSigned:true,validateInResponseTo:ValidateInResponseTo.always,acceptedClockSkewMs:0,maxAssertionAgeMs:300000,requestIdExpirationPeriodMs:300000,cacheProvider:{async saveAsync(){return null},async getAsync(key){return key===id?row.instant:null},async removeAsync(){return null}}})
  const result=await saml.validatePostResponseAsync({SAMLResponse:response})
  requiredAttributes(xml,c,id)
  const subject=result.profile?.nameID
  if(result.loggedOut||!subject||result.profile?.issuer!==c.issuer)throw new Error('Wrong identity issuer')
  const person=await db.prepare("SELECT o.email FROM lk_workforce_users u JOIN oa_operators o ON o.id=u.id WHERE u.subject=? AND o.status='active' AND o.role='member'").bind(subject).first<{email:string}>()
  if(!person)throw new Error('Identity not provisioned')
  const auth=createOperatorAuth({db,config:authConfig(env),clientIp:()=>request.headers.get('CF-Connecting-IP')??''})
  const admission=auth.createIdentityAdmission({issuer:c.issuer,subjectEmails:{[subject]:person.email}})
  const completed=await admission(request,{issuer:c.issuer,subject,provider:'workforce-saml'},{returnTo:'/app'})
  if((await workforceSettings(env))?.version!==s.version){await db.prepare('UPDATE oa_sessions SET revoked_at=? WHERE id=?').bind(Date.now(),completed.session.id).run();throw new Error('Workforce disabled')}
  return new Response(null,{status:303,headers:{...headers,location:'/app','set-cookie':completed.cookie}})
 }catch{return new Response('Workforce sign-in was refused. Start again or contact the installation owner.',{status:403,headers:{...headers,'set-cookie':cookie('',0)}})}
}
