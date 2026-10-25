import type {Bindings} from '../auth.server'
import {may,requireRole,roleSql,visibleSql} from './access'
import {commercialCheck,requireCommercial} from './approval-reminders'
import {auditSql,guardSql,type Ctx,type Handler} from './commands'
import {fail,integer,json,list,money,object,oneOf,optionalText,sql,text,type Actor,type Sql} from './model'
import {agreementGuards,bump,currentVersion,invalidateApprovals,requireStatus,statusAfterChange,visibleAgreement,type AgreementRow} from './records'
import {notificationCheck,notificationWrites} from './notifications'
import {decisionContext,routing,type Requirement} from './review'
import {addBusinessDays} from './business-days'
import {repositoryPolicy,policyVersionCheck,hiddenFields} from './repository-access'

const commercialSetCheck=(ids:string[])=>sql(`NOT EXISTS(SELECT 1 FROM json_each(?) selected LEFT JOIN oa_operators o ON o.id=selected.value WHERE o.id IS NULL OR o.status<>'active' OR (CASE WHEN o.role='owner' THEN 'owner' ELSE COALESCE((SELECT r.role FROM lk_roles r WHERE r.operator_id=o.id),'viewer') END) NOT IN ('owner','approver'))`,JSON.stringify([...new Set(ids)]))

export interface ApprovalRule {id:string;name:string;approverId:string;escalationId:string|null;order:number;when:{type:string|null;minimumCents:number|null;departmentId:string|null;risk:string|null;dataProcessing:boolean|null;findingKey:string|null}}
interface Sample {type:string;valueCents:number|null;departmentId:string;risk:string;dataProcessing:boolean;findingKeys:string[]}
const match=(r:ApprovalRule,s:Sample)=> (!r.when.type||r.when.type===s.type)&&(r.when.minimumCents===null||s.valueCents!==null&&s.valueCents>=r.when.minimumCents)&&(!r.when.departmentId||r.when.departmentId===s.departmentId)&&(!r.when.risk||r.when.risk===s.risk)&&(r.when.dataProcessing===null||r.when.dataProcessing===s.dataProcessing)&&(!r.when.findingKey||s.findingKeys.includes(r.when.findingKey))
export const matchingRules=(rules:ApprovalRule[],sample:Sample)=>rules.filter(r=>match(r,sample)).sort((a,b)=>a.order-b.order)
export async function ruleDraft(db:D1Database){return db.prepare("SELECT * FROM lk_approval_rule_drafts WHERE id='installation'").first<any>()}
export async function approvalSample(db:D1Database,a:AgreementRow):Promise<Sample>{
 const form=await db.prepare('SELECT answers FROM lk_request_forms WHERE agreement_id=?').bind(a.id).first<{answers:string}>(),answers=form?JSON.parse(form.answers):{}
 const input=await db.prepare('SELECT * FROM lk_approval_inputs WHERE agreement_id=?').bind(a.id).first<any>()
 const department=await db.prepare('SELECT department_id FROM lk_agreement_departments WHERE agreement_id=?').bind(a.id).first<{department_id:string}>()
 const findings=(await db.prepare("SELECT clause_key FROM lk_deviations WHERE version_id=? AND result<>'met'").bind(a.current_version_id).all<{clause_key:string}>()).results
 return {type:a.type,valueCents:a.value_cents,departmentId:form?(answers.department??''):(department?.department_id??''),risk:form?String(answers.risk??'unknown').toLowerCase():(input?.risk??'unknown'),dataProcessing:form?(answers.data_processing===true||String(answers.data_processing).toLowerCase()==='yes'):!!input?.data_processing,findingKeys:findings.map(f=>f.clause_key)}
}
export async function ruleSetFor(db:D1Database,agreementId:string){
 return db.prepare(`SELECT v.* FROM lk_approval_rule_versions v WHERE v.id=CASE WHEN EXISTS(SELECT 1 FROM lk_approval_rule_snapshots WHERE agreement_id=?) THEN (SELECT ruleset_id FROM lk_approval_rule_snapshots WHERE agreement_id=?) ELSE (SELECT published_id FROM lk_approval_rule_drafts WHERE id='installation') END`).bind(agreementId,agreementId).first<any>()
}
export async function ruleRequirements(db:D1Database,a:AgreementRow):Promise<Requirement[]>{
 const version=await ruleSetFor(db,a.id);if(!version)return []
 const rules=matchingRules(JSON.parse(version.definition),await approvalSample(db,a)),steps:Requirement[]=[]
 for(const rule of rules){
  if((await hiddenFields(db,{...scheduler,id:rule.approverId,role:'approver'})).length)continue
  const away=await db.prepare('SELECT * FROM lk_approval_absences WHERE operator_id=?').bind(rule.approverId).first<any>()
  const reminderDelegate=await db.prepare('SELECT delegate_id FROM lk_reminder_routing WHERE operator_id=?').bind(rule.approverId).first<{delegate_id:string|null}>()
  steps.push({kind:'commercial',deviationId:'rule:'+rule.id,label:rule.name,roles:['owner','approver'],approverId:rule.approverId,delegateId:away?.away?away.delegate_id:null,away:!!away?.away,absenceVersion:away?.version??0,order:rule.order,escalationId:rule.escalationId,escalationDelegateId:away?.delegate_id??reminderDelegate?.delegate_id??null,rulesetId:version.id})
 }
 return steps
}
export async function captureRuleSet(c:Ctx,a:Pick<AgreementRow,'id'>){
 const prior=await c.db.prepare('SELECT 1 FROM lk_approval_rule_snapshots WHERE agreement_id=?').bind(a.id).first()
 if(prior)return {writes:[] as Sql[],checks:[] as Sql[]}
 const draft=await ruleDraft(c.db)
 return {checks:[sql("(SELECT published_id FROM lk_approval_rule_drafts WHERE id='installation') IS ?",draft?.published_id??null)],writes:[sql('INSERT INTO lk_approval_rule_snapshots VALUES(?,?,?)',a.id,draft?.published_id??null,c.now)]}
}
const save:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'design approval rules')
 const prior=await ruleDraft(c.db),version=integer(p,'version',0)
 if(version!==(prior?.version??0))fail('STALE','Approval rule draft changed. Reload.',409)
 const checks:Sql[]=[sql("COALESCE((SELECT version FROM lk_approval_rule_drafts WHERE id='installation'),0)=?",version)]
 const commercialIds:string[]=[],departments:{id:string;version:number}[]=[]
 const rules:ApprovalRule[]=[]
 for(const value of list(p,'rules',50)){
  const r=object(value),when=object(r.when??{}),approverId=text(r,'approverId',100),escalationId=optionalText(r,'escalationId',100)
  await requireCommercial(c.db,approverId,'approverId');commercialIds.push(approverId)
  if(escalationId){await requireCommercial(c.db,escalationId,'escalationId');commercialIds.push(escalationId)}
  const departmentId=optionalText(when,'departmentId',100)
  if(departmentId){const d=await c.db.prepare("SELECT version FROM lk_intake_audiences WHERE id=? AND kind='department'").bind(departmentId).first<{version:number}>();if(!d)fail('INVALID','Choose a current department.');departments.push({id:departmentId,version:d.version})}
  if(when.dataProcessing!==undefined&&when.dataProcessing!==null&&typeof when.dataProcessing!=='boolean')fail('INVALID','dataProcessing must be true, false or null.')
  rules.push({id:r.id===undefined?crypto.randomUUID():text(r,'id',100),name:text(r,'name',160),approverId,escalationId,order:integer(r,'order',1,50),when:{type:when.type?oneOf(when,'type',['customer','supplier','nda','amendment','order_form','other'] as const):null,minimumCents:money(when,'minimumValue'),departmentId,risk:when.risk?oneOf(when,'risk',['low','medium','high','unknown'] as const):null,dataProcessing:typeof when.dataProcessing==='boolean'?when.dataProcessing:null,findingKey:optionalText(when,'findingKey',100)}})
 }
 checks.push(commercialSetCheck(commercialIds),sql(`NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN lk_intake_audiences d ON d.id=json_extract(expected.value,'$.id') WHERE d.id IS NULL OR d.kind<>'department' OR d.version<>json_extract(expected.value,'$.version'))`,JSON.stringify(departments)))
 if(new Set(rules.map(r=>r.id)).size!==rules.length)fail('INVALID','Rule identities must be distinct.')
 return {allowed:may.manageRoles,result:{version:version+1},checks,writes:[sql("INSERT INTO lk_approval_rule_drafts VALUES('installation',?,1,NULL,NULL) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition,version=lk_approval_rule_drafts.version+1,previewed_version=NULL",json(rules))],audit:[{action:'approval.rules.save',summary:'Saved an owner approval-rule draft; publication unchanged.'}]}
}
const preview:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'preview approval rules')
 const draft=await ruleDraft(c.db),version=integer(p,'version',1)
 if(!draft||draft.version!==version)fail('STALE','Reload the current approval-rule draft.',409)
 const input=object(p.sample)
 if(typeof input.dataProcessing!=='boolean')fail('INVALID','Sample dataProcessing must be true or false.')
 const sample:Sample={type:oneOf(input,'type',['customer','supplier','nda','amendment','order_form','other'] as const),valueCents:money(input,'value'),departmentId:optionalText(input,'departmentId',100)??'',risk:oneOf(input,'risk',['low','medium','high','unknown'] as const),dataProcessing:input.dataProcessing===true,findingKeys:list(input,'findingKeys',50).map(v=>text({v},'v',100))}
 const result=matchingRules(JSON.parse(draft.definition),sample)
 return {allowed:may.manageRoles,result:{steps:result.map(r=>({id:r.id,name:r.name,approverId:r.approverId,order:r.order}))},checks:[sql("(SELECT version FROM lk_approval_rule_drafts WHERE id='installation')=?",version)],writes:[sql("UPDATE lk_approval_rule_drafts SET previewed_version=? WHERE id='installation'",version)],audit:[{action:'approval.rules.preview',summary:'Previewed the current draft against explicit sample answers.'}]}
}
const publish:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'publish approval rules')
 const draft=await ruleDraft(c.db),version=integer(p,'version',1)
 if(!draft||draft.version!==version)fail('STALE','Reload the current approval-rule draft.',409)
 if(draft.previewed_version!==version)fail('PREVIEW','Preview this revision before publishing.',409)
 const id=crypto.randomUUID(),number=(await c.db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM lk_approval_rule_versions').first<{n:number}>())!.n
 const rules=JSON.parse(draft.definition) as ApprovalRule[]
 return {allowed:may.manageRoles,result:{id,number},checks:[sql("EXISTS(SELECT 1 FROM lk_approval_rule_drafts WHERE id='installation' AND version=? AND previewed_version=?)",version,version),commercialSetCheck(rules.flatMap(r=>[r.approverId,...(r.escalationId?[r.escalationId]:[])]))],writes:[sql('INSERT INTO lk_approval_rule_versions VALUES(?,?,?,?,?)',id,number,draft.definition,c.actor.id,c.now),sql("UPDATE lk_approval_rule_drafts SET published_id=? WHERE id='installation'",id)],audit:[{action:'approval.rules.publish',summary:`Published immutable approval rules v${number}; existing requests retain their captured version.`}]}
}
const inputs:Handler=async(c,p)=>{
 requireRole(c.actor,may.intake,'record approval routing answers')
 const a=await visibleAgreement(c,p.agreementId);requireStatus(a,['draft','in_review','approved'],'change routing answers')
 if(await c.db.prepare('SELECT 1 FROM lk_request_forms WHERE agreement_id=?').bind(a.id).first())fail('FORM_ROUTE','Approval routing answers are retained from the published request form and cannot be overridden.',409)
 const risk=oneOf(p,'risk',['low','medium','high','unknown'] as const)
 if(typeof p.dataProcessing!=='boolean')fail('INVALID','Record whether data processing applies.')
 return {allowed:may.intake,result:{id:a.id},checks:[...agreementGuards(c,a,p),sql('NOT EXISTS(SELECT 1 FROM lk_request_forms WHERE agreement_id=?)',a.id)],writes:[sql('INSERT INTO lk_approval_inputs VALUES(?,?,?,?,?) ON CONFLICT(agreement_id) DO UPDATE SET risk=excluded.risk,data_processing=excluded.data_processing,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at',a.id,risk,Number(p.dataProcessing),c.actor.id,c.now),invalidateApprovals(c,a.id,'Approval routing answers changed'),bump(c,a,'status=?',statusAfterChange(a))],audit:[{action:'approval.inputs',agreementId:a.id,summary:'A person recorded approval routing answers; earlier approvals were withdrawn.'}]}
}
const availability:Handler=async(c,p)=>{
 requireRole(c.actor,may.commercialApproval,'record approval availability')
 const id=p.operatorId?text(p,'operatorId',100):c.actor.id
 if(id!==c.actor.id&&c.actor.role!=='owner')fail('FORBIDDEN','Only the owner changes another approver’s availability.',403)
 await requireCommercial(c.db,id,'operatorId')
 if(typeof p.away!=='boolean')fail('INVALID','away must be true or false.')
 const delegate=optionalText(p,'delegateId',100)
 if(delegate){if(delegate===id)fail('INVALID','Choose another approver as delegate.');await requireCommercial(c.db,delegate,'delegateId')}
 const prior=await c.db.prepare('SELECT version FROM lk_approval_absences WHERE operator_id=?').bind(id).first<{version:number}>(),version=integer(p,'version',0)
 if((prior?.version??0)!==version)fail('STALE','Availability changed. Reload.',409)
 return {allowed:may.commercialApproval,result:{id,version:version+1},checks:[...(id!==c.actor.id?[sql(`(${roleSql})='owner'`,c.actor.id)]:[]),commercialCheck(id),...(delegate?[commercialCheck(delegate)]:[]),sql('COALESCE((SELECT version FROM lk_approval_absences WHERE operator_id=?),0)=?',id,version)],writes:[sql('INSERT INTO lk_approval_absences VALUES(?,?,?,1,?,?) ON CONFLICT(operator_id) DO UPDATE SET away=excluded.away,delegate_id=excluded.delegate_id,version=lk_approval_absences.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at',id,Number(p.away),delegate,c.actor.id,c.now)],audit:[{action:'approval.availability',summary:'Recorded attributed approver availability and a named delegate; no agreement access was granted.'}]}
}
export const approvalRuleHandlers:Record<string,Handler>={'approval.rules.save':save,'approval.rules.preview':preview,'approval.rules.publish':publish,'approval.inputs':inputs,'approval.availability':availability,'approval.rule.remind':manualRuleReminder}

export async function ruleDecision(c:Ctx,a:AgreementRow,target:Requirement,required:Requirement[],counted:any[]){
 if(!target.approverId)return {checks:[] as Sql[],writes:[] as Sql[],actedAs:null}
 const earlier=required.filter(r=>r.approverId&&r.order!<target.order!)
 if(earlier.some(r=>!counted.some(x=>x.deviation_id===r.deviationId&&x.decision==='approved')))fail('ORDER','Earlier approval steps must approve first.',409)
 const own=c.actor.id===target.approverId&&!target.away,delegated=target.away&&c.actor.id===target.delegateId,override=c.actor.role==='owner'
 if(!own&&!delegated&&!override)fail('FORBIDDEN','This approval belongs to its named approver or current away delegate.',403)
 const original=commercialCheck(target.approverId)
 const checks=[sql(`((${roleSql})='owner' OR (${original.sql}))`,c.actor.id,...original.params),...(!own&&!delegated?[sql(`(${roleSql})='owner'`,c.actor.id)]:[]),sql('COALESCE((SELECT version FROM lk_approval_absences WHERE operator_id=?),0)=?',target.approverId,target.absenceVersion??0)]
 if(delegated)checks.push(commercialCheck(c.actor.id),sql('EXISTS(SELECT 1 FROM lk_approval_absences WHERE operator_id=? AND away=1 AND delegate_id=? AND version=?)',target.approverId,c.actor.id,target.absenceVersion))
 return {checks,writes:[] as Sql[],actedAs:delegated?'delegate':override&&!own?'owner_override':'named_approver'}
}

const scheduler:Actor={id:'locket-scheduler',name:'Locket scheduler',email:'',role:'viewer',sessionId:'',operatorVersion:0}
export function rulePendingSql(id:string,agreementId:string,recipientId?:string):Sql{
 return sql(`EXISTS(SELECT 1 FROM lk_rule_pending p JOIN lk_agreements a ON a.id=p.agreement_id JOIN lk_versions v ON v.id=a.current_version_id
 WHERE p.id=? AND p.agreement_id=? AND p.active=1 AND a.status='in_review' AND a.version=p.agreement_version AND v.id=p.version_id AND v.digest=p.version_digest
 AND COALESCE((SELECT version FROM lk_approval_absences WHERE operator_id=p.approver_id),0)=p.absence_version
 AND COALESCE((SELECT version FROM lk_repository_policy WHERE id='installation'),0)=p.policy_version
 ${recipientId?'AND (p.recipient_id=? OR p.escalation_id=? OR ('+roleSql+")='owner') AND ("+roleSql+") IN ('owner','approver') AND (("+roleSql+")='owner' OR a.requester_id<>?)":''}
 AND NOT EXISTS(SELECT 1 FROM lk_approvals x WHERE x.agreement_id=a.id AND x.version_id=v.id AND x.version_digest=v.digest AND x.context_digest=p.context_digest AND x.deviation_id=p.step_id AND x.invalidated_at IS NULL))`,id,agreementId,...(recipientId?[recipientId,recipientId,recipientId,recipientId,recipientId,recipientId]:[]))
}
/** Guarded reconciliation of pending rule work; publishing a rule set is explicit
 * consent for generic approval requests. Only the current unlocked stage is asked. */
export async function syncRulePending(env:Bindings,now:number){
 if(!await env.DB.prepare('SELECT 1 FROM lk_approval_rule_versions LIMIT 1').first())return
 const rows=(await env.DB.prepare("SELECT * FROM lk_agreements WHERE status='in_review'").all<AgreementRow>()).results
 const policy=await repositoryPolicy(env.DB)
 for(const a of rows){
  const active:string[]=[]
  const v=await env.DB.prepare('SELECT * FROM lk_versions WHERE id=?').bind(a.current_version_id).first<any>();if(!v)continue
  const context=await decisionContext(env.DB,a,v),required=await routing(env.DB,a)
  const live=(await env.DB.prepare('SELECT * FROM lk_approvals WHERE agreement_id=? AND version_id=? AND context_digest=? AND invalidated_at IS NULL').bind(a.id,v.id,context.digest).all<any>()).results
  for(const step of required.filter(s=>s.approverId)){
   const id=a.id+':'+context.digest+':'+step.deviationId
   if(live.some(x=>x.deviation_id===step.deviationId)||required.some(s=>s.approverId&&s.order!<step.order!&&!live.some(x=>x.deviation_id===s.deviationId&&x.decision==='approved')))continue
   const recipient=step.away?step.delegateId:step.approverId
   const eligible=async(person:string|null|undefined)=>{
    if(!person)return null
    const personActor={...scheduler,id:person}
    if(!await notificationCheck(env.DB,[commercialCheck(person),visibleSql(personActor,a.id),sql(`(${roleSql})='owner' OR ?<>?`,person,person,a.requester_id)]))return null
    const role=await env.DB.prepare(`SELECT ${roleSql} AS role`).bind(person).first<{role:Actor['role']}>()
    if((await hiddenFields(env.DB,{...personActor,role:role!.role})).length)return null
    return person
   }
   const to=await notificationCheck(env.DB,[commercialCheck(step.approverId!)])?await eligible(recipient):null,owner=(await env.DB.prepare("SELECT id FROM oa_operators WHERE role='owner' AND status='active' ORDER BY created_at LIMIT 1").first<{id:string}>())?.id
   let escalation:string|null=null
   for(const candidate of [step.escalationDelegateId,step.escalationId,owner]){if(candidate&&candidate!==to&&candidate!==step.approverId){escalation=await eligible(candidate);if(escalation)break}}
   const old=await env.DB.prepare('SELECT * FROM lk_rule_pending WHERE id=?').bind(id).first<any>(),guard=crypto.randomUUID(),c:Ctx={env,db:env.DB,actor:scheduler,now,commandId:id}
   const writes=[sql('INSERT INTO lk_rule_pending VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET agreement_version=excluded.agreement_version,recipient_id=excluded.recipient_id,escalation_id=excluded.escalation_id,active=1,absence_version=excluded.absence_version,policy_version=excluded.policy_version',id,a.id,a.version,v.id,v.digest,context.digest,step.deviationId,step.approverId,to,escalation,old?.requested_at??now,step.absenceVersion??0,policy.version)]
   if(!old)writes.push(auditSql(c,{action:'approval.rule.request',agreementId:a.id,summary:'Recorded current named-rule approval work; its request uses personal notification preferences.'},'scheduler'))
   if(to&&(!old||old.recipient_id!==to))writes.push(...notificationWrites(c,{key:id+':'+to,agreementId:a.id,recipientId:to,kind:'rule_approval'}))
   active.push(id)
   try{await env.DB.batch([guardSql(guard,[...(old?[]:[sql('NOT EXISTS(SELECT 1 FROM lk_rule_pending WHERE id=?)',id)]),sql('(SELECT version FROM lk_agreements WHERE id=?)=?',a.id,a.version),policyVersionCheck(policy.version),sql('COALESCE((SELECT version FROM lk_approval_absences WHERE operator_id=?),0)=?',step.approverId,step.absenceVersion??0)]),...writes,sql('DELETE FROM lk_guard WHERE id=?',guard)].map(s=>env.DB.prepare(s.sql).bind(...s.params)))}catch(error){if(!/LOCKET_GUARD/.test(String(error)))throw error}
  }
  await env.DB.prepare(`UPDATE lk_rule_pending SET active=0 WHERE agreement_id=? AND agreement_version<=? AND id NOT IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM lk_agreements a WHERE a.id=agreement_id AND a.version=?)`).bind(a.id,a.version,JSON.stringify(active),a.version).run()
 }
 await env.DB.prepare("UPDATE lk_rule_pending SET active=0 WHERE EXISTS(SELECT 1 FROM lk_agreements a WHERE a.id=agreement_id AND a.status<>'in_review')").run()
}

export async function runRuleReminders(env:Bindings,now:number){
 await syncRulePending(env,now)
 const rows=(await env.DB.prepare('SELECT * FROM lk_rule_pending WHERE active=1').all<any>()).results
 const settings=await env.DB.prepare("SELECT * FROM lk_approval_reminder_settings WHERE id='installation'").first<any>()
 for(const p of rows){
  const zone=(await env.DB.prepare('SELECT timezone FROM lk_person_preferences WHERE operator_id=?').bind(p.recipient_id??p.approver_id).first<{timezone:string}>())?.timezone??'America/New_York'
  let slot=0;const first=settings?.first_after_days??1,repeat=settings?.repeat_every_days??1,escalate=settings?.escalate_after_days??3
  while(slot<1000&&addBusinessDays(p.requested_at,first+slot*repeat,zone)<=now)slot++
  for(const [kind,n,recipient]of [['reminder',slot,p.recipient_id],['escalation',0,p.escalation_id]] as const){
   if(!recipient||kind==='reminder'&&!slot||kind==='escalation'&&addBusinessDays(p.requested_at,escalate,zone)>now)continue
   const id=p.id+':'+kind+':'+n,c:Ctx={env,db:env.DB,actor:scheduler,now,commandId:id},guard=crypto.randomUUID()
   if(await env.DB.prepare('SELECT 1 FROM lk_rule_reminder_events WHERE id=?').bind(id).first())continue
   try{await env.DB.batch([guardSql(guard,[rulePendingSql(p.id,p.agreement_id,recipient),visibleSql({...scheduler,id:recipient},p.agreement_id),commercialCheck(recipient)]),sql('INSERT INTO lk_rule_reminder_events VALUES(?,?,?,?,?,?,?)',id,p.id,p.agreement_id,kind,n,recipient,now),...notificationWrites(c,{key:id,agreementId:p.agreement_id,recipientId:recipient,kind:'rule_approval_'+kind}),auditSql(c,{action:'approval.rule.'+kind,agreementId:p.agreement_id,summary:'Recorded a due rule approval '+kind+' through personal notification preferences.'},'scheduler'),sql('DELETE FROM lk_guard WHERE id=?',guard)].map(s=>env.DB.prepare(s.sql).bind(...s.params)))}catch(error){if(!/LOCKET_GUARD|UNIQUE constraint/.test(String(error)))throw error}
  }
 }
}


async function manualRuleReminder(c:Ctx,p:Record<string,unknown>){
 requireRole(c.actor,may.review,'remind a rule approver')
 const a=await visibleAgreement(c,p.agreementId);requireStatus(a,['in_review'],'remind its rule approver')
 const stepId=text(p,'stepId',200)
 const pending=await c.db.prepare('SELECT * FROM lk_rule_pending WHERE agreement_id=? AND step_id=? AND active=1').bind(a.id,stepId).first<any>()
 if(!pending?.recipient_id||!await notificationCheck(c.db,[rulePendingSql(pending.id,a.id,pending.recipient_id)]))fail('NOT_PENDING','There is no current eligible named-rule approver waiting on this step.',409)
 const gap=4*3600000
 if(await c.db.prepare("SELECT 1 FROM lk_rule_reminder_events WHERE agreement_id=? AND recipient_id=? AND kind='manual' AND at>?").bind(a.id,pending.recipient_id,c.now-gap).first())fail('TOO_SOON','This approver was reminded less than 4 hours ago.',429)
 return {allowed:may.review,result:{id:c.commandId,status:'queued'},checks:[...agreementGuards(c,a,p),rulePendingSql(pending.id,a.id,pending.recipient_id),sql("NOT EXISTS(SELECT 1 FROM lk_rule_reminder_events WHERE agreement_id=? AND recipient_id=? AND kind='manual' AND at>?)",a.id,pending.recipient_id,c.now-gap)],writes:[sql('INSERT INTO lk_rule_reminder_events VALUES(?,?,?,?,?,?,?)',c.commandId,pending.id,a.id,'manual',0,pending.recipient_id,c.now),...notificationWrites(c,{key:c.commandId,agreementId:a.id,recipientId:pending.recipient_id,kind:'rule_approval_reminder'})],audit:[{action:'approval.rule.remind',agreementId:a.id,summary:'Requested a manual named-rule approval reminder through personal preferences.'}]}
}


export async function ruleReminderState(db:D1Database,visible:Set<string>,now:number,settings:{firstAfterDays:number;repeatEveryDays:number;escalateAfterDays:number}){
 const rows=(await db.prepare('SELECT * FROM lk_rule_pending WHERE active=1').all<any>()).results.filter(p=>visible.has(p.agreement_id)),out=[]
 for(const p of rows){
  const recipient=p.recipient_id??p.approver_id,zone=(await db.prepare('SELECT timezone FROM lk_person_preferences WHERE operator_id=?').bind(recipient).first<{timezone:string}>())?.timezone??'America/New_York'
  let slot=0;while(slot<1000&&addBusinessDays(p.requested_at,settings.firstAfterDays+slot*settings.repeatEveryDays,zone)<=now)slot++
  const last=(await db.prepare("SELECT MAX(at) AS at FROM lk_rule_reminder_events WHERE agreement_id=? AND recipient_id=? AND kind='manual'").bind(p.agreement_id,recipient).first<{at:number|null}>())?.at
  out.push({agreementId:p.agreement_id,versionId:p.version_id,approverId:recipient,requestedAt:p.requested_at,timezone:zone,nextReminderAt:addBusinessDays(p.requested_at,settings.firstAfterDays+slot*settings.repeatEveryDays,zone),escalateAt:addBusinessDays(p.requested_at,settings.escalateAfterDays,zone),manualAvailableAt:last&&now-last<4*3600000?last+4*3600000:null,rulePendingId:p.id,ruleStepId:p.step_id})
 }
 return out
}


export async function ruleReminderReceipt(env:Bindings,id:string){
 const row=await env.DB.prepare('SELECT n.email_status AS status,n.code FROM lk_rule_reminder_events e LEFT JOIN lk_notifications n ON n.event_key=e.id AND n.recipient_id=e.recipient_id WHERE e.id=?').bind(id).first<{status:string|null;code:string|null}>()
 return row?{id,status:row.status??'not_recorded',code:row.status==='digest'?'daily_digest':row.status==='suppressed'&&row.code==='email_disabled'?'notification_preferences':row.code}:null
}
