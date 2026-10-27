// Summaries remain immutable model outputs. Current custody applies on every read.
import type { Bindings } from '../auth.server'
import { hiddenFields, requireFullFields } from './repository-access'
import { canSee, grantsFor } from './access'
import { recordReads } from './audit'
import { canonical, fail, parse, sha256, type Actor } from './model'

export const summarySections = ['parties', 'entity', 'our_duties', 'their_duties', 'price', 'payment_terms', 'initial_term_months', 'renewal_term_months', 'notice_days', 'notice_deadline', 'termination', 'liability', 'insurance', 'exceptions'] as const
export async function summaryContext(db: D1Database, agreementId: string) {
 const agreement = await db.prepare('SELECT party_id,entity_id FROM lk_agreements WHERE id=?').bind(agreementId).first<any>()
 const terms = (await db.prepare('SELECT id,key,value,status,citation FROM lk_terms WHERE agreement_id=? ORDER BY id').bind(agreementId).all<any>()).results
 const exceptions = (await db.prepare("SELECT d.clause_key,d.quote,d.explanation,p.id AS approval_id,p.at AS approved_at FROM lk_deviations d JOIN lk_approvals p ON p.deviation_id=d.id WHERE d.agreement_id=? AND p.decision='approved' AND p.invalidated_at IS NULL ORDER BY d.id,p.id").bind(agreementId).all<any>()).results
 const party = agreement && await db.prepare('SELECT name FROM lk_parties WHERE id=?').bind(agreement.party_id).first()
 const entity = agreement?.entity_id ? await db.prepare('SELECT legal_name FROM lk_entities WHERE id=?').bind(agreement.entity_id).first() : null
 return { terms, exceptions, party, entity }
}
export const summaryDigest = async (db: D1Database, agreementId: string) => sha256(canonical(await summaryContext(db, agreementId)))
export function summaryLines(proposals: any[], source: string, versionId: string, context: Awaited<ReturnType<typeof summaryContext>>) {
 if (proposals.length !== summarySections.length || new Set(proposals.map(p => p.key)).size !== summarySections.length || summarySections.some(key => !proposals.some(p => p.key === key))) fail('MODEL_RESPONSE', 'A summary needs one cited line for every required section.', 502)
 return proposals.map(p => {
  const confirmed = context.terms.find(t => t.key === p.key && t.status === 'confirmed' && t.value === p.value && parse(t.citation).versionId === versionId && parse(t.citation).quote === p.quote)
  return { ...p, status: confirmed ? 'confirmed' : 'proposed', start: source.indexOf(p.quote), end: source.indexOf(p.quote) + p.quote.length }
 })
}
export async function agreementSummaries(env: Bindings, actor: Actor, ids: Set<string>) {
 if ((await hiddenFields(env.DB, actor)).length) return []
 const rows = (await env.DB.prepare("SELECT o.*,v.number AS version_number,a.current_version_id FROM lk_model_outputs o JOIN lk_versions v ON v.id=o.version_id JOIN lk_agreements a ON a.id=o.agreement_id WHERE o.task='summaries' AND o.content IS NOT NULL ORDER BY o.created_at DESC,o.id").all<any>()).results
 const visible = []
 for (const row of rows) {
  if (!ids.has(row.agreement_id)) continue
  const input = parse(row.input_digests)
  visible.push({ id: row.id, agreement_id: row.agreement_id, version_id: row.version_id, version_number: row.version_number, content: row.content as string, simulated: row.simulated, stale: row.version_id !== row.current_version_id || input.summaryContext !== await summaryDigest(env.DB, row.agreement_id) })
 }
 return visible
}
export async function readAgreementSummary(env: Bindings, actor: Actor, id: string) {
 await requireFullFields(env.DB, actor)
 const row = await env.DB.prepare("SELECT a.* FROM lk_agreements a JOIN lk_model_outputs o ON o.agreement_id=a.id WHERE o.id=? AND o.task='summaries'").bind(id).first<any>()
 if (!row || !canSee(actor, row, await grantsFor(env, actor))) fail('NOT_FOUND', 'No summary you can access has that identity.', 404)
 const summary = (await agreementSummaries(env, actor, new Set([row.id]))).find(r => r.id === id)
 if (!summary) fail('NOT_FOUND', 'No readable summary has that identity.', 404)
 await recordReads(env, actor, [{ action: 'summary.read', agreementId: row.id, summary: 'Read a version-pinned agreement summary.' }])
 return summary
}
