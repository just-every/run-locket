import { useState } from 'react'
import type { LocketState } from './api'
import type { Locket } from './app'
import { Field } from './controls'
import { can, deadline, partyName, personName } from './format'

export function BulkReminders({ state, locket }: { state: LocketState; locket: Locket }) {
  const [query,setQuery]=useState(''),[view,setView]=useState(''),[selected,setSelected]=useState<Set<string>>(new Set())
  const [ownerId,setOwnerId]=useState(state.actor.id),[days,setDays]=useState('90, 60, 30, 7')
  const [activeId,setActiveId]=useState(''),[phase,setPhase]=useState(''),[progress,setProgress]=useState(''),[applied,setApplied]=useState('')
  if(!can(state,'owner','approver'))return null
  const busy=locket.busy||!!phase
  const tile=state.portfolio.tiles.find(t=>t.id===view)
  const imported=state.agreements.filter(a=>a.status==='imported')
  const matches=imported.filter(a=>(!tile||tile.agreementIds.includes(a.id))&&`${a.title} ${a.reference} ${partyName(state,a.party_id)}`.toLowerCase().includes(query.toLowerCase()))
  const schedules=state.reminderSchedules.filter(r=>imported.some(a=>a.id===r.agreement_id))
  const preview=state.reminderOperations.find(j=>j.id===activeId)
  const reset=()=>{setActiveId('');setApplied('');setProgress('')}
  const changeFilter=()=>{setSelected(new Set());reset()}
  async function advance(id:string,apply:boolean){
    setPhase(apply?'Applying':'Previewing');setActiveId(id)
    try{
      let status=apply?'applying':'previewing'
      while(apply?status==='applying':status==='previewing'){
        const result=await locket.run('renewal.bulk.next',{operationId:id,...(apply?{apply:true}:{})})
        if(!result)break
        status=result.status
        setProgress(`${apply?'Processed':'Previewed'} ${apply?result.processed:result.previewed} of ${result.total} agreements.`)
        if(status==='done')setApplied(`${result.scheduled} agreements scheduled. No reminders delivered.`)
      }
    }finally{setPhase('')}
  }
  return <section className="lk-panel lk-bulk-reminders" aria-labelledby="bulk-reminder-title" aria-busy={busy}>
    <h2 id="bulk-reminder-title">Bulk reminder schedules</h2>
    <p className="lk-muted">Choose imported agreements, review their current term deadlines, then store the schedules. A stored schedule that matches the current deadline sets who is reminded and on which days; each sent reminder appears on the deadline.</p>
    <fieldset disabled={busy} className="lk-bulk-fields">
      <div className="lk-bulk-controls">
        <Field label="Agreement view"><select value={view} onChange={e=>{setView(e.target.value);changeFilter()}}><option value="">All imported agreements</option>{state.portfolio.tiles.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
        <Field label="Filter imported agreements"><input type="search" value={query} onChange={e=>{setQuery(e.target.value);changeFilter()}} placeholder="Title, reference or counterparty" /></Field>
      </div>
      <div className="lk-bulk-selection-head"><label><input type="checkbox" aria-label="Select all matching imported agreements" disabled={!matches.length} checked={matches.length>0&&matches.every(a=>selected.has(a.id))} onChange={e=>{setSelected(new Set(e.target.checked?matches.map(a=>a.id):[]));reset()}} /> Select all matching ({matches.length})</label><strong>{selected.size} selected</strong></div>
      <div className="lk-bulk-selection" role="group" aria-label="Imported agreement selection">
        {matches.map(a=><label key={a.id}><input type="checkbox" checked={selected.has(a.id)} onChange={e=>{const next=new Set(selected);if(e.target.checked)next.add(a.id);else next.delete(a.id);setSelected(next);reset()}} /><span>{a.title}<small>{a.reference} · {partyName(state,a.party_id)}</small></span></label>)}
        {!matches.length&&<p>No imported agreements match this view and filter.</p>}
      </div>
      <form onSubmit={async e=>{
        e.preventDefault();setApplied('');setPhase('Starting')
        const result=await locket.run('renewal.bulk.start',{agreementIds:[...selected],ownerId,offsets:days.split(',').map(d=>Number(d.trim()))})
        if(result)await advance(result.id,false);else setPhase('')
      }}>
        <div className="lk-bulk-controls">
          <Field label="Reminder owner"><select value={ownerId} onChange={e=>{setOwnerId(e.target.value);reset()}} required>{state.operators.filter(o=>o.status==='active').map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
          <Field label="Days before notice deadline" hint="Comma-separated whole days; reminders are stored for 9:00 AM in each agreement’s time zone."><input value={days} required pattern="\s*\d+\s*(,\s*\d+\s*)*" onChange={e=>{setDays(e.target.value);reset()}} /></Field>
        </div>
        <button className="lk-primary" disabled={!selected.size}>Preview reminder schedules</button>
      </form>
    </fieldset>
    {progress&&<p role="status">{phase?`${phase}: `:''}{progress}</p>}
    {!phase&&state.reminderOperations.some(j=>j.status!=='done')&&<details><summary>Stored reviews and resumable operations</summary><ul>{state.reminderOperations.filter(j=>j.status!=='done').map(j=><li key={j.id}><button disabled={busy} onClick={()=>{setActiveId(j.id);setApplied('');if(j.status==='previewing')void advance(j.id,false)}}>{j.status==='previewing'?'Resume preview':'Open reviewed selection'} · {j.total} agreements · {j.previewed} previewed</button></li>)}</ul></details>}
    {preview&&preview.status!=='previewing'&&<div className="lk-bulk-preview" aria-label="Reviewed reminder preview">
      <h3>{preview.tracked.length} tracked deadlines · {preview.skipped.length} skipped</h3>
      <p>Owner: {personName(state,preview.ownerId)}. Offsets: {preview.offsets.join(', ')} days. Review and apply within 30 minutes.</p>
      <ul>{[...preview.tracked,...preview.skipped].map(r=><li key={r.agreementId} data-bulk-preview={r.agreementId}><strong>{r.title}</strong>{r.reason?<span>Skipped — {r.reason}</span>:<><span>Notice by {deadline(r.deadlineAt!,r.timezone)} · {r.timezone}</span><small>Current term {r.term}: {r.start} to {r.end}</small><details><summary>Reminder times</summary><ul>{r.reminders.map((reminder:any)=><li key={reminder.offsetDays}>{reminder.offsetDays} days before: {deadline(reminder.at,r.timezone)}{reminder.at<state.now?' (past time; no delivery)':''}</li>)}</ul></details></>}</li>)}</ul>
      {preview.status!=='done'&&<button className="lk-primary" disabled={busy} onClick={()=>void advance(preview.id,true)}>{preview.status==='applying'?'Resume applying schedules':'Apply reviewed schedules'}</button>}
    </div>}
    {applied&&<p role="status" className="lk-note">{applied}</p>}
    {schedules.length>0&&<details className="lk-bulk-saved" open><summary>Stored schedules ({schedules.length})</summary><ul>{schedules.map(r=><li key={r.id} data-reminder-schedule={r.agreement_id}><strong>{state.agreements.find(a=>a.id===r.agreement_id)?.title}</strong><span>{r.schedule_status==='needs_review'?'Agreement changed; review schedule again.':'Scheduled'} · no reminders delivered</span><small>Notice by {deadline(r.deadline_at,r.timezone)} · {personName(state,r.owner_id)} · {r.offsets.join(', ')} days before</small></li>)}</ul></details>}
  </section>
}
