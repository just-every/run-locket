import { authority, requireRole, visibleSql, agreementAccessSql } from './access'
import type { Ctx } from './commands'
import { customFields, fieldApplies, customFieldChecks } from './custom-fields'
import { customValueWrites } from './custom-values'
import { entityById } from './entities'
import { date, fail, json, money, oneOf, optionalText, sql, text, timezone, type Sql } from './model'
import type { AgreementRow } from './records'

export const bulkRoles = ['owner','counsel','approver','requester'] as const
import { standardBulkFields } from './repository-bulk-fields'
export { standardBulkFields } from './repository-bulk-fields'
export type BulkChanges = Record<string, unknown>
export interface BulkSnapshot {
 agreement: AgreementRow; values: BulkChanges; obligations: string; schedule: string
}
export interface BulkItem {
 operation_id:string; ordinal:number; agreement_id:string; snapshot:string; changes:string
 outcome:string; reason:string|null; applied_version:number|null
}
export interface BulkOperation {id:string;actor_id:string;status:string;version:number;created_at:number;updated_at:number;definitions:string;reverting:number;proposed_by:string|null;evidence:string;assumptions:string;decided_by:string|null}
export const same = (a:unknown,b:unknown) => JSON.stringify(a) === JSON.stringify(b)
/** A guarded batch has one JSON bind even when it validates many field and
 * record revisions. Values remain data; no value is interpolated as SQL. */
export function packedChecks(checks:Sql[]):Sql{
 const values:unknown[]=[]
 const clauses=checks.map(check=>{let i=0;return check.sql.replace(/\?/g,()=>{values.push(check.params[i++]);return `json_extract(bulk_checks.value,'$[${values.length-1}]')`})})
 return sql(`EXISTS(SELECT 1 FROM json_each(?) bulk_checks WHERE ${clauses.map(c=>'('+c+')').join(' AND ')})`,json([values]))
}
export const obligationsSql = "SELECT COALESCE(json_group_array(json_array(id,owner_id,status)),'[]') AS value FROM (SELECT id,owner_id,status FROM lk_obligations WHERE agreement_id=? AND status IN ('proposed','confirmed') ORDER BY id)"
export const scheduleSql = "SELECT COALESCE(json_group_array(json_array(id,owner_id,agreement_version,deadline_at,offsets,reminders)),'[]') AS value FROM (SELECT id,owner_id,agreement_version,deadline_at,offsets,reminders FROM lk_reminder_schedules WHERE agreement_id=? ORDER BY id)"
export async function dependencies(c:Ctx,id:string){
 const [obligations,schedule]=await Promise.all([obligationsSql,scheduleSql].map(q=>c.db.prepare(q).bind(id).first<{value:string}>()))
 return {obligations:obligations!.value,schedule:schedule!.value}
}
export function dependencyChecks(id:string,s:Pick<BulkSnapshot,'obligations'|'schedule'>):Sql[]{
 return [sql(`(${obligationsSql.replace(' AS value','')})=?`,id,s.obligations),sql(`(${scheduleSql.replace(' AS value','')})=?`,id,s.schedule)]
}
export async function snapshotRows(c:Ctx,agreements:AgreementRow[]):Promise<BulkSnapshot[]>{
 const ids=json(agreements.map(a=>a.id))
 const [custom,departments,groups,obligations,schedules]=await Promise.all([
  'SELECT agreement_id,field_id,value FROM lk_custom_values',
  'SELECT agreement_id,department_id FROM lk_agreement_departments',
  'SELECT agreement_id,audience_id FROM lk_agreement_groups ORDER BY audience_id',
  "SELECT agreement_id,id,owner_id,status FROM lk_obligations WHERE status IN ('proposed','confirmed') ORDER BY id",
  'SELECT agreement_id,id,owner_id,agreement_version,deadline_at,offsets,reminders FROM lk_reminder_schedules ORDER BY id',
 ].map(q=>c.db.prepare(`SELECT * FROM (${q}) WHERE agreement_id IN (SELECT value FROM json_each(?))`).bind(ids).all<any>()))
 const fields=await customFields(c.db)
 return agreements.map(a=>({agreement:a,values:{
  title:a.title,type:a.type,value:a.value_cents,needed_by:a.needed_by,start_date:a.start_date,timezone:a.timezone,
  entity:a.entity_id,owner:a.owner_id,restricted:!!a.restricted,
  department:departments.results.find(d=>d.agreement_id===a.id)?.department_id??null,
  groups:groups.results.filter(g=>g.agreement_id===a.id).map(g=>g.audience_id).sort(),
  ...Object.fromEntries(fields.filter(f=>fieldApplies(f,a.type)).map(f=>['custom:'+f.id,null])),
  ...Object.fromEntries(custom.results.filter(v=>v.agreement_id===a.id).map(v=>['custom:'+v.field_id,JSON.parse(v.value)])),
 },obligations:json(obligations.results.filter(o=>o.agreement_id===a.id).map(o=>[o.id,o.owner_id,o.status])),
 schedule:json(schedules.results.filter(o=>o.agreement_id===a.id).map(o=>[o.id,o.owner_id,o.agreement_version,o.deadline_at,o.offsets,o.reminders]))}))
}
export function diff(snapshot:BulkSnapshot,changes:BulkChanges){
 return Object.fromEntries(Object.entries(changes).filter(([field,value])=>!same(snapshot.values[field]??null,value)).map(([field,value])=>[field,{before:snapshot.values[field]??null,after:value}]))
}
/** Validation and SQL use the same typed custom-field implementation as edits. */
export async function bulkEdit(c:Ctx,a:AgreementRow,changes:BulkChanges,normalized=false){
 const checks:Sql[]=[],writes:Sql[]=[],values:BulkChanges={},custom:BulkChanges={}
 if(changes.owner!==undefined&&['type','department','groups','restricted'].some(f=>changes[f]!==undefined))fail('INVALID','Review ownership reassignment separately from type or access changes so the colleague’s resulting access can be checked.')
 const type=changes.type===undefined?a.type:oneOf(changes,'type',['customer','supplier','nda','amendment','order_form','other'] as const)
 for(const [field,raw] of Object.entries(changes)){
  if(field.startsWith('custom:')){custom[field.slice(7)]=raw;continue}
  if(!(standardBulkFields as readonly string[]).includes(field))fail('INVALID','Choose an editable standard or current custom field.')
  if(['department','restricted'].includes(field)){requireRole(c.actor,['owner'],`change ${field} access`);checks.push(authority(c.actor,['owner']))}
  if(field==='groups'){requireRole(c.actor,['owner','counsel'],'change group access');checks.push(authority(c.actor,['owner','counsel']))}
  if(field==='entity'){requireRole(c.actor,['owner','counsel'],'change the contracting entity');checks.push(authority(c.actor,['owner','counsel']))}
  let value:unknown=raw
  if(field==='title')value=text({value:raw},'value',300)
  if(field==='type')value=type
  if(field==='value')value=normalized?(raw===null?null:money({value:(Number(raw)/100).toFixed(2)},'value')):money({value:raw},'value')
  if(field==='needed_by'||field==='start_date')value=raw===null||raw===''?null:date({value:raw},'value')
  if(field==='timezone')value=timezone({value:raw},'value')
  if(field==='restricted'&&typeof raw!=='boolean')fail('INVALID','restricted must be true or false.')
  if(field==='entity'){
   if(a.status==='out_for_signature')fail('STATUS','Cannot change the contracting entity while out for signature.',409)
   value=optionalText({value:raw},'value',100)
   if(value){const e=await entityById(c,String(value));if(!e)fail('INVALID','Choose a current contracting entity.');checks.push(sql('(SELECT version FROM lk_entities WHERE id=?)=?',e.id,e.version))}
   else {if(await c.db.prepare('SELECT 1 FROM lk_entities LIMIT 1').first())fail('ENTITY_REQUIRED','Name one of our recorded contracting entities.');checks.push(sql('NOT EXISTS(SELECT 1 FROM lk_entities)'))}
  }
  if(field==='department'||field==='groups'){
   const ids=field==='groups'?(Array.isArray(raw)?raw:fail('INVALID','groups must be a list.')):raw===null||raw===''?[]:[raw]
   if(ids.length>100||new Set(ids).size!==ids.length)fail('INVALID','Choose distinct current audiences.')
   for(const id of ids){
    const row=await c.db.prepare('SELECT version FROM lk_intake_audiences WHERE id=? AND kind=?').bind(id,field==='department'?'department':'group').first<{version:number}>()
    if(!row)fail('INVALID',`Choose a current ${field==='groups'?'group':'department'}.`)
    checks.push(sql('(SELECT version FROM lk_intake_audiences WHERE id=?)=?',id,row.version))
   }
   value=field==='groups'?[...ids].sort():ids[0]??null
   const table=field==='groups'?'lk_agreement_groups':'lk_agreement_departments'
   writes.push(sql(`DELETE FROM ${table} WHERE agreement_id=?`,a.id))
   for(const id of ids)writes.push(sql(`INSERT INTO ${table} VALUES(?,?)`,a.id,id))
  }
  if(field==='owner'){
   value=text({value:raw},'value',100)
   const active=sql("EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND (o.role='owner' OR COALESCE((SELECT role FROM lk_roles WHERE operator_id=o.id),'viewer')<>'agent'))",value)
   if(!await c.db.prepare(`SELECT 1 WHERE ${active.sql}`).bind(...active.params).first())fail('INVALID','Choose an active human colleague.')
   checks.push(active)
   // Evaluate the recipient against the corrected record, including ownership of
   // restricted records. Policy/group membership still applies.
   const access=agreementAccessSql(String(value))
   const projected=sql(`EXISTS(SELECT 1 FROM (SELECT id,restricted,requester_id,? AS owner_id,? AS type FROM lk_agreements WHERE id=?) a WHERE ${access.sql})`,value,type,a.id,...access.params)
   if(!await c.db.prepare(`SELECT 1 WHERE ${projected.sql}`).bind(...projected.params).first())fail('INVALID','The new responsible person must be able to read this agreement.')
   checks.push(projected)
  }
  values[field]=value
 }
 // Money in the journal is integer cents; the native validator accepts dollars.
 if(normalized){const defs=await customFields(c.db);for(const [id,value] of Object.entries(custom))if(defs.find(f=>f.id===id)?.kind==='money'&&value!==null)custom[id]=(Number(value)/100).toFixed(2)}
 const metadata=await customValueWrites(c,a.id,type,custom,a.status)
 checks.push(...metadata.checks,authority(c.actor,metadata.allowed));writes.push(...metadata.writes)
 for(const id of Object.keys(custom))values['custom:'+id]=metadata.values[id]
 return {values,checks,writes,allowed:bulkRoles.filter(r=>metadata.allowed.includes(r))}
}
export function selectionCheck(c:Ctx,agreements:AgreementRow[]):Sql{
 const access=agreementAccessSql(c.actor.id)
 return sql(`NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN lk_agreements a ON a.id=json_extract(j.value,'$.id') WHERE a.id IS NULL OR a.version<>json_extract(j.value,'$.version') OR NOT(${access.sql}))`,json(agreements.map(a=>({id:a.id,version:a.version}))),...access.params)
}
export const readable = async(c:Ctx,id:string)=>{const check=visibleSql(c.actor,id);return !!await c.db.prepare(`SELECT 1 WHERE ${check.sql}`).bind(...check.params).first()}
