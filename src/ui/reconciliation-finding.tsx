import type { Row } from './api'
import type { Locket } from './app'
import { Badge, Field, Form, value } from './controls'
import { can, parse, personName } from './format'
import { usd, type ReconciliationState } from './reconciliation'

export function ReconciliationFinding({state,f,locket}:{state:ReconciliationState;f:Row;locket:Locket}) {
 const b=parse<any>(f.content),dispatch=state.reconciliationDispatches.find(d=>d.finding_id===f.id),scan=state.reconciliationScans.find(s=>s.id===f.scan_id),s=state.reconciliationSettings.find(s=>s.agreement_id===f.agreement_id),interpretation=state.reconciliationInterpretations.find(i=>i.agreement_id===f.agreement_id)
 const stale=b.sources.some((source:any)=>state.agreements.find(a=>a.id===source.id)?.version!==source.version)||s?.version!==scan?.settings_version||interpretation?.id!==scan?.interpretation_id||state.accountingLinks.find(l=>l.agreement_id===f.agreement_id)?.version!==scan?.link_version
 const actor=state.actor.id,base={findingId:f.id,findingVersion:f.version},editable=!dispatch&&f.status!=='rejected'&&!stale
 const outcomes:Record<string,string>={queued:'Queued; not sent',sending:'Send claimed; provider outcome unconfirmed. No automatic resend.',accepted:'Mail provider accepted; mailbox delivery and credit recovery unconfirmed.',suppressed:'Suppressed locally; no email sent.',rejected:'Provider rejected the email; no delivery confirmed.',uncertain:'Provider outcome uncertain; no automatic resend.',rate_limited:'Provider rate limited the request; no delivery confirmed.',cancelled:'Send cancelled because authority or evidence changed.'}
 return <article className="lk-card" aria-label={`Invoice finding ${b.bill.id}`}>
  <h4>Potential overcharge: {usd(b.atStakeCents)}</h4><Badge value={f.status}/>
  <p>Bill {b.bill.id}: {usd(b.bill.totalCents)} · {b.bill.date}. Baseline bill {b.baseline.id}: {usd(b.baseline.totalCents)} · {b.baseline.date}.</p>
  <p>Observed increase {Number(b.observedIncreasePercent.toFixed(4))}% · signed cap {b.capBps/100}% · maximum comparable annual bill {usd(b.allowedCents)}.</p>
  <blockquote>{b.citation.quote}<p>{b.interpretation}</p><a href={`#agreement/${b.sourceAgreementId}/terms`}>Cited signed pricing source</a></blockquote>
  <p>{b.basis}</p><p>{b.procurement.detail}</p>
  <p>Finance: {personName(state,f.finance_id)} · Finding owner: {personName(state,f.owner_id)}</p>
  {stale&&<p role="status">Sources or authority configuration changed. Confirm the interpretation and read fresh bills before acting.</p>}
  {f.finance_by&&<p>Finance confirmed by {personName(state,f.finance_by)}: {f.finance_note}</p>}
  {editable&&f.status==='proposed'&&actor===f.finance_id&&can(state,'owner','approver')&&<Form busy={locket.busy} submit="Confirm invoice accounting" onSubmit={data=>void locket.run('reconciliation.finance.confirm',{...base,note:value(data,'note'),confirmComparable:data.get('comparable')==='on',confirmAdjustments:data.get('adjustments')==='on'})}>
   <Field label="Finance accounting explanation"><textarea name="note" required/></Field>
   <label><input name="comparable" type="checkbox" required/> Both bills are allocated completely to this contract and cover comparable annual services and quantities.</label>
   <label><input name="adjustments" type="checkbox" required/> I checked taxes, credits and all adjustments; the stated USD amount at stake remains correct.</label>
  </Form>}
  {editable&&actor===f.owner_id&&can(state,'owner','approver')&&<details><summary>Edit exact supplier credit request</summary><Form busy={locket.busy} submit="Save exact credit request" onSubmit={data=>void locket.run('reconciliation.message.edit',{...base,recipient:value(data,'recipient'),subject:value(data,'subject'),message:value(data,'message')})}>
   <Field label="Credit request recipient"><input name="recipient" type="email" defaultValue={f.recipient} required/></Field>
   <Field label="Credit request subject"><input name="subject" defaultValue={f.subject} required/></Field>
   <Field label="Exact credit request message"><textarea name="message" rows={10} defaultValue={f.message_text} required/></Field>
  </Form></details>}
  <p>To: {f.recipient||'Recipient not selected'}</p><p>Subject: {f.subject}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'inherit'}}>{f.message_text}</pre>
  {editable&&actor===f.owner_id&&can(state,'owner','approver')&&f.status==='finance_confirmed'&&f.message_digest&&<Form busy={locket.busy} submit="Approve exact credit request" onSubmit={data=>void locket.run('reconciliation.message.approve',{...base,messageDigest:f.message_digest,consent:data.get('approve')==='on'})}>
   <label><input name="approve" type="checkbox" required/> I approve this exact recipient, subject and message. Sending is a separate action.</label>
  </Form>}
  {f.status==='approved'&&!dispatch&&<p>Approved; no email sent.</p>}
  {editable&&actor===f.owner_id&&can(state,'owner','approver')&&f.status==='approved'&&<Form busy={locket.busy} submit="Send approved credit request" onSubmit={data=>void locket.run('reconciliation.email',{...base,messageDigest:f.message_digest,consent:data.get('send')==='on'})}>
   <label><input name="send" type="checkbox" required/> Send the exact approved credit request to {f.recipient} through the installation mail provider.</label>
  </Form>}
  {dispatch&&<p role="status">{outcomes[dispatch.status]??dispatch.status}{dispatch.provider_message_id&&<> Receipt: {dispatch.provider_message_id}</>}</p>}
  {f.status==='rejected'?<p>Rejected by {personName(state,f.rejected_by)}: {f.rejection_reason}. Identical future evidence is suppressed.</p>:!dispatch&&[f.owner_id,f.finance_id,f.counsel_id].includes(actor)&&<details><summary>Reject invoice finding</summary><Form busy={locket.busy} submit="Reject and suppress identical evidence" onSubmit={data=>void locket.run('reconciliation.reject',{...base,reason:value(data,'reason')})}>
   <Field label="Reason to reject finding"><textarea name="reason" required/></Field>
  </Form></details>}
 </article>
}
