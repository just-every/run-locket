import { readArtifactBytes } from './artifacts'
import { visibleSetSql } from './access'
import type { Ctx } from './commands'
import { readablePages } from './execution-comparison'
import { canonical, fail, json, parse, sha256, sql, type Sql } from './model'
import { creditTableGuards, creditTableSnapshots } from './playbook-recommendation-credits'
import { currentVersion, visibleAgreement } from './records'
import { insideRecommendationScope, type RecommendationScope } from './playbook-recommendation-analysis'

export interface DraftingSource {
 kind: 'template' | 'agreement'; id: string; title: string; type: string; entityId: string | null
 versionId: string; number: number; digest: string; pages: { page: number | null; text: string }[]
 facts: Record<string, unknown>
}
export async function draftingSources(c: Ctx, templates: string[], agreements: string[], scope: RecommendationScope) {
 if (!templates.length || !agreements.length) fail('SOURCES', 'Choose approved templates and executed agreements.', 409)
 const sources: DraftingSource[] = [], checks: Sql[] = [visibleSetSql(c.actor, agreements)]
 // Observation records do not bump the agreement revision. Snapshot the
 // selected cohort once, and fence exact contents plus additions atomically.
 const agreementIds = [...agreements].sort(), observationRows: Record<string, any[]> = {}
 for (const [table, columns] of [
  ['lk_negotiation_outcomes', ['id','agreement_id','version_id','version_digest','deviation_id','approval_id','playbook_version_id','clause_key','outcome','start','end','quote','evidence','recorded_by','recorded_at']],
  ['lk_playbook_issues', ['id','outcome_id','agreement_id','kind','description','evidence','obligation_id','recorded_by','recorded_at']],
 ] as const) {
  const query = `SELECT json_group_array(json_object(${columns.map(k => `'${k}',r.${k}`).join(',')})) AS value FROM (SELECT * FROM ${table} WHERE agreement_id IN (SELECT value FROM json_each(?)) ORDER BY id) r`
  const snapshot = await c.db.prepare(query).bind(json(agreementIds)).first<{ value: string }>()
  observationRows[table] = parse(snapshot!.value)
  checks.push(sql(`(${query}) IS ?`, json(agreementIds), snapshot!.value))
 }
 const credits = await creditTableSnapshots(c, agreementIds)
 for (const entry of credits) {
  // Native credit records can cite other, unselected family documents. Retain
  // their identity/status and exact digest without disclosing those documents.
  observationRows[entry.table] = await Promise.all(parse<any[]>(entry.value).map(async row => ({
   id: row.id ?? null, agreement_id: row.agreement_id, version: row.version ?? null,
   status: row.status ?? null, digest: await sha256(canonical(row)),
  })))
 }
 checks.push(...creditTableGuards(agreementIds, credits))
 for (const id of [...templates].sort()) {
  const v = await c.db.prepare('SELECT v.*,t.name,t.type,t.entity_id FROM lk_template_versions v JOIN lk_templates t ON t.id=v.template_id WHERE v.id=?').bind(id).first<any>()
  if (!v || v.status !== 'approved') fail('SOURCES', 'Each template must still be approved.', 409)
  if (!scope.agreementTypes.includes(v.type) || v.entity_id && scope.entityIds.length && !scope.entityIds.includes(v.entity_id)) fail('SCOPE', 'Template sources must belong to the selected future scope.', 409)
  const word = await c.db.prepare('SELECT w.*,f.sha256 FROM lk_word_templates w JOIN lk_artifacts f ON f.id=w.source_artifact_id WHERE w.id=?').bind(id).first<any>()
  if (word) {
   if (await sha256(await readArtifactBytes(c.db, word.source_artifact_id)) !== word.sha256) fail('SOURCES', 'Approved Word source custody could not be verified.', 409)
   checks.push(sql('EXISTS(SELECT 1 FROM lk_word_templates w JOIN lk_artifacts f ON f.id=w.source_artifact_id WHERE w.id=? AND w.revision=? AND w.marks=? AND f.id=? AND f.sha256=?)', id, word.revision, word.marks, word.source_artifact_id, word.sha256))
  }
  const facts = { ...(word ? { artifactId: word.source_artifact_id, artifactDigest: word.sha256, marks: word.marks, revision: word.revision } : {}), body: v.body, clauses: v.clauses, fields: v.fields, approvedBy: v.approved_by, approvedAt: v.approved_at }
  sources.push({ kind: 'template', id, title: v.name, type: v.type, entityId: v.entity_id, versionId: id, number: v.number, digest: await sha256(canonical(facts)), pages: [{ page: null, text: v.body + '\n' + JSON.parse(v.clauses).flatMap((c: any) => c.variants.map((v: any) => v.text)).join('\n') }], facts })
  checks.push(sql("EXISTS(SELECT 1 FROM lk_template_versions v JOIN lk_templates t ON t.id=v.template_id WHERE v.id=? AND v.status='approved' AND v.body=? AND v.clauses=? AND v.fields=? AND t.type=? AND t.entity_id IS ?)", id, v.body, v.clauses, v.fields, v.type, v.entity_id))
 }
 for (const id of [...agreements].sort()) {
  const a = await visibleAgreement(c, id), v = await currentVersion(c, a)
  if (a.status !== 'executed' || !insideRecommendationScope(scope, a)) fail('SOURCES', 'History must contain executed agreements in the selected future scope.', 409)
  const e = await c.db.prepare("SELECT e.*,p.version_id,p.version_digest FROM lk_executions e JOIN lk_packages p ON p.id=e.package_id WHERE e.agreement_id=? AND e.imported=0 AND e.status IN ('reconciled','accepted') AND p.version_id=? AND p.version_digest=? ORDER BY e.recorded_at DESC,e.id LIMIT 1").bind(a.id, v.id, v.digest).first<any>()
  if (!e) fail('SOURCES', 'History needs retained execution evidence for the current exact version.', 409)
  const artifact = await c.db.prepare('SELECT id,sha256 FROM lk_artifacts WHERE id=? AND agreement_id=?').bind(e.signed_artifact_id, id).first<any>()
  if (!artifact) fail('SOURCES', 'The signed original is unavailable.', 409)
  const bytes = await readArtifactBytes(c.db, artifact.id)
  if (await sha256(bytes) !== artifact.sha256) fail('SOURCES', 'Signed original custody could not be verified.', 409)
  const pages = await readablePages(bytes)
  if (!pages) fail('NO_TEXT', 'A signed source has unreadable pages. Supply a readable signed original; no OCR is inferred.', 409)
  const observations = Object.fromEntries(Object.entries(observationRows).map(([table, rows]) => [table, rows.filter(row => row.agreement_id === id)]))
  const facts = { observations, agreementVersion: a.version, executionId: e.id, executionStatus: e.status, executionChecks: e.checks, resolution: e.resolution, packageId: e.package_id, artifactId: artifact.id, artifactDigest: artifact.sha256 }
  sources.push({ kind: 'agreement', id, title: a.title, type: a.type, entityId: a.entity_id, versionId: v.id, number: v.number, digest: v.digest, pages: pages.map((text, index) => ({ page: index + 1, text })), facts })
  checks.push(sql("EXISTS(SELECT 1 FROM lk_agreements a JOIN lk_versions v ON v.id=a.current_version_id WHERE a.id=? AND a.version=? AND a.status='executed' AND v.id=? AND v.digest=?)", id, a.version, v.id, v.digest),
   sql('EXISTS(SELECT 1 FROM lk_executions e JOIN lk_artifacts f ON f.id=e.signed_artifact_id JOIN lk_packages p ON p.id=e.package_id WHERE e.id=? AND e.status=? AND e.checks=? AND e.resolution IS ? AND f.id=? AND f.sha256=? AND p.version_id=? AND p.version_digest=?)', e.id, e.status, e.checks, e.resolution, artifact.id, artifact.sha256, v.id, v.digest))
 }
 if (canonical(sources).length > 500_000) fail('SOURCES', 'Select at most 500,000 source characters per request.', 409)
 return { sources, digest: await sha256(canonical(sources)), checks }
}
export const draftingSourceIds = (sources: DraftingSource[]) => ({ templateVersionIds: sources.filter(s => s.kind === 'template').map(s => s.id), agreementIds: sources.filter(s => s.kind === 'agreement').map(s => s.id) })
