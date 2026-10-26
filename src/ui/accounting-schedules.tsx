import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can } from './format'

export function AccountingSchedules({state,a,locket}:{state:LocketState;a:Row;locket:Locket}) {
 const schedules=state.accountingSchedules.filter(r=>r.agreement_id===a.id)
 const obligations=state.obligations.filter(o=>o.agreement_id===a.id&&o.status==='confirmed'&&o.due_date&&o.recurrence==='none'&&!schedules.some(r=>r.obligation_id===o.id))
 const labels:Record<string,string>={draft:'Draft for owner review',sending:'Sending approved proposal',pending:'Pending acceptance in Pantry',accepted:'Accepted in Pantry — payment unconfirmed',uncertain:'Outcome unknown — inspect Pantry before taking further action',refused:'Pantry refused the proposal',cancelled:'Cancelled — source or destination changed'}
 return <section className="lk-panel" aria-label="Payment schedule">
  <div className="lk-panel-head"><h2>Payment schedule</h2></div>
  <p>Offer a confirmed payment obligation as an unposted Pantry bill. A person accepts it in Pantry; Locket never posts or pays it.</p>
  {schedules.map(r=><article key={r.id} className="lk-card">
   <h3>{labels[r.status]}</h3><p>${(r.amount_cents/100).toFixed(2)} USD · due {r.due_date} · {r.origin}</p>
   <details><summary>Exact proposed bill</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(JSON.parse(r.payload),null,2)}</pre><blockquote>{JSON.parse(r.citation).quote}</blockquote></details>
   {r.remote_id&&<p>Pantry bill {r.remote_id} · last checked {new Date(r.checked_at).toISOString()}</p>}
   {can(state,'owner')&&r.status==='draft'&&<Form busy={locket.busy} submit="Send proposed bill" onSubmit={data=>void locket.run('accounting.schedule.send',{scheduleId:r.id,payload:r.payload,consent:data.get('consent')==='on'})}>
    <label className="lk-check"><input type="checkbox" name="consent" required/>I reviewed and authorize this exact draft bill and destination.</label>
   </Form>}
   {can(state,'owner')&&['pending','accepted'].includes(r.status)&&<button disabled={locket.busy} onClick={()=>void locket.run('accounting.schedule.check',{scheduleId:r.id})}>Check Pantry acceptance</button>}
  </article>)}
  {can(state,'owner')&&obligations.length>0&&<details><summary>Prepare a proposed payment</summary>
   <Form busy={locket.busy} submit="Prepare proposed bill" onSubmit={data=>void locket.run('accounting.schedule.prepare',{agreementId:a.id,version:a.version,obligationId:value(data,'obligationId'),amount:value(data,'amount'),billDate:value(data,'billDate'),vendorId:value(data,'vendorId'),accountId:value(data,'accountId'),citation:{quote:value(data,'quote')},confirmAllocation:data.get('allocation')==='on'})}>
    <Field label="Confirmed payment obligation"><select name="obligationId">{obligations.map(o=><option key={o.id} value={o.id}>{o.description} · {o.due_date}</option>)}</select></Field>
    <Field label="Allocated amount (USD)"><input name="amount" inputMode="decimal" required/></Field>
    <Field label="Bill date"><input name="billDate" type="date" required/></Field>
    <Field label="Pantry vendor id"><input name="vendorId" required/></Field>
    <Field label="Pantry expense account id"><input name="accountId" required/></Field>
    <Field label="Exact signed payment passage"><textarea name="quote" required/></Field>
    <label className="lk-check"><input type="checkbox" name="allocation" required/>I confirm this exact USD amount belongs to this contractual obligation.</label>
   </Form>
  </details>}
  {!schedules.length&&!obligations.length&&<p>Confirm a nonrecurring payment obligation and its due date first.</p>}
 </section>
}
