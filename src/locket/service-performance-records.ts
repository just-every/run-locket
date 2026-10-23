import type { Ctx } from './commands'
import { canonical,fail,sha256,sql } from './model'
import { visibleAgreement,type AgreementRow } from './records'
import { policyVersionCheck,repositoryPolicy } from './repository-access'
import { servicePeople,servicePerson,serviceSources,type ServiceRow } from './service-level-records'
import { linenOrigin } from './service-ticket-evidence'
import type { PerformanceConfig } from './service-performance-evidence'

export async function performanceTerm(c:Ctx,a:AgreementRow,termId:unknown) {
 if(a.type!=='supplier'||!['executed','imported'].includes(a.status))fail('NOT_EXECUTED','Performance claims require an executed or imported supplier agreement.',409)
 const term=typeof termId==='string'?await c.db.prepare('SELECT * FROM lk_service_performance_terms WHERE id=? AND agreement_id=?').bind(termId,a.id).first<ServiceRow>():null
 if(!term)fail('SLA_TERMS','Counsel must confirm an exact current performance commitment first.',409)
 const latest=await c.db.prepare('SELECT id FROM lk_service_performance_terms WHERE agreement_id=? AND metric=? ORDER BY rowid DESC LIMIT 1').bind(a.id,term.metric).first<{id:string}>(),family=await serviceSources(c,a)
 if(latest?.id!==term.id||canonical(JSON.parse(term.sources))!==canonical(family.sources))fail('STALE','The performance formula, agreement or amendment changed. Confirm current sources before continuing.',409)
 const ids=family.sources.map(s=>s.id),counsel=await servicePerson(c,term.confirmed_by,['counsel'],ids),owner=await servicePerson(c,a.owner_id,servicePeople,ids)
 return {term,config:JSON.parse(term.config) as PerformanceConfig,owner,checks:[...family.checks,counsel.check,owner.check,policyVersionCheck((await repositoryPolicy(c.db)).version),sql('(SELECT id FROM lk_service_performance_terms WHERE agreement_id=? AND metric=? ORDER BY rowid DESC LIMIT 1)=?',a.id,term.metric,term.id)]}
}
export async function performanceClaim(c:Ctx,id:string,version:unknown) {
 const claim=await c.db.prepare('SELECT * FROM lk_service_performance_claims WHERE id=?').bind(id).first<ServiceRow>()
 if(!claim)fail('NOT_FOUND','No accessible service-credit claim has that identity.',404)
 const a=await visibleAgreement(c,claim.agreement_id)
 if(claim.version!==version)fail('STALE','This claim changed. Review the current exact amount and message.',409)
 const read=await c.db.prepare('SELECT * FROM lk_service_performance_reports WHERE id=?').bind(claim.read_id).first<ServiceRow>()
 if(!read)fail('STALE','The original performance report is unavailable.',409)
 const current=await performanceTerm(c,a,read.term_id)
 if(read.source_kind==='linen'){const connection=JSON.parse(read.connection);if(!c.env.LINEN_MCP_TOKEN||connection.origin!==linenOrigin(c.env.LINEN_ORIGIN)||connection.credentialDigest!==await sha256(c.env.LINEN_MCP_TOKEN))fail('STALE','The authorized Linen evidence connection changed. Authorize current evidence before acting.',409)}
 if(a.owner_id!==claim.owner_id||read.consent_by!==a.owner_id||read.consent_operator_version!==current.owner.person.version)fail('AUTHORITY','The assigned agreement owner or its report consent changed. Authorize current evidence before acting.',409)
 if(c.now>=claim.deadline_at)fail('CLAIM_CLOSED','The counsel-confirmed claim deadline passed. No supplier contact is authorized.',409)
 return {claim,a,read,...current,kind:'performance' as const,claimTable:'lk_service_performance_claims' as const,dispatchTable:'lk_service_performance_dispatches' as const,link:null,checks:[...current.checks,sql('(SELECT version FROM lk_service_performance_claims WHERE id=?)=?',claim.id,claim.version)]}
}
