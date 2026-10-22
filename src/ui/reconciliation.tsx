import { useState } from 'react'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can, parse, personName } from './format'
import { ReconciliationFinding } from './reconciliation-finding'

export interface ReconciliationWorkspace {
 reconciliationSettings:Row[];reconciliationInterpretations:Row[];reconciliationScans:Row[];reconciliationFindings:Row[];reconciliationDispatches:Row[]
}
export type ReconciliationState=LocketState&ReconciliationWorkspace
export const usd=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100)+' USD'
export function InvoiceReconciliation({state,a,locket}:{state:ReconciliationState;a:Row;locket:Locket}) {
 const s=state.reconciliationSettings.find(s=>s.agreement_id===a.id),interpretation=state.reconciliationInterpretations.find(i=>i.agreement_id===a.id),scans=state.reconciliationScans.filter(s=>s.agreement_id===a.id),scan=scans[0]
 const findings=state.reconciliationFindings.filter(f=>f.agreement_id===a.id),[prepared,setPrepared]=useState<string|null>(null)
 const people=state.operators.filter(o=>o.status==='active'),active=Boolean(s&&interpretation&&interpretation.settings_version===s.version)
 const billData=scan?parse<any>(scan.content):null
 if(a.type!=='supplier'||!['executed','imported'].includes(a.status))return null
 return <section className="lk-card" aria-label="Invoice reconciliation">
  <h3>Invoice reconciliation</h3>
  <p>Compare supplier bills with a counsel-confirmed annual increase cap. Finance checks the accounting; the finding owner approves the exact credit request before sending.</p>
  <p>Purse purchase orders are unavailable: Purse’s published integration token cannot read POs. These findings use QuickBooks bills only.</p>
  {s&&<p>Counsel: {personName(state,s.counsel_id)} · Finance: {personName(state,s.finance_id)} · Finding owner: {personName(state,s.owner_id)}</p>}
  {can(state,'owner')&&<details><summary>Authorize invoice reconciliation</summary><Form busy={locket.busy} submit="Save reconciliation authority" onSubmit={data=>void locket.run('reconciliation.configure',{agreementId:a.id,version:a.version,counselId:value(data,'counsel'),financeId:value(data,'finance'),ownerId:value(data,'owner'),consent:data.get('consent')==='on'})}>
   <Field label="Reconciliation counsel"><select name="counsel" defaultValue={s?.counsel_id??state.actor.id}>{people.filter(p=>['owner','counsel'].includes(p.role)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
   <Field label="Finance approver"><select name="finance" defaultValue={s?.finance_id??state.actor.id}>{people.filter(p=>['owner','approver'].includes(p.role)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
   <Field label="Finding owner"><select name="owner" defaultValue={s?.owner_id??state.actor.id}>{people.filter(p=>['owner','counsel','approver','requester'].includes(p.role)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
   <label><input name="consent" type="checkbox" required/> I authorize reading linked vendor bills and preparing findings with these designated people.</label>
  </Form></details>}
  {s&&state.actor.id===s.counsel_id&&can(state,'owner','counsel')&&<details><summary>Confirm signed pricing interpretation</summary><Form busy={locket.busy} submit="Confirm annual cap interpretation" onSubmit={data=>void locket.run('reconciliation.interpret',{agreementId:a.id,version:a.version,sourceAgreementId:value(data,'source'),capBps:Math.round(Number(value(data,'cap'))*100),interpretation:value(data,'interpretation'),citation:{quote:value(data,'quote'),...(value(data,'page')?{page:Number(value(data,'page'))}:{})},confirmAnnualComparableBasis:data.get('confirm')==='on'})}>
   <Field label="Pricing source agreement"><select name="source" defaultValue={interpretation?.source_agreement_id??a.id}>{state.agreements.filter(source=>source.id===a.id||source.relation==='amends').filter(source=>['executed','imported'].includes(source.status)).map(source=><option key={source.id} value={source.id}>{source.reference}: {source.title}</option>)}</select></Field>
   <Field label="Maximum annual increase (%)"><input name="cap" type="number" step="0.01" min="0" max="1000" defaultValue={interpretation?interpretation.cap_bps/100:undefined} required/></Field>
   <Field label="Exact signed price-increase clause"><textarea name="quote" defaultValue={interpretation?parse<any>(interpretation.citation).quote:''} required/></Field>
   <Field label="Signed clause page"><input name="page" type="number" min="1"/></Field>
   <Field label="Counsel interpretation"><textarea name="interpretation" defaultValue={interpretation?.interpretation??''} required/></Field>
   <label><input name="confirm" type="checkbox" required/> This applies one annual increase to comparable services; I reviewed amendments, tax, scope and credit adjustments.</label>
  </Form></details>}
  {interpretation&&<blockquote>{parse<any>(interpretation.citation).quote}<p>{interpretation.cap_bps/100}% annual cap · {interpretation.interpretation}</p><a href={`#agreement/${interpretation.source_agreement_id}/terms`}>Signed clause source</a></blockquote>}
  {!active&&<p>Designated counsel must confirm the current interpretation before reading bills.</p>}
  {active&&can(state,'owner','counsel','approver','requester','agent')&&<Form busy={locket.busy} submit="Read current vendor bills" onSubmit={data=>void locket.run('reconciliation.scan',{agreementId:a.id,since:value(data,'since'),through:value(data,'through')})}>
   <p>The owner must first authorize the read-only QuickBooks vendor link in renewal brief settings. Vendor totals do not establish contract allocation.</p>
   <Field label="Bill period start"><input name="since" type="date" required defaultValue={billData?.since??''}/></Field>
   <Field label="Bill period end"><input name="through" type="date" required defaultValue={billData?.through??new Date(state.now).toISOString().slice(0,10)}/></Field>
  </Form>}
  {scan&&billData&&<><p>{billData.bills.length} bills · {billData.since} to {billData.through} · read {new Date(scan.scanned_at).toISOString()}. Outstanding balances are separate from incurred spend.</p>
   <ul>{billData.bills.map((b:any)=><li key={b.id}>Bill {b.id} · {b.date} · {usd(b.totalCents)} · outstanding {usd(b.balanceCents)}</li>)}</ul>
   {active&&<Form busy={locket.busy} submit="Prepare above-cap finding" onSubmit={async data=>{const result=await locket.run('reconciliation.prepare',{agreementId:a.id,scanId:scan.id,baselineBillId:value(data,'baseline'),billId:value(data,'bill')});if(result)setPrepared(result.suppressed?'Identical rejected evidence suppressed.':result.id?'Finding prepared for finance review.':null)}}>
    <Field label="Comparable baseline bill"><select name="baseline" required>{billData.bills.map((b:any)=><option key={b.id} value={b.id}>{b.id} · {b.date} · {usd(b.totalCents)}</option>)}</select></Field>
    <Field label="Bill to check"><select name="bill" required>{billData.bills.map((b:any)=><option key={b.id} value={b.id}>{b.id} · {b.date} · {usd(b.totalCents)}</option>)}</select></Field>
    <p>Comparability remains proposed until designated finance confirms the exact scope, allocation and adjustments.</p>
   </Form>}
  </>}
  {prepared&&<p role="status">{prepared}</p>}
  {!findings.length&&<p>No invoice findings prepared.</p>}
  {findings.map(f=><ReconciliationFinding key={`${f.id}:${f.version}`} state={state} f={f} locket={locket}/>)}
 </section>
}
