import type { Bindings } from '../auth.server'
import { may, requireRole, roleSql, visibleSql, visibleSetSql } from './access'
import { auditInsert } from './audit'
import { commit, type Ctx, type Handler } from './commands'
import { canReadServiceSources } from './service-level-records'
import { installationSettings } from './installation'
import { localMinute } from './report-schedule'
import { reportSnapshot } from './report-snapshot'
import { hiddenFields, policyVersionCheck, repositoryPolicy, requireFullFields } from './repository-access'
import { agreementGuards, bump, visibleAgreement } from './records'
import { fail, integer, json, list, object, oneOf, sql, text, type Actor } from './model'
import { buildOutcomeReport, type AccountingSelection } from './outcome-report-data'
import { outcomeMonth } from './outcome-report-model'

export const outcomeArchiveTables=['lk_outcome_report_settings','lk_outcome_report_deliveries']
export interface OutcomeSettings {id:string;recipients:string;accounting_links:string;enabled:number;consent_by:string;consent_operator_version:number;consent_at:number;next_month:string;version:number}
export const outcomeSettings=(db:D1Database)=>db.prepare("SELECT * FROM lk_outcome_report_settings WHERE id='installation'").first<OutcomeSettings>()
export const outcomeSettingsCheck=(version:number)=>sql("COALESCE((SELECT version FROM lk_outcome_report_settings WHERE id='installation'),0)=?",version)
export async function outcomePerson(db:D1Database,id:string):Promise<Actor|null>{
 const row=await db.prepare(`SELECT id,display_name,email,version,${roleSql} AS locket_role FROM oa_operators WHERE id=? AND status='active'`).bind(id,id).first<any>()
 return row?{id:row.id,name:row.display_name,email:row.email,role:row.locket_role,operatorVersion:row.version,sessionId:''}:null
}
export function outcomePersonCheck(actor:Actor){return sql(`EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND version=? AND email=?) AND ${roleSql}=?`,actor.id,actor.operatorVersion,actor.email,actor.id,actor.role)}
export async function outcomeReportState(env:Bindings,actor:Actor){
 const owner=actor.role==='owner'
 return {settings:owner?await outcomeSettings(env.DB):null,deliveries:(await env.DB.prepare(`SELECT id,month,recipient_id,status,provider_message_id,created_at FROM lk_outcome_report_deliveries ${owner?'':'WHERE recipient_id=?'} ORDER BY created_at DESC`).bind(...(owner?[]:[actor.id])).all()).results}
}
export async function outcomeReport(env:Bindings,actor:Actor,month:string){
 await requireFullFields(env.DB,actor)
 const settings=await outcomeSettings(env.DB),zone=(await installationSettings(env.DB)).timezone
 outcomeMonth(month)
 if(month>=localMinute(Date.now(),zone).slice(0,7))fail('INVALID','Choose a completed calendar month.')
 const policy=await repositoryPolicy(env.DB),out=await buildOutcomeReport(env,actor,month,JSON.parse(settings?.accounting_links??'[]'))
 const c:Ctx={env,db:env.DB,actor,now:Date.now(),commandId:crypto.randomUUID()}
 await commit(c,may.read,[outcomeSettingsCheck(settings?.version??0),policyVersionCheck(policy.version),...out.checks,reportSnapshot(actor,out.agreements),sql("COALESCE((SELECT version FROM lk_installation_settings WHERE id='installation'),0)=?",out.settingsVersion)],
  [auditInsert(c,[{action:'outcome-report.read',summary:`Read a twelve-month source-linked outcome report ending ${month}, narrowed to current agreement and field access.`},...out.agreements.filter(a=>a.restricted).map(a=>({action:'outcome-report.read',agreementId:a.id,summary:'Read restricted agreement evidence for a monthly outcome report.'}))])])
 return out.report
}
const configure:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'configure monthly outcome recipients')
 const version=integer(p,'version',0),prior=await outcomeSettings(c.db)
 if((prior?.version??0)!==version)fail('STALE','Monthly outcome settings changed. Reload.',409)
 if(p.consent!==true||typeof p.enabled!=='boolean')fail('CONSENT','Explicitly authorize the selected read-only sources, recipients and monthly generic-link mail schedule.')
 const recipients=list(p,'recipients',20).map(value=>text({value},'value',100))
 if(!recipients.length||new Set(recipients).size!==recipients.length)fail('INVALID','Choose distinct active recipients.')
 const checks=[outcomeSettingsCheck(version)]
 for(const id of recipients){const person=await outcomePerson(c.db,id);if(!person||!may.read.includes(person.role)||(await hiddenFields(c.db,person)).length)fail('RECIPIENT','Choose active recipients with full field access. Their current agreement access controls each report.',409);checks.push(outcomePersonCheck(person))}
 const accounting:AccountingSelection[]=[]
 for(const input of list(p,'accountingLinks',100)){const value=object(input),a=await visibleAgreement(c,text(value,'agreementId',100)),link=await c.db.prepare('SELECT * FROM lk_accounting_links WHERE agreement_id=?').bind(a.id).first<any>()
  if(!link||link.version!==integer(value,'version',1)||link.vendor_id!==text(value,'vendorId',40))fail('STALE','Select the current owner-authorized accounting link.',409)
  if(accounting.some(l=>l.agreementId===a.id||l.vendorId===link.vendor_id))fail('INVALID','Select distinct agreement and vendor links; vendor bills cannot be allocated across agreements.')
  accounting.push({agreementId:a.id,version:link.version,vendorId:link.vendor_id});checks.push(...agreementGuards(c,a),sql('(SELECT version FROM lk_accounting_links WHERE agreement_id=?)=?',a.id,link.version))
 }
 const zone=(await installationSettings(c.db)).timezone,nextMonth=localMinute(c.now,zone).slice(0,7)
 return {allowed:['owner'],result:{version:version+1},checks,writes:[sql(`INSERT INTO lk_outcome_report_settings VALUES('installation',?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET recipients=excluded.recipients,accounting_links=excluded.accounting_links,enabled=excluded.enabled,consent_by=excluded.consent_by,consent_operator_version=excluded.consent_operator_version,consent_at=excluded.consent_at,next_month=excluded.next_month,version=lk_outcome_report_settings.version+1`,json(recipients),json(accounting),Number(p.enabled),c.actor.id,c.actor.operatorVersion,c.now,nextMonth),sql("UPDATE lk_outcome_report_deliveries SET status='cancelled' WHERE status='queued'")],audit:[{action:'outcome-report.configure',summary:'Owner authorized selected exact read-only accounting links and active recipients for monthly generic-link mail. Each recipient’s report is generated under current access; approvals and sending never establish recovery.'}]}
}
const classify:Handler=async(c,p)=>{
 requireRole(c.actor,may.confirmTerms,'attribute an obligation side')
 const id=text(p,'obligationId',100),o=await c.db.prepare('SELECT * FROM lk_obligations WHERE id=?').bind(id).first<any>()
 if(!o)fail('NOT_FOUND','No accessible obligation.',404)
 const source=await c.db.prepare('SELECT sources FROM lk_service_level_claims WHERE obligation_id=? UNION ALL SELECT sources FROM lk_service_performance_claims WHERE obligation_id=?').bind(id,id).first<{sources:string}>()
 if(source&&!await canReadServiceSources(c.db,c.actor,source.sources))fail('NOT_FOUND','Some obligation sources are not currently accessible.',404)
 const a=await visibleAgreement(c,o.agreement_id),side=oneOf(p,'side',['ours','supplier','unclassified'] as const)
 if(p.confirmCitation!==true)fail('CONSENT','Confirm the responsible side against the obligation’s cited agreement text.')
 const reason=text(p,'reason',1000)
 return {allowed:may.confirmTerms,result:{id,agreementId:a.id},checks:[...agreementGuards(c,a,p),...(source?[visibleSetSql(c.actor,JSON.parse(source.sources).map((s:{id:string})=>s.id))]:[]),sql('EXISTS(SELECT 1 FROM lk_obligations WHERE id=? AND responsible_side=? AND citation=?)',id,o.responsible_side,o.citation)],writes:[sql('UPDATE lk_obligations SET responsible_side=? WHERE id=?',side,id),bump(c,a)],audit:[{action:'outcome-report.classify',agreementId:a.id,summary:`Person attributed the cited obligation to ${side}: ${reason}`}]}
}
export function outcomeDeliveryWrite(month:string,recipientId:string,settings:OutcomeSettings,now:number){return sql("INSERT INTO lk_outcome_report_deliveries(id,month,recipient_id,settings_version,status,created_at) VALUES(?,?,?,?,'queued',?) ON CONFLICT(month,recipient_id) DO NOTHING",crypto.randomUUID(),month,recipientId,settings.version,now)}
const deliver:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'send one monthly outcome link')
 const settings=await outcomeSettings(c.db),month=outcomeMonth(text(p,'month',7))
 if(!settings||settings.version!==integer(p,'version',1)||p.consent!==true)fail('CONSENT','Review the current recipients and explicitly authorize this month’s once-only generic report links.')
 const zone=(await installationSettings(c.db)).timezone
 if(month>=localMinute(c.now,zone).slice(0,7))fail('INVALID','Choose a completed calendar month.')
 return {allowed:['owner'],result:{month},checks:[outcomeSettingsCheck(settings.version)],writes:JSON.parse(settings.recipients).map((id:string)=>outcomeDeliveryWrite(month,id,settings,c.now)),audit:[{action:'outcome-report.deliver',summary:`Owner explicitly requested once-only generic outcome report links for ${month}. Mail contains no report data; provider acceptance does not confirm mailbox delivery.`}]}
}
export const outcomeReportHandlers:Record<string,Handler>={'outcome-report.configure':configure,'outcome-report.classify':classify,'outcome-report.deliver':deliver}
export async function authorizeOutcomeReportResult(c:Ctx,type:string,p:Record<string,unknown>){
 requireRole(c.actor,type==='outcome-report.classify'?may.confirmTerms:['owner'],'read monthly outcome command results')
 if(type==='outcome-report.classify'){const row=await c.db.prepare('SELECT agreement_id FROM lk_obligations WHERE id=?').bind(p.obligationId).first<{agreement_id:string}>();if(!row)fail('NOT_FOUND','The obligation is no longer available.',404);const access=visibleSql(c.actor,row.agreement_id);if(!(await c.db.prepare(`SELECT ${access.sql} AS ok`).bind(...access.params).first<{ok:number}>())?.ok)fail('NOT_FOUND','The obligation is no longer accessible.',404)}
}
