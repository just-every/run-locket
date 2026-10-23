import type { Bindings } from '../auth.server'
import { auditSql, guardSql, type Ctx } from './commands'
import { auditInsert } from './audit'
import { installationMail, installationMailLocal } from './installation-mail'
import { installationSettings } from './installation'
import { localMinute } from './report-schedule'
import { reportSnapshot } from './report-snapshot'
import { hiddenFields, policyVersionCheck, repositoryPolicy } from './repository-access'
import { sql } from './model'
import { buildOutcomeReport } from './outcome-report-data'
import { shiftMonth } from './outcome-report-model'
import { outcomeDeliveryWrite, outcomePerson, outcomePersonCheck, outcomeSettings, outcomeSettingsCheck } from './outcome-report'

type Delivery={id:string;month:string;recipient_id:string;settings_version:number;status:string}
/** Recurring authorization queues the latest complete month once. It never replays
 * a backlog or retries a claimed send, including an uncertain provider outcome. */
export async function runOutcomeReports(env:Bindings,now:number){
 const db=env.DB,settings=await outcomeSettings(db)
 if(settings?.enabled){const zone=(await installationSettings(db)).timezone,current=localMinute(now,zone).slice(0,7)
  if(settings.next_month<current){const owner=await outcomePerson(db,settings.consent_by)
   if(owner&&owner.role==='owner'&&owner.operatorVersion===settings.consent_operator_version){const month=shiftMonth(current,-1),guard=crypto.randomUUID()
    await db.batch([guardSql(guard,[outcomeSettingsCheck(settings.version),outcomePersonCheck(owner)]),...JSON.parse(settings.recipients).map((id:string)=>outcomeDeliveryWrite(month,id,settings,now)),sql("UPDATE lk_outcome_report_settings SET next_month=? WHERE id='installation'",current),sql('DELETE FROM lk_guard WHERE id=?',guard)].map(s=>db.prepare(s.sql).bind(...s.params)))
   }
  }
 }
 await dispatchOutcomeReports(env,now)
}
export async function dispatchOutcomeReports(env:Bindings,now=Date.now()){
 const db=env.DB,queued=(await db.prepare("SELECT * FROM lk_outcome_report_deliveries WHERE status='queued' ORDER BY created_at,id").all<Delivery>()).results
 for(const d of queued){
  const settings=await outcomeSettings(db),owner=settings?await outcomePerson(db,settings.consent_by):null,person=await outcomePerson(db,d.recipient_id)
  const actor=owner??person
  if(!actor){await db.prepare("UPDATE lk_outcome_report_deliveries SET status='cancelled' WHERE id=? AND status='queued'").bind(d.id).run();continue}
  const c:Ctx={env,db,actor,now,commandId:d.id};let claimed=false
  const finish=async(status:string,messageId:string|null=null)=>{const audit=auditSql(c,{action:`outcome-report.email.${status}`,summary:status==='accepted'?'Mail provider accepted a generic monthly report link. No report data was emailed; mailbox delivery remains unconfirmed.':`Monthly outcome link mail ${status}; no automatic resend.`},'scheduler')
   await db.batch([sql('UPDATE lk_outcome_report_deliveries SET status=?,provider_message_id=? WHERE id=? AND status=?',status,messageId,d.id,claimed?'sending':'queued'),audit].map(s=>db.prepare(s.sql).bind(...s.params)))
  }
  try{
   if(!settings||!owner||owner.role!=='owner'||owner.operatorVersion!==settings.consent_operator_version||!person||settings.version!==d.settings_version||!JSON.parse(settings.recipients).includes(person.id)||(await hiddenFields(db,person)).length){await finish('cancelled');continue}
   const policy=await repositoryPolicy(db),out=await buildOutcomeReport(env,person,d.month,JSON.parse(settings.accounting_links),now),guard=crypto.randomUUID(),attempt=crypto.randomUUID()
   const checks=[outcomeSettingsCheck(settings.version),outcomePersonCheck(owner),outcomePersonCheck(person),policyVersionCheck(policy.version),...out.checks,reportSnapshot(person,out.agreements),sql("COALESCE((SELECT version FROM lk_installation_settings WHERE id='installation'),0)=?",out.settingsVersion),sql("EXISTS(SELECT 1 FROM lk_outcome_report_deliveries WHERE id=? AND status='queued')",d.id)]
   const readCtx={...c,actor:person},audits=auditInsert(readCtx,[{action:'outcome-report.read',summary:`Generated the twelve-month report ending ${d.month} for an owner-selected recipient under current access; only a generic link is mailed.`},...out.agreements.filter(a=>a.restricted).map(a=>({action:'outcome-report.read',agreementId:a.id,summary:'Read restricted evidence for an authorized monthly outcome report.'}))],'scheduler')
   await db.batch([guardSql(guard,checks),sql("UPDATE lk_outcome_report_deliveries SET status='sending',attempt_id=?,attempted_at=? WHERE id=? AND status='queued'",attempt,now,d.id),audits,sql('DELETE FROM lk_guard WHERE id=?',guard)].map(s=>db.prepare(s.sql).bind(...s.params)));claimed=true
   if(installationMailLocal(env)){await finish('suppressed');continue}
   const sender=installationMail(env)
   if(!sender||!env.MAIL_FROM){await finish('rejected');continue}
   const url=new URL('/app',new URL(env.AUTH_ORIGIN).origin);url.hash=`outcome-report/${d.month}`
   const sent=await sender.send({deliveryId:d.id,from:env.MAIL_FROM,to:[person.email],subject:'Your monthly Locket report is ready',text:`Open Locket to view your monthly report: ${url.href}\nSign in to view only records you may currently access.`,html:`<p>Your monthly Locket report is ready. Sign in to view it.</p><p><a href="${url.href.replaceAll('&','&amp;').replaceAll('"','&quot;')}">Open Locket</a></p>`,headers:{}})
   await finish(sent.status==='development'?'suppressed':sent.status,sent.providerMessageId)
  }catch{await finish(claimed?'uncertain':'cancelled')}
 }
}
