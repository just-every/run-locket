// Derived facts the register and agreement pages both show.
import type { LocketState, Row } from './api'
import { currentVersion, day, dayOf, deadline, renewalOf } from './format'

export function liveApprovals(state: LocketState, a: Row) {
  const v = currentVersion(state, a)
  return state.approvals.filter(x => x.agreement_id === a.id && !x.invalidated_at && v && x.version_id === v.id && x.version_digest === v.digest)
}

/** Approval decisions that stopped counting because the document or context changed. */
export function staleApproval(state: LocketState, a: Row) {
  const v = currentVersion(state, a)
  const stale = state.approvals.filter(x => x.agreement_id === a.id && x.decision === 'approved' && (x.invalidated_at || (v && x.version_id !== v.id)))
  return stale.length ? stale[stale.length - 1] : null
}

export function blockers(state: LocketState, a: Row): { title: string; detail: string }[] {
  const out: { title: string; detail: string }[] = []
  for (const r of state.requirements.filter(r => r.agreement_id === a.id && !r.artifact_id && !r.waived_reason)) out.push({ title: `Missing schedule: ${r.label}`, detail: 'Required before review' })
  if (['in_review'].includes(a.status)) {
    const live = liveApprovals(state, a)
    for (const step of state.routes[a.id] ?? []) {
      const decided = live.find(x => x.kind === step.kind && (x.deviation_id ?? null) === (step.deviationId ?? null))
      if (!decided) out.push({ title: step.label, detail: `Awaiting ${step.roles.filter(r => r !== 'owner').join(' or ') || 'owner'} decision` })
      else if (decided.decision === 'rejected') out.push({ title: `${step.label} rejected`, detail: decided.reason || 'Upload a revised version' })
    }
  }
  for (const e of state.executions.filter(e => e.agreement_id === a.id && e.status === 'needs_review')) out.push({ title: 'Execution needs review', detail: JSON.parse(e.checks).filter((c: any) => !c.ok).map((c: any) => c.check).join(', ') + ' did not reconcile' })
  return out
}

/** The six steps, each with the local date it was reached. */
export function timeline(state: LocketState, a: Row) {
  const audit = state.audit.filter(x => x.agreement_id === a.id)
  const at = (...actions: string[]) => audit.filter(x => actions.includes(x.action)).map(x => x.at).sort((p, q) => p - q)[0] ?? null
  const executed = state.executions.find(e => e.agreement_id === a.id && e.status !== 'needs_review')
  const obligation = at('obligation.confirm', 'obligation.done')
  const reached = (statuses: string[]) => statuses.includes(a.status)
  return [
    { label: 'Request', done: true, on: dayOf(a.created_at) },
    { label: 'Review', done: reached(['in_review', 'approved', 'out_for_signature', 'executed']), on: dayOf(at('agreement.submit')) },
    { label: 'Approval', done: reached(['approved', 'out_for_signature', 'executed']), on: dayOf(at('approval.approved')) },
    { label: 'Signature', done: reached(['out_for_signature', 'executed']), on: dayOf(at('package.sent')) },
    { label: 'Executed', done: reached(['executed', 'imported']) && (!!executed || a.status === 'imported'), on: executed ? day(executed.executed_on) : a.status === 'imported' ? dayOf(a.created_at) : '—' },
    { label: 'Obligations', done: obligation !== null, on: dayOf(obligation) },
  ]
}

export function nextNotice(state: LocketState, a: Row) {
  const r = renewalOf(state, a.id)
  return r ? { renewal: r, text: deadline(r.deadline_at, r.timezone), zone: r.timezone } : null
}
