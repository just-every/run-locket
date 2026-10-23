import { ReviewRedlines } from './review-redlines'
import { ApprovalRoutingInputs, ApprovalAvailability } from './approval-rules'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { ApprovalMail } from './approval-mail'
import { ApprovalReminders } from './approval-reminders'
import { Badge, Empty, Field, Form, value } from './controls'
import { can, currentVersion, parse, personName, roleLabel, versionsOf, when } from './format'
import { decisionLine } from './notes'
import { liveApprovals } from './summary'

const resultLabel: Record<string, string> = { met: 'Rule met', breached: 'Rule breached', undetermined: 'Cannot determine' }

export function Review({ state, a, locket }: { state: LocketState; a: Row; locket: Locket }) {
  const { run, busy } = locket
  const v = currentVersion(state, a)
  const playbook = state.playbooks.find(p => p.id===state.agreementPlaybooks[a.id])
  const rules: any[] = playbook ? parse(playbook.rules) : []
  const versions = versionsOf(state, a.id)
  // Newest version first; on each, what needs a decision before what is met, then in the order of the text.
  const findings = state.deviations.filter(d => d.agreement_id === a.id).sort((x, y) => y.created_at - x.created_at || Number(x.result === 'met') - Number(y.result === 'met') || x.start_offset - y.start_offset)
  const canReview = can(state, 'owner', 'counsel', 'approver', 'requester') && ['draft', 'in_review', 'approved'].includes(a.status)
  // A breach's exception decision on the current version, worded as the margin note words it.
  const decisionOn = (d: Row) => liveApprovals(state, a).find(x => x.kind === 'exception' && x.deviation_id === d.id)
  return (
    <div className="lk-tab-page">
      <ApprovalMail state={state} a={a} locket={locket} />
      <ReviewRedlines key={v?.id} state={state} a={a} locket={locket} />
      <section className="lk-panel">
        <div className="lk-panel-head"><h2>Review findings</h2>{playbook && <span className="lk-muted">Playbook v{playbook.number}</span>}</div>
        {findings.length === 0 ? <Empty>No findings recorded. Each finding cites the exact passage it is about.</Empty> : (
          <ul className="lk-findings">
            {findings.map(d => (
              <li key={d.id} className={d.version_id === v?.id ? undefined : 'lk-faded'}>
                <div className="lk-finding-head"><strong>{parse<any[]>(state.playbooks.find(book=>book.id===d.playbook_version_id)?.rules??'[]').find(rule=>rule.key===d.clause_key)?.title??d.clause_key}</strong><Badge value={d.result} label={resultLabel[d.result]} />{decisionOn(d) && <Badge value={decisionOn(d)!.decision} tone={decisionOn(d)!.decision === 'approved' ? 'neutral' : 'bad'} label={decisionOn(d)!.decision === 'approved' ? 'Accepted ✓' : 'Rejected'} />}<span className="lk-muted">v{versions.find(x => x.id === d.version_id)?.number} · characters {d.start_offset}–{d.end_offset} · playbook v{state.playbooks.find(book=>book.id===d.playbook_version_id)?.number}{d.proposal_id ? ' · prepared by agent' : ''}</span></div>
                <blockquote>{d.quote}</blockquote>
                <p>{d.explanation}</p>
                {d.proposed_wording && <p className="lk-proposed"><strong>Proposed wording:</strong> {d.proposed_wording}</p>}
                {parse<string[]>(d.questions).length > 0 && <ul className="lk-questions">{parse<string[]>(d.questions).map(q => <li key={q}>{q}</li>)}</ul>}
                <small>{d.result === 'met' ? 'No exception needed' : decisionOn(d) ? decisionLine(state, a, decisionOn(d)!) : `Needs ${d.authority} exception approval`} · {personName(state, d.created_by)} · {when(d.created_at)}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="lk-panel">
        <div className="lk-panel-head"><h2>Record a finding on v{v?.number ?? '–'}</h2></div>
        {!playbook ? <Empty>Activate a clause playbook in the Library first.</Empty> : !v?.text ? <Empty>The current version has no text to cite.</Empty> : canReview ? (
          <Form busy={busy} submit="Record finding" onSubmit={async (data, form) => {
            const quote = value(data, 'quote')
            const start = v.text.indexOf(quote)
            if (!quote || start < 0) return locket.setError('Paste the passage exactly as it appears in the current version.')
            const ok = await run('deviation.add', { agreementId: a.id, versionId: v.id, clauseKey: value(data, 'clauseKey'), result: value(data, 'result'), start, end: start + quote.length, quote, proposedWording: value(data, 'proposedWording') || undefined, explanation: value(data, 'explanation'), questions: value(data, 'questions').split('\n').map(s => s.trim()).filter(Boolean) })
            if (ok) form.reset()
          }}>
            <Field label="Clause"><select name="clauseKey">{rules.map(r => <option key={r.key} value={r.key}>{r.title} ({r.authority} decides)</option>)}</select></Field>
            <Field label="Result"><select name="result"><option value="met">Rule met</option><option value="breached">Rule breached</option><option value="undetermined">Cannot determine</option></select></Field>
            <Field label="Exact passage" hint="Copy it from the version text; Locket stores its position."><textarea name="quote" rows={3} required /></Field>
            <Field label="Explanation"><textarea name="explanation" rows={2} required /></Field>
            <Field label="Proposed wording (optional)"><textarea name="proposedWording" rows={2} /></Field>
            <Field label="Open questions (one per line)"><textarea name="questions" rows={2} /></Field>
          </Form>
        ) : <p className="lk-muted">Your role reads findings; agents submit them as proposals.</p>}
        {rules.length > 0 && (
          <details className="lk-disclosure">
            <summary>Playbook v{playbook!.number} rules ({rules.length})</summary>
            <ul className="lk-rules">{rules.map(r => <li key={r.key}><strong>{r.title}</strong><p>{r.preferred}</p>{r.alternatives.length > 0 && <small>Allowed alternatives: {r.alternatives.join(' / ')}</small>}<small>Exception authority: {r.authority}</small></li>)}</ul>
          </details>
        )}
      </section>
    </div>
  )
}

export function Approvals({ state, a, locket }: { state: LocketState; a: Row; locket: Locket }) {
  const { run, busy } = locket
  const v = currentVersion(state, a)
  const route = state.routes[a.id] ?? []
  const live = liveApprovals(state, a)
  const history = state.approvals.filter(x => x.agreement_id === a.id).sort((p, q) => q.at - p.at)
  const versions = versionsOf(state, a.id)
  return (
    <div className="lk-tab-page">
      <ApprovalRoutingInputs state={state} a={a} locket={locket}/>
      <ApprovalAvailability state={state} locket={locket}/>
      <ApprovalMail state={state} a={a} locket={locket} />
      <ApprovalReminders state={state} a={a} locket={locket} />
      <section className="lk-panel">
        <div className="lk-panel-head"><h2>Approval route for v{v?.number ?? '–'}</h2></div>
        {a.status === 'draft' && <p className="lk-muted">Submit the request for review to open its approvals.</p>}
        <ul className="lk-route">
          {route.map(step => {
            const decided = live.find(x => x.kind === step.kind && (x.deviation_id ?? null) === (step.deviationId ?? null))
            const ordered = !step.approverId||!route.some(r=>r.approverId&&r.order!<step.order!&&!live.some(x=>x.deviation_id===r.deviationId&&x.decision==='approved'))
            const named = !step.approverId||state.actor.role==='owner'||(!step.away&&step.approverId===state.actor.id)||(step.away&&step.delegateId===state.actor.id)
            const allowed = !state.fieldAccess.documentsWithheld&&ordered&&named&&step.roles.includes(state.actor.role) && (state.actor.role === 'owner' || a.requester_id !== state.actor.id)
            return (
              <li key={step.label}>
                <div><strong>{step.label}</strong><small>{step.approverId?`Stage ${step.order} · ${personName(state,step.approverId)}${step.away?' (away; delegate: '+personName(state,step.delegateId??'')+')':''}`:'Decided by '+step.roles.map(r=>roleLabel[r]).join(' or ')}</small>{!ordered&&<small>Waiting for earlier stages</small>}</div>
                {decided ? <span>{state.ruleDecisions.some(d=>d.approval_id===decided.id&&d.acted_as==='delegate')&&<small>Acted as away delegate · </small>}{state.ruleDecisions.some(d=>d.approval_id===decided.id&&d.acted_as==='owner_override')&&<small>Owner approval for named approver · </small>}<Badge value={decided.decision} /> <small>{personName(state, decided.actor_id)} · {when(decided.at)}{decided.reason ? ` · ${decided.reason}` : ''}</small></span> : a.status === 'in_review' && allowed ? (
                  <Form busy={busy} submit="Record decision" className="lk-inline" onSubmit={data => void run('approval.decide', { agreementId: a.id, version: a.version, versionId: v!.id, kind: step.kind, deviationId: step.deviationId ?? undefined, decision: value(data, 'decision'), reason: value(data, 'reason') || undefined })}>
                    <select name="decision" aria-label={`Decision for ${step.label}`}><option value="approved">Approve v{v?.number}</option><option value="rejected">Reject</option></select>
                    <input name="reason" placeholder="Reason (optional)" aria-label="Reason" />
                  </Form>
                ) : <Badge value="pending" label={a.status === 'in_review' ? 'Waiting' : 'Not open'} />}
              </li>
            )
          })}
        </ul>
        {v && <p className="lk-muted lk-mono">Approvals pin version identity {v.digest.slice(0, 16)}… and the decision context (value, counterparty, findings).</p>}
      </section>
      <section className="lk-panel">
        <div className="lk-panel-head"><h2>All decisions</h2></div>
        {history.length === 0 ? <Empty>No decisions yet.</Empty> : (
          <ul className="lk-log">{history.map(x => (
            <li key={x.id} className={x.invalidated_at ? 'lk-faded' : undefined}>
              <time>{when(x.at)}</time>
              <span><strong>{personName(state, x.actor_id)}</strong> ({x.actor_role}) {x.decision} {x.kind === 'commercial' ? 'commercial approval' : 'exception'} on v{versions.find(y => y.id === x.version_id)?.number}{x.reason ? ` — ${x.reason}` : ''}{x.invalidated_at && <em> · no longer counts: {x.invalidated_reason}</em>}</span>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  )
}
