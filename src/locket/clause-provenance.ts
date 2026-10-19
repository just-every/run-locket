// Library lineage lives inside version fields, so it travels with archive export
// and participates in the document digest and approval identity.
import { parse } from './model'

export interface ClauseUse {
  libraryVersionId: string
  libraryVersionNumber: number
  templateName: string
  clauseKey: string
  clauseTitle: string
  variantId: string
  variantLabel: string
  text: string
  notes: string
  ruleKey: string
  playbookVersionId: string | null
  insertedBy: string
  insertedAt: number
}

export function clauseUses(fields: string | null): ClauseUse[] {
  return fields ? parse<{ clauseLibrary?: ClauseUse[] }>(fields).clauseLibrary ?? [] : []
}

/** Recorded choices survive only while their complete wording remains. */
export function retainedClauseUses(fields: string | null, body: string | null): ClauseUse[] {
  return clauseUses(fields).filter(use => body?.includes(use.text))
}

/** Template choices are recorded uses too, rather than a guess from matching text. */
export function templateClauseUses(library: Record<string, any>, fields: string, actorId: string, at: number, playbook: Record<string, any> | null, values: Record<string, unknown> = {}): ClauseUse[] {
  const chosen = parse<{ clauses?: Record<string, string> }>(fields).clauses ?? {}
  const rules = playbook ? parse<Record<string, any>[]>(playbook.rules) : []
  return parse<LibraryClause[]>(library.clauses).flatMap(clause => {
    const variant = clause.variants.find(v => v.id === chosen[clause.key])
    if (!variant) return []
    const ruleKey = clause.ruleKey || clause.key
    return [{ libraryVersionId: library.id, libraryVersionNumber: library.number, templateName: library.name,
      clauseKey: clause.key, clauseTitle: clause.title, variantId: variant.id, variantLabel: variant.label,
      text: variant.text.replace(/\{\{([a-z0-9_]+)\}\}/gi, (_, name: string) => String(values[name] ?? parse<{ values?: Record<string, string> }>(fields).values?.[name] ?? '').trim()), notes: [clause.notes, variant.notes].filter(Boolean).join('\n'), ruleKey,
      playbookVersionId: rules.some(r => r.key === ruleKey) ? playbook!.id : null, insertedBy: actorId, insertedAt: at }]
  })
}

type Row = Record<string, any>
interface LibraryClause { key: string; title: string; notes?: string; ruleKey?: string; variants: { id: string; label: string; text: string; notes?: string }[] }
export function approvedClauses(data: { templateVersions: Row[]; templates: Row[]; playbooks: Row[]; agreements: Row[]; versions: Row[]; packages: Row[]; executions: Row[] }, query = '') {
  const active = data.playbooks.find(p => p.status === 'active')
  const rules = active ? parse<Row[]>(active.rules) : []
  const accepted = new Map<string, Set<string>>()
  for (const a of data.agreements.filter(a => a.status === 'executed')) {
    const version = data.versions.find(v => v.id === a.current_version_id)
    if (!version) continue
    const completed = data.executions.some(e => {
      const pkg = data.packages.find(p => p.id === e.package_id)
      return !e.imported && ['reconciled', 'accepted'].includes(e.status) && pkg && pkg.version_id === version.id && pkg.version_digest === version.digest && parse<Row[]>(e.checks).some(c => c.check === 'document' && c.ok === true)
    })
    if (!completed) continue
    const library = data.templateVersions.find(t => t.id === version.template_version_id)
    const selected = library && version.fields ? templateClauseUses({ ...library, name: data.templates.find(t => t.id === library.template_id)?.name ?? '' }, version.fields, version.created_by, version.created_at, null) : []
    for (const use of [...retainedClauseUses(version.fields, version.text), ...selected.filter(u => version.text?.includes(u.text))]) {
      const key = JSON.stringify([use.libraryVersionId, use.clauseKey, use.variantId])
      if (!accepted.has(key)) accepted.set(key, new Set())
      accepted.get(key)!.add(a.id)
    }
  }
  const q = query.trim().toLowerCase()
  return data.templateVersions.filter(v => v.status === 'approved').flatMap(v => {
    const template = data.templates.find(t => t.id === v.template_id)
    return parse<LibraryClause[]>(v.clauses).flatMap(clause => clause.variants.map((variant) => {
      const ruleKey = clause.ruleKey || clause.key
      const rule = rules.find(r => r.key === ruleKey)
      return {
        id: JSON.stringify([v.id, clause.key, variant.id]),
        libraryVersionId: v.id, libraryVersionNumber: v.number, templateName: template?.name ?? '',
        clauseKey: clause.key, clauseTitle: clause.title, variantId: variant.id, variantLabel: variant.label,
        text: variant.text, notes: [clause.notes, variant.notes].filter(Boolean).join('\n'), ruleKey,
        playbookVersionId: rule ? active!.id : null, playbookNumber: rule ? active!.number : null, rule: rule ?? null,
        acceptanceCount: accepted.get(JSON.stringify([v.id, clause.key, variant.id]))?.size ?? 0,
      }
    }))
  }).filter(item => !q || [item.clauseKey, item.clauseTitle, item.templateName, item.variantLabel, item.text, item.notes, item.rule?.title].join(' ').toLowerCase().includes(q))
}
