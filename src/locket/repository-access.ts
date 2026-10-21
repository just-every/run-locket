// Conservative field custody: structured projection is redacted; unredacted
// documents and free-text evidence are withheld instead of rewriting originals.
import type { Bindings } from '../auth.server'
import { may, requireRole, roleSql } from './access'
import type { Handler } from './commands'
import { fail, integer, json, list, object, oneOf, sql, text, type Actor } from './model'
import { agreementGuards, bump, invalidateApprovals, statusAfterChange, visibleAgreement } from './records'
import { repositoryDefinitions } from './repository-fields'

export interface RepositoryPolicy {enabled:boolean;grants:{audienceId:string;types:string[];departmentIds:string[]}[];hiddenFields:{role:string;fields:string[]}[];version:number}
export async function repositoryPolicy(db:D1Database):Promise<RepositoryPolicy>{
 const r=await db.prepare("SELECT * FROM lk_repository_policy WHERE id='installation'").first<any>()
 return r?{enabled:!!r.enabled,grants:JSON.parse(r.grants),hiddenFields:JSON.parse(r.hidden_fields),version:r.version}:{enabled:false,grants:[],hiddenFields:[],version:0}
}
export async function hiddenFields(db:D1Database,actor:Actor):Promise<string[]>{
 const role=(await db.prepare(`SELECT ${roleSql} AS role`).bind(actor.id).first<{role:string}>())?.role??actor.role
 if(['owner','counsel'].includes(role))return []
 return (await repositoryPolicy(db)).hiddenFields.find(h=>h.role===role)?.fields??[]
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
 checks.push(sql(`NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN lk_intake_audiences a ON a.id=json_extract(expected.value,'$.id') WHERE a.id IS NULL OR a.version<>json_extract(expected.value,'$.version'))`,JSON.stringify([...revisions].map(([id,version])=>({id,version})))))
 const definitions=await repositoryDefinitions(c.db)
 const allowed=['value','pricing_schedules',...definitions.map(d=>'custom:'+d.id)]
 const hidden=list(p,'hiddenFields',4).map(value=>{
  const h=object(value),role=oneOf(h,'role',['approver','requester','viewer','agent'] as const),fields=list(h,'fields',allowed.length).map(v=>{
   if(typeof v!=='string'||!allowed.includes(v))fail('INVALID','Choose value, pricing schedules or a current custom field.')
   return v
  })
  return {role,fields:[...new Set(fields)]}
 })
 if(new Set(hidden.map(h=>h.role)).size!==hidden.length)fail('INVALID','Each role may appear once.')
 return {allowed:may.manageRoles,result:{version:version+1},checks,writes:[sql("INSERT INTO lk_repository_policy VALUES('installation',?,?,?,1) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,grants=excluded.grants,hidden_fields=excluded.hidden_fields,version=lk_repository_policy.version+1",Number(p.enabled),json(grants),json(hidden))],audit:[{action:'repository.access',summary:'Owner explicitly configured repository group/type/department visibility and role field restrictions.'}]}
}
const department:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'classify agreement departments')
 const a=await visibleAgreement(c,p.agreementId),departmentId=text(p,'departmentId',100)
 const d=await c.db.prepare("SELECT version FROM lk_intake_audiences WHERE id=? AND kind='department'").bind(departmentId).first<{version:number}>()
 if(!d)fail('INVALID','Choose a current department.')
 return {allowed:may.manageRoles,result:{id:a.id,departmentId},checks:[...agreementGuards(c,a,p),sql('(SELECT version FROM lk_intake_audiences WHERE id=?)=?',departmentId,d.version)],writes:[sql('INSERT INTO lk_agreement_departments VALUES(?,?) ON CONFLICT(agreement_id) DO UPDATE SET department_id=excluded.department_id',a.id,departmentId),invalidateApprovals(c,a.id,'Agreement department changed'),bump(c,a,'status=?',statusAfterChange(a))],audit:[{action:'agreement.department',agreementId:a.id,summary:'Owner recorded the agreement department.'}]}
}
export const repositoryAccessHandlers:Record<string,Handler>={'repository.access':configure,'agreement.department':department}

/** Block unredacted public doors and business commands when fields are hidden.
 * A hidden value must never influence an observable operation or decision. */
export async function requireFullFields(db:D1Database,actor:Actor){
 if((await hiddenFields(db,actor)).length)fail('FIELD_ACCESS','This role has hidden fields. Unredacted documents, comparisons and business commands require a role with full field access.',403)
}
export function redactWorkspace<T extends Record<string,any>>(workspace:T,hidden:string[]):T{
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
 // at redaction, mutate originals or reveal it through labels, quotes or history.
 w.versions=workspace.versions.map((v:any)=>({...v,text:null,fields:null,label:'Document version'}))
 for(const key of ['artifacts','comments','deviations','approvals','packages','executions','requestForms','proposals','noticeSources','noticePlans','noticeLetters','noticeDispatches','noticeEvents','noticeTracking','notices','audit','familyTerms'])w[key]=[]
 w.terms=[];w.routes={};w.reports=[];w.reportDeliveries=[];w.approvalInputs=[];w.ruleDecisions=[];w.rulePending=[];w.ruleReminders=[]
 w.requestQueue={...workspace.requestQueue,cancellations:workspace.requestQueue.cancellations.map((c:any)=>({...c,note:null,reopen_reason:c.reopen_reason?'Details withheld':null}))}
 // State summaries contain derived dollar totals and are recalculated downstream.
 w.counterparties={}
 return w
}
