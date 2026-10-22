import { deadline, termLabel } from './display'
import { refuseErasedAddress } from './erasure-addresses'
import { citation } from './obligations'
import type { Bindings } from '../auth.server'
import { agreementAccessSql, fullReaders, may, requireRole, roleSql } from './access'
import { PDF, encodeBase64, readArtifactBytes, storeArtifact } from './artifacts'
import { accountingSpend } from './accounting'
import { agreementHandlers } from './agreements'
import { auditSql, guardSql, type Ctx, type Handler, type Outcome } from './commands'
import { lifecycle, localDate } from './lifecycle'
import { installationSettings } from './installation'
import { canonical, fail, integer, json, sha256, sql, text, type Actor } from './model'
import { notificationBatch, notificationWrites } from './notifications'
import { textPdf } from './pdf'
import { agreementGuards, visibleAgreement, type AgreementRow } from './records'
import { hiddenFields, policyVersionCheck, repositoryPolicy } from './repository-access'

type Row={id:string;[key:string]:any}
const rows=async(db:D1Database,query:string,...args:unknown[])=>(await db.prepare(query).bind(...args).all<Row>()).results
export async function canReadBrief(db:D1Database,actor:Actor,b:{sources:string}) {
 const access=agreementAccessSql(actor.id)
 const ids=JSON.parse(b.sources).map((s:any)=>s.id)
 const found=await db.prepare(`SELECT count(*) AS n FROM lk_agreements a WHERE a.id IN (SELECT value FROM json_each(?)) AND (${access.sql})`).bind(json(ids),...access.params).first<{n:number}>()
 return found?.n===ids.length
}
const configure:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'configure renewal briefs')
 const a=await visibleAgreement(c,p.agreementId),lead=integer(p,'leadDays',1,3650),maker=text(p,'decisionMakerId',100)
 const check=sql(`EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active') AND ${roleSql} IN ('owner','approver')`,maker,maker)
 if(!(await c.db.prepare(`SELECT ${check.sql} AS ok`).bind(...check.params).first<{ok:number}>())?.ok||(await hiddenFields(c.db,{...c.actor,id:maker,role:maker===c.actor.id?'owner':'approver'})).length)fail('INVALID','Choose an active owner or approver with full field access.')
 const access=agreementAccessSql(maker)
 if(!await c.db.prepare(`SELECT id FROM lk_agreements a WHERE a.id=? AND (${access.sql})`).bind(a.id,...access.params).first())fail('RECIPIENT','The decision-maker needs current agreement access.',409)
 return {allowed:may.manageRoles,result:{agreementId:a.id},checks:[...agreementGuards(c,a,p),check],writes:[sql('INSERT INTO lk_renewal_brief_settings VALUES(?,?,?,?,1,NULL) ON CONFLICT(agreement_id) DO UPDATE SET lead_days=excluded.lead_days,decision_maker_id=excluded.decision_maker_id,configured_by=excluded.configured_by,version=lk_renewal_brief_settings.version+1,last_error=NULL',a.id,lead,maker,c.actor.id)],audit:[{action:'renewal.brief.configure',agreementId:a.id,summary:`Configured renewal brief ${lead} days before the current notice deadline for a named decision-maker.`}]}
}
export async function prepareBrief(c:Ctx,agreementId:unknown):Promise<Outcome> {
 const a=await visibleAgreement(c,agreementId)
 const setting=await c.db.prepare('SELECT * FROM lk_renewal_brief_settings WHERE agreement_id=?').bind(a.id).first<any>()
 if(!setting)fail('BRIEF_SETTINGS','Configure the lead time and decision-maker first.',409)
 if((await hiddenFields(c.db,{...c.actor,id:setting.decision_maker_id})).length)fail('FIELD_ACCESS','The decision-maker needs full field access to the brief.',403)
 const access=agreementAccessSql(setting.decision_maker_id)
 const maker=await c.db.prepare(`SELECT o.id,o.version FROM oa_operators o WHERE o.id=? AND o.status='active' AND ${roleSql} IN ('owner','approver') AND EXISTS(SELECT 1 FROM lk_agreements a WHERE a.id=? AND (${access.sql}))`).bind(setting.decision_maker_id,setting.decision_maker_id,a.id,...access.params).first<any>()
 if(!maker)fail('RECIPIENT','The decision-maker no longer has approval authority or access.',409)
 const policy=await repositoryPolicy(c.db)
 const terms=await rows(c.db,'SELECT * FROM lk_terms'),renewals=await rows(c.db,'SELECT * FROM lk_renewals'),notices=await rows(c.db,'SELECT * FROM lk_notices')
 const current=lifecycle(a,terms,renewals,notices,c.now,(await installationSettings(c.db)).rollNoticeDeadlines),r=renewals.find(r=>r.agreement_id===a.id)
 if(!r||!current.deadline)fail('NO_DEADLINE','Confirm an active agreement’s current end, renewal and notice terms first.',409)
 if(c.now<current.deadline.at-setting.lead_days*86400000)fail('NOT_DUE','The configured renewal-brief lead time has not arrived.',409)
 const family=await rows(c.db,`SELECT a.* FROM lk_agreements a WHERE (a.id=? OR (a.parent_id=? AND a.relation='amends')) AND (${access.sql}) ORDER BY a.created_at,a.id`,a.id,a.id,...access.params)
 const ids=family.map(a=>a.id),sources=family.map(a=>({id:a.id,version:a.version})),marks=ids.map(()=>'?').join(',')
 const confirmed=terms.filter(t=>ids.includes(t.agreement_id)&&t.status==='confirmed')
 const link=await c.db.prepare('SELECT * FROM lk_accounting_links WHERE agreement_id=?').bind(a.id).first<any>()
 const sourceDigest=await sha256(canonical({sources,setting:setting.version,deadline:current.deadline.at,link:link?.version??0}))
 const prior=await c.db.prepare('SELECT id FROM lk_renewal_briefs WHERE renewal_id=? AND deadline_at=? AND source_digest=?').bind(r.id,current.deadline.at,sourceDigest).first<any>()
 if(prior)return {allowed:may.renewalDecision,result:{id:prior.id},writes:[],audit:[]}
 const since=confirmed.find(t=>t.agreement_id===a.id&&t.key==='effective_date')?.value??a.start_date??localDate(a.created_at,a.timezone)
 const spend=link?await accountingSpend(c.env,link.vendor_id,since,localDate(c.now,a.timezone)):null
 const caps=await rows(c.db,`SELECT * FROM lk_price_caps WHERE agreement_id IN (${marks})`,...ids)
 const obligations=await rows(c.db,`SELECT * FROM lk_obligations WHERE agreement_id IN (${marks}) ORDER BY created_at`,...ids)
 const serviceLevels=await rows(c.db,`SELECT * FROM lk_workflow_service_levels WHERE agreement_id IN (${marks})`,...ids)
 const issues=await rows(c.db,`SELECT id,agreement_id,version_id,body,quote,at FROM lk_comments WHERE agreement_id IN (${marks}) AND parent_id IS NULL AND resolved_at IS NULL ORDER BY at`,...ids)
 const deviations=await rows(c.db,`SELECT * FROM lk_deviations WHERE agreement_id IN (${marks}) AND result IN ('breached','undetermined')`,...ids)
 const content={agreementId:a.id,timezone:a.timezone,title:a.title,reference:a.reference,current,deadline:current.deadline.at,decisionMakerId:maker.id,settingsVersion:setting.version,terms:confirmed,caps,amendments:family.filter(f=>f.id!==a.id).map(f=>({id:f.id,reference:f.reference,title:f.title})),spend,obligations,serviceLevels,issues,deviations,options:['renew','renegotiate','terminate'].map(decision=>({decision,deadline:current.deadline!.at})),preparedAt:c.now}
 const id=crypto.randomUUID(),body=briefText(content)
 const artifact=await storeArtifact({filename:`renewal-brief-${a.reference}.pdf`,mediaType:PDF,bytes:textPdf('Renewal brief',body,'Snapshot for a person’s decision; no notice has been sent.')},{agreementId:a.id,role:'attachment',actorId:c.actor.id,at:c.now,provenance:{kind:'renewal_brief',briefId:id,sources,sourceDigest}})
 const makerAccess=agreementAccessSql(maker.id)
 return {allowed:may.renewalDecision,result:{id,artifactId:artifact.id},checks:[policyVersionCheck(policy.version),...family.flatMap(a=>agreementGuards(c,a as AgreementRow)),sql('(SELECT version FROM lk_renewal_brief_settings WHERE agreement_id=?)=?',a.id,setting.version),sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active') AND "+roleSql+" IN ('owner','approver')",maker.id,maker.version,maker.id),sql(`NOT EXISTS(SELECT 1 FROM lk_agreements a WHERE a.id IN (SELECT value FROM json_each(?)) AND NOT(${makerAccess.sql}))`,json(ids),...makerAccess.params),...(link?[sql('(SELECT version FROM lk_accounting_links WHERE agreement_id=?)=?',a.id,link.version)]:[])],writes:[...artifact.writes,sql('INSERT INTO lk_renewal_briefs VALUES(?,?,?,?,?,?,?,?,?,NULL)',id,a.id,r.id,current.deadline.at,sourceDigest,json(sources),json(content),artifact.id,c.now),sql('UPDATE lk_renewal_brief_settings SET last_error=NULL WHERE agreement_id=?',a.id),...notificationWrites(c,{key:id,agreementId:a.id,recipientId:maker.id,kind:'deadline'})],audit:[{action:'renewal.brief.prepare',agreementId:a.id,summary:'Prepared a cited current-term renewal brief and its immutable PDF; spend is a dated accounting snapshot when linked.'}]}
}
export function briefText(b:any):string {
 const term=(t:any)=>`${termLabel[t.key]??t.key.replaceAll('_',' ')}: ${t.value}; ${t.agreement_id}; ${JSON.parse(t.citation).quote}`
 return [`${b.reference}: ${b.title}`,`Snapshot ${new Date(b.preparedAt).toISOString()}`,`Current term ${b.current.start??'not recorded'} to ${b.current.end}; notice deadline ${new Date(b.deadline).toISOString()}`,'Confirmed terms and citations:',...b.terms.map(term),'Price-increase caps:',...b.caps.map((cap:any)=>`${cap.value}; ${cap.agreement_id}; ${JSON.parse(cap.citation).quote}`),'Amendments:',...b.amendments.map((a:any)=>`${a.reference}: ${a.title}`),b.spend?`Spend to date: $${(b.spend.totalCents/100).toFixed(2)} USD; ${b.spend.provider}; ${b.spend.since} through ${b.spend.through}. ${b.spend.basis}`:'Spend unavailable: no accounting vendor linked.',...(b.spend?.bills??[]).map((i:any)=>`Bill ${i.id} ${i.date}: $${(i.totalCents/100).toFixed(2)} USD; outstanding $${(i.balanceCents/100).toFixed(2)}`),'Obligation history:',...b.obligations.map((o:any)=>`${o.description}: ${o.status}; due ${o.due_date}; ${o.evidence_note??''}`),'Service-level history:',...b.serviceLevels.map((s:any)=>`Service level ${s.generation}: ${s.outcome??'open'}; started ${deadline(s.started_at,b.timezone)}; due ${deadline(s.due_at,b.timezone)}${s.closed_at?'; closed '+deadline(s.closed_at,b.timezone):''}.`),'Open issues:',...b.issues.map((i:any)=>`${i.body}; ${i.quote??''}`),...b.deviations.map((d:any)=>`${d.clause_key}: ${d.result}; ${d.explanation}; source: ${d.quote}`),'Options:',...b.options.map((o:any)=>`${o.decision}: decide before ${new Date(o.deadline).toISOString()}`),'No automatic decision, notice, or supplier contact.'].join('\n')
}
const prepare:Handler=async(c,p)=>{requireRole(c.actor,may.renewalDecision,'prepare renewal briefs');return prepareBrief(c,p.agreementId)}
const open:Handler=async(c,p)=>{
 requireRole(c.actor,may.renewalDecision,'open a renewal workflow')
 const b=await c.db.prepare('SELECT * FROM lk_renewal_briefs WHERE id=?').bind(text(p,'briefId',100)).first<any>()
 if(!b||!await canReadBrief(c.db,c.actor,b))fail('NOT_FOUND','No accessible renewal brief has that identity.',404)
 const a=await visibleAgreement(c,b.agreement_id),snapshot=JSON.parse(b.content)
 if(c.actor.role!=='owner'&&c.actor.id!==snapshot.decisionMakerId)fail('FORBIDDEN','The named decision-maker or owner chooses the renewal option.',403)
 if(b.request_id)fail('ALREADY_OPEN','This brief already has a linked renewal request.',409)
 const setting=await c.db.prepare('SELECT version FROM lk_renewal_brief_settings WHERE agreement_id=?').bind(a.id).first<any>()
 if(setting?.version!==snapshot.settingsVersion)fail('STALE','The renewal configuration changed. Prepare a new brief.',409)
 const sources=JSON.parse(b.sources),checks=[]
 for(const source of sources){const current=await visibleAgreement(c,source.id);if(current.version!==source.version)fail('STALE','A source changed. Prepare and review a new brief.',409);checks.push(...agreementGuards(c,current))}
 const decision=text(p,'decision',20)
 if(!['renew','renegotiate'].includes(decision))fail('INVALID','Only renew or renegotiate opens a renewal request. Record terminate separately.')
 const payload={...p,agreementId:undefined,title:text(p,'title',200),type:a.type,partyId:a.party_id,entityId:a.entity_id??undefined,currency:'USD',value:a.value_cents===null?undefined:(a.value_cents/100).toFixed(2),restricted:Boolean(a.restricted),parentId:a.id,relation:'renews',timezone:a.timezone}
 const bytes=await readArtifactBytes(c.db,b.artifact_id)
 checks.push(...await refuseErasedAddress(c,'request.create',{...payload,renewalBrief:snapshot,briefFile:{base64:encodeBase64(bytes)}}))
 const out=await agreementHandlers['request.create'](c,payload)
 const result=out.result as {id:string;reference:string}
 const attached=await storeArtifact({filename:`renewal-brief-${a.reference}.pdf`,mediaType:PDF,bytes},{agreementId:result.id,role:'attachment',actorId:c.actor.id,at:c.now,provenance:{kind:'renewal_brief',briefId:b.id,sourceAgreementId:a.id,sources}})
 return {...out,result:{...result,briefId:b.id},checks:[...(out.checks??[]),...checks,sql('(SELECT request_id FROM lk_renewal_briefs WHERE id=?) IS NULL',b.id),sql('(SELECT version FROM lk_renewal_brief_settings WHERE agreement_id=?)=?',a.id,setting.version)],writes:[...out.writes,sql("UPDATE lk_agreements SET relation='renews' WHERE id=?",result.id),sql('INSERT INTO lk_agreement_groups SELECT ?,audience_id FROM lk_agreement_groups WHERE agreement_id=?',result.id,a.id),...attached.writes,sql('UPDATE lk_renewal_briefs SET request_id=? WHERE id=?',result.id,b.id),sql('UPDATE lk_renewals SET decision=?,decided_by=?,decided_at=?,decision_reason=? WHERE id=?',decision,c.actor.id,c.now,'Opened linked renewal workflow from reviewed brief',b.renewal_id)],audit:[...out.audit,{action:'renewal.workflow.open',agreementId:a.id,summary:`Chose ${decision}; opened ${result.reference} through the current intake form with an exact copy of the renewal brief.`}]}
}
const cap:Handler=async(c,p)=>{
 requireRole(c.actor,may.confirmTerms,'confirm a cited price-increase cap')
 const a=await visibleAgreement(c,p.agreementId)
 if(!['executed','imported'].includes(a.status))fail('NOT_EXECUTED','Confirm the cap against an executed or imported agreement.',409)
 const value=text(p,'value',2000),cite=await citation(c,a,p.citation)
 return {allowed:may.confirmTerms,result:{agreementId:a.id},checks:agreementGuards(c,a,p),writes:[sql('INSERT INTO lk_price_caps VALUES(?,?,?,?,?,?) ON CONFLICT(agreement_id) DO UPDATE SET value=excluded.value,citation=excluded.citation,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at',a.id,a.id,value,json(cite),c.actor.id,c.now),sql('UPDATE lk_agreements SET version=version+1,updated_at=? WHERE id=?',c.now,a.id)],audit:[{action:'renewal.cap.confirm',agreementId:a.id,summary:'Person confirmed a price-increase cap with its exact executed-document citation.'}]}
}
export const renewalBriefHandlers={'renewal.cap.confirm':cap,'renewal.brief.configure':configure,'renewal.brief.prepare':prepare,'renewal.workflow.open':open}
export async function runRenewalBriefs(env:Bindings,now:number) {
 const owner=await env.DB.prepare("SELECT id,display_name AS name,email,version FROM oa_operators WHERE role='owner' AND status='active' LIMIT 1").first<any>()
 if(!owner)return
 const actor:Actor={...owner,role:'owner',sessionId:'',operatorVersion:owner.version}
 const configured=await rows(env.DB,'SELECT s.agreement_id AS id FROM lk_renewal_brief_settings s WHERE NOT EXISTS(SELECT 1 FROM lk_renewal_briefs b WHERE b.agreement_id=s.agreement_id AND b.request_id IS NOT NULL)')
 for(const item of configured){
  const c:Ctx={env,db:env.DB,now,commandId:crypto.randomUUID(),actor}
  try {
   const out=await prepareBrief(c,item.id)
   if(!out.writes.length)continue
   const guard=crypto.randomUUID()
   await notificationBatch(env.DB,[guardSql(guard,[sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND role='owner' AND status='active')",owner.id,owner.version),...(out.checks??[])]),...out.writes,...out.audit.map(a=>auditSql(c,a,'scheduler')),sql('DELETE FROM lk_guard WHERE id=?',guard)])
  }catch(error){if((error as {code?:string}).code==='NOT_DUE')continue;if(/UNIQUE constraint|LOCKET_GUARD|CHECK constraint/.test(String(error)))continue;await env.DB.prepare('UPDATE lk_renewal_brief_settings SET last_error=? WHERE agreement_id=?').bind('Brief not prepared ('+((error as {code?:string}).code??'SERVER')+'): confirm current terms, decision-maker access and the accounting connection; retry is safe.',item.id).run()}
 }
}
