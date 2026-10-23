// Owner upgrade of pre-random replacement addresses and session-bound entries.
// Originals, audit and held records keep their existing custody.
import type { Handler } from './commands'
import { requireRole } from './access'
import { openErasedAddress, sealErasedAddress } from './erasure-addresses'
import { erasureFields, privacyWords } from './erasure-plan'
import { bool, fail, oneOf, text, sql, type Sql } from './model'
const owner=['owner'] as const
export const resealErasure:Handler=async(c)=>{
 requireRole(c.actor,owner,'upgrade private erasure custody')
 const blocks=(await c.db.prepare('SELECT subject_token,address_ciphertext FROM lk_erasure_blocks').all<{subject_token:string;address_ciphertext:string}>()).results
 const writes:Sql[]=[],checks:Sql[]=[sql('(SELECT COUNT(*) FROM lk_erasure_blocks)=?',blocks.length)]
 let resealed=0,rewritten=0,retained=0
 for(const row of blocks)if(!row.address_ciphertext.startsWith('v2.')){
  const email=await openErasedAddress(c,row.address_ciphertext)
  writes.push(sql('UPDATE lk_erasure_blocks SET address_ciphertext=? WHERE subject_token=?',await sealErasedAddress(c,email),row.subject_token))
  checks.push(sql('(SELECT address_ciphertext FROM lk_erasure_blocks WHERE subject_token=?)=?',row.subject_token,row.address_ciphertext));resealed++
 }
 const replacements=new Map<string,string>()
 for(const[table,columns]of Object.entries({lk_parties:['contacts','email'],...erasureFields})){
  const rows=(await c.db.prepare(`SELECT * FROM ${table}`).all<any>()).results
  for(const row of rows){
   const fields:Record<string,string>={}
   for(const column of columns)if(typeof row[column]==='string'){
    let next=row[column]
    for(const match of row[column].matchAll(/erased-[a-f0-9]{16}@invalid\.example/gi)){
     const old=match[0].toLowerCase()
     if(!replacements.has(old))replacements.set(old,'erased-'+crypto.randomUUID().replaceAll('-','')+'@invalid.example')
     next=privacyWords([old],()=>replacements.get(old)!)(next)
    }
    if(next!==row[column])fields[column]=next
   }
   if(!Object.keys(fields).length)continue
   const held=table==='lk_parties'
    ?sql('NOT EXISTS(SELECT 1 FROM lk_agreements a JOIN lk_legal_holds h ON h.agreement_id=a.id WHERE a.party_id=? AND h.active=1)',row.id)
    :table==='lk_notification_deliveries'
     ?sql('NOT EXISTS(SELECT 1 FROM lk_notifications n JOIN lk_legal_holds h ON h.agreement_id=n.agreement_id WHERE n.delivery_id=? AND h.active=1)',row.id)
     :sql('NOT EXISTS(SELECT 1 FROM lk_legal_holds WHERE agreement_id=? AND active=1)',row.agreement_id??null)
   const unheld=await c.db.prepare('SELECT CASE WHEN '+held.sql+' THEN 1 ELSE 0 END AS ok').bind(...held.params).first<{ok:number}>()
   if(!unheld?.ok){retained++;continue}
   checks.push(held,sql(`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND ${Object.keys(fields).map(k=>`${k} IS ?`).join(' AND ')})`,row.id,...Object.keys(fields).map(k=>row[k])))
   const sets=Object.keys(fields).map(k=>`${k}=?`)
   if(table==='lk_parties')sets.push('version=version+1')
   if(table==='lk_comments')sets.push('revision=revision+1')
   if(table==='lk_exchanges')sets.push('revision=revision+1','revoked_at='+c.now)
   writes.push(sql(`UPDATE ${table} SET ${sets.join(',')} WHERE id=?`,...Object.values(fields),row.id))
   if(row.agreement_id)writes.push(sql('UPDATE lk_exchanges SET revoked_at=?,revision=revision+1 WHERE agreement_id=? AND revoked_at IS NULL',c.now,row.agreement_id))
   rewritten++
  }
 }
 return{allowed:owner,result:{resealed,rewritten,retained},writes,checks,audit:[{action:'erasure.reseal',summary:`Upgraded private erasure custody: ${resealed} legacy entries re-sealed, ${rewritten} mutable records randomized; ${retained} held records retained. Original addresses absent from historical hashes cannot be reconstructed.`}]}
}

export const recoverErasure:Handler=async(c,p)=>{
 requireRole(c.actor,owner,'recover historical erasure protection')
 const subjectToken=text(p,'subjectToken',100),email=text(p,'email',200).toLowerCase()
 if(!bool(p,'verified')||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))fail('VERIFICATION','Verify the original address against the historical privacy request.',409)
 const method=oneOf(p,'method',['established_channel','in_person','verified_letter'] as const)
 const missing=sql('EXISTS(SELECT 1 FROM lk_erasures e LEFT JOIN lk_erasure_blocks b ON b.subject_token=e.subject_token WHERE e.subject_token=? AND b.subject_token IS NULL)',subjectToken)
 if(!await c.db.prepare('SELECT 1 WHERE '+missing.sql).bind(...missing.params).first())fail('STALE','Choose an unresolved historical erasure.',409)
 return{allowed:owner,result:{subjectToken,recovered:true},checks:[missing],writes:[sql('INSERT INTO lk_erasure_blocks VALUES(?,?,?)',subjectToken,await sealErasedAddress(c,email),c.now)],audit:[{action:'erasure.recover',summary:`Owner verified historical request ${subjectToken} using ${method} and restored private re-entry protection; original historical custody retained.`}]}
}
