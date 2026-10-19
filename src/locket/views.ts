// Read endpoints. Every read starts from the current session and filters
// restricted agreements (and everything hanging off them) before returning.
import type { Bindings } from '../auth.server'
import { canSee, fullReaders, grantsFor, may, requireRole } from './access'
import { encodeBase64, readArtifactBytes } from './artifacts'
import { diffLines } from './diff'
import { fail, parse, type Actor } from './model'
import { bulkReminderOperations } from './bulk-reminder-operations'
import { bulkReminderSchedules } from './bulk-reminders'
import { routing } from './review'
import { recordReads } from './audit'

const all = async <T = any>(db: D1Database, query: string, ...params: unknown[]) => (await db.prepare(query).bind(...params).all<T>()).results

async function visibleIds(env: Bindings, actor: Actor) {
  const grants = await grantsFor(env, actor)
  const every = await all(env.DB, 'SELECT * FROM lk_agreements ORDER BY updated_at DESC')
  const agreements = every.filter(a => canSee(actor, a, grants))
  const shown = new Set<string>(agreements.map(a => a.party_id))
  // A counterparty known only through agreements this person cannot see is hidden with them.
  const hiddenParties = new Set<string>(every.filter(a => !shown.has(a.party_id)).map(a => a.party_id))
  return { agreements, ids: new Set<string>(agreements.map(a => a.id)), hiddenParties }
}
const mine = <T extends { agreement_id: string | null }>(rows: T[], ids: Set<string>) => rows.filter(r => r.agreement_id === null || ids.has(r.agreement_id))

/** An intake proposal for a restricted request names no agreement yet: only its preparer, the owner and counsel see it. */
export function seesIntake(actor: Actor, p: { kind: string; payload: string; prepared_by: string }) {
  return p.kind !== 'intake' || parse<{ restricted?: unknown }>(p.payload).restricted !== true || fullReaders.includes(actor.role) || p.prepared_by === actor.id
}

/** Everything the workspace shows, already narrowed to this person. */
export async function state(env: Bindings, actor: Actor) {
  requireRole(actor, may.read, 'read agreements')
  const db = env.DB
  const { agreements, ids, hiddenParties } = await visibleIds(env, actor)
  const versions = mine(await all(db, 'SELECT id, agreement_id, number, kind, label, template_version_id, fields, text, text_source, digest, created_by, created_at FROM lk_versions ORDER BY number'), ids)
  const artifacts = mine(await all(db, 'SELECT id, agreement_id, version_id, role, filename, media_type, size, sha256, source_system, source_id, provenance, imported, uploaded_by, uploaded_at FROM lk_artifacts ORDER BY uploaded_at'), ids)
  const routes: Record<string, unknown> = {}
  for (const a of agreements) if (['draft', 'in_review', 'approved'].includes(a.status)) routes[a.id] = await routing(db, a)
  const operators = await all(db, "SELECT o.id, o.display_name AS name, o.email, o.status, CASE WHEN o.role='owner' THEN 'owner' ELSE COALESCE(r.role,'viewer') END AS role FROM oa_operators o LEFT JOIN lk_roles r ON r.operator_id=o.id ORDER BY o.created_at")
  const renewals = mine(await all(db, 'SELECT * FROM lk_renewals ORDER BY deadline_at'), ids)
  const terms = mine(await all(db, 'SELECT * FROM lk_terms ORDER BY created_at'), ids)
  const proposals = mine(await all(db, 'SELECT * FROM lk_proposals ORDER BY prepared_at DESC'), ids).filter(p => seesIntake(actor, p))
  await recordReads(env, actor, agreements.filter(a => a.restricted).map(a => ({ action: 'agreement.view', agreementId: a.id, summary: 'Read restricted agreement in workspace state.' })))
  return {
    actor: { id: actor.id, name: actor.name, role: actor.role },
    now: Date.now(),
    operators: operators.map(o => (actor.role === 'owner' ? o : { id: o.id, name: o.name, role: o.role, status: o.status })),
    parties: (await all(db, 'SELECT * FROM lk_parties ORDER BY name')).filter(p => !hiddenParties.has(p.id)),
    agreements,
    routes,
    requirements: mine(await all(db, 'SELECT * FROM lk_requirements ORDER BY created_at'), ids),
    versions,
    artifacts,
    comments: mine(await all(db, 'SELECT * FROM lk_comments ORDER BY at'), ids),
    templates: await all(db, 'SELECT * FROM lk_templates ORDER BY name'),
    templateVersions: await all(db, 'SELECT * FROM lk_template_versions ORDER BY template_id, number'),
    playbooks: await all(db, 'SELECT * FROM lk_playbook_versions ORDER BY number'),
    deviations: mine(await all(db, 'SELECT * FROM lk_deviations ORDER BY created_at'), ids),
    approvals: mine(await all(db, 'SELECT * FROM lk_approvals ORDER BY at'), ids),
    packages: mine(await all(db, 'SELECT * FROM lk_packages ORDER BY created_at'), ids),
    executions: mine(await all(db, 'SELECT * FROM lk_executions ORDER BY recorded_at'), ids),
    clickwrapTerms: await all(db, 'SELECT * FROM lk_clickwrap_terms ORDER BY name'),
    clickwrapVersions: await all(db, 'SELECT * FROM lk_clickwrap_versions ORDER BY terms_id, number DESC'),
    familyTerms: (await all(db, 'SELECT * FROM lk_family_terms')).filter(t => ids.has(t.root_id) && terms.some(source => source.id === t.term_id)),
    terms,
    obligations: mine(await all(db, 'SELECT * FROM lk_obligations ORDER BY due_date'), ids),
    renewals,
    reminderSchedules: await bulkReminderSchedules(env, actor),
    reminderOperations: await bulkReminderOperations(env, actor),
    noticeLetters: mine(await all(db, 'SELECT * FROM lk_notice_letters'), ids),
    noticeDispatches: mine(await all(db, 'SELECT * FROM lk_notice_dispatches'), ids),
    noticeEvents: mine(await all(db, 'SELECT * FROM lk_notice_events'), ids),
    noticeTracking: mine(await all(db, 'SELECT * FROM lk_notice_tracking'), ids),
    notices: mine(await all(db, 'SELECT * FROM lk_notices ORDER BY created_at'), ids),
    proposals,
    imports: actor.role === 'owner' ? await all(db, 'SELECT id, kit, status, source_label, preview, fingerprint, created_by, created_at, applied_by, applied_at, undone_by, undone_at, undo_reason, version FROM lk_import_batches ORDER BY created_at DESC') : [],
    access: mine(await all(db, 'SELECT * FROM lk_access'), ids),
    audit: mine(await all(db, 'SELECT * FROM lk_audit ORDER BY at DESC, id'), ids).filter(a => !a.action.startsWith('clickwrap.') || fullReaders.includes(actor.role) || a.actor_id === actor.id),
  }
}

/** Search titles, counterparties, references and version text the person may access. */
export async function search(env: Bindings, actor: Actor, query: string) {
  requireRole(actor, may.read, 'search agreements')
  const q = query.trim().toLowerCase()
  if (!q) return { results: [] }
  const { agreements } = await visibleIds(env, actor)
  const parties = new Map((await all(env.DB, 'SELECT id, name FROM lk_parties')).map(p => [p.id, p.name]))
  const results = []
  for (const a of agreements) {
    const texts = await all<{ number: number; text: string | null }>(env.DB, 'SELECT number, text FROM lk_versions WHERE agreement_id=?', a.id)
    const fields = [a.title, a.reference, parties.get(a.party_id) ?? ''].join(' ').toLowerCase()
    const hit = texts.find(v => v.text?.toLowerCase().includes(q))
    if (fields.includes(q) || hit) {
      const at = hit?.text ? hit.text.toLowerCase().indexOf(q) : -1
      results.push({ id: a.id, reference: a.reference, title: a.title, status: a.status, party: parties.get(a.party_id), match: hit && at >= 0 ? { version: hit.number, excerpt: hit.text!.slice(Math.max(0, at - 60), at + q.length + 60) } : null })
    }
  }
  await recordReads(env, actor, results.filter(r => agreements.find(a => a.id === r.id)?.restricted).map(r => ({ action: 'agreement.view', agreementId: r.id, summary: 'Read restricted agreement in search results.' })))
  return { results }
}

export async function compare(env: Bindings, actor: Actor, from: string, to: string) {
  requireRole(actor, may.read, 'compare versions')
  const { ids } = await visibleIds(env, actor)
  const rows = await all(env.DB, 'SELECT id, agreement_id, number, text FROM lk_versions WHERE id IN (?,?)', from, to)
  const a = rows.find(r => r.id === from), b = rows.find(r => r.id === to)
  if (!a || !b || !ids.has(a.agreement_id) || a.agreement_id !== b.agreement_id) fail('NOT_FOUND', 'Choose two versions of one agreement you can access.', 404)
  if (a.text === null || b.text === null) fail('NO_TEXT', 'Both versions need text to compare. Upload DOCX files or supply the text with each version.', 409)
  const agreement = await env.DB.prepare('SELECT restricted FROM lk_agreements WHERE id=?').bind(a.agreement_id).first<{ restricted: number }>()
  if (agreement?.restricted) await recordReads(env, actor, [{ action: 'agreement.view', agreementId: a.agreement_id, summary: `Compared restricted agreement versions ${a.number} and ${b.number}.` }])
  return { from: a.number, to: b.number, lines: diffLines(a.text, b.text) }
}

export async function download(env: Bindings, actor: Actor, id: string): Promise<Response> {
  requireRole(actor, may.read, 'download files')
  const artifact = await env.DB.prepare('SELECT * FROM lk_artifacts WHERE id=?').bind(id).first<any>()
  const { ids } = await visibleIds(env, actor)
  if (!artifact || (artifact.agreement_id && !ids.has(artifact.agreement_id))) fail('NOT_FOUND', 'No file you can access has that identity.', 404)
  const bytes = await readArtifactBytes(env.DB, id)
  await recordReads(env, actor, [{ action: 'file.download', agreementId: artifact.agreement_id, summary: `Downloaded ${artifact.filename} (${artifact.id}, SHA-256 ${artifact.sha256}).` }])
  return new Response(bytes as BodyInit, {
    headers: {
      'content-type': artifact.media_type,
      'content-disposition': `attachment; filename="${artifact.filename.replace(/[^\w.\- ]/g, '_')}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-locket-sha256': artifact.sha256,
    },
  })
}

/** The owner's complete archive: every record plus every file's exact bytes and digest. */
export async function exportArchive(env: Bindings, actor: Actor) {
  requireRole(actor, may.export, 'export the complete archive')
  const db = env.DB
  const tables = ['lk_parties', 'lk_agreements', 'lk_access', 'lk_requirements', 'lk_versions', 'lk_comments', 'lk_templates', 'lk_template_versions', 'lk_playbook_versions', 'lk_deviations', 'lk_approvals', 'lk_packages', 'lk_executions', 'lk_terms', 'lk_obligations', 'lk_renewals', 'lk_notices', 'lk_proposals', 'lk_import_batches', 'lk_roles', 'lk_audit', 'lk_clickwrap_terms', 'lk_clickwrap_versions', 'lk_clickwrap_acceptances', 'lk_approval_mail', 'lk_family_terms', 'lk_bulk_reminder_previews', 'lk_reminder_schedules', 'lk_bulk_reminder_operations', 'lk_notice_letters', 'lk_notice_dispatches', 'lk_notice_events', 'lk_notice_tracking']
  const records: Record<string, unknown[]> = {}
  for (const t of tables) records[t] = await all(db, `SELECT * FROM ${t}`)
  const files = []
  for (const a of await all(db, 'SELECT * FROM lk_artifacts ORDER BY uploaded_at')) files.push({ ...a, base64: encodeBase64(await readArtifactBytes(db, a.id)) })
  return { format: 'locket-archive/1', exportedAt: new Date().toISOString(), records, files }
}
