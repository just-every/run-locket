// A read-only comparison of recorded confirmed values, never legal precedence.
// The caller supplies the current viewer's already-scoped family and workspace.
import { noticeDeadlineFor } from './business-days'
import { lifecycle } from './lifecycle'
type Row = { id: string; [key: string]: any }
type Workspace = { now: number; terms: Row[]; renewals: Row[]; notices: Row[]; settings: { rollNoticeDeadlines: boolean } }

export function familyConflicts(workspace: Workspace, root: Row, members: Row[]) {
  const sources = new Map(members.filter(a => ['executed', 'imported'].includes(a.status)).map(a => [a.id, a]))
  const groups = new Map<string, Row[]>()
  for (const term of workspace.terms) {
    if (term.status !== 'confirmed' || !sources.has(term.agreement_id)) continue
    const group = groups.get(term.key) ?? []
    group.push(term)
    groups.set(term.key, group)
  }
  const current = lifecycle(root, workspace.terms, workspace.renewals, workspace.notices, workspace.now, workspace.settings.rollNoticeDeadlines)
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, terms]) => {
    if (new Set(terms.map(t => t.value)).size < 2) return []
    return [{ key, candidates: terms.map(term => ({
      term, source: sources.get(term.agreement_id)!,
      noticeDeadline: key === 'notice_days' && current.end && current.deadline ? {
        ...noticeDeadlineFor(current.end, Number(term.value), root.timezone, workspace.settings.rollNoticeDeadlines),
        endDate: current.end, timezone: root.timezone, baselineAgreementId: root.id,
      } : null,
    })) }]
  })
}
