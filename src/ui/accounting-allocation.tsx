import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can } from './format'
import { accountingValueComparison } from '../locket/accounting-value'

export function AccountingAllocation({state,a,locket}:{state:LocketState;a:Row;locket:Locket}){
 const link=state.accountingLinks.find(l=>l.agreement_id===a.id),read=state.accountingReads.find(r=>r.agreement_id===a.id),spend=read?JSON.parse(read.content):null
 const allocations=state.accountingAllocations.filter(r=>r.agreement_id===a.id&&r.active),current=allocations.length>0&&allocations.every(r=>r.agreement_version===a.version)&&link?.version===read?.link_version
 const total=allocations.reduce((n,r)=>n+r.amount_cents,0),comparison=current?accountingValueComparison(total,a.value_cents):null
 const dollars=(cents:number)=>(cents/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})
 return <section className="lk-panel" aria-label="Contract accounting">
  <div className="lk-panel-head"><h2>Contract accounting</h2></div>
  {allocations.length>0&&<p>{current?`Confirmed contract spend: $${dollars(total)} USD${comparison?` · ${comparison.percent}% consumed`:''}.`:'Allocation sources changed — review a fresh accounting snapshot before relying on consumption.'}</p>}
  {can(state,'owner')&&<details><summary>Accounting source and period</summary>
   <Form busy={locket.busy} submit="Authorize accounting link" onSubmit={data=>void locket.run('accounting.link',{agreementId:a.id,version:a.version,vendorId:value(data,'vendorId'),consent:data.get('consent')==='on'})}>
    <Field label="QuickBooks vendor id"><input name="vendorId" pattern="[0-9]+" defaultValue={link?.vendor_id??''} required/></Field>
    <label className="lk-check"><input type="checkbox" name="consent" required/>I authorize a read-only vendor bill link for this agreement.</label>
   </Form>
   {link&&<Form busy={locket.busy} submit="Read vendor bills" onSubmit={data=>void locket.run('accounting.read',{agreementId:a.id,version:a.version,since:value(data,'since'),through:value(data,'through')})}>
    <Field label="Accounting period start"><input type="date" name="since" required/></Field><Field label="Accounting period end"><input type="date" name="through" required/></Field>
   </Form>}
  </details>}
  {spend&&read&&<><p>Vendor-period bills: ${dollars(spend.totalCents)} USD · {spend.bills.length} bills · {spend.since} through {spend.through}. Vendor-wide totals do not establish contract allocation.</p>
   {can(state,'owner')&&read.agreement_version===a.version&&read.link_version===link?.version&&<Form busy={locket.busy} submit="Confirm contract allocation" onSubmit={data=>void locket.run('accounting.allocate',{agreementId:a.id,version:a.version,readId:read.id,allocations:spend.bills.filter((b:any)=>data.get('bill-'+b.id)==='on').map((b:any)=>({billId:b.id,amount:value(data,'amount-'+b.id)})),confirmAllocation:data.get('confirm')==='on'})}>
    {spend.bills.map((b:any)=><div key={b.id}><label className="lk-check"><input type="checkbox" name={'bill-'+b.id}/>Bill {b.id} · {b.date} · ${dollars(b.totalCents)} USD</label><Field label={`Contract amount for bill ${b.id} (USD)`}><input name={'amount-'+b.id} inputMode="decimal" defaultValue={(b.totalCents/100).toFixed(2)}/></Field></div>)}
    <label className="lk-check"><input type="checkbox" name="confirm" required/>I confirm the selected exact amounts are attributable to this contract.</label>
   </Form>}
  </>}
 </section>
}
