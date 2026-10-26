import { may, requireRole } from './access'
import type { Ctx, Handler } from './commands'
import { accountingRealm, total, type AccountingLink } from './accounting-records'
import { accountingValueComparison } from './accounting-value'
import { fail, sql, text } from './model'
import { agreementGuards, visibleAgreement } from './records'

const compare:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'compare allocated accounting records with the contract schedule')
 const a=await visibleAgreement(c,p.agreementId),read=await c.db.prepare('SELECT * FROM lk_accounting_reads WHERE id=? AND agreement_id=?').bind(text(p,'readId',100),a.id).first<any>(),link=await c.db.prepare('SELECT * FROM lk_accounting_links WHERE agreement_id=?').bind(a.id).first<AccountingLink>()
 if(!read||!link)fail('NOT_FOUND','Read a linked accounting snapshot first.',404)
 if(link.version!==read.link_version||accountingRealm(c.env,link.provider)!==read.realm_id)fail('STALE','The accounting connection changed. Read a new snapshot.',409)
 const snapshot=JSON.parse(read.content),allocations=(await c.db.prepare('SELECT * FROM lk_accounting_allocations WHERE agreement_id=? AND active=1').bind(a.id).all<any>()).results
 if(read.agreement_version!==a.version&&!(read.agreement_version+1===a.version&&allocations.length>0&&allocations.every(r=>r.read_id===read.id)))fail('STALE','The agreement changed after this snapshot. Read and confirm fresh accounting evidence.',409)
 if(allocations.some(r=>r.agreement_version!==a.version||r.realm_id!==read.realm_id||r.vendor_id!==link.vendor_id))fail('STALE','Contract allocation changed or is stale. Read and confirm fresh allocation.',409)
 const documents=[...snapshot.bills,...(snapshot.invoices??[])],allocated=allocations.map(row=>{
  const document=documents.find(d=>d.id===row.bill_id)
  if(!document||row.amount_cents>document.totalCents)fail('STALE','The selected snapshot does not include every confirmed allocation. Read a complete matching period.',409)
  return {...document,allocatedCents:row.amount_cents}
 }),allocatedCents=total(allocated.map(d=>d.allocatedCents))
 const schedules=(await c.db.prepare("SELECT s.*,o.description,o.recurrence,o.status AS obligation_status,o.due_date AS obligation_due FROM lk_accounting_schedules s JOIN lk_obligations o ON o.id=s.obligation_id WHERE s.agreement_id=? AND s.status<>'cancelled' ORDER BY s.due_date,s.id").bind(a.id).all<any>()).results
 const dueDates=new Set(schedules.map(s=>s.due_date)),schedule=schedules.map(row=>{
  const billedCents=total(allocated.filter(d=>d.dueDate===row.due_date).map(d=>d.allocatedCents))
  const sameDate=schedules.filter(s=>s.due_date===row.due_date)
  return {scheduleId:row.id,obligationId:row.obligation_id,dueDate:row.due_date,plannedCents:row.amount_cents,billedCents:sameDate.length===1?billedCents:null,differenceCents:sameDate.length===1?billedCents-row.amount_cents:null,status:row.status,comparison:sameDate.length===1?'due_date_only':'ambiguous_due_date',sourceCurrent:row.obligation_status==='confirmed'&&row.agreement_version===a.version}
 })
 const value=accountingValueComparison(allocatedCents,a.value_cents),result={readId:read.id,direction:snapshot.direction??'spend',allocation:allocations.length?'confirmed':'unconfirmed',allocatedCents,contractValueCents:a.value_cents,percent:allocations.length?value?.percent??null:null,counterpartyTotalCents:snapshot.totalCents,paymentTotalCents:snapshot.paymentTotalCents??null,paymentsAllocation:'unconfirmed',schedule,unmatchedAllocatedCents:total(allocated.filter(d=>!d.dueDate||!dueDates.has(d.dueDate)).map(d=>d.allocatedCents)),basis:'Only explicitly allocated document cents are contract spend or billed revenue. Schedule comparisons group exact due dates; they do not infer which obligation an invoice settles. Payment totals remain counterparty-wide and do not prove contract settlement.'}
 return {allowed:may.manageRoles,result,checks:[...agreementGuards(c,a,p),sql('(SELECT version FROM lk_accounting_links WHERE agreement_id=?)=?',a.id,link.version),sql('(SELECT COUNT(*) FROM lk_accounting_allocations WHERE agreement_id=? AND active=1)=?',a.id,allocations.length)],writes:[],audit:[{action:'accounting.compare',agreementId:a.id,summary:'Compared explicitly allocated USD documents against retained contractual schedule dates, preserving unmatched and ambiguous amounts and separate unallocated payments.'}]}
}
export const accountingComparisonHandlers={'accounting.compare':compare}

export async function authorizeAccountingComparison(c:Ctx,p:Record<string,unknown>){
 requireRole(c.actor,may.manageRoles,'read a retained accounting comparison')
 const a=await visibleAgreement(c,p.agreementId),read=await c.db.prepare('SELECT * FROM lk_accounting_reads WHERE id=? AND agreement_id=?').bind(text(p,'readId',100),a.id).first<any>(),link=await c.db.prepare('SELECT * FROM lk_accounting_links WHERE agreement_id=?').bind(a.id).first<AccountingLink>()
 if(a.version!==p.version||!read||!link||link.version!==read.link_version||accountingRealm(c.env,link.provider)!==read.realm_id)fail('STALE','The comparison source changed. Read and confirm fresh accounting evidence.',409)
}
