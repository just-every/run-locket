import type { Bindings } from '../auth.server'
import { agreementAccessSql, roleSql, visibleSql } from './access'
import type { Ctx } from './commands'
import { canonical, fail, json, sha256, sql, type Actor, type Role, type Sql } from './model'
import { agreementGuards, visibleAgreement, type AgreementRow } from './records'
import { hiddenFields, policyVersionCheck, repositoryPolicy } from './repository-access'
import { requireFamilyClear } from './family-analysis-guard'

export type ReconciliationRow = {id:string;[key:string]:any}
export const reconciliationRoles: Role[] = ['owner','counsel','approver','requester','agent']
export const humanReconciliationRoles: Role[] = ['owner','counsel','approver','requester']
export const findingOwnerRoles: Role[] = ['owner','approver']
export const procurementDependency = 'Purse PO evidence unavailable: its published integration token only creates purchase requests and cannot read POs. No procurement evidence was inferred.'
const familySql = `WITH RECURSIVE family(id) AS (SELECT ? UNION SELECT a.id FROM lk_agreements a JOIN family f ON a.parent_id=f.id WHERE a.relation='amends')`
export async function familySources(c:Ctx,a:AgreementRow) {
 const rows=(await c.db.prepare(`${familySql} SELECT a.* FROM lk_agreements a JOIN family f ON f.id=a.id ORDER BY a.id`).bind(a.id).all<AgreementRow>()).results
 for(const row of rows)await visibleAgreement(c,row.id)
 return {rows,sources:rows.map(row=>({id:row.id,version:row.version})),checks:[...rows.flatMap(row=>agreementGuards(c,row)),sql(`(${familySql} SELECT count(*) FROM family)=?`,a.id,rows.length)]}
}
export async function sourceChecks(c:Ctx,agreementId:string,sources:string):Promise<Sql[]> {
 const a=await visibleAgreement(c,agreementId),family=await familySources(c,a)
 if(canonical(family.sources)!==canonical(JSON.parse(sources)))fail('STALE','The agreement or an amendment changed. Confirm the interpretation and read fresh bills before continuing.',409)
 return [...family.checks,await requireFamilyClear(c,agreementId)]
}
export async function participant(c:Ctx,id:string,roles:readonly Role[],agreementIds:string[]) {
 const person=await c.db.prepare(`SELECT id,version FROM oa_operators WHERE id=? AND status='active' AND ${roleSql} IN (SELECT value FROM json_each(?))`).bind(id,id,json(roles)).first<{id:string;version:number}>()
 if(!person||(await hiddenFields(c.db,{...c.actor,id})).length)fail('RECIPIENT','Each designated person needs an active permitted role, full field access and access to every agreement source.',409)
 const access=agreementAccessSql(id)
 const check=sql(`EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND version=?) AND ${roleSql} IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM lk_agreements a WHERE a.id IN (SELECT value FROM json_each(?)) AND NOT(${access.sql}))`,id,person.version,id,json(roles),json(agreementIds),...access.params)
 if(!(await c.db.prepare(`SELECT ${check.sql} AS ok`).bind(...check.params).first<{ok:number}>())?.ok)fail('RECIPIENT','A designated person cannot access all agreement sources.',409)
 return {person,check}
}
export async function settings(c:Ctx,agreementId:string) {
 const row=await c.db.prepare('SELECT * FROM lk_reconciliation_settings WHERE agreement_id=?').bind(agreementId).first<ReconciliationRow>()
 if(!row)fail('RECONCILIATION_SETTINGS','The owner must explicitly authorize reconciliation and designate counsel, finance and the finding owner.',409)
 return row
}
export async function finding(c:Ctx,id:unknown,expected:unknown) {
 if(typeof id!=='string')fail('INVALID','findingId is required.')
 const f=await c.db.prepare('SELECT * FROM lk_reconciliation_findings WHERE id=?').bind(id).first<ReconciliationRow>()
 if(!f)fail('NOT_FOUND','No accessible invoice finding has that identity.',404)
 await visibleAgreement(c,f.agreement_id)
 if(expected!==f.version)fail('STALE','This finding changed. Reload and review it again.',409)
 return f
}
export async function currentEvidence(c:Ctx,f:ReconciliationRow) {
 const scan=await c.db.prepare('SELECT * FROM lk_reconciliation_scans WHERE id=?').bind(f.scan_id).first<ReconciliationRow>()
 if(!scan)fail('STALE','The invoice snapshot is unavailable.',409)
 const s=await settings(c,f.agreement_id),checks=await sourceChecks(c,f.agreement_id,scan.sources)
 if(s.version!==scan.settings_version)fail('STALE','The owner configuration changed. Read and review a new invoice snapshot.',409)
 const link=await c.db.prepare('SELECT version FROM lk_accounting_links WHERE agreement_id=?').bind(f.agreement_id).first<{version:number}>()
 if(link?.version!==scan.link_version)fail('STALE','The accounting link changed. Read and review fresh bills.',409)
 const interpretation=await c.db.prepare('SELECT id FROM lk_reconciliation_interpretations WHERE agreement_id=? ORDER BY rowid DESC LIMIT 1').bind(f.agreement_id).first<{id:string}>()
 if(interpretation?.id!==scan.interpretation_id)fail('STALE','Counsel changed the interpretation. Read and review fresh bills.',409)
 const ids=JSON.parse(scan.sources).map((s:any)=>s.id)
 const counsel=await participant(c,s.counsel_id,['owner','counsel'],ids),finance=await participant(c,s.finance_id,['owner','approver'],ids),owner=await participant(c,s.owner_id,findingOwnerRoles,ids)
 return {scan,s,finance,checks:[...checks,counsel.check,finance.check,owner.check,policyVersionCheck((await repositoryPolicy(c.db)).version),sql('(SELECT version FROM lk_reconciliation_settings WHERE agreement_id=?)=?',f.agreement_id,s.version),sql('(SELECT version FROM lk_accounting_links WHERE agreement_id=?)=?',f.agreement_id,scan.link_version),sql('(SELECT id FROM lk_reconciliation_interpretations WHERE agreement_id=? ORDER BY rowid DESC LIMIT 1)=?',f.agreement_id,scan.interpretation_id),sql('(SELECT version FROM lk_reconciliation_findings WHERE id=?)=?',f.id,f.version)]}
}
export const messageDigest=(f:ReconciliationRow)=>sha256(canonical({finding:f.fingerprint,recipient:f.recipient,subject:f.subject,text:f.message_text}))

/** Retained snapshots are visible only while every included source remains visible. */
export async function reconciliationState(env:Bindings,actor:Actor) {
 const empty={reconciliationSettings:[],reconciliationInterpretations:[],reconciliationScans:[],reconciliationFindings:[],reconciliationDispatches:[]}
 if((await hiddenFields(env.DB,actor)).length)return empty
 const access=agreementAccessSql(actor.id),db=env.DB
 const scoped=async(table:string)=>(await db.prepare(`SELECT r.* FROM ${table} r JOIN lk_agreements a ON a.id=r.agreement_id WHERE ${access.sql} ORDER BY r.rowid DESC`).bind(...access.params).all<ReconciliationRow>()).results
 const canRead=async(r:ReconciliationRow)=>{
  const sources=JSON.parse(r.sources)
  for(const source of sources){const check=visibleSql(actor,source.id);if(!(await db.prepare(`SELECT ${check.sql} AS ok`).bind(...check.params).first<{ok:number}>())?.ok)return false}
  return true
 }
 const interpretations=[],scans=[]
 for(const r of await scoped('lk_reconciliation_interpretations'))if(await canRead(r))interpretations.push(r)
 for(const r of await scoped('lk_reconciliation_scans'))if(await canRead(r))scans.push(r)
 const scanIds=new Set(scans.map(r=>r.id)),findings=(await scoped('lk_reconciliation_findings')).filter(f=>scanIds.has(f.scan_id)),findingIds=new Set(findings.map(f=>f.id))
 return {reconciliationSettings:await scoped('lk_reconciliation_settings'),reconciliationInterpretations:interpretations,reconciliationScans:scans,reconciliationFindings:findings,reconciliationDispatches:(await scoped('lk_reconciliation_dispatches')).filter(d=>findingIds.has(d.finding_id))}
}

/** A cached mutation outcome is still a read under the actor's current grant. */
export async function authorizeReconciliationResult(c:Ctx,type:string,p:Record<string,unknown>,result:unknown) {
 const allowed=type==='reconciliation.configure'?['owner'] as Role[]:type==='reconciliation.interpret'?['owner','counsel'] as Role[]:type==='reconciliation.finance.confirm'?['owner','approver'] as Role[]:['reconciliation.scan','reconciliation.prepare'].includes(type)?reconciliationRoles:type==='reconciliation.reject'?humanReconciliationRoles:findingOwnerRoles
 const {requireRole}=await import('./access')
 requireRole(c.actor,allowed,'read an invoice command outcome')
 let agreementId=typeof p.agreementId==='string'?p.agreementId:null,sources:string|null=null
 if(typeof p.findingId==='string'){
  const row=await c.db.prepare('SELECT f.agreement_id,s.sources FROM lk_reconciliation_findings f JOIN lk_reconciliation_scans s ON s.id=f.scan_id WHERE f.id=?').bind(p.findingId).first<any>()
  agreementId=row?.agreement_id??agreementId;sources=row?.sources??null
 }
 const id=(result as {id?:unknown})?.id
 if(typeof id==='string'&&['reconciliation.scan','reconciliation.prepare'].includes(type)){
  const query=type==='reconciliation.scan'?'SELECT agreement_id,sources FROM lk_reconciliation_scans WHERE id=?':'SELECT f.agreement_id,s.sources FROM lk_reconciliation_findings f JOIN lk_reconciliation_scans s ON s.id=f.scan_id WHERE f.id=?'
  const row=await c.db.prepare(query).bind(id).first<any>()
  agreementId=row?.agreement_id??agreementId;sources=row?.sources??sources
 }
 if(agreementId)await visibleAgreement(c,agreementId)
 if(sources)for(const source of JSON.parse(sources))await visibleAgreement(c,source.id)
}
