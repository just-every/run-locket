import { requireRole } from './access'
import type { Handler } from './commands'
import { refuseErasedAddress } from './erasure-addresses'
import { fail,sql,text } from './model'
import { serviceClaim,serviceMessageDigest,servicePeople } from './service-level-records'

const message:Handler=async(c,p)=>{
 requireRole(c.actor,servicePeople,'prepare a service-credit claim message')
 const e=await serviceClaim(c,p.claimId,p.claimVersion),f=e.claim
 if(c.actor.id!==e.a.owner_id)fail('FORBIDDEN','Only the agreement owner may edit this supplier claim.',403)
 if(await c.db.prepare('SELECT id FROM lk_service_level_dispatches WHERE agreement_id=? AND monitor_id=? AND month=?').bind(f.agreement_id,f.monitor_id,f.month).first())fail('ALREADY_SENT','This service month already has a send request. Review its outcome; it is never automatically resent.',409)
 const recipient=text(p,'recipient',254),subject=text(p,'subject',200),body=text(p,'message',12000)
 if(!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(recipient)||/[\r\n\x00-\x1f\x7f]/.test(subject)||body.includes('\0'))fail('INVALID','Supply one email address, a single-line subject and the exact claim text.')
 const digest=await serviceMessageDigest({...f,recipient,subject,message_text:body}),erased=await refuseErasedAddress(c,'request.create',p)
 return {allowed:servicePeople,result:{id:f.id,messageDigest:digest},checks:[...e.checks,...erased],writes:[sql("UPDATE lk_service_level_claims SET recipient=?,subject=?,message_text=?,message_digest=?,status='proposed',approved_by=NULL,approved_at=NULL,approved_operator_version=NULL,version=version+1 WHERE id=?",recipient,subject,body,digest,f.id)],audit:[{action:'service-level.message',agreementId:f.agreement_id,summary:'Agreement owner saved the exact supplier-claim recipient, subject and text. Any previous approval was withdrawn.'}]}
}
const approve:Handler=async(c,p)=>{
 requireRole(c.actor,servicePeople,'approve a service-credit claim and amount')
 const e=await serviceClaim(c,p.claimId,p.claimVersion),f=e.claim
 if(c.actor.id!==e.a.owner_id)fail('FORBIDDEN','Only the agreement owner approves this claim and its amount.',403)
 if(f.status!=='proposed'||!f.message_digest||p.consent!==true||p.amountCents!==f.amount_cents||p.messageDigest!==f.message_digest||await serviceMessageDigest(f)!==f.message_digest)fail('APPROVAL','Explicitly approve the exact USD amount, recipient, subject and saved message digest.',409)
 return {allowed:servicePeople,result:{id:f.id,amountCents:f.amount_cents,messageDigest:f.message_digest},checks:e.checks,writes:[sql("UPDATE lk_service_level_claims SET status='approved',approved_by=?,approved_at=?,approved_operator_version=?,version=version+1 WHERE id=?",c.actor.id,c.now,c.actor.operatorVersion,f.id)],audit:[{action:'service-level.approve',agreementId:f.agreement_id,summary:'Agreement owner explicitly approved the exact USD service-credit amount and supplier message. Approval sends nothing; recovery remains unconfirmed.'}]}
}
export const serviceClaimHandlers={'service-level.message':message,'service-level.approve':approve}
