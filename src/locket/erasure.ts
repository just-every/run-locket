// Verified owner requests first freeze an exact, hold-aware minimization plan.
import { requireRole } from './access'
import type { Handler } from './commands'
import { bool, fail, json, oneOf, sql, text, type Sql } from './model'
import { agreementGuards, visibleAgreement } from './records'
import { draftDeletion } from './draft-erasure'
import { erasurePlan } from './erasure-plan'
import { sealErasedAddress } from './erasure-addresses'
import { resealErasure } from './erasure-reseal'
const owner=['owner'] as const, custodians=['owner','counsel'] as const
function address(p:Record<string,unknown>){const email=text(p,'email',200).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('INVALID','Choose a contact email.');return email}
function date(p:Record<string,unknown>,key:string){const value=text(p,key,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail('INVALID','Choose a valid calendar date.');return value}
const preview:Handler=async(c,p)=>{
 requireRole(c.actor,owner,'preview verified personal-data erasure')
 if(!bool(p,'verified'))fail('VERIFICATION','Verify the person’s request before previewing erasure.',409)
 const email=address(p),method=oneOf(p,'method',['established_channel','in_person','verified_letter'] as const),reason=oneOf(p,'reason',['privacy_request','legal_request','other_verified_request'] as const),receivedOn=date(p,'receivedOn')
 if(receivedOn>new Date(c.now).toISOString().slice(0,10))fail('INVALID','The received date cannot be in the future.')
 const id=crypto.randomUUID(),subjectToken=crypto.randomUUID().replaceAll('-',''),plan=await erasurePlan(c,email,subjectToken)
 // Receipts never preserve pre-erasure names, addresses or unrestricted reasons.
 const patches=plan.patches.map(r=>({...r,before:Object.fromEntries(Object.keys(r.before).map(k=>[k,'[personal data]']))}))
 return{allowed:owner,result:{id,subjectToken,fingerprint:plan.fingerprint,patches,retained:plan.retained,drafts:plan.drafts},writes:[sql('INSERT INTO lk_erasure_previews VALUES(?,?,?,?,?,?,?,?,NULL)',id,c.actor.id,subjectToken,plan.fingerprint,reason,method,receivedOn,c.now)],checks:plan.checks,audit:[{action:'person.erase.preview',summary:`Verified request ${id}: exact minimization and retained-record preview; no data erased.`}]}
}
const erase:Handler=async(c,p)=>{
 requireRole(c.actor,owner,'confirm verified personal-data erasure')
 const email=address(p),previewId=text(p,'previewId',100),fingerprint=text(p,'fingerprint',100)
 const prior=await c.db.prepare('SELECT * FROM lk_erasure_previews WHERE id=? AND actor_id=? AND applied_at IS NULL').bind(previewId,c.actor.id).first<any>()
 if(!prior)fail('STALE','Choose your unconsumed erasure preview.',409)
 const plan=await erasurePlan(c,email,prior.subject_token)
 if(fingerprint!==prior.fingerprint||plan.fingerprint!==fingerprint)fail('STALE','The exact erasure preview changed. Preview it again.',409)
 if(!Array.isArray(p.draftDispositions)||p.draftDispositions.length!==plan.drafts.length)fail('DISPOSITION','Decide explicitly whether to delete or retain every listed draft and its files.',409)
 const decisions=p.draftDispositions as Record<string,unknown>[],seen=new Set<string>(),writes:Sql[]=[],checks:Sql[]=[...plan.checks,sql('EXISTS(SELECT 1 FROM lk_erasure_previews WHERE id=? AND actor_id=? AND fingerprint=? AND applied_at IS NULL)',previewId,c.actor.id,fingerprint)]
 const drafts=[]
 for(const draft of plan.drafts){
  const decision=decisions.find(d=>d.agreementId===draft.id)
  if(!decision||seen.has(draft.id))fail('DISPOSITION','Each previewed draft needs one disposition.',409)
  seen.add(draft.id)
  const action=oneOf(decision,'action',['delete','retain'] as const),reason=oneOf(decision,'reason',['legal_hold','business_retention','request_scope','legal_retention'] as const)
  if(draft.held&&(action!=='retain'||reason!=='legal_hold'))fail('LEGAL_HOLD','The held draft and all its records must remain unchanged.',409)
  drafts.push({...draft,action,reason,authorizer:c.actor.id})
 }
 const deleted=new Set(drafts.filter(d=>d.action==='delete').map(d=>d.id))
 let changedRecords=0
 for(const patch of plan.patches){
  if(patch.agreementId&&deleted.has(patch.agreementId))continue
  const entries=Object.entries(patch.after),sets=entries.map(([k])=>`${k}=?`)
  if(patch.table==='lk_parties')sets.push('version=version+1')
  if(patch.table==='lk_comments'){
   sets.push('revision=revision+1')
   writes.push(sql('UPDATE lk_exchanges SET revoked_at=?,revision=revision+1 WHERE agreement_id=? AND revoked_at IS NULL',c.now,patch.agreementId))
  }
  if(patch.table==='lk_exchanges')sets.push('revoked_at='+c.now,'revision=revision+1')
  if(patch.table==='lk_remediation_requests'){
   sets.push("status='cancelled'","stop_kind='recipient_erased'")
   writes.push(sql("DELETE FROM lk_remediation_occurrences WHERE request_id=? AND status='pending'",patch.id))
  }
  if(patch.table==='lk_notice_plans')sets.push("status=CASE WHEN status='scheduled' THEN 'erased' ELSE status END")
  if(patch.table==='lk_notice_dispatches')sets.push("status=CASE WHEN status='pending' THEN 'cancelled' ELSE status END")
  writes.push(sql(`UPDATE ${patch.table} SET ${sets.join(',')} WHERE id=?`,...entries.map(([,v])=>v),patch.id));changedRecords++
 }
 for(const id of deleted){const a=await visibleAgreement(c,id),out=await draftDeletion(c,a);writes.push(...out.writes);checks.push(...out.checks)}
 const operators=(await c.db.prepare('SELECT id FROM oa_operators WHERE lower(email)=?').bind(email).all<{id:string}>()).results
 for(const person of operators)writes.push(sql("INSERT INTO lk_person_preferences(operator_id,timezone,digest,email,updated_by,updated_at) VALUES(?,'America/New_York',0,0,?,?) ON CONFLICT(operator_id) DO UPDATE SET email=0",person.id,c.actor.id,c.now),sql("UPDATE lk_notifications SET email_status='cancelled',code='personal_data_erased' WHERE recipient_id=? AND email_status IN ('pending','immediate','digest') AND NOT EXISTS(SELECT 1 FROM lk_legal_holds h WHERE h.agreement_id=lk_notifications.agreement_id AND h.active=1)",person.id))
 const id=crypto.randomUUID(),receipt={subjectToken:prior.subject_token,previewId,fingerprint,retained:plan.retained,drafts,changedRecords}
 writes.push(sql('INSERT INTO lk_erasures(id,subject_token,reason,verification,requested_by,at,changed_records,received_on,receipt) VALUES(?,?,?,?,?,?,?,?,?)',id,prior.subject_token,prior.reason,prior.method,c.actor.id,c.now,changedRecords,prior.received_on,json(receipt)),sql('INSERT INTO lk_erasure_blocks VALUES(?,?,?)',prior.subject_token,await sealErasedAddress(c,email),c.now),sql('UPDATE lk_erasure_previews SET applied_at=? WHERE id=?',c.now,previewId))
 return{allowed:owner,result:{id,changedRecords,receipt},writes,checks,audit:[{action:'person.erase',summary:`Verified personal-data erasure ${id}: ${changedRecords} native records minimized; preview ${previewId} confirmed. Held records, execution evidence and audit retained as listed in the receipt.`}]}
}
const hold:Handler=async(c,p)=>{
 requireRole(c.actor,custodians,'set or release legal holds')
 const a=await visibleAgreement(c,p.agreementId),active=bool(p,'active'),reason=text(p,'reason',1000),reviewOn=active?date(p,'reviewOn'):null
 const activeCounsel="EXISTS(SELECT 1 FROM oa_operators o JOIN lk_roles r ON r.operator_id=o.id WHERE o.status='active' AND r.role='counsel')"
 if(!active&&c.actor.role==='owner'&&await c.db.prepare('SELECT 1 WHERE '+activeCounsel).first())fail('FORBIDDEN','Active counsel must authorize the hold release.',403)
 const prior=await c.db.prepare('SELECT * FROM lk_legal_holds WHERE agreement_id=?').bind(a.id).first<any>()
 if(p.holdVersion!==(prior?.version??0))fail('STALE','The legal hold changed. Reload before continuing.',409)
 const checks=[...agreementGuards(c,a,p),sql('COALESCE((SELECT version FROM lk_legal_holds WHERE agreement_id=?),0)=?',a.id,prior?.version??0)]
 if(!active&&c.actor.role==='owner')checks.push(sql('NOT '+activeCounsel))
 return{allowed:custodians,result:{agreementId:a.id,active,version:(prior?.version??0)+1},checks,writes:[sql(`INSERT INTO lk_legal_holds(agreement_id,active,reason,set_by,set_at,released_by,released_at,release_reason,version,review_on) VALUES(?,?,?,?,?,?,?,?,1,?) ON CONFLICT(agreement_id) DO UPDATE SET active=excluded.active,reason=CASE WHEN excluded.active=1 THEN excluded.reason ELSE lk_legal_holds.reason END,set_by=CASE WHEN excluded.active=1 THEN excluded.set_by ELSE lk_legal_holds.set_by END,set_at=CASE WHEN excluded.active=1 THEN excluded.set_at ELSE lk_legal_holds.set_at END,released_by=excluded.released_by,released_at=excluded.released_at,release_reason=excluded.release_reason,review_on=CASE WHEN excluded.active=1 THEN excluded.review_on ELSE lk_legal_holds.review_on END,version=lk_legal_holds.version+1`,a.id,active?1:0,reason,c.actor.id,c.now,active?null:c.actor.id,active?null:c.now,active?null:reason,reviewOn)],audit:[{action:active?'hold.set':'hold.release',agreementId:a.id,summary:`Legal hold ${active?'set':'released'}: ${reason}${reviewOn?'; review '+reviewOn:''}`} ]}
}
const remove:Handler=async(c,p)=>{
 requireRole(c.actor,owner,'delete native drafts')
 const a=await visibleAgreement(c,p.agreementId),out=await draftDeletion(c,a)
 return{allowed:owner,result:{id:a.id,deleted:true},...out,checks:[...out.checks,...agreementGuards(c,a,p)],audit:[{action:'draft.delete',agreementId:a.id,summary:`Deleted unexecuted draft and files: ${text(p,'reason',1000)}`} ]}
}
export const erasureHandlers:Record<string,Handler>={'erasure.reseal':resealErasure,'person.erase.preview':preview,'person.erase':erase,'hold.set':hold,'draft.delete':remove}
