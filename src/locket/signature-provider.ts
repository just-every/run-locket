import type { Bindings } from '../auth.server'
import { encodeBase64 } from './artifacts'
import { fail } from './model'
import type { SignatureField } from './signature-fields'
import type { PacketDocument,PacketRecipient } from './signature-packets'
export const liveSignatureProviders=['docusign','adobe-acrobat-sign','dropbox-sign','inkwell'] as const
export type SignatureProvider=typeof liveSignatureProviders[number]
export interface SignatureConnection {provider:SignatureProvider;base_url:string;account_id:string|null;version:number}
export interface ProviderPacket {id:string;title:string;digest:string;documents:(PacketDocument&{bytes:Uint8Array})[];recipients:PacketRecipient[];fields:SignatureField[]}
export class SignatureProviderFailure extends Error {constructor(public outcome:'rejected'|'uncertain',public code:string){super(code)}}
export function signatureSecret(env:Bindings,provider:string) {
 const names:Record<string,string>={docusign:'SIGNATURE_DOCUSIGN_TOKEN','adobe-acrobat-sign':'SIGNATURE_ACROBAT_TOKEN','dropbox-sign':'SIGNATURE_DROPBOX_KEY',inkwell:'SIGNATURE_INKWELL_TOKEN'}
 const value=(env as unknown as Record<string,unknown>)[names[provider]]
 if(typeof value!=='string'||!value)fail('SIGNATURE_CONFIG','Configure this signing provider’s secret binding before requesting a provider operation.',503)
 return value
}
export function signatureBase(provider:string,input:string,env:Bindings) {
 let url:URL;try{url=new URL(input)}catch{fail('SIGNATURE_CONFIG','Use the provider’s HTTPS API base URL.')}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port)fail('SIGNATURE_CONFIG','Use a plain HTTPS signing API URL without credentials, query or fragment.')
 const path=url.pathname.replace(/\/$/,''),host=url.hostname
 const valid=provider==='docusign'?(/^(demo|www|[a-z]{2}[0-9]?)\.docusign\.net$/.test(host)&&path==='/restapi/v2.1'):provider==='adobe-acrobat-sign'?(/^api\.[a-z0-9-]+\.(adobesign|echosign|documents\.adobe)\.com$/.test(host)&&path==='/api/rest/v6'):provider==='dropbox-sign'?(host==='api.hellosign.com'&&path==='/v3'):provider==='inkwell'?(url.origin===(env as unknown as {SIGNATURE_INKWELL_ORIGIN?:string}).SIGNATURE_INKWELL_ORIGIN&&path===''):false
 if(!valid)fail('SIGNATURE_CONFIG','The API base does not match this signing provider or the configured Inkwell installation.')
 return url.origin+path
}
export async function providerRequest(base:string,path:string,token:string,body:unknown,method='POST',basic=false):Promise<any> {
 const multipart=body instanceof FormData
 let response:Response
 try{response=await fetch(base+path,{method,redirect:'manual',signal:AbortSignal.timeout(25_000),headers:{authorization:basic?`Basic ${btoa(token+':')}`:`Bearer ${token}`,...(!multipart?{'content-type':'application/json'}:{})},body:multipart?body:JSON.stringify(body)})}
 catch{throw new SignatureProviderFailure('uncertain','provider_outcome_unknown')}
 if(response.status>=300&&response.status<400)throw new SignatureProviderFailure('rejected','provider_redirect_refused')
 if(!response.ok)throw new SignatureProviderFailure(response.status>=400&&response.status<500?'rejected':'uncertain',`provider_http_${response.status}`)
 try{return await response.json()}catch{throw new SignatureProviderFailure('uncertain','provider_receipt_unreadable')}
}
export const signersOf=(p:ProviderPacket)=>p.recipients.filter(r=>r.action==='sign')
export const copiesOf=(p:ProviderPacket)=>p.recipients.filter(r=>r.action==='copy')
export function signerIndex(p:ProviderPacket,f:SignatureField) {const index=signersOf(p).findIndex(r=>r.partyRole===f.partyRole);if(index<0)fail('FIELD_SIGNER','Every field needs its assigned packet signer.',409);return index}
export const documentNumber=(p:ProviderPacket,id:string)=>p.documents.findIndex(d=>d.id===id)+1
export const pdfBlob=(bytes:Uint8Array)=>new Blob([bytes as BlobPart],{type:'application/pdf'})
export { encodeBase64 }
