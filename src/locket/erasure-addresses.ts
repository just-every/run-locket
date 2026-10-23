// Private, purpose-limited re-entry checks; no key is derived from sign-in secrets.
import type { Ctx } from './commands'
import { requireRole } from './access'
import { decodeBase64, encodeBase64 } from './artifacts'
import { privacyWords } from './erasure-plan'
import { fail, sql } from './model'
const utf8=new TextEncoder()
async function installationKey(c:Ctx,create=false){
 let row=await c.db.prepare("SELECT key_hex FROM lk_erasure_keys WHERE id='installation'").first<{key_hex:string}>()
 if(!row&&create){
  // No recoverable ciphertext may ever be silently assigned a different key.
  if(await c.db.prepare("SELECT 1 FROM lk_erasure_blocks WHERE address_ciphertext LIKE 'v2.%'").first())fail('ERASURE_STATE','Restore the private erasure installation key before recording personal data.',409)
  const random=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('')
  await c.db.prepare("INSERT OR IGNORE INTO lk_erasure_keys VALUES('installation',?)").bind(random).run()
  row=await c.db.prepare("SELECT key_hex FROM lk_erasure_keys WHERE id='installation'").first<{key_hex:string}>()
 }
 if(!row||! /^[a-f0-9]{64}$/.test(row.key_hex))fail('ERASURE_STATE','Restore the private erasure installation key before recording personal data.',409)
 const bytes=Uint8Array.from(row.key_hex.match(/../g)!,part=>parseInt(part,16))
 return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt'])
}
export async function sealErasedAddress(c:Ctx,email:string){
 const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await installationKey(c,true),utf8.encode(email))
 return 'v2.'+encodeBase64(iv)+'.'+encodeBase64(new Uint8Array(cipher))
}
export async function openErasedAddress(c:Ctx,value:string){
 const modern=value.startsWith('v2.'),[nonce,cipher]=(modern?value.slice(3):value).split('.')
 try{
  const key=modern?await installationKey(c):await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',utf8.encode('locket-erasure-addresses:'+c.env.SESSION_SECRET)),'AES-GCM',false,['decrypt'])
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decodeBase64(nonce) as BufferSource},key,decodeBase64(cipher) as BufferSource))
 }catch{fail('ERASURE_STATE','Re-seal legacy erasure entries using the original sign-in secret before rotating it. Restore that configuration to recover legacy entries.',409)}
}
export async function refuseErasedAddress(c:Ctx,type:string,p:Record<string,unknown>){
 if(!['party.save','request.create','legacy.import','import.preview','import.apply'].includes(type))return []
 requireRole(c.actor,type.startsWith('import.')?['owner']:['owner','counsel','approver','requester'],'record or import personal data')
 if(await c.db.prepare('SELECT 1 FROM lk_erasures e LEFT JOIN lk_erasure_blocks b ON b.subject_token=e.subject_token WHERE b.subject_token IS NULL').first())fail('ERASURE_STATE','Historical erasure recovery is required before recording or importing personal data. The owner must verify and restore each missing address block.',409)
 const rows=(await c.db.prepare('SELECT address_ciphertext FROM lk_erasure_blocks').all<{address_ciphertext:string}>()).results
 // The append-only list is fenced even when empty; an erasure racing a write wins safely.
 const checks=[sql('(SELECT COUNT(*) FROM lk_erasure_blocks)=?',rows.length)]
 if(!rows.length)return checks
 const strings:string[]=[]
 const collect=(value:unknown,field='')=>{
  if(typeof value==='string'){
   strings.push(value)
   if(field==='base64'){try{strings.push(new TextDecoder().decode(decodeBase64(value)))}catch{}}
  }else if(Array.isArray(value))value.forEach(v=>collect(v))
  else if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))collect(v,k)
 }
 collect(p)
 for(const row of rows){
  const email=await openErasedAddress(c,row.address_ciphertext),replace=privacyWords([email],()=> '[erased address]')
  if(strings.some(value=>replace(value)!==value))fail('ERASED_CONTACT','An erased email was re-entered. The owner must resolve the privacy request before importing or recording that address again.',409)
 }
 return checks
}
