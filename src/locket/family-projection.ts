import { fail, parse } from './model'
import { familyConflicts } from './family-conflicts'
type Row = { id: string; [key: string]: any }
type Workspace = { now: number; agreements: Row[]; terms: Row[]; familyTerms: Row[]; renewals: Row[]; notices: Row[]; settings: { rollNoticeDeadlines: boolean } }

/** Work only on already permission-scoped records; an inaccessible parent is
 * never traversed or described. */
export function family(workspace: Workspace, id: string) {
  const byId = new Map(workspace.agreements.map(a => [a.id, a]))
  let root = byId.get(id)
  if (!root) fail('NOT_FOUND', 'No agreement you can access has this identity.', 404)
  const visited = new Set<string>()
  while (root.parent_id && byId.has(root.parent_id) && !visited.has(root.id)) {
    visited.add(root.id); root = byId.get(root.parent_id)!
  }
  const ids = new Set([root.id])
  let previous = 0
  while (previous !== ids.size) {
    previous = ids.size
    for (const a of workspace.agreements) if (ids.has(a.parent_id)) ids.add(a.id)
  }
  const members = workspace.agreements.filter(a => ids.has(a.id)).sort((a, b) => {
    const date = (r: Row) => r.start_date ?? new Date(r.created_at).toISOString().slice(0, 10)
    return date(a).localeCompare(date(b)) || a.created_at - b.created_at || a.id.localeCompare(b.id)
  })
  const candidates = workspace.terms.filter(t => ids.has(t.agreement_id) && t.status === 'confirmed')
  const governing = workspace.familyTerms.filter(t => t.root_id === root.id).flatMap(choice => {
    const term = workspace.terms.find(t => t.id === choice.term_id)
    const source = term && byId.get(term.agreement_id)
    if (!term || !source) return []
    return [{ ...choice, key: choice.key as string, term, source, stale: !ids.has(source.id) || term.status !== 'confirmed' || parse<any>(term.citation).versionId !== source.current_version_id || source.parent_id !== choice.source_parent_id || source.relation !== choice.source_relation }]
  })
  return { root, members, candidates, governing, conflicts: familyConflicts(workspace, root, members) }
}

