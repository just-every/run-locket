// Both screen and export use this executor over the freshly scoped workspace.
import type { Bindings } from '../auth.server'
import { lifecycle } from './lifecycle'
import { fail, money, type Actor } from './model'
import { repositoryFields, type RepositoryField } from './repository-fields'
import { defaultViewDefinition, parseViewDefinition, savedViews, type ViewDefinition } from './saved-views'
import { state } from './views'

export interface RepositoryRow { id: string; values: Record<string, string | number | null> }
export interface RepositoryResult { definition: ViewDefinition; columns: RepositoryField[]; rows: RepositoryRow[]; evaluatedAt: number; name?: string }
const compare = (a: string | number, b: string | number): number => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).toLocaleLowerCase().localeCompare(String(b).toLocaleLowerCase(), 'en-US')
export async function repositoryResult(env: Bindings, actor: Actor, params: URLSearchParams): Promise<RepositoryResult> {
  let definition: ViewDefinition = defaultViewDefinition, name: string | undefined
  if (params.has('viewId') && params.has('definition')) fail('INVALID', 'Choose a saved view or an ad hoc definition.')
  if (params.has('viewId')) {
    const view = (await savedViews(env, actor)).find(v => v.id === params.get('viewId'))
    if (!view) fail('NOT_FOUND', 'No saved view you can access has that identity.', 404)
    definition = view.definition; name = view.name
  } else if (params.has('definition')) {
    let parsed: unknown
    try { parsed = JSON.parse(params.get('definition')!) } catch { fail('INVALID', 'definition must be valid JSON.') }
    definition = parseViewDefinition(parsed)
  }
  const s = await state(env, actor), evaluatedAt = s.now
  const people = new Map(s.operators.map(o => [o.id, o.name]))
  const parties = new Map(s.parties.map(p => [p.id, p.name]))
  const entities = new Map(s.entities.map(e => [e.id, e.legal_name]))
  const query = definition.query.toLocaleLowerCase()
  const filters = definition.filters.map(f => {
    const kind = repositoryFields.find(c => c.id === f.field)!.kind
    return { ...f, expected: kind === 'money' ? money({ value: f.value }, 'value')! : kind === 'number' ? Number(f.value) : f.value }
  })
  const rows: RepositoryRow[] = []
  for (const a of s.agreements) {
    const current = lifecycle(a, s.terms, s.renewals, s.notices, evaluatedAt, s.settings.rollNoticeDeadlines)
    const terms = Object.fromEntries(s.terms.filter(t => t.agreement_id === a.id && t.status === 'confirmed').map(t => [t.key, t.value]))
    const values: RepositoryRow['values'] = {
      reference: a.reference, title: a.title, type: a.type, status: a.status,
      counterparty: parties.get(a.party_id) ?? null, entity: entities.get(a.entity_id) ?? null, value: a.value_cents, currency: a.currency,
      owner: people.get(a.owner_id) ?? null, requester: people.get(a.requester_id) ?? null,
      restricted: a.restricted ? 'yes' : 'no', needed_by: a.needed_by, start_date: a.start_date,
      timezone: a.timezone, origin: a.origin,
      created_at: new Date(a.created_at).toISOString().slice(0, 10), updated_at: new Date(a.updated_at).toISOString().slice(0, 10),
      effective_date: terms.effective_date ?? null, end_date: terms.end_date ?? null,
      auto_renew: terms.auto_renew ?? null,
      renewal_term_months: terms.renewal_term_months === undefined ? null : Number(terms.renewal_term_months),
      notice_days: terms.notice_days === undefined ? null : Number(terms.notice_days),
      governing_law: terms.governing_law ?? null, payment_terms: terms.payment_terms ?? null,
      lifecycle: current.status, current_term_start: current.start, current_term_end: current.end,
      current_term: current.term, notice_deadline: current.deadline?.date ?? null,
    }
    if (query && !Object.values(values).some(v => v !== null && String(v).toLocaleLowerCase().includes(query)) && !s.versions.some(v => v.agreement_id === a.id && v.text?.toLocaleLowerCase().includes(query))) continue
    if (!filters.every(f => {
      const actual = values[f.field]
      if (actual === null || actual === undefined) return false
      if (f.operator === 'contains') return String(actual).toLocaleLowerCase().includes(String(f.expected).toLocaleLowerCase())
      const order = compare(actual, f.expected)
      return f.operator === 'eq' ? order === 0 : f.operator === 'gte' ? order >= 0 : order <= 0
    })) continue
    rows.push({ id: a.id, values })
  }
  rows.sort((a, b) => {
    const av = a.values[definition.sort.field], bv = b.values[definition.sort.field]
    // Missing values stay last in either direction. Identity breaks every tie.
    const order = av === null || av === undefined ? (bv === null || bv === undefined ? 0 : 1) : bv === null || bv === undefined ? -1 : compare(av, bv) * (definition.sort.direction === 'asc' ? 1 : -1)
    return order || a.id.localeCompare(b.id, 'en-US')
  })
  // Return only requested values; the executor alone sees the full projection.
  return { definition, columns: definition.columns.map(id => repositoryFields.find(f => f.id === id)!), rows: rows.map(r => ({ id: r.id, values: Object.fromEntries(definition.columns.map(id => [id, r.values[id] ?? null])) })), evaluatedAt, ...(name === undefined ? {} : { name }) }
}
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
export function repositoryCsv(result: RepositoryResult): string {
  const cell = (value: string | number | null) => {
    let text = value === null ? '' : String(value)
    // Spreadsheet applications evaluate formulas even inside quoted CSV cells.
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text
    return '"' + text.replaceAll('"', '""') + '"'
  }
  return [result.columns.map(c => cell(c.label)).join(','), ...result.rows.map(r => result.columns.map(c => cell(c.kind === 'money' && typeof r.values[c.id] === 'number' ? usd.format((r.values[c.id] as number) / 100) : r.values[c.id])).join(','))].join('\r\n') + '\r\n'
}
