import { useState } from 'react'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Badge, Empty, Field, Form, value } from './controls'
import { can, personName, statusLabel, typeLabel, when } from './format'
import { IntakeAudiences } from './intake-audiences'

export function RequestQueue({state,locket}:{state:LocketState;locket:Locket}){
 const [type,setType]=useState(''),[team,setTeam]=useState(''),[status,setStatus]=useState('open'),[mine,setMine]=useState(false)
 const work=state.requestQueue.work
 const requests=state.agreements.filter(a=>a.origin==='intake'&&(!type||a.type===type)&&(!team||work.find(w=>w.agreement_id===a.id)?.team_id===team)&&(!mine||work.find(w=>w.agreement_id===a.id)?.assignee_id===state.actor.id)&&(status==='open'?['draft','in_review','approved','out_for_signature'].includes(a.status):a.status===status))
 return <div className="lk-stack">
 <div className="lk-titlebar"><div><h1>Request queue</h1><p className="lk-muted">Assignments, next actions and business-day service levels for requests you can access.</p></div><a className="lk-button" href="#new">New request</a></div>
 <section className="lk-panel" aria-label="Queue filters"><div className="lk-grid2">
 <Field label="Queue type"><select value={type} onChange={e=>setType(e.target.value)}><option value="">All types</option>{Object.entries(typeLabel).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field>
 <Field label="Queue team"><select value={team} onChange={e=>setTeam(e.target.value)}><option value="">All teams</option>{[...new Set(work.map(w=>w.team_id).filter(Boolean))].map(id=><option key={id} value={id}>{state.intakeAudiences.find(g=>g.id===id)?.name??'Assigned team'}</option>)}</select></Field>
 <Field label="Queue status"><select value={status} onChange={e=>setStatus(e.target.value)}><option value="open">Open requests</option><option value="cancelled">Canceled</option>{['draft','in_review','approved','out_for_signature','executed'].map(s=><option key={s} value={s}>{statusLabel[s]}</option>)}</select></Field>
 <label className="lk-check"><input type="checkbox" checked={mine} onChange={e=>setMine(e.target.checked)}/> My work</label>
 </div><p>{requests.length} requests</p></section>
 <section className="lk-panel" aria-label="Requests">
 {!requests.length&&<Empty>No requests match these filters.</Empty>}
 {requests.map(a=>{const w=work.find(w=>w.agreement_id===a.id);return <article className="lk-card" data-request-id={a.id} key={a.id}>
 <div className="lk-panel-head"><h2><a href={`#agreement/${a.id}`}>{a.title}</a></h2><Badge value={a.status}/>{w&&<Badge value={w.sla} label={w.sla.replaceAll('_',' ')} tone={w.sla==='overdue'?'bad':w.sla==='due_soon'?'warn':'neutral'}/>}</div>
 <dl className="lk-grid2"><div><dt>Responsible person</dt><dd>{personName(state,a.owner_id)}</dd></div><div><dt>Assignee</dt><dd>{personName(state,w?.assignee_id??a.owner_id)}</dd></div><div><dt>Stage · needed by</dt><dd>{w?.stage??a.status} · {a.needed_by??'Not set'}</dd></div><div><dt>Age · service level</dt><dd>{Math.floor(Math.max(0,state.now-a.created_at)/86400000)} days · {w?`${w.business_days} business days; due ${when(w.due_at)}`:'Not recorded'}</dd></div></dl>
 <p>Next action: {a.status==='cancelled'?'Review cancellation before reopening':a.status==='draft'?'Complete documents and submit for review':a.status==='in_review'?'Review findings and obtain approvals':a.status==='approved'?'Prepare signature package':a.status==='out_for_signature'?'Wait for execution evidence':'No open action'}</p>
 <QueueActions state={state} a={a} locket={locket}/>
 </article>})}
 </section>
 {state.actor.role==='owner'&&<><QueueRules state={state} locket={locket}/><IntakeAudiences state={state} locket={locket}/></>}
 </div>
}
function QueueActions({state,a,locket}:{state:LocketState;a:Row;locket:Locket}){
 const authorized=can(state,'owner','counsel')||can(state,'approver','requester')&&[a.owner_id,a.requester_id].includes(state.actor.id)
 const cancellations=state.requestQueue.cancellations.filter(c=>c.agreement_id===a.id)
 return <>
 {cancellations.map(c=><p key={c.id}>Canceled at {c.stage}: {c.reason.replaceAll('_',' ')}{c.note?' · '+c.note:''}{c.reopened_at?' · Reopened: '+c.reopen_reason:''}</p>)}
 {a.status==='cancelled'?can(state,'owner','counsel')&&<Form busy={locket.busy} submit="Reopen request" onSubmit={data=>void locket.run('request.reopen',{agreementId:a.id,version:a.version,reason:value(data,'reason')})}><Field label="Reason to reopen"><input name="reason" required/></Field></Form>:authorized&&['draft','in_review','approved','out_for_signature'].includes(a.status)&&<details className="lk-disclosure"><summary>Manage request</summary>
 <Form busy={locket.busy} submit="Reassign request" onSubmit={data=>void locket.run('request.reassign',{agreementId:a.id,version:a.version,assigneeId:value(data,'assignee'),reason:value(data,'reason')})}><Field label="New assignee"><select name="assignee">{state.operators.filter(o=>o.status==='active'&&['owner','counsel','approver','requester'].includes(o.role)).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field><Field label="Reassignment reason"><input name="reason" required/></Field></Form>
 {['draft','in_review'].includes(a.status)&&<Form busy={locket.busy} submit="Update working stage" onSubmit={data=>void locket.run('request.stage',{agreementId:a.id,version:a.version,stage:value(data,'stage'),reason:value(data,'reason')})}><Field label="Working stage"><select name="stage">{['intake','drafting','negotiation','approval'].map(s=><option key={s} value={s}>{s}</option>)}</select></Field><Field label="Stage reason"><input name="reason" required/></Field></Form>}
 <Form busy={locket.busy} submit="Cancel request" onSubmit={data=>void locket.run('request.cancel',{agreementId:a.id,version:a.version,reason:value(data,'reason'),note:value(data,'note')||undefined})}><Field label="Cancellation reason"><select name="reason">{['deal_lost','no_longer_needed','duplicate','replaced','other'].map(s=><option key={s} value={s}>{s.replaceAll('_',' ')}</option>)}</select></Field><Field label="Cancellation note"><textarea name="note"/></Field><p>Closes this request and local signature packages, withdraws approvals and stops reminders. Void any manually sent envelope with its provider separately.</p></Form>
 </details>}
 </>
}
function QueueRules({state,locket}:{state:LocketState;locket:Locket}){
 const [type,setType]=useState('nda'),rule=state.requestQueue.rules.find(r=>r.type===type)
 return <section className="lk-panel"><h2>Assignment and service levels</h2><p>New requests rotate through active team members. Existing assignments and deadlines keep their recorded rule. Restricted requests only use people already permitted to read them.</p>
 <Field label="Rule request type"><select value={type} onChange={e=>setType(e.target.value)}>{Object.entries(typeLabel).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field>
 <Form key={type+':'+(rule?.version??0)} busy={locket.busy} submit="Save assignment rule" onSubmit={data=>void locket.run('queue.configure',{type,version:rule?.version??0,audienceId:value(data,'team'),leadId:value(data,'lead'),businessDays:Number(value(data,'days'))})}>
 <Field label="Assignment team"><select name="team" required defaultValue={rule?.audience_id??''}><option value="" disabled>Choose a group</option>{state.intakeAudiences.filter(g=>g.kind==='group').map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
 <Field label="Team lead"><select name="lead" defaultValue={rule?.lead_id??state.actor.id}>{state.operators.filter(o=>o.status==='active'&&['owner','counsel','approver','requester'].includes(o.role)).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
 <Field label="Service level (business days)"><input name="days" type="number" min="1" max="60" defaultValue={rule?.business_days??2}/></Field>
 </Form></section>
}
