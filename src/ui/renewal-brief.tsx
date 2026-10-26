import { useState } from 'react'
import { type LocketState, type Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can, deadline, parse, personName } from './format'
import { IntakeFormFields, formVisibleFields, readIntakeFormAnswers, type IntakeAnswers } from './intake-form-fields'
import { CustomFieldInputs, customFieldsFor, readCustomValues } from './custom-field-values'

export function RenewalBrief({state,a,locket}:{state:LocketState;a:Row;locket:Locket}) {
 const setting=state.renewalBriefSettings.find(s=>s.agreement_id===a.id),link=state.accountingLinks.find(l=>l.agreement_id===a.id)
 const briefs=state.renewalBriefs.filter(b=>b.agreement_id===a.id),latest=briefs[0]
 return <section className="lk-card" aria-label="Renewal brief">
  <h3>Renewal brief</h3>
  {setting?<p>{setting.lead_days} days before the notice deadline · for {personName(state,setting.decision_maker_id)}. {setting.last_error}</p>:<p>Choose a lead time and decision-maker to prepare a brief automatically.</p>}
  {can(state,'owner')&&<details><summary>Configure renewal brief and accounting</summary>
   <Form busy={locket.busy} submit="Save brief settings" onSubmit={data=>void locket.run('renewal.brief.configure',{agreementId:a.id,version:a.version,leadDays:Number(value(data,'leadDays')),decisionMakerId:value(data,'decisionMakerId')})}>
    <Field label="Brief lead time (days)"><input name="leadDays" type="number" min="1" max="3650" defaultValue={setting?.lead_days??90} required/></Field>
    <Field label="Decision-maker"><select name="decisionMakerId" defaultValue={setting?.decision_maker_id??state.actor.id}>{state.operators.filter(o=>o.status==='active'&&['owner','approver'].includes(o.role)).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
   </Form>
   <Form busy={locket.busy} submit="Authorize vendor link" onSubmit={data=>void locket.run('accounting.link',{agreementId:a.id,version:a.version,vendorId:value(data,'vendorId'),consent:data.get('consent')==='on'})}>
    <p>Read-only QuickBooks Online connection, configured on this installation’s server. No payment or supplier write is sent.</p>
    <Field label="QuickBooks vendor id"><input name="vendorId" pattern="[0-9]+" required defaultValue={link?.vendor_id??''}/></Field>
    <label><input type="checkbox" name="consent" required/> I authorize reading this vendor’s USD bills into the agreement’s renewal brief.</label>
   </Form>
  </details>}
  {can(state,'owner','counsel','approver')&&<details><summary>Confirm a price-increase cap</summary>
   <Form busy={locket.busy} submit="Confirm cited cap" onSubmit={data=>void locket.run('renewal.cap.confirm',{agreementId:a.id,version:a.version,value:value(data,'cap'),citation:{quote:value(data,'quote')}})}>
    <Field label="Price-increase cap"><input name="cap" required/></Field><Field label="Exact cap passage"><textarea name="quote" required/></Field>
   </Form>
  </details>}
  {setting&&can(state,'owner','approver')&&<button disabled={locket.busy} onClick={()=>void locket.run('renewal.brief.prepare',{agreementId:a.id})}>Prepare current brief</button>}
  {!latest?<p>No brief prepared yet. Missing spend is never treated as zero.</p>:<Brief key={latest.id} state={state} a={a} record={latest} locket={locket}/>}
  {briefs.length>1&&<details><summary>Earlier brief snapshots</summary>{briefs.slice(1).map(b=><p key={b.id}><a href={`/api/locket/files/${b.artifact_id}`}>Download earlier brief · {new Date(b.prepared_at).toISOString()}</a></p>)}</details>}
 </section>
}
function Brief({state,a,record,locket}:{state:LocketState;a:Row;record:Row;locket:Locket}) {
 const b=parse<any>(record.content),sources=parse<any[]>(record.sources),stale=sources.some(s=>state.agreements.find(a=>a.id===s.id)?.version!==s.version)||state.renewalBriefSettings.find(s=>s.agreement_id===a.id)?.version!==b.settingsVersion
 const zone=b.timezone??a.timezone
 const forms=state.intakeForms.filter(f=>f.canLaunch&&f.published?.definition.type===a.type)
 const [formId,setFormId]=useState(forms[0]?.id??''),[answers,setAnswers]=useState<IntakeAnswers>({})
 const form=forms.find(f=>f.id===formId)?.published,fields=form?formVisibleFields(form.definition,{...answers,value:a.value_cents===null?'':(a.value_cents/100).toFixed(2)}):[]
 return <>
  <p>Snapshot {new Date(b.preparedAt).toISOString()} · {stale?'Source changed — prepare a new brief.':'Current reviewed sources'}</p>
  <p>Current term: {b.current.start??'Start not recorded'} to {b.current.end}. Notice deadline: {deadline(b.deadline,zone)}.</p>
  <a href={`/api/locket/files/${record.artifact_id}`}>Download renewal brief PDF</a>
  <h4>Price-increase cap and current terms</h4>
  {b.caps.map((cap:any)=><blockquote key={cap.agreement_id}><strong>{cap.value}</strong><p>{parse<any>(cap.citation).quote}</p><a href={`#agreement/${cap.agreement_id}/terms`}>Cited source</a></blockquote>)}
  {!b.caps.length&&<p>No price-increase cap confirmed.</p>}
  <ul>{b.terms.map((t:any)=><li key={t.id}>{t.key.replaceAll('_',' ')}: {t.value} — {parse<any>(t.citation).quote}</li>)}</ul>
  <h4>Amendments</h4>{!b.amendments.length?<p>No accessible amendments recorded.</p>:b.amendments.map((m:any)=><p key={m.id}><a href={`#agreement/${m.id}`}>{m.reference}: {m.title}</a></p>)}
  <h4>Spend to date</h4>{b.spend?<><p>${(b.spend.totalCents/100).toLocaleString('en-US',{minimumFractionDigits:2})} USD · {b.spend.provider} · {b.spend.since} through {b.spend.through}</p><p>{b.spend.basis}</p><ul>{b.spend.bills.map((i:any)=><li key={i.id}>Bill {i.id}: ${(i.totalCents/100).toFixed(2)} USD · {i.date}</li>)}</ul></>:<p>Unavailable — no accounting vendor linked.</p>}
  {b.accountingComparison&&<p>Vendor bills equal {b.accountingComparison.percent}% of recorded contract value ${(b.accountingComparison.contractValueCents/100).toLocaleString('en-US',{minimumFractionDigits:2})} USD. Contract allocation unconfirmed; this is not proven contract consumption.</p>}
  <h4>Obligation and service-level history</h4><ul>{b.obligations.map((o:any)=><li key={o.id}>{o.description}: {o.status} · {o.due_date??'No due date'}{o.evidence_note?` · ${o.evidence_note}`:''}</li>)}</ul><p>{b.serviceLevels.length} recorded service-level intervals.</p><ul>{b.serviceLevels.map((s:any)=><li key={`${s.agreement_id}:${s.generation}`}>Service level {s.generation}: {s.outcome??'open'} · started {deadline(s.started_at,zone)} · due {deadline(s.due_at,zone)}{s.closed_at?` · closed ${deadline(s.closed_at,zone)}`:''}</li>)}</ul>
  <h4>Open issues</h4><ul>{b.issues.map((i:any)=><li key={i.id}>{i.body}</li>)}{b.deviations.map((d:any)=><li key={d.id}>{d.clause_key}: {d.result}</li>)}</ul>
  <h4>Options and deadlines</h4><ul>{b.options.map((o:any)=><li key={o.decision}>{o.decision}: {deadline(o.deadline,zone)}</li>)}</ul>
  {record.request_id?<p><a href={`#agreement/${record.request_id}`}>Open linked renewal request</a></p>:can(state,'owner','approver')&&!stale&&(state.actor.role==='owner'||state.actor.id===b.decisionMakerId)&&<Form busy={locket.busy} submit="Open renewal request" onSubmit={async data=>{
   const result=await locket.run('renewal.workflow.open',{briefId:record.id,title:value(data,'title'),decision:value(data,'decision'),...(form?{formVersionId:form.id,formAnswers:await readIntakeFormAnswers(answers,fields)}:{}),customValues:readCustomValues(data,customFieldsFor(state,a.type))})
   if(result)window.location.hash=`agreement/${result.id}`
  }}>
   <Field label="Renewal request title"><input name="title" defaultValue={`Renewal: ${a.title}`} required/></Field>
   <Field label="Renewal option"><select name="decision"><option value="renew">Renew</option><option value="renegotiate">Renegotiate</option></select></Field>
   {forms.length>0&&<Field label="Renewal request form"><select value={formId} onChange={e=>{setFormId(e.target.value);setAnswers({})}}>{forms.map(f=><option key={f.id} value={f.id}>{f.published!.definition.name}</option>)}</select></Field>}
   {form&&<><Field label="Renewal department"><select value={String(answers.department??'')} onChange={e=>setAnswers({...answers,department:e.target.value})}><option value="">Choose…</option>{state.intakeAudiences.filter(d=>d.kind==='department').map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field><Field label="Renewal region"><input value={String(answers.region??'')} onChange={e=>setAnswers({...answers,region:e.target.value})}/></Field><IntakeFormFields fields={fields} answers={answers} onChange={(key,answer)=>setAnswers({...answers,[key]:answer})} state={state}/></>}
   <CustomFieldInputs state={state} fields={customFieldsFor(state,a.type)} stage="draft" stored={false}/>
   <p>The current published intake route applies. Terminate uses the existing decision and separately approved notice; no supplier contact is sent here.</p>
  </Form>}
 </>
}
