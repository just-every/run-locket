// Request work is recorded in the business batch. Team membership grants no access.
import type { Bindings } from '../auth.server'
import { fullReaders, may, requireRole, roleSql, visibleSql } from './access'
import { addBusinessDays } from './business-days'
import { auditSql, guardSql, type Ctx, type Handler } from './commands'
import { fail, integer, oneOf, optionalText, sql, text, type Actor, type Sql } from './model'
import { notificationCheck, notificationReaderSql, notificationWrites } from './notifications'
import { agreementGuards, bump, invalidateApprovals, requireStatus, visibleAgreement, type AgreementRow } from './records'

const types = ['customer','supplier','nda','amendment','order_form','other'] as const
const open = ['draft','in_review','approved','out_for_signature']
const stages: Record<string,string> = {draft:'intake',in_review:'approval',approved:'signature',out_for_signature:'signature'}
const member = (id:string) => sql(`EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND (${roleSql}) IN ('owner','counsel','approver','requester'))`,id,id)
const check = async (db:D1Database,s:Sql) => notificationCheck(db,[s])

const configure: Handler = async(c,p) => {
 requireRole(c.actor,may.manageRoles,'configure request assignment and service levels')
 const type=oneOf(p,'type',types), audienceId=text(p,'audienceId',100), leadId=text(p,'leadId',100), days=integer(p,'businessDays',1,60)
 const audience=await c.db.prepare("SELECT version FROM lk_intake_audiences WHERE id=? AND kind='group'").bind(audienceId).first<{version:number}>()
 if(!audience || !await check(c.db,member(leadId))) fail('INVALID','Choose a group and an active team lead who can work requests.')
 const prior=await c.db.prepare('SELECT version FROM lk_queue_rules WHERE type=?').bind(type).first<{version:number}>()
 const version=integer(p,'version',0)
 if(version!==(prior?.version??0))fail('STALE','The assignment rule changed. Reload before editing.',409)
 return {allowed:may.manageRoles,result:{type,version:version+1},
 checks:[member(leadId),sql('(SELECT version FROM lk_intake_audiences WHERE id=?)=?',audienceId,audience.version),sql('COALESCE((SELECT version FROM lk_queue_rules WHERE type=?),0)=?',type,version)],
 writes:[sql(`INSERT INTO lk_queue_rules VALUES(?,?,?,?,0,1) ON CONFLICT(type) DO UPDATE SET audience_id=excluded.audience_id,lead_id=excluded.lead_id,business_days=excluded.business_days,version=lk_queue_rules.version+1`,type,audienceId,leadId,days)],
 audit:[{action:'queue.configure',summary:'Configured team assignment and a request-type business-day service level.'}]}
}

/** Stable ID order with a guarded cursor. Stale concurrent creates retry explicitly.
 * Restricted requests skip anyone who lacks their existing reading authority. */
export async function newRequestWork(c:Ctx,a:Pick<AgreementRow,'id'|'type'|'restricted'|'owner_id'|'requester_id'|'timezone'>){
 const rule=await c.db.prepare('SELECT * FROM lk_queue_rules WHERE type=?').bind(a.type).first<any>()
 let assignee=a.owner_id,lead=a.owner_id,team=null,days=a.type==='nda'?2:5
 const checks:Sql[]=[],writes:Sql[]=[]
 if(rule){
  const audience=await c.db.prepare('SELECT version FROM lk_intake_audiences WHERE id=?').bind(rule.audience_id).first<{version:number}>()
  const candidates=(await c.db.prepare(`SELECT o.id,CASE WHEN o.role='owner' THEN 'owner' ELSE COALESCE((SELECT r.role FROM lk_roles r WHERE r.operator_id=o.id),'viewer') END AS role FROM lk_intake_members m JOIN oa_operators o ON o.id=m.operator_id WHERE m.audience_id=? AND o.status='active' ORDER BY o.id`).bind(rule.audience_id).all<{id:string;role:string}>()).results.filter(o=>may.intake.includes(o.role as any)&&(!a.restricted||fullReaders.includes(o.role as any)||o.id===a.owner_id||o.id===a.requester_id))
  if(!audience||!candidates.length)fail('ASSIGNMENT','This request team has no active member permitted to read this request.',409)
  assignee=candidates[rule.cursor%candidates.length].id;lead=rule.lead_id;team=rule.audience_id;days=rule.business_days
  checks.push(sql('EXISTS(SELECT 1 FROM lk_queue_rules WHERE type=? AND version=? AND cursor=?)',a.type,rule.version,rule.cursor),sql('(SELECT version FROM lk_intake_audiences WHERE id=?)=?',team,audience.version),member(assignee),member(lead))
  // Preserve the selected membership/role snapshot, including the candidate order.
  checks.push(sql(`NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN oa_operators o ON o.id=json_extract(expected.value,'$.id') WHERE o.id IS NULL OR o.status<>'active' OR (CASE WHEN o.role='owner' THEN 'owner' ELSE COALESCE((SELECT r.role FROM lk_roles r WHERE r.operator_id=o.id),'viewer') END)<>json_extract(expected.value,'$.role'))`,JSON.stringify(candidates)))
  writes.push(sql('UPDATE lk_queue_rules SET cursor=cursor+1 WHERE type=?',a.type))
 }else checks.push(sql('NOT EXISTS(SELECT 1 FROM lk_queue_rules WHERE type=?)',a.type))
 const due=addBusinessDays(c.now,days,a.timezone),warning=addBusinessDays(c.now,Math.max(0,days-1),a.timezone)
 writes.push(sql('INSERT INTO lk_request_work VALUES(?,?,?,?,?,?,?,?,1)',a.id,assignee,team,lead,days,due,warning,'intake'),...(assignee!==a.owner_id?notificationWrites(c,{key:c.commandId+':assignee',agreementId:a.id,recipientId:assignee,kind:'queue_assignment'}):[]))
 return {checks,writes}
}

function workAuthority(c:Ctx,a:AgreementRow){
 requireRole(c.actor,may.intake,'manage request work')
 if(!fullReaders.includes(c.actor.role)&&c.actor.id!==a.owner_id&&c.actor.id!==a.requester_id)fail('FORBIDDEN','Only the requester, responsible person, owner or counsel can manage this request.',403)
}
const reassign:Handler=async(c,p)=>{
 const a=await visibleAgreement(c,p.agreementId);workAuthority(c,a);requireStatus(a,open,'be reassigned')
 const assignee=text(p,'assigneeId',100),reason=text(p,'reason',2000)
 if(!await check(c.db,member(assignee))||!await notificationCheck(c.db,notificationReaderSql(c.actor,a.id,assignee)))fail('INVALID','Choose an active colleague who can already read this agreement.')
 return {allowed:may.intake,result:{id:a.id,assigneeId:assignee},checks:[...agreementGuards(c,a,p),member(assignee),visibleSql({...c.actor,id:assignee},a.id)],
 writes:[sql('UPDATE lk_request_work SET assignee_id=? WHERE agreement_id=?',assignee,a.id),bump(c,a),...notificationWrites(c,{key:c.commandId,agreementId:a.id,recipientId:assignee,kind:'queue_assignment'})],
 audit:[{action:'request.reassign',agreementId:a.id,summary:'Reassigned request: '+reason}]}
}
const setStage:Handler=async(c,p)=>{
 const a=await visibleAgreement(c,p.agreementId);workAuthority(c,a);requireStatus(a,['draft','in_review'],'change its working stage')
 const stage=oneOf(p,'stage',['intake','drafting','negotiation','approval'] as const),reason=text(p,'reason',2000)
 return {allowed:may.intake,result:{id:a.id,stage},checks:agreementGuards(c,a,p),writes:[sql('UPDATE lk_request_work SET stage=? WHERE agreement_id=?',stage,a.id),bump(c,a)],audit:[{action:'request.stage',agreementId:a.id,summary:`Working stage: ${stage}; ${reason}`}]}
}
const cancel:Handler=async(c,p)=>{
 const a=await visibleAgreement(c,p.agreementId);workAuthority(c,a);requireStatus(a,open,'be canceled')
 const reason=oneOf(p,'reason',['deal_lost','no_longer_needed','duplicate','replaced','other'] as const),note=reason==='other'?text(p,'note',2000):optionalText(p,'note',2000)
 const work=await c.db.prepare('SELECT stage FROM lk_request_work WHERE agreement_id=?').bind(a.id).first<{stage:string}>()
 const stage=['approved','out_for_signature'].includes(a.status)?'signature':work?.stage??stages[a.status]
 return {allowed:may.intake,result:{id:a.id,status:'cancelled'},checks:agreementGuards(c,a,p),writes:[
 sql('INSERT INTO lk_request_cancellations VALUES(?,?,?,?,?,?,?,?,NULL,NULL,NULL)',c.commandId,a.id,reason,note,stage,a.status,c.actor.id,c.now),
 invalidateApprovals(c,a.id,'Request canceled'),bump(c,a,"status='cancelled'"),
 sql("UPDATE lk_packages SET status='voided',void_reason='Request canceled; manual provider void must be recorded separately' WHERE agreement_id=? AND status IN ('prepared','sent')",a.id),
 sql("UPDATE lk_approval_mail SET status='cancelled',code='request_cancelled' WHERE agreement_id=? AND status IN ('queued','suppressed')",a.id),
 sql("UPDATE lk_approval_reminders SET status='cancelled',code='request_cancelled' WHERE agreement_id=? AND status IN ('queued','suppressed')",a.id),
 sql("UPDATE lk_notifications SET email_status='cancelled',code='request_cancelled' WHERE agreement_id=? AND email_status IN ('pending','immediate','digest')",a.id),
 ...[...new Set([a.owner_id,a.requester_id])].flatMap(recipientId=>notificationWrites(c,{key:c.commandId,agreementId:a.id,recipientId,kind:'queue_canceled'}))],
 audit:[{action:'request.cancel',agreementId:a.id,summary:`Canceled at ${stage}: ${reason.replaceAll('_',' ')}${note?'; '+note:''}. Manual provider envelopes require a separate provider void; local packages are closed.`}]}
}
const reopen:Handler=async(c,p)=>{
 requireRole(c.actor,may.library,'reopen requests')
 const a=await visibleAgreement(c,p.agreementId);requireStatus(a,['cancelled'],'be reopened')
 const reason=text(p,'reason',2000),prior=await c.db.prepare('SELECT * FROM lk_request_cancellations WHERE agreement_id=? AND reopened_at IS NULL ORDER BY canceled_at DESC LIMIT 1').bind(a.id).first<any>()
 if(!prior)fail('STATUS','This cancellation has no reopening record.',409)
 const status=prior.prior_status==='draft'?'draft':'in_review'
 const work=await c.db.prepare('SELECT * FROM lk_request_work WHERE agreement_id=?').bind(a.id).first<any>()
 return {allowed:may.library,result:{id:a.id,status},checks:agreementGuards(c,a,p),writes:[
 bump(c,a,'status=?',status),sql('UPDATE lk_request_cancellations SET reopened_by=?,reopened_at=?,reopen_reason=? WHERE id=?',c.actor.id,c.now,reason,prior.id),
 ...(work?[sql('UPDATE lk_request_work SET generation=generation+1,due_at=?,warning_at=? WHERE agreement_id=?',addBusinessDays(c.now,work.business_days,a.timezone),addBusinessDays(c.now,Math.max(0,work.business_days-1),a.timezone),a.id)]:[]),
 ...[...new Set([a.owner_id,a.requester_id,work?.assignee_id].filter(Boolean))].flatMap(recipientId=>notificationWrites(c,{key:c.commandId,agreementId:a.id,recipientId,kind:'queue_reopened'}))],audit:[{action:'request.reopen',agreementId:a.id,summary:'Reopened without restoring approvals or signature packages: '+reason}]}
}
export const queueHandlers:Record<string,Handler>={'queue.configure':configure,'request.reassign':reassign,'request.stage':setStage,'request.cancel':cancel,'request.reopen':reopen}

export async function requestQueue(db:D1Database,agreements:AgreementRow[],now:number){
 const ids=new Set(agreements.filter(a=>a.origin==='intake').map(a=>a.id))
 const work=(await db.prepare('SELECT * FROM lk_request_work').all<any>()).results.filter(w=>ids.has(w.agreement_id))
 const cancellations=(await db.prepare('SELECT * FROM lk_request_cancellations ORDER BY canceled_at').all<any>()).results.filter(w=>ids.has(w.agreement_id))
 return {rules:(await db.prepare('SELECT * FROM lk_queue_rules').all<any>()).results,work:work.map(w=>{
 const a=agreements.find(a=>a.id===w.agreement_id)!,closed=!open.includes(a.status)
 return {...w,stage:['approved','out_for_signature'].includes(a.status)?'signature':w.stage,ageMs:Math.max(0,now-a.created_at),sla:closed?'closed':now>=w.due_at?'overdue':now>=w.warning_at?'due_soon':'on_track'}
 }),cancellations}
}

/** One escalation per warning/breach per generation, guarded against cancellation,
 * reopening, edits and concurrent cron invocations. The shared dispatcher owns mail. */
export async function runQueueEscalations(env:Bindings,now:number){
 const actor:Actor={id:'locket-scheduler',name:'Locket scheduler',email:'',role:'viewer',sessionId:'',operatorVersion:0}
 const rows=(await env.DB.prepare("SELECT w.*,a.version,a.status FROM lk_request_work w JOIN lk_agreements a ON a.id=w.agreement_id WHERE a.status IN ('draft','in_review','approved','out_for_signature') AND w.warning_at<=?").bind(now).all<any>()).results
 for(const w of rows)for(const kind of ['due_soon','overdue']){
 if(kind==='overdue'&&now<w.due_at)continue
 const c:Ctx={env,db:env.DB,actor,now,commandId:`queue:${w.agreement_id}:${w.generation}:${kind}`},guard=crypto.randomUUID()
 if(await env.DB.prepare('SELECT 1 FROM lk_queue_escalations WHERE agreement_id=? AND generation=? AND kind=?').bind(w.agreement_id,w.generation,kind).first())continue
 const checks=[sql("EXISTS(SELECT 1 FROM lk_agreements WHERE id=? AND version=? AND status IN ('draft','in_review','approved','out_for_signature'))",w.agreement_id,w.version),sql('EXISTS(SELECT 1 FROM lk_request_work WHERE agreement_id=? AND generation=? AND lead_id=? AND due_at=? AND warning_at=?)',w.agreement_id,w.generation,w.lead_id,w.due_at,w.warning_at),sql('NOT EXISTS(SELECT 1 FROM lk_queue_escalations WHERE agreement_id=? AND generation=? AND kind=?)',w.agreement_id,w.generation,kind)]
 try{await env.DB.batch([guardSql(guard,checks),sql('INSERT INTO lk_queue_escalations VALUES(?,?,?,?)',w.agreement_id,w.generation,kind,now),...notificationWrites(c,{key:c.commandId,agreementId:w.agreement_id,recipientId:w.lead_id,kind:'queue_'+kind}),auditSql(c,{action:'request.sla.'+kind,agreementId:w.agreement_id,summary:'Request service level '+kind.replaceAll('_',' ')+'; team-lead notification recorded only with current access.'},'scheduler'),sql('DELETE FROM lk_guard WHERE id=?',guard)].map(s=>env.DB.prepare(s.sql).bind(...s.params)))}catch(error){if(!/LOCKET_GUARD|UNIQUE constraint/.test(String(error)))throw error}
 }
}
