// A configured age produces an exact owner-approved deletion preview. No timer
// authorizes destruction: approval applies only the unchanged previewed drafts.
import { requireRole } from './access'
import type { Handler } from './commands'
import { draftDeletion } from './draft-erasure'
import { fail, integer, json, parse, sql, text, type Sql } from './model'
import { visibleAgreement } from './records'
const owner=['owner'] as const
const configure:Handler=async(c,p)=>{
 requireRole(c.actor,owner,'configure draft retention')
 const prior=await c.db.prepare("SELECT * FROM lk_retention_rules WHERE id='installation'").first<{version:number}>()
 const version=integer(p,'version',0),days=integer(p,'days',1,36500)
 if(version!==(prior?.version??0))fail('STALE','The retention rule changed. Reload before saving.',409)
 return{allowed:owner,result:{days,version:version+1},checks:[sql("COALESCE((SELECT version FROM lk_retention_rules WHERE id='installation'),0)=?",version)],writes:[sql("INSERT INTO lk_retention_rules VALUES('installation',?,?,?,?) ON CONFLICT(id) DO UPDATE SET days=excluded.days,updated_by=excluded.updated_by,updated_at=excluded.updated_at,version=excluded.version",days,c.actor.id,c.now,version+1)],audit:[{action:'retention.configure',summary:`Native unexecuted drafts expire after ${days} elapsed days. Each deletion requires a separate owner-approved preview.`}]}
}
const preview:Handler=async(c)=>{
 requireRole(c.actor,owner,'preview expired drafts')
 const rule=await c.db.prepare("SELECT * FROM lk_retention_rules WHERE id='installation'").first<any>()
 if(!rule)fail('RETENTION','Configure a draft retention period first.',409)
 const candidates=(await c.db.prepare("SELECT id,version,title FROM lk_agreements a WHERE status='draft' AND created_at<=? AND NOT EXISTS(SELECT 1 FROM lk_legal_holds WHERE agreement_id=a.id AND active=1) AND NOT EXISTS(SELECT 1 FROM lk_agreements child WHERE child.parent_id=a.id) ORDER BY created_at,id LIMIT 100").bind(c.now-rule.days*86400000).all()).results
 const id=crypto.randomUUID()
 return{allowed:owner,result:{id,candidates},checks:[sql("(SELECT version FROM lk_retention_rules WHERE id='installation')=?",rule.version)],writes:[sql('INSERT INTO lk_retention_previews VALUES(?,?,?,?,?,NULL)',id,c.actor.id,rule.version,json(candidates),c.now)],audit:[{action:'retention.preview',summary:`Previewed ${candidates.length} expired unheld native drafts; no data deleted.`}]}
}
const apply:Handler=async(c,p)=>{
 requireRole(c.actor,owner,'approve expired draft deletion')
 const id=text(p,'previewId',100),reason=text(p,'reason',1000)
 const preview=await c.db.prepare('SELECT * FROM lk_retention_previews WHERE id=? AND actor_id=?').bind(id,c.actor.id).first<any>()
 if(!preview||preview.applied_at)fail('STALE','Choose your unconsumed retention preview.',409)
 const candidates=parse<{id:string;version:number}[]>(preview.candidates),writes:Sql[]=[],checks:Sql[]=[sql("(SELECT version FROM lk_retention_rules WHERE id='installation')=?",preview.rule_version),sql('EXISTS(SELECT 1 FROM lk_retention_previews WHERE id=? AND actor_id=? AND applied_at IS NULL)',id,c.actor.id)]
 for(const item of candidates){
  const a=await visibleAgreement(c,item.id)
  if(a.version!==item.version)fail('STALE','A previewed draft changed. Preview again before deleting.',409)
  const deletion=await draftDeletion(c,a);writes.push(...deletion.writes);checks.push(...deletion.checks)
 }
 writes.push(sql('UPDATE lk_retention_previews SET applied_at=?,candidates=? WHERE id=?',c.now,json(candidates.map(({id,version})=>({id,version}))),id))
 return{allowed:owner,result:{id,deleted:candidates.length},writes,checks,audit:[{action:'retention.apply',summary:`Approved retention preview ${id}: ${candidates.length} expired drafts deleted. ${reason}`},...candidates.map(a=>({action:'draft.delete',agreementId:a.id,summary:`Expired native draft and files deleted under owner-approved retention preview ${id}. ${reason}`}))]}
}
export const retentionHandlers:Record<string,Handler>={'retention.configure':configure,'retention.preview':preview,'retention.apply':apply}
