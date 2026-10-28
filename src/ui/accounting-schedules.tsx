import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can } from './format'

export function AccountingSchedules({state,a,locket}:{state:LocketState;a:Row;locket:Locket}) {
 const customer=a.type==='customer'
 const schedules=state.accountingSchedules.filter(r=>r.agreement_id===a.id)
 const obligations=state.obligations.filter(o=>o.agreement_id===a.id&&o.status==='confirmed'&&o.due_date&&!schedules.some(r=>r.obligation_id===o.id&&r.status!=='cancelled'&&(r.status!=='draft'||r.destination_current)))
 const labels:Record<string,string>={draft:'Draft for owner review',sending:'Sending approved proposal',pending:'Pending acceptance in Pantry',accepted:'Accepted in Pantry — payment unconfirmed',uncertain:'Outcome unknown — inspect Pantry before taking further action',refused:'Pantry refused the proposal',cancelled:'Cancelled — source or destination changed'}
 return <section className="lk-panel" aria-label="Payment schedule">
  <div className="lk-panel-head"><h2>Payment schedule</h2></div>
  <p>Offer confirmed payment obligations as unposted Pantry bills or draft customer invoices. A person accepts it in Pantry; Locket never posts or pays it.</p>
  {schedules.map(r=><article key={r.id} className="lk-card">
   <h3>{labels[r.status]}</h3>{customer&&<p>Customer invoice reminder.</p>}<p>${(r.amount_cents/100).toFixed(2)} USD · due {r.due_date} · {r.origin} · destination revision {r.destination_revision}</p>
   {!r.destination_current&&<p role="status">Destination consent is stale. This retained proposal cannot be sent or checked against the current connection. Review the destination under Settings.</p>}
   <details><summary>{customer?'Exact proposed invoice':'Exact proposed bill'}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(JSON.parse(r.payload),null,2)}</pre><blockquote>{JSON.parse(r.citation).quote}</blockquote></details>
   {r.remote_id&&<p>Pantry {customer?'invoice':'bill'} {r.remote_id} · last checked {new Date(r.checked_at).toISOString()}</p>}
   {can(state,'owner')&&r.status==='draft'&&r.destination_current&&<Form busy={locket.busy} submit={customer?'Send proposed invoice':'Send proposed bill'} onSubmit={data=>void locket.run('accounting.schedule.send',{scheduleId:r.id,payload:r.payload,consent:data.get('consent')==='on'})}>
    <label className="lk-check"><input type="checkbox" name="consent" required/>I reviewed and authorize this exact draft {customer?'invoice':'bill'} and destination.</label>
   </Form>}
   {can(state,'owner')&&['pending','accepted'].includes(r.status)&&r.destination_current&&<button disabled={locket.busy} onClick={()=>void locket.run('accounting.schedule.check',{scheduleId:r.id})}>Check Pantry acceptance</button>}
  </article>)}
  {can(state,'owner')&&obligations.length>0&&<details><summary>Prepare a proposed payment</summary>
   <Form busy={locket.busy} submit={customer?'Prepare proposed invoice':'Prepare proposed bill'} onSubmit={data=>void locket.run('accounting.schedule.prepare',{agreementId:a.id,version:a.version,obligationId:value(data,'obligationId'),amount:value(data,'amount'),billDate:value(data,'billDate'),occurrences:Number(value(data,'occurrences')),...(customer?{taxCode:value(data,'taxCode')}:{ }),...(customer?{customerId:value(data,'vendorId')}:{vendorId:value(data,'vendorId')}),accountId:value(data,'accountId'),citation:{quote:value(data,'quote')},confirmAllocation:data.get('allocation')==='on'})}>
    <Field label="Confirmed payment obligation"><select name="obligationId">{obligations.map(o=><option key={o.id} value={o.id}>{o.description} · {o.due_date}</option>)}</select></Field>
    <Field label="Allocated amount (USD)"><input name="amount" inputMode="decimal" required/></Field>
    <Field label="Number of scheduled occurrences"><input name="occurrences" type="number" min="1" max="120" defaultValue="1" required/></Field>
    <Field label="Bill date"><input name="billDate" type="date" required/></Field>
    <Field label={customer?'Pantry customer id':'Pantry vendor id'}><input name="vendorId" required/></Field>
    <Field label={customer?'Pantry revenue account id':'Pantry expense account id'}><input name="accountId" required/></Field>
    {customer&&<Field label="Confirmed tax treatment"><select name="taxCode" required defaultValue=""><option value="" disabled>Select treatment</option><option value="exempt">Tax exempt, explicitly confirmed</option></select></Field>}
    <Field label="Exact signed payment passage"><textarea name="quote" required/></Field>
    <label className="lk-check"><input type="checkbox" name="allocation" required/>I confirm this exact USD amount belongs to this contractual obligation.</label>
   </Form>
  </details>}
  {!schedules.length&&!obligations.length&&<p>Confirm a payment obligation and its due date first.</p>}
 </section>
}

export function AccountingDestinationSettings({state,locket}:{state:LocketState;locket:Locket}){
 if(!can(state,'owner'))return null
 const destination=state.connections.find(c=>c.id==='pantry'),revision=destination?.connectionVersion??0
 return <section className="lk-panel" aria-label="Accounting destination settings" style={{overflowWrap:'anywhere'}}>
  <h2>Accounting destination</h2>
  <p>Pantry: {destination?.account??'Not configured'} · destination revision {revision}. {destination?.destinationEnabled?'Enabled.':'Disabled.'}</p>
  <p>{destination?.serverMatches?'Private server settings match this destination.':'Sending is unavailable until private server settings match this destination.'} Credentials stay on the server.</p>
  <p>Every saved change creates a new revision. Earlier consent stays stale even when the former destination is restored. An uncertain attempt is never sent again.</p>
  <Form key={revision} busy={locket.busy} submit="Save accounting destination" onSubmit={data=>void locket.run(value(data,'action')==='invalidate'?'accounting.destination.invalidate':'accounting.destination.configure',{revision,origin:value(data,'origin'),consent:data.get('consent')==='on'})}>
   <Field label="Pantry destination origin"><input name="origin" type="url" required defaultValue={destination?.account??''}/></Field>
   <Field label="Destination action"><select name="action"><option value="configure">Configure a new revision</option>{revision>0&&<option value="invalidate">Disable and invalidate consent</option>}</select></Field>
   <label className="lk-check"><input name="consent" type="checkbox" required/>I confirm this destination change invalidates earlier accounting consent.</label>
  </Form>
 </section>
}
