import { requestQueue } from './request-queue'
import { intakeForms } from './intake-forms'
import { intakeAudiences } from './intake-audiences'
import { notificationState } from './notifications'
import { recordReportReads, type ScheduledReportRead } from './report-read-authority'
import { reports } from './reports'
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
import { savedViews } from './saved-views'
import { recordReads } from './audit'
import { approvalReminderState } from './approval-reminders'
import { deadlineReminderState } from './deadline-reminders'
import { installationSettings } from './installation'
import { risks } from './obligation-risk'
import { counterpartySummaries } from './counterparty-summary'
import { customFields } from './custom-fields'

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
export async function state(env: Bindings, actor: Actor, scheduledReport?: ScheduledReportRead) {
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
  const obligations = mine(await all(db, 'SELECT * FROM lk_obligations ORDER BY due_date'), ids), now = Date.now()
  const settings = await installationSettings(db), notices = mine(await all(db, 'SELECT * FROM lk_notices ORDER BY created_at'), ids)
  const parties = (await all(db, 'SELECT * FROM lk_parties ORDER BY name')).filter(p => !hiddenParties.has(p.id))
  if (scheduledReport) await recordReportReads(env, actor, agreements, scheduledReport)
  else await recordReads(env, actor, agreements.filter(a => a.restricted).map(a => ({ action: 'agreement.view', agreementId: a.id, summary: 'Read restricted agreement in workspace state.' })))
  return {
    requestQueue: await requestQueue(db, agreements, now),
    intakeForms: await intakeForms(db, actor),
    intakeFormTypes: (await all(db, `SELECT DISTINCT json_extract(v.definition,'$.type') AS type FROM lk_intake_forms f JOIN lk_intake_form_versions v ON v.id=f.published_version_id`)).map(f=>f.type),
    intakeAudiences: await intakeAudiences(db, actor),
    requestForms: mine(await all(db, `SELECT r.*,v.number AS form_number,json_extract(v.definition,'$.name') AS form_name,json_extract(v.definition,'$.fields') AS form_fields FROM lk_request_forms r JOIN lk_intake_form_versions v ON v.id=r.form_version_id`), ids),
    customFields: await customFields(db),
    customValues: mine(await all(db, 'SELECT * FROM lk_custom_values ORDER BY field_id'), ids),
    reports: await reports(env, actor),
    reportDeliveries: await all(db, 'SELECT d.* FROM lk_report_deliveries d JOIN lk_reports r ON r.id=d.report_id WHERE r.created_by=? ORDER BY d.created_at DESC', actor.id),
    savedViews: await savedViews(env, actor),
    actor: { id: actor.id, name: actor.name, role: actor.role },
    notifications: scheduledReport ? {preferences:{inApp:false,email:false,digest:false,timezone:settings.timezone},items:[]} : await notificationState(env, actor),
    now,
    settings,
    operators: operators.map(o => (actor.role === 'owner' ? o : { id: o.id, name: o.name, role: o.role, status: o.status })),
    parties,
    counterparties: counterpartySummaries({ agreements, terms, renewals, notices, parties }, now, settings.rollNoticeDeadlines),
    entities: await all(db, 'SELECT * FROM lk_entities ORDER BY legal_name'),
    agreements,
    workflowHistory: mine(await all(db, 'SELECT * FROM lk_workflow_history ORDER BY at,rowid'), ids),
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
    approvalReminders: await approvalReminderState(env, actor, ids, Date.now()),
    deadlineReminders: await deadlineReminderState(env, actor, ids),
    packages: mine(await all(db, 'SELECT * FROM lk_packages ORDER BY created_at'), ids),
    executions: mine(await all(db, 'SELECT * FROM lk_executions ORDER BY recorded_at'), ids),
    clickwrapTerms: await all(db, 'SELECT * FROM lk_clickwrap_terms ORDER BY name'),
    clickwrapVersions: await all(db, 'SELECT * FROM lk_clickwrap_versions ORDER BY terms_id, number DESC'),
    familyTerms: (await all(db, 'SELECT * FROM lk_family_terms')).filter(t => ids.has(t.root_id) && terms.some(source => source.id === t.term_id)),
    terms,
    obligations,
    risk: risks({ agreements, obligations }, now),
    renewals,
    reminderSchedules: await bulkReminderSchedules(env, actor),
    reminderOperations: await bulkReminderOperations(env, actor),
    noticeSources: mine(await all(db, 'SELECT * FROM lk_notice_sources'), ids),
    noticePlans: mine(await all(db, 'SELECT * FROM lk_notice_plans'), ids),
    noticeLetters: mine(await all(db, 'SELECT * FROM lk_notice_letters'), ids),
    noticeDispatches: mine(await all(db, 'SELECT * FROM lk_notice_dispatches'), ids),
    noticeEvents: mine(await all(db, 'SELECT * FROM lk_notice_events'), ids),
    noticeTracking: mine(await all(db, 'SELECT * FROM lk_notice_tracking'), ids),
    notices,
    proposals,
    imports: actor.role === 'owner' ? await all(db, 'SELECT id, kit, status, source_label, preview, fingerprint, created_by, created_at, applied_by, applied_at, undone_by, undone_at, undo_reason, version FROM lk_import_batches ORDER BY created_at DESC') : [],
    access: mine(await all(db, 'SELECT * FROM lk_access'), ids),
    audit: mine(await all(db, 'SELECT * FROM lk_audit ORDER BY at DESC, id'), ids).filter(a => !a.action.startsWith('view.') || a.actor_id === actor.id).filter(a => !a.action.startsWith('report.') || a.actor_id === actor.id).filter(a => !a.action.startsWith('clickwrap.') || fullReaders.includes(actor.role) || a.actor_id === actor.id),
  }
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
  const tables = ['lk_queue_rules','lk_request_work','lk_request_cancellations','lk_queue_escalations','lk_intake_audiences', 'lk_intake_members', 'lk_intake_forms', 'lk_intake_form_versions', 'lk_request_forms', 'lk_custom_fields', 'lk_custom_values', 'lk_workflow_history', 'lk_notice_sources', 'lk_notice_plans', 'lk_entities', 'lk_parties', 'lk_agreements', 'lk_access', 'lk_requirements', 'lk_versions', 'lk_comments', 'lk_templates', 'lk_template_versions', 'lk_playbook_versions', 'lk_deviations', 'lk_approvals', 'lk_packages', 'lk_executions', 'lk_terms', 'lk_obligations', 'lk_renewals', 'lk_notices', 'lk_proposals', 'lk_import_batches', 'lk_roles', 'lk_audit', 'lk_clickwrap_terms', 'lk_clickwrap_versions', 'lk_clickwrap_acceptances', 'lk_approval_mail', 'lk_family_terms', 'lk_bulk_reminder_previews', 'lk_reminder_schedules', 'lk_bulk_reminder_operations', 'lk_notice_letters', 'lk_notice_dispatches', 'lk_notice_events', 'lk_notice_tracking', 'lk_saved_views', 'lk_view_pins', 'lk_approval_reminder_settings', 'lk_person_preferences', 'lk_deadline_reminder_settings', 'lk_deadline_reminders', 'lk_deadline_reminder_events', 'lk_approval_reminders', 'lk_installation_settings', 'lk_reports', 'lk_report_deliveries', 'lk_notifications', 'lk_notification_deliveries']
  const records: Record<string, unknown[]> = {}
  for (const t of [...tables, 'lk_reminder_routing']) records[t] = await all(db, `SELECT * FROM ${t}`)
  const files = []
  for (const a of await all(db, 'SELECT * FROM lk_artifacts ORDER BY uploaded_at')) files.push({ ...a, base64: encodeBase64(await readArtifactBytes(db, a.id)) })
  return { format: 'locket-archive/1', exportedAt: new Date().toISOString(), records, files }
}
