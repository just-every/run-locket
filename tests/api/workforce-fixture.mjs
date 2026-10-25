import { generateKeyPairSync,randomUUID } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { SignedXml } from 'xml-crypto'
import assert from 'node:assert/strict'
export const scimSecret='synthetic-locket-workforce-provisioning-0001'
export const issuer='https://synthetic-locket-idp.example.com/saml'
const pair=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
export const workforceBindings={WORKFORCE_SCIM_TOKEN:scimSecret,WORKFORCE_SAML_ISSUER:issuer,WORKFORCE_SAML_SSO_URL:'https://synthetic-locket-idp.example.com/sso',WORKFORCE_SAML_CERT:pair.publicKey}
export const groups=[{id:'Counsel',name:'Counsel',role:'counsel',kind:'department'},{id:'Viewers',name:'Readers',role:'viewer',kind:'group'}]
export async function enableWorkforce(h){
 await h.owner.command('workforce.configure',{version:0,enabled:true,consent:true,groups})
 const enabled=await h.owner.request('/auth/settings/identity',{method:'POST',body:{idpSignIn:true}});assert.equal(enabled.status,200,await enabled.text())
}
export async function scim(h,path,{method='GET',body,token=scimSecret,headers={}}={}){
 return h.request('/api/locket/scim/v2/'+path.replace(/^\//,''),{method,body,headers:{authorization:'Bearer '+token,...headers}})
}
export async function provision(h){
 const res=await scim(h,'Users',{method:'POST',body:{externalId:'synthetic-locket-subject',userName:'synthetic-locket-counsel@example.com',displayName:'Synthetic Counsel',active:true}})
 assert.equal(res.status,201,await res.clone().text());const user=await res.json()
 const mapped=await scim(h,'/Groups/Counsel',{method:'PATCH',body:{Operations:[{op:'add',path:'members',value:[{value:user.id}]}]}});assert.equal(mapped.status,200,await mapped.text())
 return user
}
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')
function sign(xml,localName){
 const signer=new SignedXml({privateKey:pair.privateKey,canonicalizationAlgorithm:'http://www.w3.org/2001/10/xml-exc-c14n#',signatureAlgorithm:'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'})
 signer.addReference({xpath:`//*[local-name()='${localName}']`,transforms:['http://www.w3.org/2000/09/xmldsig#enveloped-signature','http://www.w3.org/2001/10/xml-exc-c14n#'],digestAlgorithm:'http://www.w3.org/2001/04/xmlenc#sha256'})
 signer.computeSignature(xml,{location:{reference:`//*[local-name()='${localName}']/*[local-name()='Issuer']`,action:'after'}})
 return signer.getSignedXml()
}
export async function samlStart(h){
 const res=await h.request('/auth/saml/start');assert.equal(res.status,303,await res.text())
 const redirect=new URL(res.headers.get('location')),xml=inflateRawSync(Buffer.from(redirect.searchParams.get('SAMLRequest'),'base64')).toString(),id=xml.match(/\bID="([^"]+)"/)[1]
 return {id,cookie:res.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')}
}
export function samlResponse(h,start,options={}){
 const now=Date.now(),instant=new Date(now).toISOString(),before=new Date(now-1000).toISOString(),after=new Date(now+240000).toISOString(),callback=h.origin+'/auth/saml/callback',sp=h.origin+'/auth/saml/metadata'
 let xml=`<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_${randomUUID()}" Version="2.0" IssueInstant="${instant}" Destination="${escape(options.destination??callback)}" InResponseTo="${start.id}"><saml:Issuer>${escape(issuer)}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_${randomUUID()}" Version="2.0" IssueInstant="${instant}"><saml:Issuer>${escape(options.issuer??issuer)}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${escape(options.subject??'synthetic-locket-subject')}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${start.id}" Recipient="${escape(options.recipient??callback)}" NotOnOrAfter="${options.expired?before:after}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${before}" NotOnOrAfter="${options.expired?before:after}"><saml:AudienceRestriction><saml:Audience>${escape(options.audience??sp)}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${instant}" SessionIndex="synthetic-locket-session"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement></saml:Assertion></samlp:Response>`
 if(options.email)xml=xml.replace('</saml:Assertion>',`<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${escape(options.email)}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`)
 if(!options.unsigned)xml=sign(sign(xml,'Assertion'),'Response')
 if(options.tamper)xml=xml.replace('synthetic-locket-subject','synthetic-locket-attacker')
 return new URLSearchParams({SAMLResponse:Buffer.from(xml).toString('base64')}).toString()
}
export async function samlLogin(h,options={}){
 const start=await samlStart(h),body=samlResponse(h,start,options)
 return {start,body,response:await h.mf.dispatchFetch(h.origin+'/auth/saml/callback',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',cookie:start.cookie},body})}
}

// Real loopback HTTPS edge: browser redirect chains must reach a listener rather
// than a route interceptor. All signing keys are generated for this test only.
export async function oktaFake(){
 const {createServer}=await import('node:https'),{mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{execFileSync}=await import('node:child_process')
 const root=await mkdtemp(join(tmpdir(),'locket-okta-'))
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-subj','/CN=127.0.0.1','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-days','1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'})
 let installation
 const server=createServer({key:await readFile(join(root,'key.pem')),cert:await readFile(join(root,'cert.pem'))},(request,response)=>{
  try{
   const url=new URL(request.url,'https://127.0.0.1'),xml=inflateRawSync(Buffer.from(url.searchParams.get('SAMLRequest'),'base64')).toString(),id=xml.match(/\bID="([^"]+)"/)[1]
   const saml=new URLSearchParams(samlResponse(installation,{id})).get('SAMLResponse')
   response.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});response.end(`<!doctype html><html><body><form method="POST" action="${installation.origin}/auth/saml/callback"><input type="hidden" name="SAMLResponse" value="${saml}"><button>Sign in with Okta fake</button></form></body></html>`)
  }catch{response.writeHead(400);response.end('Invalid fake IdP request')}
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 return {origin:'https://127.0.0.1:'+server.address().port,setInstallation(h){installation=h},async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})}}
}
