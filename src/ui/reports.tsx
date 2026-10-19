import { useState } from 'react'
import type { LocketState } from './api'
import { fetchJson } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { repositoryFields } from '../locket/repository-fields'
import type { ReportOutput } from '../locket/report-output'
import { money, personName } from './format'

export function Reports({state,locket}:{state:LocketState;locket:Locket}){
  const [preview,setPreview]=useState<ReportOutput|null>(null),[error,setError]=useState('')
  return <section className="lk-panel" aria-label="Custom reports"><h2>Custom reports</h2>
    <p className="lk-muted">Group a saved-view snapshot and total its USD values. Dates group by calendar month. Each emailed attachment is generated with its recipient’s current access. Weekly and monthly schedules keep the installation’s time zone at creation; month-end dates clamp to the last day.</p>
    {state.actor.role!=='agent'&&<details><summary>Schedule a report</summary><Form busy={locket.busy} submit="Schedule report" onSubmit={async (data,form)=>{const created=await locket.run('report.create',{name:value(data,'name'),viewId:value(data,'view'),groupField:value(data,'group'),frequency:value(data,'frequency'),format:value(data,'format'),firstAt:value(data,'first'),recipients:data.getAll('recipient')});if(created){const details=form.closest('details');if(details)details.open=false}}}>
      <Field label="Report name"><input name="name" required /></Field>
      <Field label="Saved view"><select name="view" required>{state.savedViews.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
      <Field label="Group by"><select name="group" defaultValue="notice_deadline">{repositoryFields.map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</select></Field>
      <Field label="Frequency"><select name="frequency"><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></Field>
      <Field label="Attachment"><select name="format"><option value="csv">CSV</option><option value="pdf">PDF</option></select></Field>
      <Field label={`First occurrence (${state.settings.timezone})`}><input name="first" type="datetime-local" required /></Field>
      <fieldset className="lk-fieldset"><legend>Recipients (attachments include their permitted rows)</legend>{state.operators.filter(o=>o.status==='active').map(o=><label key={o.id} className="lk-check"><input type="checkbox" name="recipient" value={o.id} defaultChecked={o.id===state.actor.id} /> {o.name}</label>)}</fieldset>
    </Form></details>}
    {error&&<p role="alert">{error}</p>}
    {state.reports.map(r=><article key={r.id} className="lk-card"><h3>{r.name}</h3><p>{r.frequency} · {r.format.toUpperCase()} · {r.enabled?'Next '+new Date(r.next_at).toLocaleString('en-US',{timeZone:r.timezone})+' '+r.timezone:'Stopped'}</p>
      <div className="lk-actions"><button type="button" onClick={()=>void fetchJson<ReportOutput>(`/api/locket/reports/${r.id}`).then(setPreview).catch(e=>setError(e.message))}>Open report</button><a href={`/api/locket/reports/${r.id}?format=csv`}>Download CSV</a><a href={`/api/locket/reports/${r.id}?format=pdf`}>Download PDF</a>{Boolean(r.enabled)&&<button type="button" onClick={()=>void locket.run('report.stop',{id:r.id,version:r.version})}>Stop schedule</button>}</div>
      <ul>{state.reportDeliveries.filter(d=>d.report_id===r.id).map(d=><li key={d.id}>{personName(state,d.recipient_id)}: {d.status==='accepted'?'Provider accepted; mailbox delivery unconfirmed':d.status}{d.detail?' — '+d.detail:''}</li>)}</ul>
    </article>)}
    {preview&&<section aria-label="Report preview"><h3>{preview.name}</h3><div className="lk-table-scroll"><table className="lk-table"><thead><tr><th>Group</th><th>Agreements</th><th>Total USD</th><th>Missing value</th></tr></thead><tbody>{preview.groups.map(g=><tr key={g.group}><td data-label="Group">{g.group}</td><td data-label="Agreements">{g.count}</td><td data-label="Total USD">{money(g.value)}</td><td data-label="Missing value">{g.missing}</td></tr>)}</tbody></table></div><p>{preview.result.rows.length} agreements in your current access.</p></section>}
  </section>
}
