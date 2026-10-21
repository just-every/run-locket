// One catalogue for validation, the repository screen and its CSV export.
export type CustomRepositoryKind = 'text' | 'number' | 'money' | 'date' | 'pick_list' | 'yes_no' | 'person' | 'counterparty'
export interface CustomRepositoryDefinition {
  id: string
  name: string
  kind: CustomRepositoryKind
  agreement_types: string
  version: number
}
export interface RepositoryField { id: string; label: string; kind: 'text' | 'number' | 'money' | 'date'; customKind?: CustomRepositoryKind }
export const repositoryFields: RepositoryField[] = [
  { id: 'reference', label: 'Reference', kind: 'text' },
  { id: 'title', label: 'Agreement', kind: 'text' },
  { id: 'type', label: 'Type', kind: 'text' },
  { id: 'status', label: 'Status', kind: 'text' },
  { id: 'counterparty', label: 'Counterparty', kind: 'text' },
  { id: 'entity', label: 'Our entity', kind: 'text' },
  { id: 'value', label: 'Value (USD)', kind: 'money' },
  { id: 'currency', label: 'Currency', kind: 'text' },
  { id: 'owner', label: 'Owner', kind: 'text' },
  { id: 'requester', label: 'Requester', kind: 'text' },
  { id: 'restricted', label: 'Restricted', kind: 'text' },
  { id: 'needed_by', label: 'Needed by', kind: 'date' },
  { id: 'start_date', label: 'Intake start date', kind: 'date' },
  { id: 'timezone', label: 'Time zone', kind: 'text' },
  { id: 'origin', label: 'Origin', kind: 'text' },
  { id: 'created_at', label: 'Created date', kind: 'date' },
  { id: 'updated_at', label: 'Updated date', kind: 'date' },
  { id: 'effective_date', label: 'Confirmed effective date', kind: 'date' },
  { id: 'end_date', label: 'Confirmed original end date', kind: 'date' },
  { id: 'auto_renew', label: 'Auto renew', kind: 'text' },
  { id: 'renewal_term_months', label: 'Renewal term (months)', kind: 'number' },
  { id: 'notice_days', label: 'Notice period (days)', kind: 'number' },
  { id: 'governing_law', label: 'Governing law', kind: 'text' },
  { id: 'payment_terms', label: 'Payment terms', kind: 'text' },
  { id: 'has_deviations', label: 'Has playbook deviations (yes/no)', kind: 'text' },
  { id: 'deviations', label: 'Playbook deviation keys', kind: 'text' },
  { id: 'lifecycle', label: 'Lifecycle', kind: 'text' },
  { id: 'current_term_start', label: 'Current term start', kind: 'date' },
  { id: 'current_term_end', label: 'Current term end', kind: 'date' },
  { id: 'current_term', label: 'Current term number', kind: 'number' },
  { id: 'notice_deadline', label: 'Notice deadline', kind: 'date' },
]

/** The same pure catalogue serves server validation and the workspace controls. */
export function repositoryFieldsFor(definitions: readonly CustomRepositoryDefinition[]): RepositoryField[] {
  return [...repositoryFields, ...definitions.map(d => ({
    id: `custom:${d.id}`, label: d.name,
    kind: d.kind === 'number' || d.kind === 'money' || d.kind === 'date' ? d.kind : 'text' as const,
    customKind: d.kind,
  }))]
}

export async function repositoryDefinitions(db: D1Database): Promise<CustomRepositoryDefinition[]> {
  return (await db.prepare('SELECT id,name,kind,agreement_types,version FROM lk_custom_fields ORDER BY name,id').all<CustomRepositoryDefinition>()).results
}

/** Guard the definition revisions used to validate an explicitly selected field. */
export function repositoryFieldChecks(definitions: readonly CustomRepositoryDefinition[], fieldIds: readonly string[]) {
  const selected = new Set(fieldIds)
  const revisions = definitions.filter(d => selected.has(`custom:${d.id}`)).map(d => ({ id: d.id, version: d.version }))
  return revisions.length ? [{
    sql: `NOT EXISTS(SELECT 1 FROM json_each(?) snapshot
      LEFT JOIN lk_custom_fields f ON f.id=json_extract(snapshot.value,'$.id')
      WHERE f.id IS NULL OR f.version<>json_extract(snapshot.value,'$.version'))`,
    params: [JSON.stringify(revisions)],
  }] : []
}
