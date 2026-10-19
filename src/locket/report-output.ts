import type { ScheduledReportRead } from './report-read-authority'
import type { Bindings } from '../auth.server'
import { fail, type Actor } from './model'
import { repositoryResult, repositoryCsv, type RepositoryResult } from './repository'
import type { ViewDefinition } from './saved-views'
import { repositoryFields } from './repository-fields'
import { textPdf } from './pdf'

export interface ReportSpec { name: string; definition: ViewDefinition; group_field: string }
export async function reportOutput(env: Bindings, actor: Actor, spec: ReportSpec, scheduledReport?: ScheduledReportRead) {
  const field = repositoryFields.find(f => f.id === spec.group_field)
  if (!field) fail('INVALID', 'Choose a report grouping field.')
  const columns = [...new Set([...spec.definition.columns, spec.group_field, 'value'])]
  const result = await repositoryResult(env, actor, new URLSearchParams({ definition: JSON.stringify({ ...spec.definition, columns }) }), scheduledReport)
  const groups = new Map<string, { group: string; count: number; value: number; missing: number }>()
  for (const row of result.rows) {
    const value = row.values[spec.group_field]
    const group = value === null ? 'Not recorded' : field.kind === 'date' ? String(value).slice(0, 7) : String(value)
    const total = groups.get(group) ?? { group, count: 0, value: 0, missing: 0 }
    total.count++; if (typeof row.values.value === 'number') total.value += row.values.value; else total.missing++
    groups.set(group, total)
  }
  const totals = [...groups.values()].sort((a,b) => a.group.localeCompare(b.group, 'en-US'))
  return { name: spec.name, groupField: spec.group_field, groups: totals, result }
}
export type ReportOutput = Awaited<ReturnType<typeof reportOutput>>
export function reportCsv(out: ReportOutput) {
  const grouped: RepositoryResult = { ...out.result, columns: [{ id:'group',label:'Group',kind:'text' },{id:'count',label:'Agreements',kind:'number'},{id:'value',label:'Total USD',kind:'money'},{id:'missing',label:'Missing value',kind:'number'}], rows:out.groups.map((g,i)=>({id:String(i),values:{...g}})) }
  return repositoryCsv(grouped) + '\r\n' + repositoryCsv(out.result)
}
export function reportPdf(out: ReportOutput) {
  return textPdf(out.name, reportCsv(out), 'Locket report - USD; dates grouped by calendar month')
}
