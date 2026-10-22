// Private, purpose-limited re-entry checks. The request/receipt identity is random.
// Rotation/restoration uses the installation secret already required by PORT-001.
import type { Ctx } from './commands'
import { requireRole } from './access'
import { decodeBase64, encodeBase64 } from './artifacts'
import { fail } from './model'
const utf8=new TextEncoder()
async function key(secret:string){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',utf8.encode('locket-erasure-addresses:'+secret)),'AES-GCM',false,['encrypt','decrypt'])}
export async function sealErasedAddress(c:Ctx,email:string){
 const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(c.env.SESSION_SECRET),utf8.encode(email))
 return encodeBase64(iv)+'.'+encodeBase64(new Uint8Array(cipher))
}
export async function refuseErasedAddress(c:Ctx,type:string,p:Record<string,unknown>){
 if(!['party.save','request.create','legacy.import','import.preview'].includes(type))return
 requireRole(c.actor,type==='import.preview'?['owner']:['owner','counsel','approver','requester'],'record or import personal data')
 const rows=(await c.db.prepare('SELECT address_ciphertext FROM lk_erasure_blocks').all<{address_ciphertext:string}>()).results
 if(!rows.length)return
 const strings:string[]=[]
 const collect=(value:unknown,field='')=>{
  if(typeof value==='string'){
   strings.push(value.toLowerCase())
   if(field==='base64'){try{strings.push(new TextDecoder().decode(decodeBase64(value)).toLowerCase())}catch{}}
  }else if(Array.isArray(value))value.forEach(v=>collect(v))
  else if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))collect(v,k)
 }
 collect(p)
 const encryption=await key(c.env.SESSION_SECRET)
 for(const row of rows){
  const[nonce,cipher]=row.address_ciphertext.split('.')
  let email:string
  try{email=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decodeBase64(nonce) as BufferSource},encryption,decodeBase64(cipher) as BufferSource))}
  catch{fail('ERASURE_STATE','The private erasure re-entry check needs the installation’s original secret. Restore its configuration before importing.',409)}
  if(strings.some(value=>value.includes(email!)))fail('ERASED_CONTACT','An erased email was re-entered. The owner must resolve the privacy request before importing or recording that address again.',409)
 }
}
