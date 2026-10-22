import { useState } from 'react'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Badge, Empty, Field, Form, value } from './controls'
import { can, parse, typeLabel } from './format'

type EvidenceState = { outcomes: Row[]; issues: Row[]; recommendations: Row[]; applications: Row[] }
type Props = { state: LocketState & { playbookRecommendations: EvidenceState }; locket: Locket }
const hours = (ms: number | null) => ms === null ? 'Unknown' : `${(ms / 3_600_000).toLocaleString('en-US', { maximumFractionDigits: 2 })} hours`
const passage = (c: any) => `#agreement/${c.agreementId}/versions/${c.version}/${c.start}/${c.end}`

/** Counsel works from exact approved passages and explicit counterparty records.
 * Analysis never treats proposed wording or missing issue data as an outcome. */
export function PlaybookRecommendations({ state, locket }: Props) {
  const [agreementId, setAgreementId] = useState('')
  if (!can(state, 'counsel')) return null
  const { run, busy } = locket, evidence = state.playbookRecommendations
  const active = state.playbooks.find(p => p.status === 'active')
  const rules = active ? parse<any[]>(active.rules) : []
  const a = state.agreements.find(a => a.id === agreementId)
  const eligible = a ? state.deviations.filter(d => d.agreement_id === a.id && d.version_id === a.current_version_id && d.result !== 'met' && !evidence.outcomes.some(o => o.deviation_id === d.id)).flatMap(d => {
    const approval = state.approvals.find(p => p.deviation_id === d.id && p.version_id === d.version_id && p.decision === 'approved' && !p.invalidated_at)
    return approval ? [{ d, approval }] : []
  }) : []
  return <section className="lk-panel" aria-label="Measured playbook changes">
    <div className="lk-panel-head"><h2>Measured playbook changes</h2></div>
    <p>Compare recorded counterparty outcomes, approved exceptions and later operational observations. Counsel chooses the scope for each new playbook version.</p>
    <details><summary>Record a counterparty outcome</summary>
      <Field label="Outcome agreement"><select value={agreementId} onChange={e => setAgreementId(e.target.value)}><option value="">Choose agreement</option>{state.agreements.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></Field>
      {eligible.length ? eligible.map(({ d, approval }) => <article className="lk-card" key={d.id}>
        <strong>{d.clause_key}</strong><blockquote style={{ overflowWrap: 'anywhere' }}>{d.quote}</blockquote>
        <Form busy={busy} submit="Record negotiation outcome" onSubmit={async data => { await run('negotiation.outcome.record', { agreementId: a!.id, version: a!.version, versionId: d.version_id, deviationId: d.id, approvalId: approval.id, outcome: value(data, 'outcome'), evidence: value(data, 'evidence') }) }}>
          <Field label="Counterparty decision"><select name="outcome"><option value="accepted">Accepted this exact wording</option><option value="rejected">Rejected this exact wording</option></select></Field>
          <Field label="Counterparty evidence" hint="Identify the reply, discussion or signed passage supporting this recorded outcome."><textarea name="evidence" required /></Field>
        </Form>
      </article>) : <Empty>Choose an agreement with an approved exception on its current version.</Empty>}
    </details>
    <details><summary>Record a later operational observation</summary>
      <Form busy={busy} submit="Record operational observation" onSubmit={async data => {
        const outcome = evidence.outcomes.find(o => o.id === value(data, 'outcomeId'))
        const agreement = state.agreements.find(a => a.id === outcome?.agreement_id)
        if (outcome && agreement) await run('playbook.issue.record', { agreementId: agreement.id, version: agreement.version, outcomeId: outcome.id, kind: value(data, 'kind'), description: value(data, 'description'), evidence: value(data, 'evidence'), obligationId: value(data, 'obligationId') || undefined })
      }}>
        <Field label="Accepted outcome"><select name="outcomeId" required><option value="">Choose outcome</option>{evidence.outcomes.filter(o => o.outcome === 'accepted').map(o => <option key={o.id} value={o.id}>{state.agreements.find(a => a.id === o.agreement_id)?.title} · {o.clause_key}</option>)}</select></Field>
        <Field label="Observation kind"><select name="kind"><option value="dispute">Dispute</option><option value="credit">Credit</option><option value="missed_obligation">Missed obligation</option><option value="none_observed">Explicitly reviewed; none observed</option></select></Field>
        <Field label="Missed obligation source"><select name="obligationId"><option value="">No obligation source</option>{state.obligations.filter(o => o.status === 'confirmed').map(o => <option key={o.id} value={o.id}>{o.description}</option>)}</select></Field>
        <Field label="Observation"><textarea name="description" required /></Field>
        <Field label="Observation evidence"><textarea name="evidence" required /></Field>
      </Form>
    </details>
    {active && <details><summary>Analyze accepted exceptions</summary>
      <Form busy={busy} submit="Prepare measured recommendation" onSubmit={async data => { await run('playbook.recommend', { sourcePlaybookId: active.id, clauseKey: value(data, 'clauseKey'), scope: { agreementTypes: data.getAll('agreementTypes'), entityIds: data.getAll('entityIds').filter(Boolean) } }) }}>
        <Field label="Analyze clause"><select name="clauseKey">{rules.map(r => <option key={r.key} value={r.key}>{r.title}</option>)}</select></Field>
        <fieldset className="lk-fieldset" style={{ minWidth: 0 }}><legend>Agreement types for future reviews</legend>{Object.entries(typeLabel).map(([key, label]) => <label className="lk-check" key={key}><input type="checkbox" name="agreementTypes" value={key} /> {label}</label>)}</fieldset>
        <Field label="Entities for future reviews" hint="Select entities, or explicitly choose every entity."><select name="entityIds" multiple defaultValue={['']}><option value="">Every entity</option>{state.entities.map(e => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</select></Field>
        <p>The most frequently recorded accepted wording outside the source playbook's standard positions is proposed. Missing workflow time and operational observations remain unknown.</p>
      </Form>
    </details>}
    {evidence.recommendations.length === 0 && <Empty>No measured recommendations yet.</Empty>}
    {evidence.recommendations.map(recommendation => <Recommendation key={recommendation.id} recommendation={recommendation} state={state} locket={locket} />)}
  </section>
}

function Recommendation({ recommendation: r, state, locket }: Props & { recommendation: Row }) {
  const analysis = parse<any>(r.analysis), { cycleTime, operations } = analysis
  return <article className="lk-card" aria-label={`Recommendation ${analysis.clauseKey}`}>
    <div className="lk-finding-head"><h3>{analysis.title}: standard alternative</h3><Badge value={r.status} /></div>
    <blockquote style={{ overflowWrap: 'anywhere' }}>{analysis.wording}</blockquote>
    <p>{analysis.acceptedCount} accepted citations from {analysis.negotiations} recorded negotiations · {analysis.unknownNegotiationCount} other agreements with unrecorded counterparty outcomes · source playbook v{analysis.sourcePlaybookNumber}</p>
    <p>Predicted cycle-time saving per affected agreement: <strong>{hours(cycleTime.predictedSavingMs)}</strong>. Measured on {cycleTime.measuredCount}; unknown on {cycleTime.unknownCount}. Historical affected-agreement scenario: {hours(cycleTime.affectedScenarioSavingMs)}.</p>
    <p className="lk-muted">{cycleTime.assumption}</p>
    <p>{operations.issueCount} recorded later issues; {operations.unknownAgreementCount} agreements have unknown operational outcomes. {operations.interpretation}</p>
    <p>Future review scope: {analysis.scope.agreementTypes.map((t: string) => typeLabel[t]).join(', ')} · {analysis.scope.entityIds.length ? analysis.scope.entityIds.map((id: string) => state.entities.find(e => e.id === id)?.legal_name ?? id).join(', ') : 'Every entity'}.</p>
    <details><summary>Affected agreements and exact citations ({analysis.citations.length})</summary><ul className="lk-rules">{analysis.citations.map((c: any) => <li key={c.outcomeId}>
      <a href={passage(c)}>{c.title} · v{c.version}</a><blockquote style={{ overflowWrap: 'anywhere' }}>{c.quote}</blockquote><p>{c.evidence}</p>
      <small>Incremental exception wait: {hours(c.timing.incrementalExceptionWaitMs)}. Exception approval recorded for this version.</small>
      {c.issues.map((issue: any) => <p key={issue.id}>{issue.kind.replace(/_/g, ' ')}: {issue.description} · {issue.evidence}</p>)}
    </li>)}</ul></details>
    <details><summary>Other recorded negotiation outcomes ({analysis.otherOutcomes.length})</summary>{analysis.otherOutcomes.map((o: any) => <p key={o.id}>{o.outcome}: {o.quote} · {o.evidence}{o.issues.map((i: any) => ` · ${i.kind}: ${i.description}`).join('')}</p>)}</details>
    {r.status === 'proposed' && <Form busy={locket.busy} submit="Approve new playbook version" onSubmit={async data => { await locket.run('playbook.recommendation.decide', { recommendationId: r.id, decision: 'approve', scope: analysis.scope, reason: value(data, 'reason') }) }}>
      <label className="lk-check"><input type="checkbox" required /> Apply this alternative only to future reviews in the displayed scope. I reviewed the recorded issues and unknown outcomes.</label>
      <Field label="Counsel decision reason"><textarea name="reason" required /></Field>
    </Form>}
    {r.status === 'proposed' && <details><summary>Reject recommendation</summary><Form busy={locket.busy} submit="Reject measured recommendation" onSubmit={async data => { await locket.run('playbook.recommendation.decide', { recommendationId: r.id, decision: 'reject', reason: value(data, 'reason') }) }}><Field label="Rejection reason"><textarea name="reason" required /></Field></Form></details>}
    {r.new_playbook_id && <p>Approved as playbook v{state.playbooks.find(p => p.id === r.new_playbook_id)?.number}. Signed agreements and earlier findings and approvals retain their original versions.</p>}
  </article>
}
