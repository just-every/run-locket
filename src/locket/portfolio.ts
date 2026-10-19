// All input is the same permission-scoped workspace used by the register.
import { endInstant, lifecycle, localDate, type Lifecycle } from './lifecycle'
import { daysUntil } from './display'
import { fail } from './model'
type Row = { id: string; [key: string]: any }
export interface PortfolioTile { id: string; label: string; count: number; valueCents: number; unvalued: number; agreementIds: string[]; obligationCount?: number }
export interface Portfolio { tiles: PortfolioTile[]; lifecycle: Record<string, Lifecycle>; now: number }
export function portfolio(workspace: { now: number; agreements: Row[]; entities: Row[]; terms: Row[]; renewals: Row[]; notices: Row[]; obligations: Row[]; approvals: Row[]; deviations: Row[] }, entityId: string | null = null): Portfolio {
  // ENTITY-001: one entity's figures, or every entity with a tile per entity ("none" = not recorded).
  if (entityId !== null && entityId !== 'none' && !workspace.entities.some(e => e.id === entityId)) fail('NOT_FOUND', 'No such entity of ours.', 404)
  const s = entityId === null ? workspace : { ...workspace, agreements: workspace.agreements.filter(a => (a.entity_id ?? 'none') === entityId) }
  const states = Object.fromEntries(s.agreements.map(a => [a.id, lifecycle(a, s.terms, s.renewals, s.notices, s.now)]))
  const contracted = s.agreements.filter(a => ['executed', 'imported'].includes(a.status))
  const tiles: PortfolioTile[] = []
  const tile = (id: string, label: string, rows: Row[], extra = {}) => tiles.push({ id, label, count: rows.length, valueCents: rows.reduce((sum, a) => sum + (a.value_cents ?? 0), 0), unvalued: rows.filter(a => a.value_cents === null).length, agreementIds: rows.map(a => a.id), ...extra })
  tile('all', 'Total contracted value', contracted)
  if (entityId === null && s.entities.length) {
    for (const e of s.entities) tile(`entity-${e.id}`, `Entity: ${e.legal_name}`, contracted.filter(a => a.entity_id === e.id))
    tile('entity-none', 'Entity: not recorded', contracted.filter(a => !a.entity_id))
  }
  for (const type of ['customer', 'supplier', 'nda', 'amendment', 'order_form', 'other']) tile(`type-${type}`, `Type: ${type.replaceAll('_', ' ')}`, contracted.filter(a => a.type === type))
  for (const status of ['not_yet_in_effect', 'active', 'auto_renewing', 'expired', 'terminated', 'termination_pending', 'terms_unconfirmed']) tile(`lifecycle-${status}`, `Lifecycle: ${status.replaceAll('_', ' ')}`, contracted.filter(a => states[a.id].status === status))
  for (const days of [30, 60, 90]) {
    const active = contracted.filter(a => !['expired', 'terminated', 'terms_unconfirmed'].includes(states[a.id].status))
    tile(`notice-${days}`, `Notice deadlines · next ${days} days`, active.filter(a => { const d = states[a.id].deadline; return d && d.at >= s.now && d.days <= days }))
    tile(`renewal-${days}`, `Term ends / renewals · next ${days} days`, active.filter(a => { const e = states[a.id].end; return e && endInstant(e, a.timezone) >= s.now && daysUntil(endInstant(e, a.timezone), s.now, a.timezone) <= days }))
  }
  const overdue = s.obligations.filter(o => o.status === 'confirmed' && o.due_date && o.due_date < localDate(s.now, s.agreements.find(a => a.id === o.agreement_id)!.timezone))
  tile('overdue', 'Overdue obligations', s.agreements.filter(a => overdue.some(o => o.agreement_id === a.id)), { obligationCount: overdue.length })
  tile('exceptions', 'Accepted playbook exceptions', s.agreements.filter(a => s.approvals.some(p => p.agreement_id === a.id && p.version_id === a.current_version_id && p.kind === 'exception' && p.decision === 'approved' && !p.invalidated_at && s.deviations.some(d => d.id === p.deviation_id && d.result !== 'met'))))
  tile('missing', 'Missing confirmed key terms', contracted.filter(a => states[a.id].missing.length > 0))
  return { tiles, lifecycle: states, now: s.now }
}
