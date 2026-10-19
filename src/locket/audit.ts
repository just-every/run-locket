// Attributed read events and the owner/counsel audit door.
import type { Bindings } from '../auth.server'
import { fullReaders, may, requireRole, visibleSql } from './access'
import { auditSql, commit, type AuditEntry, type Ctx } from './commands'
import { fail, type Actor, type Role } from './model'

export async function recordReads(env: Bindings, actor: Actor, entries: AuditEntry[], allowed: readonly Role[] = may.read) {
  if (!entries.length) return
  const c: Ctx = { env, db: env.DB, actor, now: Date.now(), commandId: crypto.randomUUID() }
  const ids = [...new Set(entries.flatMap(e => e.agreementId ? [e.agreementId] : []))]
  await commit(c, allowed, ids.map(id => visibleSql(actor, id)), entries.map(e => auditSql(c, e)))
}

function dateBound(value: string, end: boolean) {
  const at = Date.parse(value + 'T00:00:00.000Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== value) fail('INVALID', 'Audit dates must be valid YYYY-MM-DD dates in UTC.')
  return at + (end ? 86_400_000 - 1 : 0)
}

export async function auditTrail(env: Bindings, actor: Actor, params: URLSearchParams) {
  requireRole(actor, fullReaders, 'filter or export the audit trail')
  const clauses: string[] = [], values: (string | number)[] = []
  for (const [key, column] of [['person', 'actor_id'], ['agreement', 'agreement_id'], ['action', 'action']]) {
    const value = params.get(key)
    if (value) { clauses.push(`${column}=?`); values.push(value) }
  }
  const from = params.get('from'), to = params.get('to')
  if (from) { clauses.push('at>=?'); values.push(dateBound(from, false)) }
  if (to) { clauses.push('at<=?'); values.push(dateBound(to, true)) }
  if (from && to && from > to) fail('INVALID', 'The audit start date must be on or before the end date.')
  const q = params.get('q')?.trim().toLowerCase()
  if (q) { clauses.push("instr(lower(actor_name || ' ' || action || ' ' || summary),?)>0"); values.push(q) }
  const rows = (await env.DB.prepare(`SELECT * FROM lk_audit${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''} ORDER BY at DESC, id`).bind(...values).all()).results
  return { rows }
}

export function auditCsv(rows: Record<string, unknown>[]) {
  const columns = ['id', 'at', 'actor_id', 'actor_name', 'actor_role', 'action', 'agreement_id', 'summary', 'command_id']
  const cell = (value: unknown) => {
    let text = String(value ?? '')
    // Spreadsheet applications must display user-controlled names and summaries as text.
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text
    return '"' + text.replaceAll('"', '""') + '"'
  }
  return [columns.join(','), ...rows.map(row => columns.map(key => cell(key === 'at' ? new Date(Number(row.at)).toISOString() : row[key])).join(','))].join('\r\n') + '\r\n'
}
