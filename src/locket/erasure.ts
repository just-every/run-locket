// Explicit, verified owner requests minimize personal data in native records.
// Original files, execution/signature evidence and audit history are never rewritten.
import { requireRole } from './access'
import type { Ctx, Handler } from './commands'
import { bool, fail, json, parse, sha256, sql, text, type Sql } from './model'
import { agreementGuards, visibleAgreement } from './records'
import { draftDeletion } from './draft-erasure'

const owner=['owner'] as const, counsel=['counsel'] as const
const erase:Handler=async(c,p)=>{
  requireRole(c.actor,owner,'erase verified personal data')
  if(!bool(p,'verified'))fail('VERIFICATION','Verify the person’s request before erasing personal data.',409)
  const email=text(p,'email',200).toLowerCase(),reason=text(p,'reason',1000),verification=text(p,'verification',1000)
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('INVALID','Choose a contact email.')
  const parties=(await c.db.prepare('SELECT * FROM lk_parties').all<any>()).results
  const contacts=parties.flatMap(r=>parse<any[]>(r.contacts??'[]')).filter(r=>r.email.toLowerCase()===email)
  if(!contacts.length&&!parties.some(r=>r.email?.toLowerCase()===email))fail('NOT_FOUND','No current counterparty contact has that email.',404)
  const hash=await sha256(email),name='[erased person]',address=`erased-${hash.slice(0,16)}@invalid.example`
  const needles=[email,...new Set<string>(contacts.map(r=>r.name).filter(Boolean))].sort((a,b)=>b.length-a.length)
  const scrub=(value:string)=>needles.reduce((s,n)=>s.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),n===email?address:name),value)
  const writes:Sql[]=[],checks:Sql[]=[],changed=new Set<string>()
  for(const r of parties){
    const rows=parse<any[]>(r.contacts??'[]'),next=rows.map(v=>v.email.toLowerCase()===email?{name,email:address,title:null}:v)
    const contact=json(next),nextEmail=r.email?.toLowerCase()===email?null:r.email
    if(contact!==r.contacts||nextEmail!==r.email){
      writes.push(sql('UPDATE lk_parties SET contacts=?,email=?,version=version+1 WHERE id=?',contact,nextEmail,r.id))
      checks.push(sql('(SELECT version FROM lk_parties WHERE id=?)=?',r.id,r.version));changed.add('lk_parties:'+r.id)
    }
  }
  const fields:Record<string,string[]>={lk_comments:['body','quote'],lk_notices:['recipient','body'],lk_notice_letters:['recipient'],lk_notice_dispatches:['recipient','subject','message_text'],lk_notice_sources:['recipient','alternate_address'],lk_notice_plans:['recipient','acknowledgment'],lk_notice_events:['detail'],lk_notice_tracking:['detail'],lk_notification_deliveries:['recipient_email'],lk_approval_reminders:['recipient_email'],lk_deadline_reminders:['recipient_email'],lk_approval_mail:['recipient_email']}
  // The later exchange door inherits minimization without requiring it to exist first.
  const exchange=await c.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='lk_exchanges'").first()
  if(exchange){fields.lk_exchanges=['recipient_name','recipient_email','contact_consent'];fields.lk_comments.push('external_author_name','external_author_email')}
  for(const[table,columns]of Object.entries(fields)){
    const rows=(await c.db.prepare(`SELECT * FROM ${table}`).all<any>()).results
    checks.push(sql(`(SELECT COUNT(*) FROM ${table})=?`,rows.length))
    for(const r of rows){
      const updated=columns.filter(key=>typeof r[key]==='string'&&scrub(r[key])!==r[key])
      if(!updated.length)continue
      const key='id'
      const sets=updated.map(k=>`${k}=?`),values=updated.map(k=>scrub(r[k]))
      if(table==='lk_comments'){
        sets.push('revision=revision+1')
        if(exchange)writes.push(sql('UPDATE lk_exchanges SET revoked_at=?,revision=revision+1 WHERE agreement_id=? AND revoked_at IS NULL',c.now,r.agreement_id))
      }
      if(table==='lk_exchanges')sets.push('revoked_at='+c.now,'revision=revision+1')
      if(table==='lk_notice_plans'){sets.push("status=CASE WHEN status='scheduled' THEN 'erased' ELSE status END")}
      if(table==='lk_notice_dispatches'){sets.push("status=CASE WHEN status='pending' THEN 'cancelled' ELSE status END")}
      writes.push(sql(`UPDATE ${table} SET ${sets.join(',')} WHERE ${key}=?`,...values,r[key]))
      checks.push(sql(`EXISTS(SELECT 1 FROM ${table} WHERE ${key}=? AND ${updated.map(k=>`${k} IS ?`).join(' AND ')})`,r[key],...updated.map(k=>r[k])))
      changed.add(table+':'+r[key])
    }
  }
  const operators=(await c.db.prepare('SELECT id FROM oa_operators WHERE lower(email)=?').bind(email).all<{id:string}>()).results
  for(const person of operators){
    writes.push(sql("INSERT INTO lk_person_preferences(operator_id,timezone,digest,email,updated_by,updated_at) VALUES(?,'America/New_York',0,0,?,?) ON CONFLICT(operator_id) DO UPDATE SET email=0",person.id,c.actor.id,c.now),sql("UPDATE lk_notifications SET email_status='cancelled',code='personal_data_erased' WHERE recipient_id=? AND email_status IN ('pending','immediate','digest')",person.id))
  }
  const id=crypto.randomUUID()
  writes.push(sql('INSERT INTO lk_erasures VALUES(?,?,?,?,?,?,?)',id,hash,reason,verification,c.actor.id,c.now,changed.size))
  return{allowed:owner,result:{id,changedRecords:changed.size},writes,checks,audit:[{action:'person.erase',summary:`Verified personal-data erasure ${id}: ${changed.size} native records minimized. Reason: ${reason}. Original files, signatures and audit retained.`}]}
}
const hold:Handler=async(c,p)=>{
  requireRole(c.actor,counsel,'set or release legal holds')
  const a=await visibleAgreement(c,p.agreementId),active=bool(p,'active'),reason=text(p,'reason',1000)
  const prior=await c.db.prepare('SELECT * FROM lk_legal_holds WHERE agreement_id=?').bind(a.id).first<any>()
  if(p.holdVersion!==(prior?.version??0))fail('STALE','The legal hold changed. Reload before continuing.',409)
  return{allowed:counsel,result:{agreementId:a.id,active,version:(prior?.version??0)+1},checks:[...agreementGuards(c,a,p),sql('COALESCE((SELECT version FROM lk_legal_holds WHERE agreement_id=?),0)=?',a.id,prior?.version??0)],writes:[sql(`INSERT INTO lk_legal_holds VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT(agreement_id) DO UPDATE SET active=excluded.active,reason=CASE WHEN excluded.active=1 THEN excluded.reason ELSE lk_legal_holds.reason END,set_by=CASE WHEN excluded.active=1 THEN excluded.set_by ELSE lk_legal_holds.set_by END,set_at=CASE WHEN excluded.active=1 THEN excluded.set_at ELSE lk_legal_holds.set_at END,released_by=excluded.released_by,released_at=excluded.released_at,release_reason=excluded.release_reason,version=lk_legal_holds.version+1`,a.id,active?1:0,reason,c.actor.id,c.now,active?null:c.actor.id,active?null:c.now,active?null:reason)],audit:[{action:active?'hold.set':'hold.release',agreementId:a.id,summary:`Legal hold ${active?'set':'released'}: ${reason}`} ]}
}
const remove:Handler=async(c,p)=>{
  requireRole(c.actor,owner,'delete native drafts')
  const a=await visibleAgreement(c,p.agreementId)
  const out=await draftDeletion(c,a)
  return{allowed:owner,result:{id:a.id,deleted:true},...out,checks:[...out.checks,...agreementGuards(c,a,p)],audit:[{action:'draft.delete',agreementId:a.id,summary:`Deleted unexecuted draft and files: ${text(p,'reason',1000)}`} ]}
}
export const erasureHandlers:Record<string,Handler>={'person.erase':erase,'hold.set':hold,'draft.delete':remove}
