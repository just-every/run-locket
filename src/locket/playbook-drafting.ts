import { requireRole } from './access'
import { auditSql, commit, type Ctx, type Handler } from './commands'
import { requireEntitiesExist } from './entities'
import { libraryHandlers } from './library'
import { bool, canonical, fail, integer, json, list, oneOf, parse, Problem, sha256, sql, text } from './model'
import { evaluation, modelSettings, settingsGuard, taskGate } from './model-settings'
import { requestModel } from './model-provider'
import { recommendationScope } from './playbook-recommendation-analysis'
import { draftingSourceIds, draftingSources, type DraftingSource } from './playbook-drafting-sources'
import { draftedRules, editedRule } from './playbook-drafting-rules'
import { playbookDraftingPrompt } from './playbook-drafting-prompt'
import { fullFieldsCheck, policyVersionCheck, repositoryPolicy, requireFullFields } from './repository-access'

const counsel = ['counsel'] as const
const baseGuard = (id: string | null) => sql("(SELECT id FROM lk_playbook_versions WHERE status='active') IS ?", id)
const rowGuard = (r: any) => sql('EXISTS(SELECT 1 FROM lk_playbook_drafts WHERE id=? AND revision=? AND status=? AND source_digest=? AND sources=? AND proposals=?)', r.id, r.revision, r.status, r.source_digest, r.sources, r.proposals)
const ids = (p: Record<string, unknown>, key: string, max: number) => {
 const values = list(p, key, max).map(v => text({ id: v }, 'id', 100))
 if (new Set(values).size !== values.length) fail('INVALID', 'Choose each source once.')
 return values
}
async function gate(c: Ctx, s: Awaited<ReturnType<typeof modelSettings>>, scope: ReturnType<typeof recommendationScope>, simulated: boolean) {
 for (const type of scope.agreementTypes) await taskGate(c, s, 'playbook-drafting', type, simulated)
}
async function load(c: Ctx, p: Record<string, unknown>) {
 requireRole(c.actor, counsel, 'review drafted playbook rules')
 const r = await c.db.prepare('SELECT * FROM lk_playbook_drafts WHERE id=?').bind(text(p, 'draftId', 100)).first<any>()
 if (!r) fail('NOT_FOUND', 'No drafted playbook has that identity.', 404)
 if (r.revision !== integer(p, 'revision', 1)) fail('STALE', 'The rule decisions changed. Reload and review them.', 409)
 if (r.status !== 'proposed') fail('STATUS', 'Only a proposed playbook can take rule decisions or approval.', 409)
 return r
}
async function currentSources(c: Ctx, r: any) {
 const sources = parse<DraftingSource[]>(r.sources), chosen = draftingSourceIds(sources)
 const current = await draftingSources(c, chosen.templateVersionIds, chosen.agreementIds, recommendationScope(parse(r.scope)))
 if (current.digest !== r.source_digest) fail('STALE', 'A source or its execution evidence changed. Generate and review a fresh draft.', 409)
 return current
}
const generate: Handler = async (c, p) => {
 requireRole(c.actor, counsel, 'draft playbook rules with the model')
 const scope = recommendationScope(p.scope), s = await modelSettings(c.db), simulated = bool(p, 'simulated')
 await gate(c, s, scope, simulated)
 await requireEntitiesExist(c, scope.entityIds)
 if (!bool(p, 'consent')) fail('CONSENT', 'Approve sending exactly these approved templates and signed pages to the selected model for this request.', 409)
 const source = await draftingSources(c, ids(p, 'templateVersionIds', 10), ids(p, 'agreementIds', 40), scope)
 const base = await c.db.prepare("SELECT id FROM lk_playbook_versions WHERE status='active'").first<{ id: string }>()
 const id = crypto.randomUUID(), prompt = await sha256(playbookDraftingPrompt)
 return { allowed: counsel, result: { id }, checks: [...source.checks, settingsGuard(s.version), baseGuard(base?.id ?? null)],
  writes: [sql(`INSERT INTO lk_playbook_drafts (id,revision,status,source_playbook_id,scope,sources,source_digest,provider,model,prompt_version,settings_version,simulated,requested_by,session_id,created_at) VALUES(?,1,'queued',?,?,?,?,?,?,?,?,?,?,?,?)`, id, base?.id ?? null, json(scope), json(source.sources), source.digest, s.provider, s.model, prompt, s.version, simulated ? 1 : 0, c.actor.id, c.actor.sessionId, c.now)],
  audit: [{ action: 'playbook.generate', summary: `Counsel consented to ${simulated ? 'simulated' : 'evaluated live'} playbook drafting from ${source.sources.length} exact sources for future scope ${json(scope)}.` }] }
}
const decide: Handler = async (c, p) => {
 const r = await load(c, p), source = await currentSources(c, r)
 const proposals = parse<any[]>(r.proposals), rule = proposals.find(v => v.proposed.key === text(p, 'ruleKey', 40))
 if (!rule) fail('NOT_FOUND', 'No proposed rule has that identity.', 404)
 const decision = oneOf(p, 'decision', ['accept', 'edit', 'reject'] as const), reason = text(p, 'reason', 4000)
 rule.decision = decision
 rule.effective = decision === 'reject' ? null : decision === 'edit' ? editedRule(p.rule, rule.proposed) : rule.proposed
 rule.decidedBy = c.actor.id; rule.decidedAt = c.now; rule.reason = reason
 rule.history = [...(rule.history ?? []), { decision, effective: rule.effective, by: c.actor.id, at: c.now, reason, revision: r.revision + 1 }]
 return { allowed: counsel, result: { id: r.id, revision: r.revision + 1 }, checks: [...source.checks, rowGuard(r)],
  writes: [sql('UPDATE lk_playbook_drafts SET proposals=?,revision=revision+1 WHERE id=?', json(proposals), r.id)],
  audit: [{ action: `playbook.rule.${decision}`, summary: `Counsel ${decision}: ${rule.proposed.key} in source draft ${r.id}. ${reason}` }] }
}
const approve: Handler = async (c, p) => {
 const r = await load(c, p), source = await currentSources(c, r), scope = recommendationScope(p.scope)
 if (canonical(scope) !== canonical(parse(r.scope))) fail('SCOPE', 'Approve the exact analyzed future scope. Generate a new draft to change it.', 409)
 await requireEntitiesExist(c, scope.entityIds)
 if (!bool(p, 'consent')) fail('CONSENT', 'Explicitly approve publishing these reviewed rules to the shared playbook for the displayed future scope.', 409)
 const proposals = parse<any[]>(r.proposals)
 if (!proposals.length || proposals.some(v => v.decision === 'pending')) fail('RULE_DECISIONS', 'Accept, edit or reject every rule before approval.', 409)
 const rules = proposals.filter(v => v.decision !== 'reject').map(v => v.effective)
 if (!rules.length) fail('RULE_DECISIONS', 'At least one reviewed rule is needed for a new playbook.', 409)
 const reason = text(p, 'reason', 4000), s = await modelSettings(c.db)
 await gate(c, s, scope, r.simulated === 1)
 if (s.version !== r.settings_version) fail('STALE', 'Model configuration changed; generate a new draft.', 409)
 const out = await libraryHandlers['playbook.draft'](c, { rules }), version = out.result as { id: string; number: number }
 return { allowed: counsel, result: { id: r.id, playbookId: version.id, number: version.number },
  checks: [...source.checks, rowGuard(r), baseGuard(r.source_playbook_id), settingsGuard(s.version), ...(out.checks ?? [])],
  writes: [...out.writes, sql("UPDATE lk_playbook_versions SET status='superseded' WHERE status='active'"),
   sql("UPDATE lk_playbook_versions SET status='active',activated_by=?,activated_at=? WHERE id=?", c.actor.id, c.now, version.id),
   sql('INSERT INTO lk_playbook_draft_applications VALUES(?,?,?,?,?,?)', version.id, r.id, r.source_playbook_id, r.scope, c.actor.id, c.now),
   sql("UPDATE lk_playbook_drafts SET status='approved',revision=revision+1,approved_by=?,approved_at=?,reason=?,new_playbook_id=? WHERE id=?", c.actor.id, c.now, reason, version.id, r.id)],
  audit: [{ action: 'playbook.generated.approve', summary: `Counsel approved ${rules.length} reviewed ${r.simulated ? 'provider-simulated ' : ''}rules as playbook v${version.number}, for future scope ${r.scope}. ${reason}` }] }
}

/** Complete the public command after its one durable reservation. Replays never
 * resend an attempted request, and every result remains under current authority. */
export async function completePlaybookDraft(c: Ctx, type: string, result: any) {
 if (!type.startsWith('playbook.generation.') && type !== 'playbook.generate') return result
 requireRole(c.actor, counsel, 'read drafted playbook outcomes')
 await requireFullFields(c.db, c.actor)
 if (type !== 'playbook.generate') return result
 let r = await c.db.prepare('SELECT * FROM lk_playbook_drafts WHERE id=?').bind(result.id).first<any>()
 if (!r) fail('NOT_FOUND', 'This drafting record is unavailable.', 404)
 if (r.status !== 'queued') return { id: r.id, status: r.status }
 if (r.requested_by !== c.actor.id || r.session_id !== c.actor.sessionId) fail('AUTHORITY', 'Only the original current authorizing session can dispatch this request.', 403)
 const source = await currentSources(c, r), s = await modelSettings(c.db), scope = recommendationScope(parse(r.scope))
 await gate(c, s, scope, r.simulated === 1)
 if (s.version !== r.settings_version) fail('STALE', 'Model settings changed before dispatch.', 409)
 const policy = await repositoryPolicy(c.db)
 const checks = [...source.checks, baseGuard(r.source_playbook_id), settingsGuard(s.version), fullFieldsCheck(c.actor), policyVersionCheck(policy.version)]
 try {
  await commit(c, counsel, [...checks, rowGuard(r)], [sql("UPDATE lk_playbook_drafts SET status='uncertain' WHERE id=?", r.id), sql('INSERT INTO lk_model_usage VALUES(?,?,?,?,NULL,NULL,NULL,?)', r.id, r.provider, r.model, r.simulated, r.created_at)])
 } catch (error) {
  const row = await c.db.prepare('SELECT status FROM lk_playbook_drafts WHERE id=?').bind(r.id).first<any>()
  if (row.status !== 'queued') return { id: r.id, status: row.status }
  throw error
 }
 const claimed = sql("EXISTS(SELECT 1 FROM lk_playbook_drafts WHERE id=? AND status='uncertain' AND revision=? AND source_digest=? AND sources=?)", r.id, r.revision, r.source_digest, r.sources)
 try {
  const response = await requestModel(c, s, playbookDraftingPrompt, { scope, sourcePlaybookId: r.source_playbook_id, sources: source.sources }, 12000)
  if (!response.ok) fail('MODEL_UNAVAILABLE', 'The provider refused the drafting request. No rules were applied.', 502)
  const envelope: any = await response.json(), body = envelope.result ?? envelope
  const input = integer({ n: body.usage?.prompt_tokens ?? body.usage?.input_tokens }, 'n', 0, 10000000), output = integer({ n: body.usage?.completion_tokens ?? body.usage?.output_tokens }, 'n', 0, 10000000)
  await commit(c, counsel, [...checks, claimed], [sql('UPDATE lk_model_usage SET input_tokens=?,output_tokens=?,estimated_usd_micros=? WHERE id=?', input, output, Math.round(input * s.inputUsdPerMillion + output * s.outputUsdPerMillion), r.id)])
  const raw = body.choices?.[0]?.message?.content ?? body.content?.[0]?.text ?? body.response
  if (typeof raw !== 'string' || raw.length > 500000) fail('MODEL_RESPONSE', 'The provider returned no supported drafting JSON.', 502)
  const proposals = draftedRules(JSON.parse(raw), source.sources)
  await commit(c, counsel, [...checks, claimed], [sql("UPDATE lk_playbook_drafts SET status='proposed',proposals=? WHERE id=?", json(proposals), r.id), auditSql(c, { action: 'playbook.generated', summary: `Retained ${proposals.length} cited ${r.simulated ? 'simulated ' : ''}proposals; counsel decisions and version approval pending.` })])
 } catch (error) {
  // A rejected/invalid provider response is visible. Lost session, source or
  // policy authority cannot write a completion; its claimed uncertainty remains.
  const code = error instanceof Problem ? error.code : 'MODEL_RESPONSE'
  try { await commit(c, counsel, [...checks, claimed], [sql("UPDATE lk_playbook_drafts SET status='failed',failure=? WHERE id=?", ['CITATION', 'MODEL_UNAVAILABLE'].includes(code) ? code : 'MODEL_RESPONSE', r.id)]) } catch { /* current guards intentionally withhold the result */ }
 }
 r = await c.db.prepare('SELECT status FROM lk_playbook_drafts WHERE id=?').bind(r.id).first<any>()
 await commit(c, counsel, [fullFieldsCheck(c.actor)], [])
 return { id: result.id, status: r.status }
}
export async function draftingWorkspace(c: Pick<Ctx, 'env' | 'db' | 'actor'>) {
 if (c.actor.role !== 'counsel') return null
 const settings = await modelSettings(c.db), record = await evaluation(settings, 'playbook-drafting')
 const drafts = (await c.db.prepare('SELECT * FROM lk_playbook_drafts ORDER BY created_at DESC,id').all<any>()).results.map(({ session_id, ...row }) => ({ ...row, status: !session_id && row.status === 'queued' ? 'uncertain' : row.status }))
 return { drafts, provider: settings.provider, model: settings.model, enabled: settings.enabled, disabledTypes: settings.disabledTypes, evaluated: record?.status === 'passed', simulationAvailable: c.env.LOCKET_MODEL_SIMULATION === 'true' }
}
export const playbookDraftingHandlers: Record<string, Handler> = { 'playbook.generate': generate, 'playbook.generation.decide': decide, 'playbook.generation.approve': approve }
