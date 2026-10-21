import type { ScheduledReportRead } from './report-read-authority'
// Both screen and export use this executor over the freshly scoped workspace.
import type { Bindings } from '../auth.server'
import { lifecycle } from './lifecycle'
import { fail, money, type Actor } from './model'
import { repositoryFieldsFor, type CustomRepositoryDefinition, type RepositoryField } from './repository-fields'
import { defaultViewDefinition, parseViewDefinition, savedViews, type ViewDefinition } from './saved-views'
import { state } from './views'
import { searchPassages, type SearchPassage } from './search-passages'

export interface RepositoryRow { id: string; matches?: SearchPassage[]; values: Record<string, string | number | null> }
export interface RepositoryResult { definition: ViewDefinition; columns: RepositoryField[]; rows: RepositoryRow[]; evaluatedAt: number; name?: string }
const compare = (a: string | number, b: string | number): number => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).toLocaleLowerCase().localeCompare(String(b).toLocaleLowerCase(), 'en-US')
export async function repositoryResult(env: Bindings, actor: Actor, params: URLSearchParams, scheduledReport?: ScheduledReportRead): Promise<RepositoryResult> {
  const s = await state(env, actor, scheduledReport), evaluatedAt = s.now
  const repositoryFields = repositoryFieldsFor(s.customFields)
  const customFields = s.customFields.map(field => ({ ...field, types: new Set<string>(JSON.parse(field.agreement_types)) }))
  let definition: ViewDefinition = defaultViewDefinition, name: string | undefined
  if (params.has('viewId') && params.has('definition')) fail('INVALID', 'Choose a saved view or an ad hoc definition.')
  if (params.has('viewId')) {
    const view = (await savedViews(env, actor)).find(v => v.id === params.get('viewId'))
    if (!view) fail('NOT_FOUND', 'No saved view you can access has that identity.', 404)
    definition = view.definition; name = view.name
  } else if (params.has('definition')) {
    let parsed: unknown
    try { parsed = JSON.parse(params.get('definition')!) } catch { fail('INVALID', 'definition must be valid JSON.') }
    definition = parseViewDefinition(parsed, s.customFields)
  }
  // Saved definitions also pass the current catalogue on every execution.
  definition = parseViewDefinition(definition, s.customFields)
  const people = new Map(s.operators.map(o => [o.id, o.name]))
  const parties = new Map(s.parties.map(p => [p.id, p.name]))
  const entities = new Map(s.entities.map(e => [e.id, e.legal_name]))
  const query = definition.query.toLocaleLowerCase()
  const filters = definition.filters.map(f => {
    const kind = repositoryFields.find(c => c.id === f.field)!.kind
    return { ...f, expected: kind === 'money' ? money({ value: f.value }, 'value')! : kind === 'number' ? Number(f.value) : f.value }
  })
  const customValues = new Map<string, Map<string, string>>()
  for (const v of s.customValues) {
    if (!customValues.has(v.agreement_id)) customValues.set(v.agreement_id, new Map())
    customValues.get(v.agreement_id)!.set(v.field_id, v.value)
  }
  const rows: RepositoryRow[] = []
  for (const a of s.agreements) {
    const current = lifecycle(a, s.terms, s.renewals, s.notices, evaluatedAt, s.settings.rollNoticeDeadlines)
    const terms = Object.fromEntries(s.terms.filter(t => t.agreement_id === a.id && t.status === 'confirmed').map(t => [t.key, t.value]))
    const matches = searchPassages(s.versions.filter(v => v.agreement_id === a.id), definition.query)
    const deviations = s.deviations.filter(d => d.version_id === a.current_version_id && d.result !== 'met')
    const values: RepositoryRow['values'] = {
      reference: a.reference, title: a.title, type: a.type, status: a.status,
      deviations: deviations.map(d => d.clause_key).join(', '),
      has_deviations: deviations.length ? 'yes' : 'no',
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
    for (const field of customFields) {
      const stored = customValues.get(a.id)?.get(field.id)
      values[`custom:${field.id}`] = stored === undefined || !field.types.has(a.type)
        ? null : customValue(field, stored, people, parties)
    }
    if (query && !Object.values(values).some(v => v !== null && String(v).toLocaleLowerCase().includes(query)) && !matches.length) continue
    if (!filters.every(f => {
      const actual = values[f.field]
      if (actual === null || actual === undefined) return false
      if (f.operator === 'contains') return String(actual).toLocaleLowerCase().includes(String(f.expected).toLocaleLowerCase())
      const order = compare(actual, f.expected)
      return f.operator === 'eq' ? order === 0 : f.operator === 'gte' ? order >= 0 : order <= 0
    })) continue
    rows.push({ id: a.id, matches, values })
  }
  rows.sort((a, b) => {
    const av = a.values[definition.sort.field], bv = b.values[definition.sort.field]
    // Missing values stay last in either direction. Identity breaks every tie.
    const order = av === null || av === undefined ? (bv === null || bv === undefined ? 0 : 1) : bv === null || bv === undefined ? -1 : compare(av, bv) * (definition.sort.direction === 'asc' ? 1 : -1)
    return order || a.id.localeCompare(b.id, 'en-US')
  })
  // Return only requested values; the executor alone sees the full projection.
  return { definition, columns: definition.columns.map(id => repositoryFields.find(f => f.id === id)!), rows: rows.map(r => ({ id: r.id, matches: r.matches, values: Object.fromEntries(definition.columns.map(id => [id, r.values[id] ?? null])) })), evaluatedAt, ...(name === undefined ? {} : { name }) }
}
/** Reference identities never substitute for a label outside the scoped state. */
function customValue(field: CustomRepositoryDefinition, stored: string, people: Map<string, string>, parties: Map<string, string>): string | number | null {
  const value: unknown = JSON.parse(stored)
  if (field.kind === 'number' || field.kind === 'money') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (field.kind === 'money' && !Number.isSafeInteger(value))) fail('INVALID', 'A custom numeric value is invalid.')
    return value
  }
  if (field.kind === 'yes_no') {
    if (typeof value !== 'boolean') fail('INVALID', 'A custom yes/no value is invalid.')
    return value ? 'yes' : 'no'
  }
  if (typeof value !== 'string') fail('INVALID', 'A custom text or reference value is invalid.')
  if (field.kind === 'person') return people.get(value) ?? null
  if (field.kind === 'counterparty') return parties.get(value) ?? null
  return value
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
