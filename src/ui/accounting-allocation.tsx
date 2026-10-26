import { useState } from 'react'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can } from './format'
import { accountingValueComparison } from '../locket/accounting-value'

export function AccountingAllocation({state,a,locket}:{state:LocketState;a:Row;locket:Locket}){
 const [scheduleComparison,setScheduleComparison]=useState<any>(null)
 const link=state.accountingLinks.find(l=>l.agreement_id===a.id),read=state.accountingReads.find(r=>r.agreement_id===a.id),spend=read?JSON.parse(read.content):null
 const transactions=spend?(spend.direction==='revenue'?spend.invoices:spend.bills):[]
 const allocations=state.accountingAllocations.filter(r=>r.agreement_id===a.id&&r.active),current=allocations.length>0&&allocations.every(r=>r.agreement_version===a.version)&&link?.version===read?.link_version
 const total=allocations.reduce((n,r)=>n+r.amount_cents,0),comparison=current?accountingValueComparison(total,a.value_cents):null
 const dollars=(cents:number)=>(cents/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})
 return <section className="lk-panel" aria-label="Contract accounting">
  <div className="lk-panel-head"><h2>Contract accounting</h2></div>
  {allocations.length>0&&<p>{current?`Confirmed contract ${a.type==='customer'?'revenue':'spend'}: $${dollars(total)} USD${comparison?` · ${comparison.percent}% consumed`:''}.`:'Allocation sources changed — review a fresh accounting snapshot before relying on consumption.'}</p>}
  {can(state,'owner')&&<details><summary>Accounting source and period</summary>
   <Form busy={locket.busy} submit="Authorize accounting link" onSubmit={data=>void locket.run('accounting.link',{agreementId:a.id,version:a.version,provider:value(data,'provider'),...(a.type==='customer'?{customerId:value(data,'vendorId')}:{vendorId:value(data,'vendorId')}),consent:data.get('consent')==='on'})}>
    <Field label="Accounting provider"><select name="provider" defaultValue={link?.provider??'quickbooks'}><option value="quickbooks">QuickBooks Online</option><option value="pantry">Pantry</option><option value="netsuite">NetSuite</option></select></Field>
    <Field label={a.type==='customer'?'Accounting customer id':'Accounting vendor id'}><input name="vendorId" defaultValue={link?.vendor_id??''} required/></Field>
    <label className="lk-check"><input type="checkbox" name="consent" required/>I authorize a read-only accounting record link for this agreement.</label>
   </Form>
   {link&&<Form busy={locket.busy} submit="Read accounting records" onSubmit={data=>void locket.run('accounting.read',{agreementId:a.id,version:a.version,since:value(data,'since'),through:value(data,'through')})}>
    <Field label="Accounting period start"><input type="date" name="since" required/></Field><Field label="Accounting period end"><input type="date" name="through" required/></Field>
   </Form>}
  </details>}
  {spend&&read&&<><p>{a.type==='customer'?'Customer-period invoices:':'Vendor-period bills:'} ${dollars(spend.totalCents)} USD · {transactions.length} {a.type==='customer'?'invoices':'bills'} · {spend.since} through {spend.through}. Counterparty totals do not establish contract allocation.</p>
   {can(state,'owner')&&read.agreement_version===a.version&&read.link_version===link?.version&&<Form busy={locket.busy} submit="Confirm contract allocation" onSubmit={data=>void locket.run('accounting.allocate',{agreementId:a.id,version:a.version,readId:read.id,allocations:transactions.filter((b:any)=>data.get('bill-'+b.id)==='on').map((b:any)=>({billId:b.id,amount:value(data,'amount-'+b.id)})),confirmAllocation:data.get('confirm')==='on'})}>
    {transactions.map((b:any)=><div key={b.id}><label className="lk-check"><input type="checkbox" name={'bill-'+b.id}/>{a.type==='customer'?'Invoice':'Bill'} {b.id} · {b.date} · ${dollars(b.totalCents)} USD</label><Field label={`Contract amount for ${a.type==='customer'?'invoice':'bill'} ${b.id} (USD)`}><input name={'amount-'+b.id} inputMode="decimal" defaultValue={(b.totalCents/100).toFixed(2)}/></Field></div>)}
    <label className="lk-check"><input type="checkbox" name="confirm" required/>I confirm the selected exact amounts are attributable to this contract.</label>
   </Form>}
   {spend.payments&&<p>Counterparty payments: ${dollars(spend.paymentTotalCents)} USD · {spend.payments.length} payments. Payment totals remain unallocated and do not establish contract settlement.</p>}
   {can(state,'owner')&&<button disabled={locket.busy} onClick={()=>void locket.run('accounting.compare',{agreementId:a.id,version:a.version,readId:read.id}).then(result=>setScheduleComparison(result?{...result,sourceVersion:a.version}:null))}>Compare contract schedule</button>}
   {scheduleComparison?.readId===read.id&&scheduleComparison.sourceVersion===a.version&&<div aria-label="Contract schedule comparison"><p>Contract allocation: {scheduleComparison.allocation}. Payments remain unallocated.</p>{scheduleComparison.schedule.length?<div style={{overflowX:'auto'}}><table className="lk-table"><thead><tr><th>Due date</th><th>Planned USD</th><th>Allocated USD</th><th>Difference USD</th><th>Basis</th></tr></thead><tbody>{scheduleComparison.schedule.map((row:any)=><tr key={row.scheduleId}><td data-label="Due date">{row.dueDate}</td><td data-label="Planned USD">{dollars(row.plannedCents)}</td><td data-label="Allocated USD">{row.billedCents===null?'Unknown':dollars(row.billedCents)}</td><td data-label="Difference USD">{row.differenceCents===null?'Unknown':dollars(row.differenceCents)}</td><td data-label="Basis">{!row.sourceCurrent?'Source changed':row.comparison==='ambiguous_due_date'?'Ambiguous date':'Due date only'}</td></tr>)}</tbody></table></div>:<p>No retained proposed payment schedule.</p>}<p>Allocated amounts outside the schedule: ${dollars(scheduleComparison.unmatchedAllocatedCents)} USD. A matching due date does not prove payment.</p></div>}
  </>}
 </section>
}
