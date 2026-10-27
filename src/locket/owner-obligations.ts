// Confirmation records stay distinct from the dated lifecycle of each occurrence.
import { zonedInstant } from './dates'
import type { Ctx } from './commands'
import { sql } from './model'

type Row = { id: string; [key: string]: any }

export function obligationLifecycle(o: Row, timezone: string, now: number): string {
  if (o.status === 'done') return o.resolution === 'waived' ? 'waived' : 'done'
  if (o.status !== 'confirmed') return o.status
  if (!o.due_date) return 'upcoming'
  if (now > zonedInstant(o.due_date, '23:59:59', timezone)) return 'missed'
  return now >= zonedInstant(o.due_date, '00:00:00', timezone) ? 'due' : 'upcoming'
}

/** Calendar recurrence always uses the first confirmed date, avoiding month-end drift. */
export function nextObligationDate(o: Row): string | null {
  if (o.recurrence === 'none' || !o.due_date) return null
  const anchor = o.recurrence_anchor ?? o.due_date
  const [year, month, day] = anchor.split('-').map(Number)
  const step = { monthly: 1, quarterly: 3, annually: 12 }[o.recurrence as string]
  if (!step) return null
  const target = new Date(Date.UTC(year, month - 1 + step * ((o.occurrence_number ?? 0) + 1), 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, last))
  return target.toISOString().slice(0, 10)
}

/** Input has already passed current agreement and source access; never fetch a wider list. */
export function obligationWorkspace(obligations: Row[], agreements: Row[], now: number): Row[] {
  const zones = new Map(agreements.map(a => [a.id, a.timezone]))
  const open = new Map(obligations.filter(o => o.status === 'confirmed').map(o => [o.series_id ?? o.id, o]))
  return obligations.map(o => {
    const current = open.get(o.series_id ?? o.id)
    return { ...o, series_id: o.series_id ?? o.id,
      lifecycle_status: obligationLifecycle(o, zones.get(o.agreement_id), now),
      next_due_date: current?.due_date ?? null }
  })
}

/** Called in the same guarded batch by every completion door. */
export function advanceObligation(c: Ctx, o: Row) {
  const nextDate = nextObligationDate(o)
  if (!nextDate) return { nextId: null, writes: [] }
  const nextId = crypto.randomUUID()
  return { nextId, writes: [sql(`INSERT INTO lk_obligations(id,agreement_id,description,owner_id,due_date,recurrence,citation,status,created_by,confirmed_by,created_at,evidence,risk,responsible_side,series_id,recurrence_anchor,occurrence_number)
    VALUES(?,?,?,?,?,?,?,'confirmed',?,?,?,?,?,?,?,?,?)`, nextId, o.agreement_id, o.description, o.owner_id, nextDate, o.recurrence, o.citation, o.created_by, o.confirmed_by, c.now, o.evidence, o.risk, o.responsible_side, o.series_id ?? o.id, o.recurrence_anchor ?? o.due_date, o.occurrence_number + 1)] }
}
