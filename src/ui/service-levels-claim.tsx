import type { Row } from './api'
import { Badge, Field, Form, value } from './controls'
import { can, parse, personName } from './format'
import { serviceSourceStale, serviceUsd, type ServiceLevelProps } from './service-levels'

export function ServiceLevelMetrics({read}:{read:Row}) {
 const m=parse<any>(read.metrics),percent=m.observedMs>0?(m.upMs/m.observedMs*100).toLocaleString('en-US',{maximumFractionDigits:6}):null
 const duration=(ms:number)=>`${ms.toLocaleString('en-US')} ms`
 return <>
  <p><strong>Observed monthly availability: {percent===null?'Unavailable':`${percent}%`}</strong> · monitor {m.monitorId}</p>
  <p>Observed fraction: {duration(m.upMs)} healthy / {duration(m.observedMs)} observed scheduled time. Provider display: {m.providerDisplayPercent}% (display only).</p>
  <dl className="lk-obligation-facts">
   <div><dt>Complete window</dt><dd>{duration(m.windowMs)}</dd></div>
   <div><dt>Not passing</dt><dd>{duration(m.notPassingMs)}</dd></div>
   <div><dt>Unknown, excluded</dt><dd>{duration(m.unknownMs)}</dd></div>
   <div><dt>Paused, excluded</dt><dd>{duration(m.pausedMs)}</dd></div>
   <div><dt>Maintenance, excluded</dt><dd>{duration(m.maintenanceMs)}</dd></div>
  </dl>
  <p>{m.denominatorPolicy}</p>
  <p>Evidence period: {new Date(read.period_from).toISOString()} to {new Date(read.period_to).toISOString()} (end exclusive). Read {new Date(read.read_at).toISOString()}.</p>
  <p><a href={`/api/locket/files/${read.artifact_id}`} download>Download original monitoring response</a></p>
  <details><summary>Monitoring response identity</summary><p style={{overflowWrap:'anywhere'}}>SHA-256: {read.response_sha256}</p></details>
 </>
}

export function ServiceLevelClaim({state,a,locket,claim:c}:ServiceLevelProps&{claim:Row}) {
 const b=parse<any>(c.content),read=state.serviceLevels.reads.find(r=>r.id===c.read_id),link=state.serviceLevels.links.find(l=>l.agreement_id===a.id),term=state.serviceLevels.terms.find(t=>t.agreement_id===a.id)
 const dispatch=state.serviceLevels.dispatches.find(d=>d.claim_id===c.id),breach=state.serviceLevels.breaches.find(d=>d.claim_id===c.id),obligation=state.obligations.find(o=>o.id===c.obligation_id)
 const stale=serviceSourceStale(state,c.sources)||!read||read.term_id!==term?.id||read.link_version!==link?.version||a.owner_id!==c.owner_id
 const closed=state.now>=c.deadline_at,owner=state.actor.id===c.owner_id&&can(state,'owner','approver'),editable=owner&&!dispatch&&!stale&&!closed
 const base={claimId:c.id,claimVersion:c.version,amountCents:c.amount_cents,messageDigest:c.message_digest}
 const deadline=new Intl.DateTimeFormat('en-US',{timeZone:b.period.timeZone,dateStyle:'long',timeStyle:'long'}).format(c.deadline_at)
 const outcomes:Record<string,string>={queued:'Queued; no provider acceptance recorded.',sending:'Send claimed; provider outcome unconfirmed. No automatic resend.',accepted:'Mail provider accepted; mailbox delivery and credit recovery unconfirmed.',rejected:'Mail provider rejected the request; no delivery confirmed.',uncertain:'Provider outcome uncertain; no automatic resend.',rate_limited:'Provider rate limited the request; no delivery confirmed.',suppressed:'Suppressed locally; no email sent.',cancelled:'Send cancelled because authority or evidence changed.'}
 return <article className="lk-card" aria-label={`Service credit claim ${c.month}`} style={{minWidth:0,overflowWrap:'anywhere'}}>
  <h4>Service credit claim: {serviceUsd(c.amount_cents)}</h4><Badge value={c.status}/>
  <p>Service month: {c.month} · Agreement owner: {personName(state,c.owner_id)}</p>
  {read&&<ServiceLevelMetrics read={read}/>}
  <p>Signed commitment: {b.formula.targetBps/100}%. Confirmed tier: at least {b.formula.tierFloorBps/100}% and below {b.formula.targetBps/100}% availability.</p>
  <p>Credit formula: {b.formula.creditBps/100}% × {serviceUsd(b.formula.monthlyCents)} monthly charge = <strong>{serviceUsd(b.formula.amountCents)}</strong>.</p>
  <blockquote><p>{b.citation.quote}</p><p>{b.interpretation}</p><a href={`#agreement/${b.sourceAgreementId}/terms`}>Cited signed service-level clause{b.citation.page?` · page ${b.citation.page}`:''}</a></blockquote>
  <p><strong>Claim deadline: <time dateTime={new Date(c.deadline_at).toISOString()}>{deadline}</time></strong> · {b.period.timeZone}.</p>
  <p>{b.formula.claimDays} calendar days after the final service date; deadline at 23:59:59 in the confirmed zone.</p>
  {breach&&<p>Supplier obligation breach recorded. {obligation?.description}</p>}
  {stale&&<p role="status">The agreement, amendment, monitoring authorization, confirmed formula or owner changed. Confirm the current sources and read fresh evidence before acting.</p>}
  {closed&&<p role="status">The claim window is closed. Supplier contact is unavailable.</p>}
  {editable&&<details><summary>Edit exact service credit claim</summary><Form busy={locket.busy} submit="Save exact service credit message" onSubmit={data=>void locket.run('service-level.message',{claimId:c.id,claimVersion:c.version,recipient:value(data,'recipient'),subject:value(data,'subject'),message:value(data,'message')})}>
   <Field label="Service credit recipient"><input name="recipient" type="email" required defaultValue={c.recipient}/></Field>
   <Field label="Service credit subject"><input name="subject" required defaultValue={c.subject}/></Field>
   <Field label="Exact service credit message"><textarea name="message" required rows={10} defaultValue={c.message_text}/></Field>
  </Form></details>}
  <p>To: {c.recipient||'Recipient not selected'}</p><p>Subject: {c.subject}</p>
  <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'inherit'}}>{c.message_text}</pre>
  {editable&&c.status==='proposed'&&c.message_digest&&<Form busy={locket.busy} submit="Approve service credit amount and message" onSubmit={data=>void locket.run('service-level.approve',{...base,consent:data.get('approve')==='on'})}>
   <p>Amount to approve: <strong>{serviceUsd(c.amount_cents)}</strong>.</p>
   <label className="lk-check"><input name="approve" type="checkbox" required/> I approve this exact amount, recipient, subject and message. Sending is a separate action.</label>
  </Form>}
  {c.status==='approved'&&!dispatch&&<p>Amount and exact message approved; no email sent.</p>}
  {editable&&c.status==='approved'&&<Form busy={locket.busy} submit="Send approved service credit claim" onSubmit={data=>void locket.run('service-level.email',{...base,consent:data.get('send')==='on'})}>
   <label className="lk-check"><input name="send" type="checkbox" required/> Send the approved {serviceUsd(c.amount_cents)} claim to {c.recipient} through the installation mail provider.</label>
  </Form>}
  {!owner&&!dispatch&&<p>Only {personName(state,c.owner_id)}, the agreement owner, may approve this claim amount and exact message or send it.</p>}
  {dispatch&&<p role="status">{outcomes[dispatch.status]}{dispatch.provider_message_id&&<> Receipt: {dispatch.provider_message_id}</>}</p>}
 </article>
}
