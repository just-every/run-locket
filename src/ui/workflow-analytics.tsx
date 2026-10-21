import { useState } from 'react'
import { workflowAnalytics } from '../locket/analytics'
import type { LocketState } from './api'
import { Field, Form, value } from './controls'
import { partyName, personName, typeLabel } from './format'

const labels: Record<string, string> = { draft: 'Draft', in_review: 'In review', approved: 'Approved · awaiting dispatch', out_for_signature: 'Out for signature' }
const duration = (ms: number | null) => ms === null ? 'No completed visits' : `${(ms / 3_600_000).toLocaleString('en-US', { maximumFractionDigits: 2 })} hours`

export function WorkflowAnalytics({ state }: { state: LocketState }) {
  const [params, setParams] = useState(new URLSearchParams())
  let result: ReturnType<typeof workflowAnalytics> | undefined, error = ''
  try { result = workflowAnalytics(state, params) } catch (cause) { error = (cause as Error).message }
  const title = (id: string) => state.agreements.find(a => a.id === id)?.title
  const links = (ids: string[]) => ids.map(id => <a key={id} href={`#agreement/${id}`}>{title(id)}</a>)
  return <section className="lk-panel lk-workflow" aria-label="Workflow performance">
    <h2>Workflow performance</h2>
    <p className="lk-muted">Measured request activity and current waiting work. Imported history is excluded. Team service levels and cancellation reporting are not yet available.</p>
    <Form busy={false} submit="Apply performance filters" onSubmit={data => {
      setParams(new URLSearchParams(Object.fromEntries(['from', 'to', 'type', 'entity'].map(key => [key, value(data, key)]))))
    }}>
      <div className="lk-workflow-filters">
        <Field label="Performance from"><input type="date" name="from" /></Field>
        <Field label="Performance through"><input type="date" name="to" /></Field>
        <Field label="Performance type"><select name="type"><option value="">All types</option>{Object.entries(typeLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
        <Field label="Performance entity"><select name="entity"><option value="">All entities</option>{state.entities.map(e => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</select></Field>
      </div>
    </Form>
    {error && <p role="alert">{error}</p>}
    {result && <>
      <h3>Requests opened and completed</h3>
      {!result.groups.length && <p>No request activity in this period.</p>}
      <ul className="lk-workflow-groups">{result.groups.map(group => <li key={JSON.stringify([group.type, group.entityId])}>
        <strong>{typeLabel[group.type]} · {state.entities.find(e => e.id === group.entityId)?.legal_name ?? 'No entity recorded'}</strong>
        <p>{group.opened} opened · {group.completed} completed</p>
        <details><summary>Source requests</summary><p>Opened</p><div className="lk-workflow-links">{links(group.openedIds)}</div><p>Completed</p><div className="lk-workflow-links">{links(group.completedIds)}</div></details>
      </li>)}</ul>
      <h3>Time in each workflow stage</h3>
      <p className="lk-muted">Elapsed hours per completed stage visit, including repeat visits. Median averages the middle two; P90 uses nearest rank. Open stages are excluded. History starts when transition recording is installed; {result.unknownStageStarts} current stage starts are unknown.</p>
      <div className="lk-workflow-stages">{result.stages.map(stage => <article key={stage.stage} aria-label={`${labels[stage.stage]} timing`}>
        <h4>{labels[stage.stage]}</h4><p>{stage.count} completed visits</p><dl><dt>Median</dt><dd>{duration(stage.medianMs)}</dd><dt>P90</dt><dd>{duration(stage.p90Ms)}</dd></dl>
      </article>)}</div>
      <h3>Longest pending approvals</h3>
      {!result.approvalWaits.length && <p>No pending approval requests in this period.</p>}
      <ol className="lk-workflow-waits">{result.approvalWaits.map(p => <li key={`${p.agreementId}:${p.approverId}`}><a href={`#agreement/${p.agreementId}/approvals`}>{title(p.agreementId)}</a><span>{personName(state, p.approverId)} · {duration(p.elapsedMs)}</span></li>)}</ol>
      <h3>Longest signature waits by counterparty</h3>
      {!result.signatureWaits.length && <p>No outstanding signature packages in this period.</p>}
      <ol className="lk-workflow-waits">{result.signatureWaits.map(p => <li key={p.agreementId}><a href={`#agreement/${p.agreementId}/signature`}>{title(p.agreementId)}</a><span>{partyName(state, p.partyId)} · {duration(p.elapsedMs)} since recorded dispatch</span></li>)}</ol>
      <p className="lk-muted">Period dates include the whole UTC day. Opened uses request creation, completed uses the first observed execution, stage visits use their exit time, and current waits use the request or dispatch time. Filters use the agreement’s current type and entity. Waiting time continues to the current evaluation time.</p>
    </>}
  </section>
}
