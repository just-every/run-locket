import { reportInstant, localMinute } from '../locket/report-schedule'
import { type LocketState, type Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can, deadline, personName } from './format'

export function NoticeAgentSource({state,renewal:r,agreement:a,locket}:{state:LocketState;renewal:Row;agreement:Row;locket:Locket}) {
  return can(state,'owner','counsel','approver','requester') && r.decision ? <details className="lk-disclosure">
    <summary>Prepare a notice from the executed passage</summary>
    <p>Choose the exact notice passage from the executed text. Uses the counterparty’s recorded email and courier notice address, confirmed deadline and decision. Review with counsel.</p>
    <Form busy={locket.busy} submit="Prepare cited draft" onSubmit={async data=>{
      const source=await locket.run('notice.source',{agreementId:a.id,quote:value(data,'quote')})
      if(source)await locket.run('notice.agent.prepare',{sourceId:source.id})
    }}><Field label="Exact executed notice passage"><textarea name="quote" rows={3} required /></Field></Form>
  </details> : null
}
export function NoticeAgentPlan({state,notice:n,renewal:r,locket}:{state:LocketState;notice:Row;renewal:Row;locket:Locket}) {
  const plan=state.noticePlans.find(p=>p.id===n.id)
  if(!plan)return null
  const source=state.noticeSources.find(s=>s.id===plan.source_id)!
  const letter=state.noticeLetters.find(l=>l.id===n.id)!
  return <section aria-label="Prepared notice schedule">
    <p><strong>Prepared draft, not legal advice or proof of service.</strong></p>
    <blockquote>{source.quote}</blockquote>
    <p>Selected by {personName(state,source.selected_by)} · decision: {source.decision} · deadline: {deadline(source.deadline_at,r.timezone)}</p>
    <p>Proposed method: {plan.method}{plan.parent_notice_id?' · alternate route; another human approval required':''}</p>
    {plan.status==='draft' && can(state,'owner','approver') && <ScheduleApproval plan={plan} letter={letter} r={r} locket={locket} />}
    {plan.send_at && <p>Approved send: {plan.send_local} {plan.timezone}. Lead margin: {((source.deadline_at-plan.send_at)/3600000).toFixed(2)} hours. Watch for acknowledgment: {deadline(plan.watch_at,plan.timezone)}.</p>}
    {plan.status!=='draft' && <p>Schedule: {plan.status}. {plan.outcome}</p>}
    {plan.alert_at && <p role="status"><strong>Decision-maker alert:</strong> {plan.outcome}. Check alternate drafts and delivery evidence before the deadline.</p>}
    {plan.acknowledged_at ? <p>Recipient acknowledgment recorded: {plan.acknowledgment}</p> : n.status==='sent' && can(state,'owner','approver','requester') && <Form busy={locket.busy} submit="Record recipient acknowledgment" onSubmit={async data=>{await locket.run('notice.acknowledge',{noticeId:n.id,detail:value(data,'detail')})}}><Field label="Recipient acknowledgment evidence"><textarea name="detail" required /></Field></Form>}
  </section>
}
import { useState } from 'react'
function ScheduleApproval({plan,letter,r,locket}:{plan:Row;letter:Row;r:Row;locket:Locket}) {
  const [local,setLocal]=useState('')
  // The server resolves this wall time in the displayed agreement zone and
  // returns the exact margin. Review shows that same calculation before approval.
  const at=local ? reportInstant(local,r.timezone) : null
  const margin=at!==null && localMinute(at,r.timezone)===local ? ((r.deadline_at-at)/3600000).toFixed(2) : null
  return <Form busy={locket.busy} submit="Approve exact PDF and schedule" onSubmit={async()=>{await locket.run('notice.schedule',{noticeId:plan.id,pdfDigest:letter.sha256,recipient:letter.recipient,method:plan.method,sendLocal:local})}}>
    <Field label={`Send at (${r.timezone})`}><input type="datetime-local" name="sendLocal" value={local} onChange={e=>setLocal(e.target.value)} required /></Field>
    <p>Lead margin: {margin===null?'choose a valid local time':`${margin} hours`}. Send with more than one hour’s lead before {deadline(r.deadline_at,r.timezone)}. The hourly scheduler sends at the first run at or after this time, strictly before the deadline. Repeated clock times use their earlier occurrence.</p>
  </Form>
}
