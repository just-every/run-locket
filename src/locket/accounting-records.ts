import type { Bindings } from '../auth.server'
import { fail } from './model'

export type AccountingProvider = 'quickbooks'|'pantry'|'netsuite'
export type AccountingLink = {vendor_id:string;provider:AccountingProvider;record_kind:'vendor'|'customer';version:number}
export type AccountingDocument = {id:string;date:string;dueDate:string|null;totalCents:number;balanceCents:number|null}
export type AccountingPayment = {id:string;date:string;totalCents:number;reversed:boolean;allocations:{documentId:string;amountCents:number}[]}
export type AccountingRecords = {bills:AccountingDocument[];invoices:AccountingDocument[];payments:AccountingPayment[]}
export function providerDate(value:unknown):string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('ACCOUNTING_DATA','The provider returned an invalid calendar date.',502)
 return value
}
export function cents(value:unknown,integer=false):number {
 if(integer){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)fail('ACCOUNTING_DATA','The provider returned an invalid USD cent amount.',502);return value}
 if(typeof value!=='number'&&!(typeof value==='string'&&/^\d+(\.\d{1,2})?$/.test(value)))fail('ACCOUNTING_DATA','The provider returned an invalid USD amount.',502)
 const n=Number(value),out=Math.round(n*100)
 if(!Number.isSafeInteger(out)||out<0||Math.abs(n*100-out)>0.00001)fail('ACCOUNTING_DATA','The provider returned an inexact USD amount.',502)
 return out
}
export function total(values:number[]){const out=values.reduce((n,v)=>n+v,0);if(!Number.isSafeInteger(out))fail('ACCOUNTING_DATA','The selection exceeds the exact supported USD range.',502);return out}
export function identity(value:unknown):string {if(typeof value!=='string'||!value.length||value.length>100)fail('ACCOUNTING_DATA','The provider returned an invalid record identity.',502);return value}
export function publicPantryOrigin(value:string){
 let url:URL
 try{url=new URL(value)}catch{fail('PANTRY_UNAVAILABLE','Configure the server-only Pantry origin and scoped token.',409)}
 if(url.protocol!=='https:'||url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!url.hostname.includes('.')||/^(localhost|.*\.localhost|.*\.local)$/.test(url.hostname)||/^\[|^\d+\./.test(url.hostname))fail('PANTRY_UNAVAILABLE','Pantry requires a public HTTPS origin and a server-only scoped token.',409)
 return url.origin
}
export function pantryOrigin(env:Bindings){
 if(!env.PANTRY_TOKEN)fail('PANTRY_UNAVAILABLE','Configure the server-only Pantry origin and scoped token.',409)
 return publicPantryOrigin(env.PANTRY_ORIGIN??'')
}
export function accountingRealm(env:Bindings,provider:AccountingProvider){
 if(provider==='pantry')return 'pantry:'+pantryOrigin(env)
 if(provider==='netsuite'){
  if(!env.NETSUITE_ACCESS_TOKEN||!env.NETSUITE_ACCOUNT_ID||!/^\d+(?:[-_](?:sb|rp)\d+)?$/i.test(env.NETSUITE_ACCOUNT_ID))fail('ACCOUNTING_UNAVAILABLE','Configure the server-only NetSuite account and OAuth access token.',409)
  return 'netsuite:'+env.NETSUITE_ACCOUNT_ID.toLowerCase().replaceAll('_','-')
 }
 if(!env.QUICKBOOKS_ACCESS_TOKEN||!env.QUICKBOOKS_REALM_ID||!/^\d+$/.test(env.QUICKBOOKS_REALM_ID))fail('ACCOUNTING_UNAVAILABLE','Configure the server-only QuickBooks connection.',409)
 return env.QUICKBOOKS_REALM_ID
}
export async function providerJson(url:string,init:RequestInit={}){
 let response:Response
 try{response=await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(15000)})}catch{fail('ACCOUNTING_UNAVAILABLE','The accounting provider could not be reached. No partial snapshot was saved.',502)}
 if(!response.ok)fail('ACCOUNTING_UNAVAILABLE','The accounting provider refused the read. No partial snapshot was saved.',502)
 const reader=response.body?.getReader();if(!reader)fail('ACCOUNTING_DATA','The accounting provider returned no data.',502)
 const chunks:Uint8Array[]=[];let size=0
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2097152)fail('ACCOUNTING_DATA','The accounting page exceeds the supported response size.',502);chunks.push(value)}}finally{await reader.cancel()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try{return JSON.parse(new TextDecoder().decode(bytes))}catch{fail('ACCOUNTING_DATA','The accounting provider returned unreadable data.',502)}
}
