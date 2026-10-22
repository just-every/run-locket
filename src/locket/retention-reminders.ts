// Expiry prompts review; it never authorizes a delete or releases a hold.
import type { Bindings } from '../auth.server'
import { guardSql, type Ctx } from './commands'
import { notificationBatch, notificationWrites } from './notifications'
import { sql } from './model'
export const expiredDraftCheck=(id:string,version:number,ruleVersion:number,now:number)=>sql(`EXISTS(SELECT 1 FROM lk_agreements a JOIN lk_retention_rules r ON r.id='installation' WHERE a.id=? AND a.version=? AND a.status='draft' AND a.created_at<=?-r.days*86400000 AND r.version=? AND NOT EXISTS(SELECT 1 FROM lk_legal_holds h WHERE h.agreement_id=a.id AND h.active=1) AND NOT EXISTS(SELECT 1 FROM lk_executions e WHERE e.agreement_id=a.id) AND NOT EXISTS(SELECT 1 FROM lk_agreements child WHERE child.parent_id=a.id) AND NOT EXISTS(SELECT 1 FROM lk_retention_previews p,json_each(p.candidates) x WHERE p.rule_version=r.version AND json_extract(x.value,'$.id')=a.id AND json_extract(x.value,'$.version')=a.version))`,id,version,now,ruleVersion)
export async function runRetentionReminders(env:Bindings,now=Date.now()){
 const rule=await env.DB.prepare("SELECT * FROM lk_retention_rules WHERE id='installation'").first<{version:number;days:number}>()
 if(!rule)return
 const owners=(await env.DB.prepare("SELECT id,name,email,version FROM oa_operators WHERE role='owner' AND status='active'").all<any>()).results
 const drafts=(await env.DB.prepare("SELECT id,version FROM lk_agreements WHERE status='draft' AND created_at<=? ORDER BY created_at,id LIMIT 100").bind(now-rule.days*86400000).all<{id:string;version:number}>()).results
 for(const draft of drafts)for(const owner of owners){
  const key=`retention:${rule.version}:${draft.id}:${draft.version}`
  if(await env.DB.prepare('SELECT 1 FROM lk_notifications WHERE event_key=? AND recipient_id=?').bind(key,owner.id).first())continue
  const c:Ctx={env,db:env.DB,now,commandId:crypto.randomUUID(),actor:{id:owner.id,name:owner.name,email:owner.email,role:'owner',sessionId:'',operatorVersion:owner.version}}
  const guard=crypto.randomUUID()
  try{await notificationBatch(env.DB,[guardSql(guard,[expiredDraftCheck(draft.id,draft.version,rule.version,now)]),...notificationWrites(c,{key,agreementId:draft.id,recipientId:owner.id,kind:'draft_retention'}),sql('DELETE FROM lk_guard WHERE id=?',guard)])}
  catch(error){if(!/LOCKET_GUARD|CHECK constraint/.test(String(error)))throw error}
 }
}
