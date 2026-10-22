import type { Bindings } from '../auth.server'
import { agreementAccessSql,requireRole,roleSql,visibleSql } from './access'
import type { Ctx } from './commands'
import { requireFamilyClear } from './family-analysis-guard'
import { canonical,fail,json,sha256,sql,type Actor,type Role } from './model'
import { agreementGuards,visibleAgreement,type AgreementRow } from './records'
import { hiddenFields,policyVersionCheck,repositoryPolicy } from './repository-access'

export type ServiceRow={id:string;[key:string]:any}
export const serviceReaders:Role[]=['owner','counsel','approver','requester','agent']
export const servicePeople:Role[]=['owner','approver']
const familySql=`WITH RECURSIVE family(id) AS (SELECT ? UNION SELECT a.id FROM lk_agreements a JOIN family f ON a.parent_id=f.id WHERE a.relation='amends')`
export async function serviceSources(c:Ctx,a:AgreementRow) {
 const rows=(await c.db.prepare(`${familySql} SELECT a.* FROM lk_agreements a JOIN family f ON f.id=a.id ORDER BY a.id`).bind(a.id).all<AgreementRow>()).results
 for(const row of rows)await visibleAgreement(c,row.id)
 return {rows,sources:rows.map(r=>({id:r.id,version:r.version})),checks:[...rows.flatMap(r=>agreementGuards(c,r)),sql(`(${familySql} SELECT count(*) FROM family)=?`,a.id,rows.length),await requireFamilyClear(c,a.id)]}
}
export async function servicePerson(c:Ctx,id:string,roles:Role[],ids:string[]) {
 const person=await c.db.prepare(`SELECT id,version FROM oa_operators WHERE id=? AND status='active' AND ${roleSql} IN (SELECT value FROM json_each(?))`).bind(id,id,json(roles)).first<{id:string;version:number}>()
 if(!person||(await hiddenFields(c.db,{...c.actor,id})).length)fail('AUTHORITY','Counsel and the agreement owner need current roles and full access to every source.',403)
 const access=agreementAccessSql(id),check=sql(`EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active') AND ${roleSql} IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM lk_agreements a WHERE a.id IN (SELECT value FROM json_each(?)) AND NOT(${access.sql}))`,id,person.version,id,json(roles),json(ids),...access.params)
 if(!(await c.db.prepare(`SELECT ${check.sql} AS ok`).bind(...check.params).first<{ok:number}>())?.ok)fail('AUTHORITY','A claim decision-maker cannot access all source agreements.',403)
 return {person,check}
}
export async function serviceLink(c:Ctx,agreementId:string) {
 const link=await c.db.prepare('SELECT * FROM lk_service_level_links WHERE agreement_id=?').bind(agreementId).first<ServiceRow>()
 if(!link)fail('UPTIME_CONSENT','The installation owner must authorize this exact Uptime installation and monitor first.',409)
 return link
}
export async function serviceTerm(c:Ctx,a:AgreementRow,expected?:string) {
 if(!['executed','imported'].includes(a.status))fail('NOT_EXECUTED','Service claims require a currently executed or imported agreement.',409)
 const link=await serviceLink(c,a.id),term=await c.db.prepare('SELECT * FROM lk_service_level_terms WHERE agreement_id=? ORDER BY rowid DESC LIMIT 1').bind(a.id).first<ServiceRow>()
 if(!term)fail('SLA_TERMS','Counsel must confirm the signed monthly SLA and credit formula first.',409)
 const family=await serviceSources(c,a)
 if((expected&&term.id!==expected)||term.link_version!==link.version||canonical(JSON.parse(term.sources))!==canonical(family.sources))fail('STALE','The SLA, installation consent, agreement or amendment changed. Counsel must confirm current sources before reading or claiming.',409)
 const ids=family.sources.map(s=>s.id),counsel=await servicePerson(c,term.confirmed_by,['counsel'],ids),owner=await servicePerson(c,a.owner_id,servicePeople,ids)
 return {term,link,owner,checks:[...family.checks,counsel.check,owner.check,policyVersionCheck((await repositoryPolicy(c.db)).version),sql('(SELECT version FROM lk_service_level_links WHERE agreement_id=?)=?',a.id,link.version),sql('(SELECT id FROM lk_service_level_terms WHERE agreement_id=? ORDER BY rowid DESC LIMIT 1)=?',a.id,term.id)]}
}
export async function serviceClaim(c:Ctx,id:unknown,version:unknown) {
 if(typeof id!=='string')fail('INVALID','claimId is required.')
 const claim=await c.db.prepare('SELECT * FROM lk_service_level_claims WHERE id=?').bind(id).first<ServiceRow>()
 if(!claim)fail('NOT_FOUND','No accessible service-credit claim has that identity.',404)
 const a=await visibleAgreement(c,claim.agreement_id)
 if(claim.version!==version)fail('STALE','This claim changed. Reload and review its exact amount and message.',409)
 const read=await c.db.prepare('SELECT * FROM lk_service_level_reads WHERE id=?').bind(claim.read_id).first<ServiceRow>()
 if(!read)fail('STALE','The original monitoring evidence is unavailable.',409)
 const current=await serviceTerm(c,a,read.term_id)
 if(a.owner_id!==claim.owner_id)fail('STALE','The agreement owner changed. Review the current sources.',409)
 if(c.now>=claim.deadline_at)fail('CLAIM_CLOSED','The counsel-confirmed claim deadline has passed. No supplier email is authorized.',409)
 return {claim,a,read,...current,checks:[...current.checks,sql('(SELECT version FROM lk_service_level_claims WHERE id=?)=?',claim.id,claim.version)]}
}
export const serviceMessageDigest=(c:ServiceRow)=>sha256(canonical({claim:c.fingerprint,amountCents:c.amount_cents,deadlineAt:c.deadline_at,recipient:c.recipient,subject:c.subject,message:c.message_text}))
export async function canReadServiceSources(db:D1Database,actor:Actor,sources:string) {
 for(const source of JSON.parse(sources)){const check=visibleSql(actor,source.id);if(!(await db.prepare(`SELECT ${check.sql} AS ok`).bind(...check.params).first<{ok:number}>())?.ok)return false}
 return true
}
export async function serviceLevelState(env:Bindings,actor:Actor) {
 const empty={links:[],terms:[],reads:[],claims:[],breaches:[],dispatches:[]}
 if((await hiddenFields(env.DB,actor)).length)return empty
 const access=agreementAccessSql(actor.id),scoped=async(table:string)=>(await env.DB.prepare(`SELECT r.* FROM ${table} r JOIN lk_agreements a ON a.id=r.agreement_id WHERE ${access.sql} ORDER BY r.rowid DESC`).bind(...access.params).all<ServiceRow>()).results
 const terms=[],reads=[],claims=[]
 for(const row of await scoped('lk_service_level_terms'))if(await canReadServiceSources(env.DB,actor,row.sources))terms.push(row)
 for(const row of await scoped('lk_service_level_reads'))if(await canReadServiceSources(env.DB,actor,row.sources))reads.push(row)
 for(const row of await scoped('lk_service_level_claims'))if(await canReadServiceSources(env.DB,actor,row.sources))claims.push(row)
 const ids=new Set(claims.map(c=>c.id))
 return {links:await scoped('lk_service_level_links'),terms,reads,claims,breaches:(await scoped('lk_service_level_breaches')).filter(b=>ids.has(b.claim_id)),dispatches:(await scoped('lk_service_level_dispatches')).filter(d=>ids.has(d.claim_id))}
}
export async function authorizeServiceResult(c:Ctx,type:string,p:Record<string,unknown>,result:unknown) {
 requireRole(c.actor,type==='service-level.link'?['owner']:type==='service-level.confirm'?['counsel']:['service-level.message','service-level.approve','service-level.email'].includes(type)?servicePeople:serviceReaders,'read service-level command outcomes')
 let agreementId=typeof p.agreementId==='string'?p.agreementId:null,sources:string|null=null
 if(typeof p.claimId==='string'){const row=await c.db.prepare('SELECT agreement_id,sources FROM lk_service_level_claims WHERE id=?').bind(p.claimId).first<ServiceRow>();agreementId=row?.agreement_id??agreementId;sources=row?.sources??null}
 if(type==='service-level.read'&&typeof(result as {id?:unknown})?.id==='string'){const row=await c.db.prepare('SELECT agreement_id,sources FROM lk_service_level_reads WHERE id=?').bind((result as {id:string}).id).first<ServiceRow>();agreementId=row?.agreement_id??agreementId;sources=row?.sources??sources}
 if(agreementId){await visibleAgreement(c,agreementId);const term=await c.db.prepare('SELECT sources FROM lk_service_level_terms WHERE agreement_id=? ORDER BY rowid DESC LIMIT 1').bind(agreementId).first<{sources:string}>();sources??=term?.sources??null}
 if(sources&&!await canReadServiceSources(c.db,c.actor,sources))fail('NOT_FOUND','Some sources are no longer accessible.',404)
}
