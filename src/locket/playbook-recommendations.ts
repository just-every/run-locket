import { requireRole } from './access'
import { creditSnapshotGuards } from './playbook-recommendation-credits'
import type { Ctx, Handler } from './commands'
import { requireEntitiesExist } from './entities'
import { libraryHandlers } from './library'
import { canonical, fail, json, oneOf, optionalText, parse, sql, text, type Sql } from './model'
import { measuredPlaybookRecommendation, recommendationScope } from './playbook-recommendation-analysis'
import { playbookEvidenceHandlers, recommendationReviewers } from './playbook-recommendation-evidence'
export { playbookRecommendationState } from './playbook-recommendation-evidence'
export { applicableRecommendationPlaybook } from './playbook-recommendation-analysis'

async function activeSource(c: Ctx, id: string) {
  const source = await c.db.prepare("SELECT * FROM lk_playbook_versions WHERE id=? AND status='active'").bind(id).first<any>()
  if (!source) fail('STALE', 'The recommendation must use the currently active source playbook.', 409)
  return source
}

/** Guard the evidence set, including additions made while the analysis ran. */
async function evidenceGuards(c: Ctx, sourceId: string, clauseKey: string): Promise<Sql[]> {
  const sources = [
    { query: 'SELECT COUNT(*) n FROM lk_negotiation_outcomes WHERE playbook_version_id=? AND clause_key=?', params: [sourceId, clauseKey] },
    { query: "SELECT COUNT(*) n FROM lk_approvals p JOIN lk_deviations d ON d.id=p.deviation_id WHERE d.playbook_version_id=? AND d.clause_key=? AND p.kind='exception' AND p.decision='approved' AND p.invalidated_at IS NULL", params: [sourceId, clauseKey] },
    { query: 'SELECT COUNT(*) n FROM lk_playbook_issues i JOIN lk_negotiation_outcomes o ON o.id=i.outcome_id WHERE o.playbook_version_id=? AND o.clause_key=?', params: [sourceId, clauseKey] },
    { query: 'SELECT COUNT(*) n FROM lk_workflow_stages s WHERE EXISTS(SELECT 1 FROM lk_negotiation_outcomes o WHERE o.agreement_id=s.agreement_id AND o.playbook_version_id=? AND o.clause_key=?)', params: [sourceId, clauseKey] },
    { query: 'SELECT COUNT(*) n FROM lk_approvals p WHERE EXISTS(SELECT 1 FROM lk_negotiation_outcomes o WHERE o.agreement_id=p.agreement_id AND o.playbook_version_id=? AND o.clause_key=?)', params: [sourceId, clauseKey] },
  ]
  const checks: Sql[] = []
  for (const source of sources) {
    const count = await c.db.prepare(source.query).bind(...source.params).first<{ n: number }>()
    checks.push(sql(`(${source.query.replace('COUNT(*) n', 'COUNT(*)')})=?`, ...source.params, count!.n))
  }
  return checks
}

function snapshotGuards(input:any):Sql[] {
 return [
  ...creditSnapshotGuards(input.credits),
  ...((input.credits?.sources ?? []).map((s:any)=>sql('(SELECT version FROM lk_agreements WHERE id=?) IS ?',s.id,s.version))),
  sql(`NOT EXISTS(SELECT 1 FROM json_each(?) source LEFT JOIN lk_agreements a ON a.id=json_extract(source.value,'$.id') WHERE a.id IS NULL OR a.version IS NOT json_extract(source.value,'$.version'))`,json(input.agreements)),
  sql(`NOT EXISTS(SELECT 1 FROM json_each(?) source LEFT JOIN lk_approvals a ON a.id=json_extract(source.value,'$.id') WHERE a.id IS NULL OR a.invalidated_at IS NOT json_extract(source.value,'$.invalidatedAt'))`,json(input.approvals)),
 ]
}

const recommend: Handler = async (c, p) => {
  requireRole(c.actor, recommendationReviewers, 'prepare measured playbook recommendations')
  const source = await activeSource(c, text(p, 'sourcePlaybookId', 100)), clauseKey = text(p, 'clauseKey', 40)
  const scope = recommendationScope(p.scope)
  const priorApplication = await c.db.prepare('SELECT scope FROM lk_playbook_applications WHERE id=?').bind(source.id).first<{scope:string}>()
  if (priorApplication && canonical(parse(priorApplication.scope)) !== canonical(scope)) fail('SCOPE', 'A measured successor must retain the existing scoped playbook applicability. Counsel can draft a separately reviewed playbook to change its scope.', 409)
  await requireEntitiesExist(c, scope.entityIds)
  const checks = await evidenceGuards(c, source.id, clauseKey)
  const analysis = await measuredPlaybookRecommendation(c, source, clauseKey, scope, optionalText(p, 'wording', 20_000) ?? undefined)
  const id = crypto.randomUUID()
  return {
    allowed: recommendationReviewers, result: { id, analysis },
    writes: [sql('INSERT INTO lk_playbook_recommendations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, source.id, clauseKey, analysis.wording, json(analysis), 'proposed', c.actor.id, c.now, null, null, null, null)],
    checks: [...checks, ...snapshotGuards(analysis.input), sql("(SELECT status FROM lk_playbook_versions WHERE id=?)='active'", source.id)],
    audit: [{ action: 'playbook.recommend', summary: `Proposed standard alternative for ${clauseKey}: ${analysis.acceptedCount} recorded accepted negotiations of ${analysis.negotiations}; source playbook v${source.number}` }],
  }
}

const decide: Handler = async (c, p) => {
  requireRole(c.actor, recommendationReviewers, 'approve or reject measured playbook changes')
  const recommendation = await c.db.prepare('SELECT * FROM lk_playbook_recommendations WHERE id=?').bind(text(p, 'recommendationId', 100)).first<any>()
  if (!recommendation) fail('NOT_FOUND', 'No such playbook recommendation.', 404)
  if (recommendation.status !== 'proposed') fail('STATUS', 'This recommendation has already been decided.', 409)
  const decision = oneOf(p, 'decision', ['approve', 'reject'] as const), reason = text(p, 'reason', 4000)
  const checks = [sql("(SELECT status FROM lk_playbook_recommendations WHERE id=?)='proposed'", recommendation.id)]
  if (decision === 'reject') return {
    allowed: recommendationReviewers, result: { id: recommendation.id, status: 'rejected' }, checks,
    writes: [sql("UPDATE lk_playbook_recommendations SET status='rejected',decided_by=?,decided_at=?,reason=? WHERE id=?", c.actor.id, c.now, reason, recommendation.id)],
    audit: [{ action: 'playbook.recommendation.reject', summary: `Rejected measured recommendation for ${recommendation.clause_key}: ${reason}` }],
  }
  const source = await activeSource(c, recommendation.source_playbook_id)
  const original = parse<any>(recommendation.analysis), scope = recommendationScope(p.scope)
  await requireEntitiesExist(c, scope.entityIds)
  if (canonical(scope) !== canonical(original.scope)) fail('SCOPE', 'Approve the exact scope that was analyzed; prepare a new recommendation to change it.', 409)
  checks.push(...await evidenceGuards(c, source.id, recommendation.clause_key))
  const current = await measuredPlaybookRecommendation(c, source, recommendation.clause_key, scope, recommendation.wording)
  checks.push(...snapshotGuards(current.input))
  if (canonical(current.input) !== canonical(original.input)) fail('STALE', 'Negotiation or operational evidence changed. Prepare and review a fresh recommendation.', 409)
  const rules = parse<any[]>(source.rules).map(rule => rule.key === recommendation.clause_key ? { ...rule, alternatives: [...rule.alternatives, recommendation.wording] } : rule)
  const draft = await libraryHandlers['playbook.draft'](c, { rules })
  const version = draft.result as { id: string; number: number }
  return {
    allowed: recommendationReviewers, result: { id: recommendation.id, status: 'approved', playbookId: version.id, number: version.number, scope },
    checks: [...checks, ...(draft.checks ?? []), sql("(SELECT status FROM lk_playbook_versions WHERE id=?)='active'", source.id)],
    writes: [...draft.writes,
      sql("UPDATE lk_playbook_versions SET status='superseded' WHERE status='active'"),
      sql("UPDATE lk_playbook_versions SET status='active',activated_by=?,activated_at=? WHERE id=?", c.actor.id, c.now, version.id),
      sql('INSERT INTO lk_playbook_applications VALUES(?,?,?,?,?,?)', version.id, recommendation.id, source.id, json(scope), c.actor.id, c.now),
      sql("UPDATE lk_playbook_recommendations SET status='approved',decided_by=?,decided_at=?,reason=?,new_playbook_id=? WHERE id=?", c.actor.id, c.now, reason, version.id, recommendation.id),
    ],
    audit: [{ action: 'playbook.recommendation.approve', summary: `Counsel approved ${recommendation.clause_key} as a standard alternative in playbook v${version.number}; future review scope ${json(scope)}. ${reason}` }],
  }
}

export const playbookRecommendationHandlers: Record<string, Handler> = {
  ...playbookEvidenceHandlers,
  'playbook.recommend': recommend,
  'playbook.recommendation.decide': decide,
}
