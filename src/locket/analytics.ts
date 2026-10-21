// REPORT-001's observed workflow slice. Input has already passed ACCESS-001.
import { fail } from './model'
type Row = { id: string; [key: string]: any }
type Workspace = {
  now: number; agreements: Row[]; workflowHistory: Row[]; packages: Row[]
  approvalReminders: { pending: { agreementId: string; approverId: string; requestedAt: number }[] }
}
const statuses = ['draft', 'in_review', 'approved', 'out_for_signature']
const dayMs = 86_400_000

function bound(params: URLSearchParams, key: string, end: boolean) {
  const value = params.get(key)
  if (!value) return end ? Infinity : -Infinity
  const at = Date.parse(value + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== value) fail('INVALID', `${key} must be a calendar date.`)
  return at + (end ? dayMs - 1 : 0)
}
function median(values: number[]) {
  const n = values.length
  return n ? (values[Math.floor((n - 1) / 2)] + values[Math.ceil((n - 1) / 2)]) / 2 : null
}

export function workflowAnalytics(state: Workspace, params = new URLSearchParams()) {
  const start = bound(params, 'from', false), end = bound(params, 'to', true)
  if (start > end) fail('INVALID', 'The period ends before it starts.')
  const inside = (at: number) => at >= start && at <= end && at <= state.now
  const agreements = state.agreements.filter(a => a.origin === 'intake' && (!params.get('type') || a.type === params.get('type')) && (!params.get('entity') || a.entity_id === params.get('entity')))
  const ids = new Set(agreements.map(a => a.id))
  const history = state.workflowHistory.filter(e => ids.has(e.agreement_id) && e.at <= state.now)
  const completed = new Map<string, number>()
  const samples = new Map(statuses.map(s => [s, [] as number[]]))
  const current = new Map<string, Row>()
  for (const a of agreements) {
    // Commands can share a millisecond. rowid order is retained by the state read.
    const events = history.filter(e => e.agreement_id === a.id)
    let previous: Row | undefined
    for (const event of events) {
      if (event.to_status === 'executed' && !completed.has(a.id)) completed.set(a.id, event.at)
      if (previous && previous.to_status === event.from_status && event.at >= previous.at && inside(event.at)) samples.get(previous.to_status)?.push(event.at - previous.at)
      previous = event
    }
    if (previous && previous.to_status === a.status) current.set(a.id, previous)
  }
  const groups = new Map<string, { type: string; entityId: string | null; opened: number; completed: number; openedIds: string[]; completedIds: string[] }>()
  for (const a of agreements) {
    const key = JSON.stringify([a.type, a.entity_id ?? null])
    const group = groups.get(key) ?? { type: a.type, entityId: a.entity_id ?? null, opened: 0, completed: 0, openedIds: [] as string[], completedIds: [] as string[] }
    if (inside(a.created_at)) { group.opened++; group.openedIds.push(a.id) }
    if (completed.has(a.id) && inside(completed.get(a.id)!)) { group.completed++; group.completedIds.push(a.id) }
    if (group.opened || group.completed) groups.set(key, group)
  }
  const approvalWaits = state.approvalReminders.pending.filter(p => ids.has(p.agreementId) && inside(p.requestedAt)).map(p => ({ ...p, elapsedMs: Math.max(0, state.now - p.requestedAt) })).sort((a, b) => b.elapsedMs - a.elapsedMs || a.agreementId.localeCompare(b.agreementId))
  const signatureWaits = agreements.filter(a => a.status === 'out_for_signature').flatMap(a => {
    const pkg = state.packages.filter(p => p.agreement_id === a.id && p.status === 'sent').sort((x, y) => y.sent_at - x.sent_at)[0]
    return pkg && inside(pkg.sent_at) ? [{ agreementId: a.id, partyId: a.party_id, since: pkg.sent_at, elapsedMs: Math.max(0, state.now - pkg.sent_at) }] : []
  }).sort((a, b) => b.elapsedMs - a.elapsedMs || a.agreementId.localeCompare(b.agreementId))
  return {
    evaluatedAt: state.now,
    groups: [...groups.values()].sort((a, b) => a.type.localeCompare(b.type) || (a.entityId ?? '').localeCompare(b.entityId ?? '')),
    stages: statuses.map(stage => {
      const values = samples.get(stage)!.sort((a, b) => a - b)
      return { stage, count: values.length, medianMs: median(values), p90Ms: values.length ? values[Math.ceil(values.length * .9) - 1] : null }
    }),
    approvalWaits, signatureWaits,
    unknownStageStarts: agreements.filter(a => statuses.includes(a.status) && !current.has(a.id)).length,
  }
}
