import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Badge, Field, Form, value, When } from './controls'
import { can, day, deadline, personName } from './format'
export interface RenewalLifecycleWorkspace {
 renewalHistory:Row[];renewalGenerations:Row[];renewalSettings:Row[];renewalTerminations:Row[]
 calendarConnections:Row[];calendarEvents:Row[]
}
export function RenewalHistory({state,a,locket}:{state:LocketState;a:Row;locket:Locket}) {
 const s=state as LocketState&RenewalLifecycleWorkspace,current=state.portfolio.lifecycle[a.id]
 if(!current)return null
 const generations=s.renewalGenerations.filter(g=>g.agreement_id===a.id),r=state.renewals.find(r=>r.agreement_id===a.id)
 return <section className="lk-panel" aria-label="Current term and renewal history">
  <h2>Current term and renewal history</h2>
  <p><Badge value={current.status}/>{' '}{current.renewalType.replaceAll('_',' ')} · term {current.term}{current.remaining!==null?` · ${current.remaining} renewals remaining`:' · unlimited renewals'}</p>
  <p>{day(current.start)} – {current.end?day(current.end):'Continues until notice'}{current.deadline&&<> · notice by {deadline(current.deadline.at,a.timezone)} ({current.deadline.days} days left)</>}</p>
  {current.terminationUnsent&&<p role="alert">Termination decided, notice not recorded by the deadline. Owner or counsel must record the notice with evidence or confirm that the agreement renewed.</p>}
  {current.review&&<p>Anniversary review: {day(current.review.date)}. Review opens {deadline(current.review.dueAt,a.timezone)}.</p>}
  {can(state,'owner')&&current.renewalType==='evergreen'&&<Form busy={locket.busy} submit="Save anniversary review" onSubmit={data=>void locket.run('renewal.review.configure',{agreementId:a.id,version:a.version,leadDays:Number(value(data,'leadDays'))})}><Field label="Days before each anniversary"><input name="leadDays" type="number" min="0" max="365" defaultValue={r?.evergreen_lead_days??30} required/></Field></Form>}
  {generations.map(g=><details key={g.id} open={!g.superseded_at} className="lk-disclosure"><summary>{g.superseded_at?'Superseded derivation':'Current derivation'} · <When at={g.created_at}/></summary>
   <p>Confirmed source terms: {JSON.parse(g.sources).map((t:Row)=>`${t.key.replaceAll('_',' ')}: ${t.value===''?'unlimited':t.value}`).join('; ')}</p>
   <ol>{s.renewalHistory.filter(h=>h.generation_id===g.id).sort((x,y)=>x.term_number-y.term_number).map(h=><li key={h.id}>Term {h.term_number}: {day(h.start_date)} – {day(h.end_date)}; {h.deadline_at?<>notice deadline {deadline(h.deadline_at,a.timezone)}; </>:null}renewal committed with {h.decision??'no decision'}{h.decided_by?` by ${personName(state,h.decided_by)}`:''}. {h.derived_at_import?'Derived at import. ':''}Derived <When at={h.derived_at}/>.</li>)}</ol>
  </details>)}
  {s.renewalTerminations.filter(t=>t.agreement_id===a.id).map(t=><p key={t.id}>{t.resolution.replaceAll('_',' ')}{t.effective_date?` effective ${day(t.effective_date)}`:''} recorded by {personName(state,t.recorded_by)}: {t.reason}</p>)}
  {can(state,'owner','counsel','approver')&&r&&<details className="lk-disclosure"><summary>Record an earlier termination permitted by a clause</summary><Form busy={locket.busy} submit="Record cited termination" onSubmit={data=>void locket.run('renewal.terminate',{agreementId:a.id,version:a.version,effectiveDate:value(data,'effectiveDate'),reason:value(data,'reason'),citation:{quote:value(data,'quote'),...(value(data,'page')?{page:Number(value(data,'page'))}:{})}})}><Field label="Termination effective date"><input name="effectiveDate" type="date" required/></Field><Field label="Clause permitting this termination"><textarea name="quote" required/></Field><Field label="Signed PDF page"><input name="page" type="number" min="1"/></Field><Field label="Reason"><input name="reason" required/></Field></Form></details>}
  {current.terminationUnsent&&can(state,'owner','counsel')&&<Form busy={locket.busy} submit="Resolve termination" onSubmit={data=>void locket.run('renewal.termination.resolve',{agreementId:a.id,version:a.version,resolution:value(data,'resolution'),reason:value(data,'reason'),noticeId:value(data,'noticeId')||undefined})}><Field label="Resolution"><select name="resolution"><option value="renewed">Confirm agreement renewed</option><option value="notice_recorded">Notice recorded with evidence</option></select></Field><Field label="Sent notice with evidence"><select name="noticeId"><option value="">Select for notice resolution</option>{state.notices.filter(n=>n.agreement_id===a.id&&n.status==='sent'&&n.evidence_artifact_id).map(n=><option key={n.id} value={n.id}>{n.recipient} · {day(new Date(n.sent_at).toISOString().slice(0,10))}</option>)}</select></Field><Field label="Reason"><textarea name="reason" required/></Field></Form>}
 </section>
}
export function RenewalCalendars({state,locket}:{state:LocketState;locket:Locket}) {
 const s=state as LocketState&RenewalLifecycleWorkspace
 return <details className="lk-disclosure"><summary>Connected deadline calendars</summary>
  <p>Calendar events contain deadline labels and a link to sign in. Synchronization uses your current agreement access.</p>
  {s.calendarConnections.map(c=><p key={c.id}>{c.provider}: {c.calendar_id} · {!c.configured?'Reconnect after archive restore':c.last_error?`Synchronization failed: ${c.last_error}`:`${s.calendarEvents.filter(e=>e.connection_id===c.id).length} provider-confirmed events`}</p>)}
  {can(state,'owner')&&<Form busy={locket.busy} submit="Approve calendar connection" onSubmit={async(data,form)=>{if(await locket.run('calendar.connect',{provider:value(data,'provider'),calendarId:value(data,'calendarId'),accessToken:value(data,'accessToken'),scope:'all_accessible',consent:data.get('consent')==='on'}))form.reset()}}><Field label="Provider"><select name="provider"><option value="google">Google Calendar</option><option value="outlook">Outlook</option></select></Field><Field label="Calendar ID"><input name="calendarId" required/></Field><Field label="Provider access token"><input name="accessToken" type="password" autoComplete="off" required/></Field><label><input type="checkbox" name="consent" required/> I approve this provider and calendar to receive deadlines for all agreements I can access.</label></Form>}
 </details>
}
