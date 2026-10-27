import { recordReads } from './audit'
// Conservative field custody: structured projection is redacted; unredacted
// documents and free-text evidence are withheld instead of rewriting originals.
import type { Bindings } from '../auth.server'
import { agreementAccessSql, fullReaders, may, requireRole, roleSql } from './access'
import type { Handler } from './commands'
import { fail, integer, json, list, money, object, oneOf, sql, text, type Actor } from './model'
import { agreementGuards, bump, invalidateApprovals, statusAfterChange, visibleAgreement } from './records'
import { repositoryDefinitions } from './repository-fields'

export interface RepositoryPolicy {enabled:boolean;grants:{audienceId:string;types:string[];departmentIds:string[]}[];hiddenFields:{role:string;audienceId?:string;fields:string[]}[];version:number}
export async function repositoryPolicy(db:D1Database):Promise<RepositoryPolicy>{
 const r=await db.prepare("SELECT * FROM lk_repository_policy WHERE id='installation'").first<any>()
 return r?{enabled:!!r.enabled,grants:JSON.parse(r.grants),hiddenFields:JSON.parse(r.hidden_fields),version:r.version}:{enabled:false,grants:[],hiddenFields:[],version:0}
}
export async function hiddenFields(db:D1Database,actor:Actor):Promise<string[]>{
 const role=(await db.prepare(`SELECT ${roleSql} AS role`).bind(actor.id).first<{role:string}>())?.role??actor.role
 if(['owner','counsel'].includes(role))return []
 const memberships=(await db.prepare('SELECT audience_id FROM lk_intake_members WHERE operator_id=?').bind(actor.id).all<{audience_id:string}>()).results.map(m=>m.audience_id)
 return [...new Set((await repositoryPolicy(db)).hiddenFields.filter(h=>h.role===role||!!h.audienceId&&memberships.includes(h.audienceId)).flatMap(h=>h.fields))]
}
export const policyVersionCheck=(version:number)=>sql("COALESCE((SELECT version FROM lk_repository_policy WHERE id='installation'),0)=?",version)
const configure:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'configure repository access')
 if(typeof p.enabled!=='boolean')fail('INVALID','enabled must be true or false.')
 const version=integer(p,'version',0),prior=await repositoryPolicy(c.db)
 if(prior.version!==version)fail('STALE','Repository access changed. Reload before editing.',409)
 const types=['customer','supplier','nda','amendment','order_form','other'] as const
 const audiences=(await c.db.prepare('SELECT id,kind,version FROM lk_intake_audiences').all<any>()).results
 const checks=[policyVersionCheck(version)],revisions=new Map<string,number>()
 const grants=list(p,'grants',100).map(value=>{
  const g=object(value),audienceId=text(g,'audienceId',100),audience=audiences.find(a=>a.id===audienceId)
  if(!audience)fail('INVALID','Choose a current group or department.')
  const selected=list(g,'types',6).map(v=>oneOf({v},'v',types))
  if(!selected.length||new Set(selected).size!==selected.length)fail('INVALID','Select distinct agreement types.')
  const departments=list(g,'departmentIds',100).map(v=>text({v},'v',100))
  for(const id of [audienceId,...departments]){
   const row=audiences.find(a=>a.id===id)
   if(!row||(id!==audienceId&&row.kind!=='department'))fail('INVALID','Choose current departments.')
   revisions.set(id,row.version)
  }
  return {audienceId,types:selected,departmentIds:[...new Set(departments)]}
 })
 const definitions=await repositoryDefinitions(c.db)
 const allowed=['value','pricing_schedules',...definitions.map(d=>'custom:'+d.id)]
 const hidden=list(p,'hiddenFields',104).map(value=>{
  const h=object(value),audienceId=h.audienceId===undefined?undefined:text(h,'audienceId',100),role=audienceId?'':oneOf(h,'role',['approver','requester','viewer','agent'] as const),fields=list(h,'fields',allowed.length).map(v=>{
   if(typeof v!=='string'||!allowed.includes(v))fail('INVALID','Choose value, pricing schedules or a current custom field.')
   return v
  })
  if(audienceId){const group=audiences.find(a=>a.id===audienceId&&a.kind==='group');if(!group)fail('INVALID','Choose a current group.');revisions.set(audienceId,group.version)}
  return {role,...(audienceId?{audienceId}:{}),fields:[...new Set(fields)]}
 })
 if(new Set(hidden.map(h=>h.audienceId??h.role)).size!==hidden.length)fail('INVALID','Each role or group may appear once.')
 checks.push(sql(`NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN lk_intake_audiences a ON a.id=json_extract(expected.value,'$.id') WHERE a.id IS NULL OR a.version<>json_extract(expected.value,'$.version'))`,JSON.stringify([...revisions].map(([id,version])=>({id,version})))))
 return {allowed:may.manageRoles,result:{version:version+1},checks,writes:[sql("INSERT INTO lk_repository_policy VALUES('installation',?,?,?,1) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,grants=excluded.grants,hidden_fields=excluded.hidden_fields,version=lk_repository_policy.version+1",Number(p.enabled),json(grants),json(hidden))],audit:[{action:'repository.access',summary:json({before:{enabled:prior.enabled,grants:prior.grants,hiddenFields:prior.hiddenFields},after:{enabled:p.enabled,grants,hiddenFields:hidden}})}]}
}
const department:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'classify agreement departments')
 const a=await visibleAgreement(c,p.agreementId),departmentId=text(p,'departmentId',100)
 const before=await c.db.prepare('SELECT department_id FROM lk_agreement_departments WHERE agreement_id=?').bind(a.id).first<{department_id:string}>()
 const d=await c.db.prepare("SELECT version FROM lk_intake_audiences WHERE id=? AND kind='department'").bind(departmentId).first<{version:number}>()
 if(!d)fail('INVALID','Choose a current department.')
 return {allowed:may.manageRoles,result:{id:a.id,departmentId},checks:[...agreementGuards(c,a,p),sql('(SELECT version FROM lk_intake_audiences WHERE id=?)=?',departmentId,d.version)],writes:[sql('INSERT INTO lk_agreement_departments VALUES(?,?) ON CONFLICT(agreement_id) DO UPDATE SET department_id=excluded.department_id',a.id,departmentId),invalidateApprovals(c,a.id,'Agreement department changed'),bump(c,a,'status=?',statusAfterChange(a))],audit:[{action:'agreement.department',agreementId:a.id,summary:json({before:{departmentId:before?.department_id??null},after:{departmentId}})}]}
}
const share:Handler=async(c,p)=>{
 requireRole(c.actor,may.grantAccess,'share an agreement exception')
 const a=await visibleAgreement(c,p.agreementId),operatorId=text(p,'operatorId',64)
 const person=await c.db.prepare("SELECT version FROM oa_operators WHERE id=? AND status='active'").bind(operatorId).first<{version:number}>()
 if(!person)fail('INVALID','Choose an active person.')
 const revoke=p.revoke===true
 const reason=revoke?null:text(p,'reason',2000),expiresAt=revoke?0:integer(p,'expiresAt',c.now+1)
 const prior=await c.db.prepare('SELECT * FROM lk_access_exceptions WHERE agreement_id=? AND operator_id=?').bind(a.id,operatorId).first()
 return {allowed:may.grantAccess,result:{agreementId:a.id},checks:[...agreementGuards(c,a,p),sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active')",operatorId,person.version)],writes:[revoke?sql('DELETE FROM lk_access_exceptions WHERE agreement_id=? AND operator_id=?',a.id,operatorId):sql('INSERT OR REPLACE INTO lk_access_exceptions VALUES(?,?,?,?,?,?,?)',c.commandId,a.id,operatorId,reason,expiresAt,c.actor.id,c.now),bump(c,a)],audit:[{action:'access.exception',agreementId:a.id,summary:json({before:prior,after:revoke?null:{operatorId,reason,expiresAt}})}]}
}
const submitHiddenValue:Handler=async(c,p)=>{
 requireRole(c.actor,['requester'],'submit a hidden agreement value')
 const a=await visibleAgreement(c,p.agreementId)
 if(a.requester_id!==c.actor.id)fail('FORBIDDEN','Only the agreement requester can submit this value.',403)
 if(!(await hiddenFields(c.db,c.actor)).includes('value'))fail('FIELD_ACCESS','Use the normal details form when value is readable.',403)
 if(!['draft','in_review','approved'].includes(a.status))fail('STATUS','This agreement no longer accepts request details.',409)
 if(a.currency!=='USD')fail('INVALID','The responsible person must record values in another currency.')
 if(await c.db.prepare('SELECT 1 FROM lk_request_forms WHERE agreement_id=?').bind(a.id).first())fail('FORM_ROUTE','Routing answers and value are pinned at launch. Create a new request for changed routing inputs.',409)
 const cents=money(p,'value');if(cents===null)fail('INVALID','A value is required.')
 return {allowed:['requester'],result:{agreementId:a.id,submitted:true},checks:[...agreementGuards(c,a,p),sql("EXISTS(SELECT 1 FROM lk_agreements WHERE id=? AND requester_id=?)",a.id,c.actor.id)],writes:[invalidateApprovals(c,a.id,'Requester submitted a hidden value'),bump(c,a,'value_cents=?,original_cents=?,status=?',cents,null,statusAfterChange(a))],audit:[{action:'agreement.hidden-value',agreementId:a.id,summary:'Requester submitted a hidden value; prior approvals withdrawn.'}]}
}
const legalNote:Handler=async(c,p)=>{
 requireRole(c.actor,fullReaders,'record privileged legal notes')
 const a=await visibleAgreement(c,p.agreementId),body=text(p,'body',10000)
 return {allowed:fullReaders,result:{id:c.commandId},checks:agreementGuards(c,a,p),writes:[sql('INSERT INTO lk_privileged_notes VALUES(?,?,?,?,?)',c.commandId,a.id,body,c.actor.id,c.now),bump(c,a)],audit:[{action:'agreement.legal-note',agreementId:a.id,summary:'Recorded a privileged legal note.'}]}
}
export const repositoryAccessHandlers:Record<string,Handler>={'repository.access':configure,'agreement.department':department,'access.exception':share,'agreement.hidden-value':submitHiddenValue,'agreement.legal-note':legalNote}

/** Block unredacted public doors and business commands when fields are hidden.
 * A hidden value must never influence an observable operation or decision. */
export async function requireFullFields(db:D1Database,actor:Actor){
 if((await hiddenFields(db,actor)).length)fail('FIELD_ACCESS','This role has hidden fields. Unredacted documents, comparisons and business commands require a role with full field access.',403)
}
export function redactWorkspace<T extends Record<string,any>>(workspace:T,hidden:string[],renditions:any[]=[]):T{
 if(!hidden.length)return {...workspace,fieldAccess:{hidden,documentsWithheld:false}}
 const w:any={...workspace,fieldAccess:{hidden,documentsWithheld:true}}
 const moneyKeys=['value_cents','currency','original_cents','usd_rate','rate_recorded_by','rate_recorded_at']
 w.agreements=workspace.agreements.map((a:any)=>{
  const row={...a};if(hidden.includes('value'))for(const key of moneyKeys)delete row[key]
  return row
 })
 w.customValues=workspace.customValues.filter((v:any)=>!hidden.includes('custom:'+v.field_id))
 w.terms=workspace.terms.filter((t:any)=>!hidden.includes(t.key))
 // Any arbitrary text or immutable file may repeat a hidden value. Do not guess
 // at redaction, mutate originals or reveal it through labels, quotes or history;
 // obligation wording, citations and evidence notes are withheld with them.
 w.redactedRenditions=[]
 w.versions=workspace.versions.map((v:any)=>({...v,text:null,fields:null,label:'Document version'}))
 for(const key of ['summaries','proposalSources','billingProposals','executionRetrievals','renewalGenerations','renewalHistory','renewalTerminations','calendarEvents','familyAnalyses','renewalBriefs','accountingLinks','accountingSchedules','accountingReads','accountingAllocations','versionAudiences','commentAudiences','legalHolds','artifacts','comments','deviations','approvals','packages','executions','requestForms','proposals','noticeSources','noticePlans','noticeLetters','noticeDispatches','noticeEvents','noticeTracking','notices','audit','familyTerms','obligations'])w[key]=[]
 if(workspace.signature)w.signature={...workspace.signature,packets:[],renditions:[],dispatches:[],canCoordinate:[]}
 if(workspace.chatNotifications)w.chatNotifications={...workspace.chatNotifications,deliveries:[]}
 if(workspace.approvalChannels)w.approvalChannels={...workspace.approvalChannels,requests:[],deliveries:[]}
 w.playbookRecommendations={outcomes:[],issues:[],recommendations:[],applications:[]};
 w.terms=[];w.routes={};w.reports=[];w.reportDeliveries=[];w.approvalInputs=[];w.ruleDecisions=[];w.rulePending=[];w.ruleReminders=[]
 w.requestQueue={...workspace.requestQueue,cancellations:workspace.requestQueue.cancellations.map((c:any)=>({...c,note:null,reopen_reason:c.reopen_reason?'Details withheld':null}))}
 // State summaries contain derived dollar totals and are recalculated downstream.
 // Expose only an approved rendition's text and metadata, never its original.
 const approved=renditions.filter(r=>workspace.agreements.some((a:any)=>a.id===r.agreement_id))
 w.versions=w.versions.map((v:any)=>({...v,text:approved.find(r=>r.version_id===v.id)?.text??null}))
 w.artifacts=workspace.artifacts.filter((f:any)=>approved.some(r=>r.artifact_id===f.id)).map((f:any)=>({...f,role:'redacted',filename:'Approved redacted rendition',provenance:'{}'}))
 w.counterparties={}
 return w
}

/** Re-evaluate group hiding inside the command transaction, after any membership change. */
export function fullFieldsCheck(actor:Actor){
 return sql(`((${roleSql}) IN ('owner','counsel') OR NOT EXISTS(SELECT 1 FROM lk_repository_policy p,json_each(p.hidden_fields) h WHERE json_array_length(json_extract(h.value,'$.fields'))>0 AND (json_extract(h.value,'$.role')=(${roleSql}) OR EXISTS(SELECT 1 FROM lk_intake_members m WHERE m.operator_id=? AND m.audience_id=json_extract(h.value,'$.audienceId')))))`,actor.id,actor.id,actor.id)
}

/** Read the current effective predicate, then explain both restricted custody and group authority. */
export async function accessReport(env:Bindings,actor:Actor,agreementId:string){
 requireRole(actor,fullReaders,'review agreement readers')
 const a=await env.DB.prepare('SELECT * FROM lk_agreements WHERE id=?').bind(agreementId).first<any>()
 if(!a)fail('NOT_FOUND','No agreement has that identity.',404)
 const people=(await env.DB.prepare(`SELECT o.id,o.display_name AS name,CASE WHEN o.role='owner' THEN 'owner' ELSE COALESCE(r.role,'viewer') END AS role FROM oa_operators o LEFT JOIN lk_roles r ON r.operator_id=o.id WHERE o.status='active' AND (o.role='owner' OR NOT EXISTS(SELECT 1 FROM lk_workforce_users WHERE id=o.id) OR EXISTS(SELECT 1 FROM lk_workforce_settings w JOIN oa_operators owner ON owner.id=w.approved_by WHERE w.enabled=1 AND owner.status='active' AND owner.role='owner' AND owner.version=w.owner_version))`).all<any>()).results
 const policy=await repositoryPolicy(env.DB),readers=[]
 const department=(await env.DB.prepare("SELECT COALESCE((SELECT department_id FROM lk_agreement_departments WHERE agreement_id=?),(SELECT json_extract(answers,'$.department') FROM lk_request_forms WHERE agreement_id=?)) AS id").bind(a.id,a.id).first<{id:string}>())?.id
 for(const person of people){
  const access=agreementAccessSql(person.id)
  if(!await env.DB.prepare(`SELECT 1 FROM lk_agreements a WHERE a.id=? AND ${access.sql}`).bind(a.id,...access.params).first())continue
  const reasons:string[]=[]
  if(fullReaders.includes(person.role))reasons.push(person.role+' role')
  else{
   if(!a.restricted)reasons.push('Unrestricted agreement')
   if(a.requester_id===person.id)reasons.push('Agreement requester')
   if(a.owner_id===person.id)reasons.push('Responsible person')
   if(await env.DB.prepare('SELECT 1 FROM lk_access WHERE agreement_id=? AND operator_id=?').bind(a.id,person.id).first())reasons.push('Explicit restricted-access grant')
   const exception=await env.DB.prepare('SELECT reason,expires_at FROM lk_access_exceptions WHERE agreement_id=? AND operator_id=? AND expires_at>?').bind(a.id,person.id,Date.now()).first<any>()
   if(exception)reasons.push('Temporary group exception: '+exception.reason+'; expires '+new Date(exception.expires_at).toISOString())
   const groups=(await env.DB.prepare('SELECT a.id,a.name FROM lk_intake_members m JOIN lk_intake_audiences a ON a.id=m.audience_id WHERE m.operator_id=?').bind(person.id).all<any>()).results
   for(const group of groups){
    const assigned=await env.DB.prepare('SELECT 1 FROM lk_agreement_groups WHERE agreement_id=? AND audience_id=?').bind(a.id,group.id).first()
    const configured=policy.enabled&&policy.grants.some(g=>g.audienceId===group.id&&g.types.includes(a.type)&&(!g.departmentIds.length||g.departmentIds.includes(department??'')))
    if(assigned||configured)reasons.push((assigned?'Assigned group: ':'Repository grant: ')+group.name)
   }
  }
  readers.push({...person,reasons,hiddenFields:await hiddenFields(env.DB,{...actor,id:person.id,role:person.role})})
 }
 await recordReads(env,actor,[{action:'access.review',agreementId:a.id,summary:'Reviewed current agreement readers and their grants.'}],fullReaders)
 return {agreementId:a.id,readers}
}
