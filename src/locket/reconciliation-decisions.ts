import { requireRole, visibleSql } from './access'
import type { Ctx, Handler } from './commands'
import { fail, sql, text } from './model'
import { notificationWrites } from './notifications'
import { currentEvidence, finding, humanReconciliationRoles, messageDigest } from './reconciliation-records'
import { visibleAgreement } from './records'

const finance:Handler=async(c,p)=>{
 requireRole(c.actor,['owner','approver'],'confirm invoice accounting')
 const f=await finding(c,p.findingId,p.findingVersion),e=await currentEvidence(c,f)
 if(c.actor.id!==f.finance_id)fail('FORBIDDEN','Only the designated finance approver confirms this accounting.',403)
 if(f.status!=='proposed')fail('STATUS','Only a proposed finding can receive finance confirmation.',409)
 if(p.confirmComparable!==true||p.confirmAdjustments!==true)fail('CONSENT','Confirm the complete invoice allocation and comparable annual service scope, plus tax, credits and adjustments. Reject the finding if these assumptions do not hold.')
 const note=text(p,'note',4000)
 return {allowed:['owner','approver'],result:{id:f.id},checks:e.checks,writes:[sql("UPDATE lk_reconciliation_findings SET status='finance_confirmed',finance_by=?,finance_at=?,finance_operator_version=?,finance_note=?,version=version+1 WHERE id=?",c.actor.id,c.now,c.actor.operatorVersion,note,f.id),...notificationWrites(c,{key:c.commandId,agreementId:f.agreement_id,recipientId:f.owner_id,kind:'approval'})],audit:[{action:'reconciliation.finance.confirm',agreementId:f.agreement_id,summary:'Designated finance approver confirmed the exact bill comparison, annual scope, contract allocation and tax/credit adjustments with a retained explanation. No message sent.'}]}
}
const draft:Handler=async(c,p)=>{
 requireRole(c.actor,humanReconciliationRoles,'edit the credit request')
 const f=await finding(c,p.findingId,p.findingVersion),e=await currentEvidence(c,f)
 if(c.actor.id!==f.owner_id)fail('FORBIDDEN','Only the finding owner edits its supplier message.',403)
 if(f.status==='rejected')fail('STATUS','A rejected finding cannot be contacted.',409)
 if(await c.db.prepare('SELECT id FROM lk_reconciliation_dispatches WHERE finding_id=?').bind(f.id).first())fail('ALREADY_SENT','A send was already requested. Inspect its retained outcome.',409)
 const recipient=text(p,'recipient',254),subject=text(p,'subject',200),body=text(p,'message',12000)
 if(!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(recipient)||/[\r\n\x00-\x1f\x7f]/.test(subject)||body.includes('\0'))fail('INVALID','Supply one valid recipient, a single-line subject and the exact credit request text.')
 const digest=await messageDigest({...f,recipient,subject,message_text:body})
 return {allowed:humanReconciliationRoles,result:{id:f.id,messageDigest:digest},checks:e.checks,writes:[sql("UPDATE lk_reconciliation_findings SET recipient=?,subject=?,message_text=?,message_digest=?,approved_by=NULL,approved_at=NULL,status=CASE WHEN finance_by IS NULL THEN 'proposed' ELSE 'finance_confirmed' END,version=version+1 WHERE id=?",recipient,subject,body,digest,f.id)],audit:[{action:'reconciliation.message.edit',agreementId:f.agreement_id,summary:'Finding owner saved the exact credit-request recipient, subject and message. Any earlier message approval was withdrawn.'}]}
}
const approve:Handler=async(c,p)=>{
 requireRole(c.actor,humanReconciliationRoles,'approve the exact credit request')
 const f=await finding(c,p.findingId,p.findingVersion),e=await currentEvidence(c,f)
 if(c.actor.id!==f.owner_id)fail('FORBIDDEN','Only the finding owner approves its exact supplier message.',403)
 if(f.status!=='finance_confirmed'||!f.finance_by||f.finance_operator_version!==e.finance.person.version)fail('APPROVAL','Current designated finance confirmation is required first.',409)
 if(!f.message_digest||p.messageDigest!==f.message_digest||await messageDigest(f)!==f.message_digest||p.consent!==true)fail('APPROVAL','Review and explicitly approve the saved exact recipient, subject and message digest.',409)
 return {allowed:humanReconciliationRoles,result:{id:f.id,messageDigest:f.message_digest},checks:e.checks,writes:[sql("UPDATE lk_reconciliation_findings SET status='approved',approved_by=?,approved_at=?,version=version+1 WHERE id=?",c.actor.id,c.now,f.id)],audit:[{action:'reconciliation.message.approve',agreementId:f.agreement_id,summary:'Finding owner explicitly approved the exact saved recipient, subject and credit request. Approval alone sends no email and posts no accounting entry.'}]}
}
const reject:Handler=async(c,p)=>{
 requireRole(c.actor,humanReconciliationRoles,'reject an invoice finding')
 const f=await finding(c,p.findingId,p.findingVersion)
 if(![f.owner_id,f.finance_id,f.counsel_id].includes(c.actor.id))fail('FORBIDDEN','The finding owner, designated finance approver or designated counsel may reject this finding.',403)
 if(f.status==='rejected')fail('STATUS','This finding is already rejected.',409)
 if(await c.db.prepare('SELECT id FROM lk_reconciliation_dispatches WHERE finding_id=?').bind(f.id).first())fail('STATUS','A send request already exists; retain its outcome rather than rejecting it retroactively.',409)
 const reason=text(p,'reason',4000),content=JSON.parse(f.content)
 const checks=await sourceChecksForRejection(c,f.agreement_id,content.sources)
 return {allowed:humanReconciliationRoles,result:{id:f.id},checks:[...checks,sql('(SELECT version FROM lk_reconciliation_findings WHERE id=?)=?',f.id,f.version)],writes:[sql("UPDATE lk_reconciliation_findings SET status='rejected',rejected_by=?,rejected_at=?,rejection_reason=?,approved_by=NULL,approved_at=NULL,version=version+1 WHERE id=?",c.actor.id,c.now,reason,f.id)],audit:[{action:'reconciliation.reject',agreementId:f.agreement_id,summary:'Retained the reasoned rejection and exact evidence fingerprint. Identical future findings are suppressed.'}]}
}
// A changed source should not prevent retiring a bad finding; access still holds.
async function sourceChecksForRejection(c:Ctx,agreementId:string,sources:{id:string}[]) {
 await visibleAgreement(c,agreementId)
 for(const s of sources)await visibleAgreement(c,s.id)
 return sources.map(s=>visibleSql(c.actor,s.id))
}
export const reconciliationDecisionHandlers={'reconciliation.finance.confirm':finance,'reconciliation.message.edit':draft,'reconciliation.message.approve':approve,'reconciliation.reject':reject}
