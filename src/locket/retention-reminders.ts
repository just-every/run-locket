// Expiry prompts review; it never authorizes a delete or releases a hold.
import type { Bindings } from '../auth.server'
import { guardSql, type Ctx } from './commands'
import { notificationBatch, notificationWrites } from './notifications'
import { sql } from './model'
import { deletableDraftSql } from './retained-originals'
const unpreviewed=`NOT EXISTS(SELECT 1 FROM lk_retention_previews p,json_each(p.candidates) x WHERE p.rule_version=r.version AND json_extract(x.value,'$.id')=a.id AND json_extract(x.value,'$.version')=a.version)`
const eligible=`${deletableDraftSql()} AND a.created_at<=?-r.days*86400000 AND ${unpreviewed}`
export const expiredDraftCheck=(id:string,version:number,ruleVersion:number,now:number)=>sql(`EXISTS(SELECT 1 FROM lk_agreements a JOIN lk_retention_rules r ON r.id='installation' WHERE a.id=? AND a.version=? AND r.version=? AND ${eligible})`,id,version,ruleVersion,now)
export async function runRetentionReminders(env:Bindings,now=Date.now()){
 const rule=await env.DB.prepare("SELECT * FROM lk_retention_rules WHERE id='installation'").first<{version:number;days:number}>()
 if(!rule)return
 const owners=(await env.DB.prepare("SELECT id,display_name AS name,email,version FROM oa_operators WHERE role='owner' AND status='active'").all<any>()).results
 for(const owner of owners){
  // Apply all exclusions before the bounded batch, including already sent events
  // for this owner. Earlier ineligible drafts cannot starve later expiries.
  const drafts=(await env.DB.prepare(`SELECT a.id,a.version FROM lk_agreements a JOIN lk_retention_rules r ON r.id='installation' WHERE r.version=? AND ${eligible} AND NOT EXISTS(SELECT 1 FROM lk_notifications n WHERE n.event_key='retention:'||r.version||':'||a.id||':'||a.version AND n.recipient_id=?) ORDER BY a.created_at,a.id LIMIT 100`).bind(rule.version,now,owner.id).all<{id:string;version:number}>()).results
  for(const draft of drafts){
   const key=`retention:${rule.version}:${draft.id}:${draft.version}`
   const c:Ctx={env,db:env.DB,now,commandId:crypto.randomUUID(),actor:{id:owner.id,name:owner.name,email:owner.email,role:'owner',sessionId:'',operatorVersion:owner.version}}
   const guard=crypto.randomUUID()
   try{await notificationBatch(env.DB,[guardSql(guard,[expiredDraftCheck(draft.id,draft.version,rule.version,now)]),...notificationWrites(c,{key,agreementId:draft.id,recipientId:owner.id,kind:'draft_retention'}),sql('DELETE FROM lk_guard WHERE id=?',guard)])}
   catch(error){if(!/LOCKET_GUARD|CHECK constraint/.test(String(error)))throw error}
  }
 }
}
