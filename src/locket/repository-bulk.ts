import { authority, may, requireRole, visibleSetSql } from './access'
import type { Ctx, Handler, AuditEntry } from './commands'
import { customFields, customFieldChecks } from './custom-fields'
import { fail, integer, json, list, object, Problem, sql, text, type Sql } from './model'
import { agreementGuards, bump, invalidateApprovals, statusAfterChange, visibleAgreement, type AgreementRow } from './records'
import { requireFullFields } from './repository-access'
import { repositoryResult } from './repository'
import { bulkCsvChanges } from './repository-bulk-csv'
import { bulkRoles, bulkEdit, dependencies, dependencyChecks, diff, readable, same, selectionCheck, snapshotRows, type BulkChanges, type BulkItem, type BulkOperation, type BulkSnapshot } from './repository-bulk-model'

export async function bulkOperation(c:Ctx,id:unknown):Promise<BulkOperation>{
 requireRole(c.actor,may.prepare,'read repository bulk work');await requireFullFields(c.db,c.actor)
 let op=await c.db.prepare('SELECT * FROM lk_repository_bulk WHERE id=? AND actor_id=?').bind(text({id},'id',100),c.actor.id).first<BulkOperation>()
 if(!op&&c.actor.role!=='agent')op=(await readableBulkProposal(c,text({id},'id',100)))?.op??null
 if(!op)fail('NOT_FOUND','No bulk operation you prepared has that identity.',404)
 if(c.actor.role==='agent'&&op.status!=='proposed'&&op.status!=='rejected')fail('FORBIDDEN','Agents prepare proposals; a person reviews and applies them.',403)
 return op
}
export async function bulkItems(c:Ctx,id:string){return (await c.db.prepare('SELECT * FROM lk_repository_bulk_items WHERE operation_id=? ORDER BY ordinal').bind(id).all<BulkItem>()).results}
const opGuard=(o:BulkOperation)=>sql('EXISTS(SELECT 1 FROM lk_repository_bulk WHERE id=? AND version=? AND status=?)',o.id,o.version,o.status)
const summary=(o:BulkOperation,items:BulkItem[])=>({operationId:o.id,status:o.status,version:o.version,total:items.length,changed:items.filter(i=>Object.keys(JSON.parse(i.changes)).length).length,applied:items.filter(i=>i.outcome==='applied').length,reverted:items.filter(i=>i.outcome==='reverted').length,skipped:items.filter(i=>i.outcome==='skipped'||i.outcome==='revert_skipped').length,pending:items.filter(i=>i.outcome==='pending'||i.outcome==='reverting').length})
export async function bulkOperationView(c:Ctx,id:unknown,offset=0){
 const op=await bulkOperation(c,id),items=await bulkItems(c,op.id),rows=[]
 for(const i of items.slice(offset,offset+50)){
  if(!await readable(c,i.agreement_id))continue
  const s:BulkSnapshot=JSON.parse(i.snapshot)
  rows.push({agreementId:i.agreement_id,reference:s.agreement.reference,title:s.agreement.title,outcome:i.outcome,reason:i.reason,diff:diff(s,JSON.parse(i.changes))})
 }
 return {...summary(op,items),rows,offset,...(op.proposed_by?{proposal:{preparedBy:op.proposed_by,decidedBy:op.decided_by,evidence:JSON.parse(op.evidence),assumptions:op.assumptions}}:{})}
}
async function selectedOutcome(c:Ctx,p:Record<string,unknown>,proposal=false){
 requireRole(c.actor,proposal?may.prepare:bulkRoles,'select agreements for bulk actions');await requireFullFields(c.db,c.actor)
 let ids:string[]
 if(p.agreementIds!==undefined){ids=list(p,'agreementIds',5000).map(id=>text({id},'id',100));if(new Set(ids).size!==ids.length)fail('INVALID','Choose distinct agreements.')}
 else{
  const params=new URLSearchParams()
  if(p.viewId!==undefined)params.set('viewId',text(p,'viewId',100))
  else params.set('definition',json(object(p.definition,'definition')))
  ids=(await repositoryResult(c.env,c.actor,params)).rows.map(r=>r.id)
 }
 if(!ids.length||ids.length>5000)fail('INVALID','Select between 1 and 5,000 agreements.')
 // One scoped query keeps a 5,000-record selection within D1's bind limit.
 const agreements=(await c.db.prepare('SELECT * FROM lk_agreements WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id').bind(json(ids)).all<AgreementRow>()).results
 const selection=selectionCheck(c,agreements)
 if(!await c.db.prepare(`SELECT 1 WHERE ${selection.sql}`).bind(...selection.params).first())fail('NOT_FOUND','No agreement you can access has that identity.',404)
 if(agreements.length!==ids.length)fail('NOT_FOUND','No agreement you can access has that identity.',404)
 const snapshots=await snapshotRows(c,agreements),id=crypto.randomUUID(),writes:Sql[]=[sql("INSERT INTO lk_repository_bulk(id,actor_id,status,version,created_at,updated_at) VALUES(?,?,'selected',1,?,?)",id,c.actor.id,c.now,c.now)]
 for(let start=0;start<snapshots.length;start+=50){const batch=snapshots.slice(start,start+50).map((s,n)=>({ordinal:start+n,id:s.agreement.id,snapshot:json(s)}));writes.push(sql(`INSERT INTO lk_repository_bulk_items(operation_id,ordinal,agreement_id,snapshot) SELECT ?,json_extract(value,'$.ordinal'),json_extract(value,'$.id'),json_extract(value,'$.snapshot') FROM json_each(?)`,id,json(batch)))}
 return {allowed:proposal?may.prepare:bulkRoles,result:{operationId:id,total:ids.length,status:'selected',version:1},writes,checks:[selectionCheck(c,agreements)],audit:[{action:'repository.bulk.select',summary:`Bulk operation ${id}: selected ${ids.length} agreements; no metadata changed.`}]}
}
const select:Handler=(c,p)=>selectedOutcome(c,p)
const propose:Handler=async(c,p)=>{
 const changes=object(p.changes,'changes')
 if(!Object.keys(changes).length)fail('INVALID','Propose at least one metadata change.')
 const evidence=list(p,'evidence',50).map(v=>text({v},'v',4000)),assumptions=typeof p.assumptions==='string'?p.assumptions.slice(0,4000):''
 if(!evidence.length)fail('INVALID','A bulk proposal states its evidence (where the corrections came from).')
 const out=await selectedOutcome(c,p,true),id=out.result.operationId
 out.writes.push(sql("UPDATE lk_repository_bulk SET status='proposed',proposed_by=?,evidence=?,assumptions=? WHERE id=?",c.actor.id,json(evidence),assumptions,id),sql("UPDATE lk_repository_bulk_items SET changes=?,outcome='reviewing' WHERE operation_id=?",json(changes),id))
 out.result.status='proposed';out.audit=[{action:'repository.bulk.propose',summary:`Bulk operation ${id}: proposed metadata updates for a person to review; no business records changed.`}]
 return out
}
export async function readableBulkProposal(c:Ctx,id:string){
 const op=await c.db.prepare("SELECT * FROM lk_repository_bulk WHERE id=? AND status='proposed'").bind(id).first<BulkOperation>()
 if(!op)return null
 const items=await bulkItems(c,op.id),check=visibleSetSql(c.actor,items.map(i=>i.agreement_id))
 if(!await c.db.prepare(`SELECT 1 WHERE ${check.sql}`).bind(...check.params).first())return null
 return {op,check}
}
const decideProposal:Handler=async(c,p)=>{
 requireRole(c.actor,bulkRoles,'decide a bulk proposal');await requireFullFields(c.db,c.actor)
 const proposal=await readableBulkProposal(c,text(p,'operationId',100))
 if(!proposal)fail('NOT_FOUND','No bulk proposal you can access has that identity.',404)
 if(p.decision!=='review'&&p.decision!=='reject')fail('INVALID','Choose review or reject.')
 const {op,check}=proposal,fields=await customFields(c.db),status=p.decision==='review'?'previewing':'rejected'
 if(op.proposed_by===c.actor.id&&c.actor.role!=='owner')fail('SELF_APPROVAL','Someone else must decide a proposal you prepared.',403)
 return {allowed:bulkRoles,result:{operationId:op.id,status},checks:[opGuard(op),check,...customFieldChecks(fields),...(op.proposed_by===c.actor.id?[authority(c.actor,['owner'])]:[])],writes:[sql('UPDATE lk_repository_bulk SET actor_id=?,status=?,version=version+1,definitions=?,updated_at=?,decided_by=?,decided_at=? WHERE id=?',c.actor.id,status,json(fields.map(f=>({id:f.id,version:f.version}))),c.now,c.actor.id,c.now,op.id)],audit:[{action:'repository.bulk.proposal.decide',summary:`Bulk operation ${op.id}: person ${p.decision==='review'?'accepted proposal for exact dry-run review':'rejected proposal'}; no business records changed.`}]}
}
const preview:Handler=async(c,p)=>{
 requireRole(c.actor,bulkRoles,'review bulk changes')
 const op=await bulkOperation(c,p.operationId)
 if(op.status!=='selected')fail('STATUS','Create a fresh selection before preparing another dry run.',409)
 const items=await bulkItems(c,op.id),fields=await customFields(c.db)
 const csv=p.csv===undefined?null:bulkCsvChanges(text(p,'csv',16*1024*1024),items,fields)
 if(csv&&p.changes!==undefined)fail('INVALID','Choose a CSV or bulk field changes.')
 const changes=csv?null:object(p.changes,'changes')
 if(changes&&!Object.keys(changes).length)fail('INVALID','Choose at least one field to change.')
 const updates=[],checks=[opGuard(op),...customFieldChecks(fields)]
 for(const item of items){
  const raw=csv?.get(item.agreement_id)??changes??{}
  updates.push({ordinal:item.ordinal,changes:json(raw),outcome:Object.keys(raw).length?'reviewing':'unchanged',reason:null})
 }
 const writes:Sql[]=[]
 for(let start=0;start<updates.length;start+=50)writes.push(sql(`UPDATE lk_repository_bulk_items SET changes=json_extract(j.value,'$.changes'),outcome=json_extract(j.value,'$.outcome'),reason=json_extract(j.value,'$.reason') FROM json_each(?) j WHERE operation_id=? AND ordinal=json_extract(j.value,'$.ordinal')`,json(updates.slice(start,start+50)),op.id))
 writes.push(sql("UPDATE lk_repository_bulk SET status='previewing',version=version+1,updated_at=?,definitions=? WHERE id=?",c.now,json(fields.map(f=>({id:f.id,version:f.version}))),op.id))
 return {allowed:bulkRoles,result:{operationId:op.id,status:'previewing',version:op.version+1,total:items.length,remaining:updates.filter(u=>u.outcome==='reviewing').length},checks,writes,audit:[{action:'repository.bulk.preview',summary:`Bulk operation ${op.id}: began exact dry-run review; no metadata changed.`}]}
}
const review:Handler=async(c,p)=>{
 requireRole(c.actor,bulkRoles,'review bulk changes')
 const op=await bulkOperation(c,p.operationId)
 if(op.status!=='previewing')fail('STATUS','This operation has no pending dry-run review.',409)
 const items=await bulkItems(c,op.id),batch=items.filter(i=>i.outcome==='reviewing').slice(0,10),fields=await customFields(c.db)
 const writes:Sql[]=[],checks=[opGuard(op),...customFieldChecks(fields)]
 for(const item of batch){
  const s:BulkSnapshot=JSON.parse(item.snapshot);let value:BulkChanges={},reason:string|null=null
  try{
   if(!await readable(c,item.agreement_id))fail('NOT_FOUND','Access changed after selection',404)
   if(json(fields.map(f=>({id:f.id,version:f.version})))!==op.definitions)fail('STALE','Custom field definitions changed after selection.',409)
   const normalized=await bulkEdit(c,s.agreement,JSON.parse(item.changes))
   value=Object.fromEntries(Object.entries(normalized.values).filter(([field,v])=>!same(s.values[field]??null,v)))
  }catch(e){if(!(e instanceof Problem))throw e;reason=e.message}
  writes.push(sql('UPDATE lk_repository_bulk_items SET changes=?,outcome=?,reason=? WHERE operation_id=? AND ordinal=?',json(value),reason?'skipped':Object.keys(value).length?'pending':'unchanged',reason,op.id,item.ordinal))
 }
 const remaining=items.filter(i=>i.outcome==='reviewing').length-batch.length,status=remaining?'previewing':'reviewed'
 writes.push(sql('UPDATE lk_repository_bulk SET status=?,version=version+1,updated_at=? WHERE id=?',status,c.now,op.id))
 return {allowed:bulkRoles,result:{operationId:op.id,status,remaining,version:op.version+1},checks,writes,audit:remaining?[]:[{action:'repository.bulk.reviewed',summary:`Bulk operation ${op.id}: exact dry-run review finished; no metadata changed.`}]}
}
const columns:Record<string,string>={title:'title',type:'type',value:'value_cents',needed_by:'needed_by',start_date:'start_date',timezone:'timezone',entity:'entity_id',owner:'owner_id',restricted:'restricted'}
function assignmentWrites(c:Ctx,a:AgreementRow,s:BulkSnapshot,values:BulkChanges,undo:boolean):Sql[]{
 if(values.owner===undefined||values.owner===a.owner_id)return []
 const writes:Sql[]=[]
 const obligations:unknown[][]=JSON.parse(s.obligations),schedules:unknown[][]=JSON.parse(s.schedule)
 // Only the departing person's open work follows the responsible person.
 for(const [id,owner] of obligations)if(owner===s.agreement.owner_id)writes.push(sql("UPDATE lk_obligations SET owner_id=? WHERE id=? AND status IN ('proposed','confirmed')",undo?owner:values.owner,id))
 for(const [id,owner] of schedules)if(owner===s.agreement.owner_id)writes.push(sql('UPDATE lk_reminder_schedules SET owner_id=?,agreement_version=? WHERE id=?',undo?owner:values.owner,a.version+1,id))
 return writes
}
const next:Handler=async(c,p)=>{
 requireRole(c.actor,bulkRoles,'apply bulk changes')
 const op=await bulkOperation(c,p.operationId),undo=!!op.reverting
 if(!['reviewed','applying','reverting'].includes(op.status))fail('STATUS','This operation has no pending reviewed changes.',409)
 const items=await bulkItems(c,op.id),pending=items.filter(i=>i.outcome===(undo?'reverting':'pending')).slice(0,10)
 const writes:Sql[]=[],checks:Sql[]=[opGuard(op)],audit:AuditEntry[]=[],definitions=json((await customFields(c.db)).map(f=>({id:f.id,version:f.version})))
 for(const item of pending){
  const s:BulkSnapshot=JSON.parse(item.snapshot),forward:BulkChanges=JSON.parse(item.changes)
  const changes=undo?Object.fromEntries(Object.keys(forward).map(f=>[f,s.values[f]??null])):forward
  let reason:string|null=null,a:AgreementRow|null=null
  try{
   a=await visibleAgreement(c,item.agreement_id)
   if(!undo&&a.version!==s.agreement.version)fail('STALE','Record changed after selection.',409)
   // Undo restores only this operation's fields. Later unrelated edits survive;
   // a later correction to one of these fields is a conflict and stays intact.
   if(undo){const current=(await snapshotRows(c,[a]))[0];if(Object.entries(forward).some(([field,value])=>!same(current.values[field]??null,value)))fail('STALE','A changed field was edited again after this operation.',409)}
   if(definitions!==op.definitions)fail('STALE','Custom field definitions changed after review.',409)
   const dep=await dependencies(c,a.id)
   if(changes.owner!==undefined){
    const expected=undo?{
     obligations:json(JSON.parse(s.obligations).map((o:unknown[])=>[o[0],o[1]===s.agreement.owner_id?forward.owner:o[1],o[2]])),
     schedule:json(JSON.parse(s.schedule).map((o:unknown[])=>[o[0],o[1]===s.agreement.owner_id?forward.owner:o[1],o[1]===s.agreement.owner_id?item.applied_version:o[2],...o.slice(3)])),
    }:s
    if(dep.obligations!==expected.obligations||dep.schedule!==expected.schedule)fail('STALE','Open obligations or reminders changed after selection.',409)
    checks.push(...dependencyChecks(a.id,dep))
   }
   const edit=await bulkEdit(c,a,changes,true)
   const fields=Object.keys(edit.values).filter(f=>columns[f])
   const assignments=fields.map(f=>`${columns[f]}=?`),values=fields.map(f=>f==='restricted'?Number(edit.values[f]):edit.values[f])
   checks.push(...agreementGuards(c,a),...edit.checks)
   writes.push(...edit.writes,...assignmentWrites(c,a,s,edit.values,undo),invalidateApprovals(c,a.id,`Bulk operation ${op.id} ${undo?'reverted':'changed'} metadata`),bump(c,a,[...assignments,'status=?'].join(','),...values,statusAfterChange(a)))
   writes.push(sql('UPDATE lk_repository_bulk_items SET outcome=?,applied_version=? WHERE operation_id=? AND ordinal=?',undo?'reverted':'applied',a.version+1,op.id,item.ordinal))
   audit.push({action:undo?'repository.bulk.revert':'repository.bulk.apply',agreementId:a.id,summary:`Bulk operation ${op.id}: ${undo?'restored prior values':'applied reviewed changes'} ${json(diff(undo?{...s,values:{...s.values,...forward}}:s,edit.values))}${changes.owner!==undefined?'; departing owner’s open obligations and reminders reassigned':''}.`})
  }catch(e){if(!(e instanceof Problem))throw e;reason=e.code==='NOT_FOUND'?'Access changed after selection':e.message}
  if(reason){
   writes.push(sql('UPDATE lk_repository_bulk_items SET outcome=?,reason=? WHERE operation_id=? AND ordinal=?',undo?'revert_skipped':'skipped',reason,op.id,item.ordinal))
   audit.push({action:'repository.bulk.skip',agreementId:a?.id??null,summary:`Bulk operation ${op.id}: skipped record ${item.agreement_id}: ${reason}`})
  }
 }
 const remaining=items.filter(i=>i.outcome===(undo?'reverting':'pending')).length-pending.length,status=remaining?undo?'reverting':'applying':undo?'reverted':'done'
 writes.push(sql('UPDATE lk_repository_bulk SET status=?,version=version+1,updated_at=? WHERE id=?',status,c.now,op.id))
 return {allowed:bulkRoles,result:{operationId:op.id,status,remaining,processed:pending.length,version:op.version+1},checks,writes,audit}
}
const revert:Handler=async(c,p)=>{
 requireRole(c.actor,bulkRoles,'revert bulk changes')
 const op=await bulkOperation(c,p.operationId)
 if(op.status!=='done'||op.reverting)fail('STATUS','Only a completed operation can be reverted once.',409)
 return {allowed:bulkRoles,result:{operationId:op.id,status:'reverting'},checks:[opGuard(op)],writes:[sql("UPDATE lk_repository_bulk SET status='reverting',reverting=1,version=version+1,updated_at=? WHERE id=?",c.now,op.id),sql("UPDATE lk_repository_bulk_items SET outcome='reverting' WHERE operation_id=? AND outcome='applied'",op.id)],audit:[{action:'repository.bulk.revert.start',summary:`Bulk operation ${op.id}: requested restoration of prior values; history remains.`}]}
}
export const repositoryBulkHandlers:Record<string,Handler>={'repository.bulk.select':select,'repository.bulk.propose':propose,'repository.bulk.proposal.decide':decideProposal,'repository.bulk.preview':preview,'repository.bulk.review':review,'repository.bulk.next':next,'repository.bulk.revert':revert}

/** Replays may return identifiers/counts only. Never cache document or diff bodies
 * in command results; all detailed reads recheck current authority and custody. */
export async function authorizeRepositoryBulkResult(c:Ctx,result:unknown){
 requireRole(c.actor,may.prepare,'read repository bulk work');await requireFullFields(c.db,c.actor)
 const id=(result as {operationId?:string})?.operationId
 if(id)await bulkOperation(c,id)
}
