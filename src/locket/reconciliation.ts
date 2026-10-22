import { accountingSpend } from './accounting'
import { may, requireRole } from './access'
import type { Handler } from './commands'
import { canonical, date, fail, integer, json, sha256, sql, text } from './model'
import { citation } from './obligations'
import { agreementGuards, bump, visibleAgreement } from './records'
import { familySources, findingOwnerRoles, participant, procurementDependency, reconciliationRoles, settings, sourceChecks } from './reconciliation-records'
import { reconciliationDecisionHandlers } from './reconciliation-decisions'
import { reconciliationMailHandlers } from './reconciliation-mail'
import { notificationWrites } from './notifications'
import { requireFamilyClear } from './family-analysis-guard'

const configure:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'authorize invoice reconciliation')
 const a=await visibleAgreement(c,p.agreementId),family=await familySources(c,a)
 if(a.type!=='supplier'||!['executed','imported'].includes(a.status))fail('NOT_EXECUTED','Invoice reconciliation requires an executed or imported supplier agreement.',409)
 if(p.consent!==true)fail('CONSENT','Explicitly authorize reading linked vendor bills and preparing findings. Supplier contact still needs exact-message approval.')
 const counselId=text(p,'counselId',100),financeId=text(p,'financeId',100),ownerId=text(p,'ownerId',100),ids=family.sources.map(s=>s.id)
 const counsel=await participant(c,counselId,['owner','counsel'],ids),finance=await participant(c,financeId,['owner','approver'],ids),owner=await participant(c,ownerId,findingOwnerRoles,ids)
 return {allowed:may.manageRoles,result:{agreementId:a.id},checks:[...agreementGuards(c,a,p),...family.checks,counsel.check,finance.check,owner.check],writes:[sql('INSERT INTO lk_reconciliation_settings(agreement_id,counsel_id,finance_id,owner_id,consent_by,consent_at,version) VALUES(?,?,?,?,?,?,1) ON CONFLICT(agreement_id) DO UPDATE SET counsel_id=excluded.counsel_id,finance_id=excluded.finance_id,owner_id=excluded.owner_id,consent_by=excluded.consent_by,consent_at=excluded.consent_at,version=lk_reconciliation_settings.version+1',a.id,counselId,financeId,ownerId,c.actor.id,c.now),bump(c,a)],audit:[{action:'reconciliation.configure',agreementId:a.id,summary:'Owner authorized read-only invoice reconciliation and designated counsel, finance and the finding owner. No supplier contact or accounting posting authorized.'}]}
}
const interpret:Handler=async(c,p)=>{
 requireRole(c.actor,['owner','counsel'],'confirm the signed pricing interpretation')
 const a=await visibleAgreement(c,p.agreementId),s=await settings(c,a.id),family=await familySources(c,a)
 family.checks.push(await requireFamilyClear(c,a.id))
 if(c.actor.id!==s.counsel_id)fail('FORBIDDEN','Only the designated counsel confirms this interpretation.',403)
 const sourceId=text(p,'sourceAgreementId',100),source=family.rows.find(a=>a.id===sourceId)
 if(!source||!['executed','imported'].includes(source.status))fail('CITATION','Choose an executed agreement or amendment in this agreement family.')
 const capBps=integer(p,'capBps',0,100000),interpretation=text(p,'interpretation',4000)
 if(p.confirmAnnualComparableBasis!==true)fail('CONSENT','Confirm that the interpretation applies one annual increase to a comparable baseline and identifies any amendment, scope, tax or credit adjustments.')
 const cite=await citation(c,source,p.citation),id=crypto.randomUUID()
 const active=await participant(c,s.counsel_id,['owner','counsel'],family.sources.map(s=>s.id)),prior=await c.db.prepare('SELECT id FROM lk_reconciliation_interpretations WHERE agreement_id=? ORDER BY rowid DESC LIMIT 1').bind(a.id).first<{id:string}>()
 return {allowed:['owner','counsel'],result:{id},checks:[...agreementGuards(c,a,p),...family.checks,active.check,sql('(SELECT version FROM lk_reconciliation_settings WHERE agreement_id=?)=?',a.id,s.version),sql('(SELECT id FROM lk_reconciliation_interpretations WHERE agreement_id=? ORDER BY rowid DESC LIMIT 1) IS ?',a.id,prior?.id??null)],writes:[sql('INSERT INTO lk_reconciliation_interpretations VALUES(?,?,?,?,?,?,?,?,?,?)',id,a.id,s.version,source.id,json(family.sources),capBps,interpretation,json(cite),c.actor.id,c.now)],audit:[{action:'reconciliation.interpret',agreementId:a.id,summary:'Designated counsel confirmed the exact signed clause and annual-comparison interpretation, including the numeric cap. Finance must still confirm comparable invoices and adjustments.'}]}
}
const scan:Handler=async(c,p)=>{
 requireRole(c.actor,reconciliationRoles,'read authorized bills for reconciliation')
 const a=await visibleAgreement(c,p.agreementId),s=await settings(c,a.id)
 const i=await c.db.prepare('SELECT * FROM lk_reconciliation_interpretations WHERE agreement_id=? ORDER BY rowid DESC LIMIT 1').bind(a.id).first<any>()
 if(!i||i.settings_version!==s.version)fail('INTERPRETATION','Designated counsel must confirm the current pricing interpretation first.',409)
 const checks=await sourceChecks(c,a.id,i.sources),ids=JSON.parse(i.sources).map((s:any)=>s.id)
 for(const [id,roles]of [[s.counsel_id,['owner','counsel']],[s.finance_id,['owner','approver']],[s.owner_id,findingOwnerRoles]] as const)checks.push((await participant(c,id,roles,ids)).check)
 const link=await c.db.prepare('SELECT * FROM lk_accounting_links WHERE agreement_id=?').bind(a.id).first<any>()
 if(!link)fail('ACCOUNTING_UNAVAILABLE','The owner must authorize the read-only QuickBooks vendor link first.',409)
 const since=date(p,'since'),through=date(p,'through')
 if(since>through||through>new Date(c.now).toISOString().slice(0,10))fail('INVALID','Choose a complete bill period ending no later than today.')
 const spend=await accountingSpend(c.env,link.vendor_id,since,through),id=crypto.randomUUID()
 const content={...spend,asOf:c.now,procurement:{status:'unavailable',detail:procurementDependency}}
 return {allowed:reconciliationRoles,result:{id,billCount:spend.bills.length},checks:[...checks,sql('(SELECT version FROM lk_reconciliation_settings WHERE agreement_id=?)=?',a.id,s.version),sql('(SELECT version FROM lk_accounting_links WHERE agreement_id=?)=?',a.id,link.version),sql('(SELECT id FROM lk_reconciliation_interpretations WHERE agreement_id=? ORDER BY rowid DESC LIMIT 1)=?',a.id,i.id)],writes:[sql('INSERT INTO lk_reconciliation_scans VALUES(?,?,?,?,?,?,?,?,?)',id,a.id,i.id,s.version,link.version,i.sources,json(content),c.actor.id,c.now)],audit:[{action:'reconciliation.scan',agreementId:a.id,summary:'Read a complete, dated QuickBooks vendor-period bill snapshot. Contract allocation, payment, credits and Purse POs are not inferred.'}]}
}
const prepare:Handler=async(c,p)=>{
 requireRole(c.actor,reconciliationRoles,'prepare an invoice finding')
 const a=await visibleAgreement(c,p.agreementId),s=await settings(c,a.id),scan=await c.db.prepare('SELECT * FROM lk_reconciliation_scans WHERE id=? AND agreement_id=?').bind(text(p,'scanId',100),a.id).first<any>()
 if(!scan)fail('NOT_FOUND','No accessible invoice snapshot has that identity.',404)
 const checks=await sourceChecks(c,a.id,scan.sources)
 if(scan.settings_version!==s.version)fail('STALE','The reconciliation configuration changed. Read fresh bills.',409)
 const i=await c.db.prepare('SELECT * FROM lk_reconciliation_interpretations WHERE agreement_id=? ORDER BY rowid DESC LIMIT 1').bind(a.id).first<any>()
 if(i?.id!==scan.interpretation_id)fail('STALE','The signed interpretation changed. Read fresh bills.',409)
 const spend=JSON.parse(scan.content),baseline=spend.bills.find((b:any)=>b.id===text(p,'baselineBillId',100)),bill=spend.bills.find((b:any)=>b.id===text(p,'billId',100))
 if(!baseline||!bill||baseline.id===bill.id||baseline.date>=bill.date||baseline.totalCents<=0)fail('INVALID','Choose a positive earlier baseline bill and a different later bill from the same complete snapshot.')
 const allowed=Number((BigInt(baseline.totalCents)*BigInt(10000+i.cap_bps)+5000n)/10000n),atStake=bill.totalCents-allowed
 if(!Number.isSafeInteger(allowed)||!Number.isSafeInteger(atStake))fail('ACCOUNTING_DATA','The comparison exceeds the supported exact USD range.',409)
 if(atStake<=0)fail('NO_FINDING','This invoice does not exceed the counsel-confirmed cap on the selected baseline.',409)
 const evidence={kind:'annual_price_increase',agreementId:a.id,vendorId:spend.vendorId,baseline,bill,capBps:i.cap_bps,allowedCents:allowed,atStakeCents:atStake,sourceAgreementId:i.source_agreement_id,citation:JSON.parse(i.citation),interpretation:i.interpretation}
 const economicBill=(b:any)=>({id:b.id,date:b.date,totalCents:b.totalCents})
 const evidenceKey=await sha256(canonical({...evidence,baseline:economicBill(baseline),bill:economicBill(bill)}))
 const fingerprint=await sha256(canonical({evidenceKey,sources:JSON.parse(scan.sources),settingsVersion:s.version,linkVersion:scan.link_version,interpretationId:i.id}))
 const prior=await c.db.prepare("SELECT id,status FROM lk_reconciliation_findings WHERE agreement_id=? AND (fingerprint=? OR (evidence_key=? AND status='rejected')) ORDER BY CASE WHEN status='rejected' THEN 0 ELSE 1 END LIMIT 1").bind(a.id,fingerprint,evidenceKey).first<any>()
 if(prior)return {allowed:reconciliationRoles,result:{id:prior.status==='rejected'?null:prior.id,suppressed:prior.status==='rejected'},checks,writes:[],audit:[]}
 const id=crypto.randomUUID(),amount=(atStake/100).toFixed(2),content={...evidence,observedIncreasePercent:100*(bill.totalCents-baseline.totalCents)/baseline.totalCents,sources:JSON.parse(scan.sources),procurement:spend.procurement,basis:'Potential overcharge only. Finance must confirm full contract allocation, equal annual service/quantity scope, and all tax, credit and adjustment effects; total vendor bills alone do not prove an overcharge.'}
 const ids=content.sources.map((s:any)=>s.id)
 const people=[]
 for(const [personId,roles]of [[s.counsel_id,['owner','counsel']],[s.finance_id,['owner','approver']],[s.owner_id,findingOwnerRoles]] as const)people.push((await participant(c,personId,roles,ids)).check)
 const subject=`Credit request: ${a.reference}, bill ${bill.id}`
 const body=`Please review a potential USD ${amount} overcharge on bill ${bill.id} dated ${bill.date}. The comparable baseline bill ${baseline.id} is USD ${(baseline.totalCents/100).toFixed(2)}; the current bill is USD ${(bill.totalCents/100).toFixed(2)}. The confirmed annual increase cap is ${i.cap_bps/100}%, allowing USD ${(allowed/100).toFixed(2)}.\n\nContract clause: “${content.citation.quote}”\nInterpretation: ${i.interpretation}\n\nPlease confirm the appropriate credit or explain any difference in scope, tax or credits.`
 return {allowed:reconciliationRoles,result:{id,suppressed:false,atStakeCents:atStake},checks:[...checks,...people,sql('(SELECT version FROM lk_reconciliation_settings WHERE agreement_id=?)=?',a.id,s.version),sql('(SELECT version FROM lk_accounting_links WHERE agreement_id=?)=?',a.id,scan.link_version),sql('(SELECT id FROM lk_reconciliation_interpretations WHERE agreement_id=? ORDER BY rowid DESC LIMIT 1)=?',a.id,i.id),sql("NOT EXISTS(SELECT 1 FROM lk_reconciliation_findings WHERE agreement_id=? AND (fingerprint=? OR (evidence_key=? AND status='rejected')))",a.id,fingerprint,evidenceKey)],writes:[sql("INSERT INTO lk_reconciliation_findings(id,agreement_id,scan_id,fingerprint,evidence_key,content,owner_id,counsel_id,finance_id,status,subject,message_text,created_at) VALUES(?,?,?,?,?,?,?,?,?,'proposed',?,?,?)",id,a.id,scan.id,fingerprint,evidenceKey,json(content),s.owner_id,s.counsel_id,s.finance_id,subject,body,c.now),...notificationWrites(c,{key:id,agreementId:a.id,recipientId:s.finance_id,kind:'approval'})],audit:[{action:'reconciliation.prepare',agreementId:a.id,summary:`Prepared a potential USD ${amount} above-cap finding citing signed terms and both QuickBooks bills. Finance confirmation and finding-owner exact-message approval are required before contact.`}]}
}
export const reconciliationHandlers={'reconciliation.configure':configure,'reconciliation.interpret':interpret,'reconciliation.scan':scan,'reconciliation.prepare':prepare,...reconciliationDecisionHandlers,...reconciliationMailHandlers}
