import type { Row } from './api'
import { Badge, Field, Form, value } from './controls'
import { can, parse, personName } from './format'
import { serviceSourceStale, serviceUsd } from './service-levels'
import { performanceMetric, type ServicePerformanceProps } from './service-performance'

const elapsed=(ms:number|null)=>ms===null?'Unknown':`${(ms/60_000).toLocaleString('en-US',{maximumFractionDigits:3})} minutes`
export function ServicePerformanceComparison({comparison:c}:{comparison:any}) {
 return <>
  <p><strong>{c.breachedCount} proven late · {c.metCount} met the measured threshold · {c.unknownCount} unknown</strong></p>
  <p>Worst proven lateness: {elapsed(c.worstLateMs)}. Unknown timestamps do not establish performance or add credit. A reported closure does not prove contractual fulfillment.</p>
  {c.unknownCount>0&&<p role="status">The evidence is incomplete. Any claim below uses proven late records only; unknown records remain unresolved.</p>}
  {c.warnings.map((warning:string,index:number)=><p role="status" key={index}>{warning}</p>)}
  <details><summary>Compare reported records</summary>{c.records.map((r:any)=><article className="lk-card" key={r.recordId} aria-label={`Performance record ${r.recordId}`}><strong>{r.recordId}</strong><p>{r.status==='met'?'Met the measured timestamp threshold':r.status==='breached'?'Proven late':'Unknown'} · Reported elapsed: {elapsed(r.elapsedMs)} · Lateness: {elapsed(r.lateMs)}</p><p>{r.reason}</p></article>)}</details>
 </>
}

export function ServicePerformanceClaim({state,agreement:a,locket,claim:c}:ServicePerformanceProps&{claim:Row}) {
 const b=parse<any>(c.content),data=state.serviceLevels,metric=b.metric
 const report=data.performanceReports.find(r=>r.id===c.read_id),term=data.performanceTerms.find(t=>t.id===report?.term_id)
 const latest=data.performanceTerms.find(t=>t.agreement_id===a.id&&t.metric===metric)
 const dispatch=data.performanceDispatches.find(d=>d.claim_id===c.id),obligation=state.obligations.find(o=>o.id===c.obligation_id)
 const stale=serviceSourceStale(state,c.sources)||!report||!term||term.id!==latest?.id||a.owner_id!==c.owner_id
 const owner=state.actor.id===c.owner_id&&can(state,'owner','approver'),closed=state.now>=c.deadline_at,editable=owner&&!dispatch&&!stale&&!closed
 const base={claimId:c.id,claimVersion:c.version,amountCents:c.amount_cents,messageDigest:c.message_digest}
 const deadline=new Intl.DateTimeFormat('en-US',{timeZone:b.period.timeZone,dateStyle:'long',timeStyle:'long'}).format(c.deadline_at)
 const outcomes:Record<string,string>={queued:'Queued; no provider acceptance recorded.',sending:'Send claimed; provider outcome unconfirmed. No automatic resend.',accepted:'Mail provider accepted; mailbox delivery and credit recovery unconfirmed.',rejected:'Mail provider rejected the request; no delivery confirmed.',uncertain:'Provider outcome uncertain; no automatic resend.',rate_limited:'Provider rate limited the request; no delivery confirmed.',suppressed:'Suppressed locally; no email sent.',cancelled:'Send cancelled because authority or evidence changed.'}
 return <article className="lk-card" aria-label={`Performance credit claim ${metric} ${c.month}`} style={{minWidth:0,overflowWrap:'anywhere'}}>
  <h4>{performanceMetric[metric]} credit claim: {serviceUsd(c.amount_cents)}</h4><Badge value={c.status}/>
  <p>Service month: {c.month} · Agreement owner: {personName(state,c.owner_id)} · Credit recovery unconfirmed.</p>
  <ServicePerformanceComparison comparison={b.comparison}/>
  <p>Wall-clock {performanceMetric[metric].toLowerCase()}. {metric!=='delivery'&&<>Confirmed threshold: {b.formula.thresholdMinutes} minutes.</>} One monthly credit is selected by the worst proven lateness; records are not summed or stacked.</p>
  <dl className="lk-obligation-facts"><div><dt>Eligible monthly fee</dt><dd>{serviceUsd(b.formula.eligibleFeeCents)}</dd></div><div><dt>Monthly cap</dt><dd>{serviceUsd(b.formula.capCents)}</dd></div><div><dt>Proposed credit</dt><dd>{serviceUsd(b.formula.amountCents)}</dd></div></dl>
  <p>Eligible allocation: {b.formula.allocation}</p>
  <p>Applied tier: more than {b.formula.selectedTier.minimumLateMinutes} minutes late · {b.formula.selectedTier.creditBps/100}% of eligible monthly fee, limited to the monthly cap.</p>
  <details><summary>Confirmed performance credit tiers</summary><ul>{b.formula.tiers.map((tier:any)=><li key={tier.minimumLateMinutes}>More than {tier.minimumLateMinutes} minutes late: {tier.creditBps/100}%</li>)}</ul></details>
  <blockquote><p>{b.citation.quote}</p><p>{b.interpretation}</p><a href={`#agreement/${b.sourceAgreementId}/terms`}>Cited signed performance clause{b.citation.page?` · page ${b.citation.page}`:''}</a></blockquote>
  <p>Report source: {b.report.sourceName} · {b.report.sourceReference}</p><p>{b.report.windowNote}</p>
  <p>Evidence period: {new Date(b.period.from).toISOString()} to {new Date(b.period.to).toISOString()} (end exclusive), {b.period.timeZone}.</p>
  <p><a href={`/api/locket/files/${b.report.artifactId}`} download>Download original supplier report</a></p>
  <details><summary>Supplier report identity</summary><p>SHA-256: {b.report.responseSha256}</p></details>
  <p><strong>Performance claim deadline: <time dateTime={new Date(c.deadline_at).toISOString()}>{deadline}</time></strong> · {b.period.timeZone} · {b.formula.claimDays} calendar days after the final service date, at 23:59:59.</p>
  {obligation&&<p>Supplier performance breach recorded. {obligation.description}</p>}
  {stale&&<p role="status">The agreement, amendment, formula or owner changed. Confirm the current sources and compare fresh evidence before acting.</p>}
  {closed&&<p role="status">The claim window is closed. Supplier contact is unavailable.</p>}
  {editable&&<details><summary>Edit exact performance credit claim</summary><Form busy={locket.busy} submit="Save exact performance credit message" onSubmit={data=>void locket.run('service-level.message',{claimId:c.id,claimVersion:c.version,recipient:value(data,'recipient'),subject:value(data,'subject'),message:value(data,'message')})}>
   <Field label="Performance credit recipient"><input name="recipient" type="email" required defaultValue={c.recipient}/></Field>
   <Field label="Performance credit subject"><input name="subject" required defaultValue={c.subject}/></Field>
   <Field label="Exact performance credit message"><textarea name="message" required rows={10} defaultValue={c.message_text}/></Field>
  </Form></details>}
  <p>To: {c.recipient||'Recipient not selected'}</p><p>Subject: {c.subject}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'inherit'}}>{c.message_text}</pre>
  {editable&&c.status==='proposed'&&c.message_digest&&<Form busy={locket.busy} submit="Approve performance credit amount and message" onSubmit={data=>void locket.run('service-level.approve',{...base,consent:data.get('approve')==='on'})}>
   <p>Amount to approve: <strong>{serviceUsd(c.amount_cents)}</strong>.</p><label className="lk-check"><input name="approve" type="checkbox" required/> I approve this exact performance credit amount, recipient, subject and message. Sending is a separate action.</label>
  </Form>}
  {c.status==='approved'&&!dispatch&&<p>Performance credit amount and exact message approved; no email sent.</p>}
  {editable&&c.status==='approved'&&<Form busy={locket.busy} submit="Send approved performance credit claim" onSubmit={data=>void locket.run('service-level.email',{...base,consent:data.get('send')==='on'})}><label className="lk-check"><input name="send" type="checkbox" required/> Send the approved {serviceUsd(c.amount_cents)} performance claim to {c.recipient} through the installation mail provider.</label></Form>}
  {!owner&&!dispatch&&<p>Only {personName(state,c.owner_id)}, the agreement owner, may approve this exact performance claim or send it.</p>}
  {dispatch&&<p role="status">{outcomes[dispatch.status]}{dispatch.provider_message_id&&<> Receipt: {dispatch.provider_message_id}</>}</p>}
 </article>
}
