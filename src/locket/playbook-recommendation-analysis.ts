import type { Ctx } from './commands'
import { fail, list, object, oneOf, parse } from './model'
import { agreementTypes } from './agreements'

export interface RecommendationScope { agreementTypes: string[]; entityIds: string[] }
export function recommendationScope(value: unknown): RecommendationScope {
  const p = object(value, 'scope')
  if (!Array.isArray(p.agreementTypes) || !p.agreementTypes.length || !Array.isArray(p.entityIds)) fail('INVALID', 'Choose agreement types and explicitly choose entity IDs (an empty entity list means every entity).')
  const types = list(p, 'agreementTypes', 6).map(v => oneOf({ value: v }, 'value', agreementTypes))
  const entities = list(p, 'entityIds', 100).map(v => typeof v === 'string' && v ? v : fail('INVALID', 'Entity identities must be text.'))
  return { agreementTypes: [...new Set(types)].sort(), entityIds: [...new Set(entities)].sort() }
}
export const insideRecommendationScope = (scope: RecommendationScope, a: { type: string; entity_id: string | null }) => scope.agreementTypes.includes(a.type) && (!scope.entityIds.length || (a.entity_id !== null && scope.entityIds.includes(a.entity_id)))
const median = (values: number[]) => {
  const ordered = [...values].sort((a, b) => a - b), n = ordered.length
  return n ? (ordered[Math.floor((n - 1) / 2)] + ordered[Math.ceil((n - 1) / 2)]) / 2 : null
}

/** Reconstruct only observed approval intervals. The predicted saving assumes
 * a standard alternative removes the exception's incremental blocking wait.
 * It is a scenario estimate, never a causal claim or a fabricated duration. */
export async function measuredPlaybookRecommendation(c: Ctx, source: any, clauseKey: string, scope: RecommendationScope, selectedWording?: string) {
  const rule = parse<any[]>(source.rules).find(r => r.key === clauseKey)
  if (!rule) fail('INVALID', 'The source playbook has no such clause.')
  const rows = (await c.db.prepare(`SELECT o.*,a.type,a.entity_id,a.reference,a.title,a.version AS agreement_version,v.number AS version_number
    FROM lk_negotiation_outcomes o JOIN lk_agreements a ON a.id=o.agreement_id
    JOIN lk_versions v ON v.id=o.version_id WHERE o.playbook_version_id=? AND o.clause_key=?
    ORDER BY o.recorded_at DESC,o.id`).bind(source.id, clauseKey).all<any>()).results.filter(a => insideRecommendationScope(scope, a))
  // Each negotiation is counted once, even if several historical findings exist.
  const seen = new Set<string>(), outcomes = rows.filter(o => !seen.has(o.agreement_id) && !!seen.add(o.agreement_id))
  const unrecordedExceptions = (await c.db.prepare(`SELECT d.id,d.agreement_id,d.version_id,d.quote,a.type,a.entity_id,p.id AS approval_id
    FROM lk_deviations d JOIN lk_approvals p ON p.deviation_id=d.id JOIN lk_agreements a ON a.id=d.agreement_id
    WHERE d.playbook_version_id=? AND d.clause_key=? AND p.kind='exception' AND p.decision='approved' AND p.invalidated_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM lk_negotiation_outcomes o WHERE o.deviation_id=d.id) ORDER BY d.id,p.id`).bind(source.id, clauseKey).all<any>()).results.filter(a => insideRecommendationScope(scope, a))
  const groups = new Map<string, any[]>()
  for (const o of outcomes.filter(o => o.outcome === 'accepted')) groups.set(o.quote, [...(groups.get(o.quote) ?? []), o])
  const eligible = [...groups.entries()].filter(([wording]) => wording !== rule.preferred && !rule.alternatives.includes(wording)).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  const choice = selectedWording ? eligible.find(([wording]) => wording === selectedWording) : eligible[0]
  if (!choice) fail('NO_EVIDENCE', 'No recorded accepted exception wording can become a new standard alternative in this scope.', 409)
  const [wording, accepted] = choice
  const allStages = (await c.db.prepare(`SELECT s.* FROM lk_workflow_stages s JOIN lk_negotiation_outcomes o ON o.agreement_id=s.agreement_id
    WHERE o.playbook_version_id=? AND o.clause_key=? GROUP BY s.id ORDER BY s.at,s.rowid`).bind(source.id, clauseKey).all<any>()).results
  const approvals = (await c.db.prepare(`SELECT p.* FROM lk_approvals p JOIN lk_negotiation_outcomes o ON o.agreement_id=p.agreement_id
    WHERE o.playbook_version_id=? AND o.clause_key=? GROUP BY p.id ORDER BY p.id`).bind(source.id, clauseKey).all<any>()).results
  const issues = (await c.db.prepare(`SELECT i.* FROM lk_playbook_issues i JOIN lk_negotiation_outcomes o ON o.id=i.outcome_id WHERE o.playbook_version_id=? AND o.clause_key=? ORDER BY i.recorded_at,i.id`).bind(source.id, clauseKey).all<any>()).results
  const citations = accepted.map(o => {
    const exception = approvals.find(p => p.id === o.approval_id)
    const commercial = approvals.filter(p => p.agreement_id === o.agreement_id && p.version_id === o.version_id && p.kind === 'commercial' && p.decision === 'approved' && p.at <= o.recorded_at && (p.invalidated_at === null || p.invalidated_at > o.recorded_at)).sort((a, b) => b.at - a.at)[0]
    const history = allStages.filter(s => s.agreement_id === o.agreement_id)
    const index = exception ? history.findIndex((s, i) => s.to_stage === 'approval' && s.at <= exception.at && history[i + 1]?.from_stage === 'approval' && history[i + 1].at >= exception.at) : -1
    const stage = history[index], closed = index >= 0 ? history[index + 1] : null
    const savedMs = stage && exception && commercial ? Math.max(0, exception.at - Math.max(stage.at, commercial.at)) : null
    return {
      outcomeId: o.id, agreementId: o.agreement_id, reference: o.reference, title: o.title,
      versionId: o.version_id, version: o.version_number, digest: o.version_digest, deviationId: o.deviation_id, approvalId: o.approval_id,
      start: o.start, end: o.end, quote: o.quote, evidence: o.evidence,
      timing: { stageEventId: stage?.id ?? null, closedEventId: closed?.id ?? null, approvalIntervalMs: stage && closed ? closed.at - stage.at : null, incrementalExceptionWaitMs: savedMs },
      issues: issues.filter(i => i.outcome_id === o.id),
    }
  })
  const waits = citations.flatMap(c => c.timing.incrementalExceptionWaitMs === null ? [] : [c.timing.incrementalExceptionWaitMs])
  const intervals = citations.flatMap(c => c.timing.approvalIntervalMs === null ? [] : [c.timing.approvalIntervalMs])
  const saving = median(waits)
  return {
    method: 'recorded-exceptions/1', sourcePlaybookId: source.id, sourcePlaybookNumber: source.number,
    clauseKey, title: rule.title, scope, wording,
    negotiations: outcomes.length, unrecordedExceptions, unknownNegotiationCount: new Set(unrecordedExceptions.map(d => d.agreement_id)).size, acceptedCount: accepted.length, rejectedCount: outcomes.filter(o => o.outcome === 'rejected').length,
    affectedAgreementIds: accepted.map(o => o.agreement_id), citations,
    otherOutcomes: outcomes.filter(o => !accepted.includes(o)).map(o => ({ id: o.id, agreementId: o.agreement_id, versionId: o.version_id, approvalId: o.approval_id, outcome: o.outcome, quote: o.quote, evidence: o.evidence, issues: issues.filter(i => i.outcome_id === o.id) })),
    cycleTime: { measuredCount: waits.length, unknownCount: accepted.length - waits.length, medianApprovalMs: median(intervals), predictedSavingMs: saving, affectedScenarioSavingMs: saving === null ? null : saving * waits.length,
      assumption: 'Scenario: standard wording removes the incremental wait for its exception approval after commercial approval. Observed elapsed workflow time includes parallel work; this is not a causal forecast. Missing workflow or commercial-approval evidence stays unknown.' },
    operations: { observedAgreementCount: citations.filter(c => c.issues.length).length, unknownAgreementCount: citations.filter(c => !c.issues.length).length, issueCount: citations.reduce((n, c) => n + c.issues.filter(i => i.kind !== 'none_observed').length, 0), interpretation: 'Recorded later observations only; no observation means unknown. Counsel reviews disputes, credits and missed obligations before approval.' },
    // Snapshot source contents, not only aggregate counts, so counsel's decision is reviewable.
    input: { unrecordedExceptionIds: unrecordedExceptions.map(d => d.id), agreements: outcomes.map(o => ({ id: o.agreement_id, version: o.agreement_version })), outcomes: outcomes.map(o => ({ id: o.id, recordedAt: o.recorded_at })), stageEventIds: allStages.filter(s => seen.has(s.agreement_id)).map(s => s.id), issueIds: issues.filter(i => outcomes.some(o => o.id === i.outcome_id)).map(i => i.id), approvals: approvals.filter(p => seen.has(p.agreement_id)).map(p => ({ id: p.id, invalidatedAt: p.invalidated_at })) },
    evaluatedAt: c.now,
  }
}

/** Apply the approved change only to the expressly chosen future review scope.
 * Existing findings/approvals retain their immutable playbook identities. */
export function selectScopedPlaybook(agreement: {type:string;entity_id:string|null}, active:any, versions:any[], applications:any[]) {
 let current=active
 const visited=new Set<string>()
 while(current&&!visited.has(current.id)){
  visited.add(current.id)
  const application=applications.find(a=>a.id===current.id)
  if(!application||insideRecommendationScope(parse<RecommendationScope>(application.scope),agreement))return current
  current=versions.find(p=>p.id===application.source_playbook_id)
 }
 return null
}
export async function applicableRecommendationPlaybook(c: Pick<Ctx,'db'>,agreement:{type:string;entity_id:string|null},active:any) {
 const [versions,applications]=await Promise.all([c.db.prepare('SELECT * FROM lk_playbook_versions').all<any>(),c.db.prepare('SELECT id,source_playbook_id,scope FROM lk_playbook_applications').all<any>()])
 return selectScopedPlaybook(agreement,active,versions.results,applications.results)
}
