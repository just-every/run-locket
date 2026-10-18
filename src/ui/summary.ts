// Derived facts the register and agreement pages both show.
import type { LocketState, Row } from './api'
import { currentVersion, deadline, renewalOf } from './format'

export function liveApprovals(state: LocketState, a: Row) {
  const v = currentVersion(state, a)
  return state.approvals.filter(x => x.agreement_id === a.id && !x.invalidated_at && v && x.version_id === v.id && x.version_digest === v.digest)
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

export function nextNotice(state: LocketState, a: Row) {
  const r = renewalOf(state, a.id)
  return r ? { renewal: r, text: deadline(r.deadline_at, r.timezone), zone: r.timezone } : null
}
