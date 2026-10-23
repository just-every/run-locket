import type { Bindings } from '../auth.server'
import { agreementAccessSql, may, roleSql, visibleSql } from './access'
import type { Ctx } from './commands'
import { familyClear } from './family-analysis-guard'
import { fail, json, sql, type Actor, type Sql } from './model'
import { visibleAgreement } from './records'
import { hiddenFields, policyVersionCheck, repositoryPolicy } from './repository-access'

export type RemediationRow = {id:string;[key:string]:any}
export const remediationArchiveTables = ['lk_remediation_requirements','lk_remediation_requests','lk_remediation_occurrences','lk_remediation_evidence']
export async function remediationObligation(c:Ctx,id:unknown) {
 const o=await c.db.prepare('SELECT * FROM lk_obligations WHERE id=?').bind(id).first<RemediationRow>()
 if(!o)fail('NOT_FOUND','No such obligation.',404)
 const a=await visibleAgreement(c,o.agreement_id)
 if(o.status!=='confirmed')fail('STATUS','Remediation needs a confirmed open obligation.',409)
 return {o,a}
}
export async function remediationSource(c:Ctx,o:RemediationRow) {
 const a=await visibleAgreement(c,o.agreement_id)
 const party=await c.db.prepare('SELECT * FROM lk_parties WHERE id=? AND merged_into IS NULL').bind(a.party_id).first<RemediationRow>()
 const owner=await c.db.prepare('SELECT id,version,email FROM oa_operators WHERE id=? AND status=\'active\'').bind(o.owner_id).first<RemediationRow>()
 if(!party||!owner)fail('AUTHORITY','The current obligation owner and counterparty must be active.',409)
 const source={agreementId:a.id,versionId:a.current_version_id,partyId:a.party_id,partyVersion:party.version,ownerId:o.owner_id,ownerVersion:owner.version,dueDate:o.due_date,citation:o.citation,description:o.description}
 return {a,party,owner,source}
}
export function remediationChecks(source:any,obligationId:string):Sql[] {
 return [familyClear(source.agreementId),
 sql("EXISTS(SELECT 1 FROM lk_agreements WHERE id=? AND current_version_id IS ? AND party_id=? AND status IN ('executed','imported'))",source.agreementId,source.versionId,source.partyId),
 sql('EXISTS(SELECT 1 FROM lk_parties WHERE id=? AND version=? AND merged_into IS NULL)',source.partyId,source.partyVersion),
 sql("EXISTS(SELECT 1 FROM lk_obligations WHERE id=? AND agreement_id=? AND status='confirmed' AND owner_id=? AND due_date IS ? AND citation=? AND description=?)",obligationId,source.agreementId,source.ownerId,source.dueDate,source.citation,source.description),
 sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active')",source.ownerId,source.ownerVersion),
 sql(`${roleSql} IN (SELECT value FROM json_each(?))`,source.ownerId,json(may.review)),visibleSql({id:source.ownerId} as Actor,source.agreementId)]
}
export async function remediationRequirement(c:Ctx,id:unknown) {
 const r=await c.db.prepare('SELECT * FROM lk_remediation_requirements WHERE id=?').bind(id).first<RemediationRow>()
 if(!r||r.active!==1)fail('NOT_FOUND','No confirmed remediation requirement.',404)
 const {o,a}=await remediationObligation(c,r.obligation_id),source=JSON.parse(r.source)
 if((await hiddenFields(c.db,c.actor)).length||(await hiddenFields(c.db,{...c.actor,id:source.ownerId})).length)fail('FIELD_ACCESS','Remediation requires full access to the signed requirement and returned evidence.',403)
 const policy=await repositoryPolicy(c.db),checks=[policyVersionCheck(policy.version),...remediationChecks(source,o.id),sql('(SELECT active FROM lk_remediation_requirements WHERE id=?)=1',r.id)]
 for(const check of checks)if(!(await c.db.prepare(`SELECT (${check.sql}) AS ok`).bind(...check.params).first<{ok:number}>())?.ok)fail('STALE','Requirement source, contact or owner changed. Review the obligation before remediation.',409)
 return {r,o,a,source,checks}
}
export async function remediationRequest(c:Ctx,id:unknown) {
 const request=await c.db.prepare('SELECT * FROM lk_remediation_requests WHERE id=?').bind(id).first<RemediationRow>()
 if(!request)fail('NOT_FOUND','No remediation request.',404)
 const current=await remediationRequirement(c,request.requirement_id)
 const occurrences=(await c.db.prepare('SELECT * FROM lk_remediation_occurrences WHERE request_id=? ORDER BY send_at,id').bind(request.id).all<RemediationRow>()).results
 const source=JSON.parse(request.source),checks=[...current.checks,...remediationChecks(source,current.o.id)]
 const recipient=sql("(?='internal' AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND email=? AND status='active')) OR (?='supplier' AND EXISTS(SELECT 1 FROM lk_parties p,json_each(p.contacts) person WHERE p.id=? AND p.version=? AND p.merged_into IS NULL AND lower(json_extract(person.value,'$.email'))=lower(?)))",source.target,source.ownerId,request.recipient,source.target,source.partyId,source.partyVersion,request.recipient)
 checks.push(recipient)
 for(const check of checks)if(!(await c.db.prepare(`SELECT (${check.sql}) AS ok`).bind(...check.params).first<{ok:number}>())?.ok)fail('STALE','The approved request recipient or source changed.',409)
 return {...current,request,occurrences,checks}
}
/** Existing generic completion must not bypass a structured requirement. */
export async function remediationCompletionCheck(c:Ctx,obligationId:string) {
 if(await c.db.prepare('SELECT id FROM lk_remediation_requirements WHERE obligation_id=?').bind(obligationId).first())fail('REMEDIATION_REQUIRED','Submit evidence through remediation so every confirmed requirement is checked.',409)
 return sql('NOT EXISTS(SELECT 1 FROM lk_remediation_requirements WHERE obligation_id=?)',obligationId)
}
export async function remediationState(env:Bindings,actor:Actor) {
 const result:Record<string,RemediationRow[]>={requirements:[],requests:[],occurrences:[],evidence:[]}
 if((await hiddenFields(env.DB,actor)).length)return result
 const access=agreementAccessSql(actor.id)
 for(const [name,table] of [['requirements',remediationArchiveTables[0]],['requests',remediationArchiveTables[1]],['occurrences',remediationArchiveTables[2]],['evidence',remediationArchiveTables[3]]])result[name]=(await env.DB.prepare(`SELECT r.* FROM ${table} r JOIN lk_agreements a ON a.id=r.agreement_id WHERE ${access.sql}`).bind(...access.params).all<RemediationRow>()).results
 return result
}
