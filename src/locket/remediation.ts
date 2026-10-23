import { may, requireRole } from './access'
import type { Ctx, Handler } from './commands'
import { remediationStopHandlers, remediationSchedule, remediationReplyAddress } from './remediation-stops'
import { installationMailLocal, installationMailReady } from './installation-mail'
import { citation } from './obligations'
import { canonical, date, fail, integer, json, list, object, oneOf, sha256, sql, text } from './model'
import { agreementGuards, bump } from './records'
import { remediationEvidenceHandlers } from './remediation-evidence'
import { remediationChecks, remediationObligation, remediationRequest, remediationRequirement, remediationSource } from './remediation-records'
export { remediationCompletionCheck, remediationState, remediationArchiveTables } from './remediation-records'

const configure:Handler=async(c,p)=>{
 requireRole(c.actor,may.confirmTerms,'confirm an obligation evidence requirement')
 const {o,a}=await remediationObligation(c,p.obligationId),e=await remediationSource(c,o)
 const kind=oneOf(p,'kind',['coi','document'] as const),input=object(p.requirement,'requirement')
 const requirement=kind==='coi'?{coverageCents:integer(input,'coverageCents',1),insured:text(input,'insured',500),validFrom:date(input,'validFrom'),validThrough:date(input,'validThrough')}:{description:text(input,'description',4000)}
 if(kind==='coi'&&(requirement as any).validFrom>(requirement as any).validThrough)fail('INVALID','The required coverage interval is reversed.')
 const cite=await citation(c,a,p.citation),id=crypto.randomUUID()
 return {allowed:may.confirmTerms,result:{id},checks:[...agreementGuards(c,a),...remediationChecks(e.source,o.id)],writes:[sql('UPDATE lk_remediation_requirements SET active=0 WHERE obligation_id=?',o.id),sql("UPDATE lk_remediation_occurrences SET status='cancelled',outcome_code='requirement_replaced' WHERE status='pending' AND request_id IN (SELECT r.id FROM lk_remediation_requests r JOIN lk_remediation_requirements q ON q.id=r.requirement_id WHERE q.obligation_id=?)",o.id),sql('INSERT INTO lk_remediation_requirements(id,agreement_id,obligation_id,kind,requirement,citation,source,confirmed_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',id,a.id,o.id,kind,json(requirement),json(cite),json(e.source),c.actor.id,c.now),bump(c,a)],audit:[{action:'remediation.configure',agreementId:a.id,summary:'Person confirmed the exact signed evidence requirement. Prior requests cannot authorize changed requirements.'}]}
}
export async function remediationDigest(recipient:string,source:unknown,occurrences:{[key:string]:any}[]) {
 return sha256(canonical({recipient,source,occurrences:occurrences.map(o=>({sendAt:o.send_at,subject:o.subject,message:o.message_text}))}))
}
const prepare:Handler=async(c,p)=>{
 requireRole(c.actor,may.prepare,'prepare obligation remediation')
 const e=await remediationRequirement(c,p.requirementId),current=await remediationSource(c,e.o)
 const target=oneOf(p,'target',['supplier','internal'] as const)
 const contacts=JSON.parse(current.party.contacts)
 const recipient=target==='internal'?current.owner.email:typeof p.recipient==='string'&&p.recipient.trim()?text(p,'recipient',320):contacts.length===1?contacts[0].email:fail('RECIPIENT','Choose the responsible supplier contact from the recorded contacts.',409)
 if(target==='supplier'&&!JSON.parse(current.party.contacts).some((person:any)=>person.email.toLowerCase()===recipient.toLowerCase()))fail('RECIPIENT','Choose a recorded supplier contact.',409)
 const source={...e.source,target},items=list(p,'occurrences',12)
 if(!items.length)fail('INVALID','Prepare a finite schedule with at least one exact request.')
 const requirement=JSON.parse(e.r.requirement),requestText=e.r.kind==='coi'?`Please provide the current certificate of insurance for ${e.a.reference}. The confirmed requirement is at least USD ${(requirement.coverageCents/100).toFixed(2)} coverage, naming ${requirement.insured}, valid from ${requirement.validFrom} through ${requirement.validThrough}.`:`Please provide evidence for ${e.a.reference}: ${requirement.description}.`
 const occurrences=items.map((item,index)=>{const v=object(item,'occurrence');return {id:crypto.randomUUID(),send_at:integer(v,'sendAt',c.now+1),subject:p.draftFromRequirement===true?`${index?'Follow-up':'Request'}: obligation evidence for ${e.a.reference}`:text(v,'subject',500),message_text:p.draftFromRequirement===true?`${index?'Following up on the approved evidence request. ':''}${requestText}\nObligation: ${e.o.description}.${e.o.due_date?` Due: ${e.o.due_date}.`:''}\nThe returned original will be checked against the confirmed requirement; a person reviews anything that cannot be verified.`:text(v,'message',20000)}}).sort((a,b)=>a.send_at-b.send_at)
 if(new Set(occurrences.map(o=>o.send_at)).size!==occurrences.length)fail('INVALID','Each approved occurrence needs a distinct time.')
 const id=crypto.randomUUID(),digest=await remediationDigest(recipient,source,occurrences)
 return {allowed:may.prepare,result:{id,digest,status:'draft'},checks:e.checks,writes:[sql("INSERT INTO lk_remediation_requests(id,agreement_id,requirement_id,recipient,source,digest,prepared_by,status,created_at) VALUES(?,?,?,?,?,?,?,'draft',?)",id,e.a.id,e.r.id,recipient,json(source),digest,c.actor.id,c.now),...occurrences.map(o=>sql('INSERT INTO lk_remediation_occurrences(id,agreement_id,request_id,send_at,subject,message_text) VALUES(?,?,?,?,?,?)',o.id,e.a.id,id,o.send_at,o.subject,o.message_text))],audit:[{action:'remediation.prepare',agreementId:e.a.id,summary:'Prepared exact requests and finite chase schedule for obligation-owner approval; no sending authority.'}]}
}
const approve:Handler=async(c,p)=>{
 requireRole(c.actor,may.review,'approve obligation remediation')
 const e=await remediationRequest(c,p.requestId),r=e.request
 if(c.actor.id!==e.o.owner_id)fail('FORBIDDEN','Only the obligation owner approves each request and its chase schedule.',403)
 if(r.status!=='draft'||p.consent!==true||p.digest!==r.digest||await remediationDigest(r.recipient,JSON.parse(r.source),e.occurrences)!==r.digest)fail('APPROVAL','Review and approve every exact message, recipient and scheduled time.',409)
 if(e.occurrences.some(o=>o.send_at<=c.now))fail('SCHEDULE','Prepare a future schedule before approval.',409)
 if(JSON.parse(r.source).target==='supplier'&&!installationMailLocal(c.env)&&!remediationReplyAddress(c.env,r.id))fail('INBOUND_UNAVAILABLE','Configure the authenticated supplier reply address before approving requests.',503)
 if(!installationMailReady(c.env))fail('MAIL_UNAVAILABLE','Configure the installation mail provider and sender.',503)
 return {allowed:may.review,result:{id:r.id,status:'approved'},checks:[...e.checks,sql("(SELECT status FROM lk_remediation_requests WHERE id=?)='draft'",r.id)],writes:[sql("UPDATE lk_remediation_requests SET status='approved',approved_by=?,operator_version=?,sender=?,approved_at=? WHERE id=?",c.actor.id,c.actor.operatorVersion,c.env.MAIL_FROM??'',c.now,r.id)],audit:[{action:'remediation.approve',agreementId:e.a.id,summary:`Obligation owner explicitly approved every exact outbound request and all ${e.occurrences.length} finite scheduled occurrences; maximum ${e.occurrences.length}, minimum spacing ${remediationSchedule(e.occurrences.map(o=>({send_at:Number(o.send_at)}))).minimumSpacingMs??'no repeat'} milliseconds.`}]}
}
const send:Handler=async(c,p)=>{
 requireRole(c.actor,may.review,'send approved obligation remediation')
 const e=await remediationRequest(c,p.requestId),occurrence=e.occurrences.find(o=>o.id===p.occurrenceId)
 if(c.actor.id!==e.o.owner_id)fail('FORBIDDEN','Only the obligation owner explicitly sends a request.',403)
 if(!occurrence||occurrence.status!=='pending'||occurrence.send_at>c.now||e.request.status!=='approved'||p.consent!==true||p.digest!==e.request.digest)fail('APPROVAL','Explicitly authorize a due exact approved occurrence.',409)
 return {allowed:may.review,result:{id:occurrence.id,requestId:e.request.id,status:'queued'},checks:e.checks,writes:[],audit:[{action:'remediation.send',agreementId:e.a.id,summary:'Obligation owner explicitly requested sending one due approved occurrence.'}]}
}
const cancel:Handler=async(c,p)=>{
 requireRole(c.actor,may.review,'cancel remediation requests')
 const request=await c.db.prepare('SELECT * FROM lk_remediation_requests WHERE id=?').bind(p.requestId).first<any>()
 if(!request)fail('NOT_FOUND','No remediation request.',404)
 const requirement=await c.db.prepare('SELECT obligation_id FROM lk_remediation_requirements WHERE id=?').bind(request.requirement_id).first<{obligation_id:string}>()
 const {o,a}=await remediationObligation(c,requirement!.obligation_id)
 if(c.actor.id!==o.owner_id)fail('FORBIDDEN','Only the current obligation owner withdraws a chase schedule.',403)
 const reason=text(p,'reason',1000)
 return {allowed:may.review,result:{id:request.id,status:'cancelled'},checks:[...agreementGuards(c,a),sql('EXISTS(SELECT 1 FROM lk_obligations WHERE id=? AND owner_id=?)',o.id,c.actor.id)],writes:[sql("UPDATE lk_remediation_requests SET status='cancelled' WHERE id=?",request.id),sql("UPDATE lk_remediation_occurrences SET status='cancelled',outcome_code='owner_withdrew' WHERE request_id=? AND status='pending'",request.id)],audit:[{action:'remediation.cancel',agreementId:a.id,summary:`Obligation owner withdrew future requests without waiving the obligation: ${reason}`}]}
}
/** Replay must reauthorize source access before exposing stored command results. */
export async function authorizeRemediationResult(c:Ctx,type:string,p:Record<string,unknown>,result:any){
 if(type==='remediation.cancel'||type==='remediation.stop'){const request=await c.db.prepare('SELECT agreement_id FROM lk_remediation_requests WHERE id=?').bind(p.requestId).first<{agreement_id:string}>();if(request){const {visibleAgreement}=await import('./records');await visibleAgreement(c,request.agreement_id)}}
 else if(type==='remediation.send'||type==='remediation.approve')await remediationRequest(c,p.requestId)
 else if(type==='remediation.prepare')await remediationRequirement(c,p.requirementId)
 else if(result?.id){const r=await c.db.prepare('SELECT agreement_id FROM lk_remediation_requirements WHERE id=? UNION ALL SELECT agreement_id FROM lk_remediation_evidence WHERE id=?').bind(result.id,result.id).first<{agreement_id:string}>();if(r){const {visibleAgreement}=await import('./records');await visibleAgreement(c,r.agreement_id)}}
}
export const remediationHandlers={'remediation.configure':configure,'remediation.prepare':prepare,'remediation.approve':approve,'remediation.send':send,'remediation.cancel':cancel,...remediationStopHandlers,...remediationEvidenceHandlers}
