import { questionWorkspace } from './repository-questions'
import { pantryServerMatches } from './accounting-destinations'
import { agreementSummaries } from './agreement-summaries'
import { modelSwitchAllows, modelWorkspace } from './model-settings'
import { approvedRenditions } from './redacted-renditions'
import { chatState, chatTables } from './chat-notifications'
import { connectionRegistry } from './connection-health'
import { signatureState,signatureArchiveTables } from './signature-workspace'
import { approvalChannelState,approvalChannelTables } from './approval-channel-automatic'
import { outcomeReportState, outcomeArchiveTables } from './outcome-report'
import { familyEvaluationApproved } from './family-evaluations'
import { remediationState,remediationArchiveTables } from './remediation-records'
import { renewalLifecycleState } from './renewal-lifecycle'
import { renewalCalendarState } from './renewal-calendar'
import { playbookRecommendationState } from './playbook-recommendations'
import { selectScopedPlaybook } from './playbook-recommendation-analysis'
import { reconciliationState } from './reconciliation-records'
import { canReadServiceSources,serviceLevelState } from './service-level-records'
import { familyAnalysisState } from './family-analysis-state'
import { canReadBrief } from './renewal-briefs'
import { ruleDraft } from './approval-rules'
import { hiddenFields, repositoryPolicy, redactWorkspace, requireFullFields } from './repository-access'
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
import { obligationWorkspace } from './owner-obligations'
import { counterpartySummaries } from './counterparty-summary'
import { customFields } from './custom-fields'

const all = async <T = any>(db: D1Database, query: string, ...params: unknown[]) => (await db.prepare(query).bind(...params).all<T>()).results

async function visibleIds(env: Bindings, actor: Actor) {
  const grants = await grantsFor(env, actor)
  const every = await all(env.DB, `SELECT a.*,
    (SELECT audience.name FROM lk_intake_audiences audience WHERE audience.kind='department'
      AND audience.id=COALESCE(
        (SELECT d.department_id FROM lk_agreement_departments d WHERE d.agreement_id=a.id),
        (SELECT json_extract(f.answers,'$.department') FROM lk_request_forms f WHERE f.agreement_id=a.id))) AS department
    FROM lk_agreements a ORDER BY a.updated_at DESC`)
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
  const candidateArtifacts = mine(await all(db, 'SELECT id, agreement_id, version_id, role, filename, media_type, size, sha256, source_system, source_id, provenance, imported, uploaded_by, uploaded_at FROM lk_artifacts ORDER BY uploaded_at'), ids)
  const artifacts=[]
  for(const artifact of candidateArtifacts){const provenance=JSON.parse(artifact.provenance);if(provenance.kind==='service_level_evidence'&&!await canReadServiceSources(db,actor,JSON.stringify(provenance.sources)))continue;if(provenance.kind!=='renewal_brief'||await canReadBrief(db,actor,{sources:JSON.stringify(provenance.sources)}))artifacts.push(artifact)}
  const routes: Record<string, unknown> = {}
  for (const a of agreements) if (['draft', 'in_review', 'approved'].includes(a.status)) routes[a.id] = await routing(db, a)
  const operators = await all(db, "SELECT o.id, o.display_name AS name, o.email, o.status, CASE WHEN o.role='owner' THEN 'owner' ELSE COALESCE(r.role,'viewer') END AS role FROM oa_operators o LEFT JOIN lk_roles r ON r.operator_id=o.id ORDER BY o.created_at")
  const renewals = mine(await all(db, 'SELECT * FROM lk_renewals ORDER BY deadline_at'), ids)
  const terms = mine(await all(db, 'SELECT * FROM lk_terms ORDER BY created_at'), ids)
  const proposals = mine(await all(db, 'SELECT * FROM lk_proposals ORDER BY prepared_at DESC'), ids).filter(p => seesIntake(actor, p))
  const obligationCandidates=mine(await all(db,'SELECT * FROM lk_obligations ORDER BY due_date'),ids),obligations=[]
  for(const obligation of obligationCandidates){const claim=await db.prepare('SELECT sources FROM lk_service_level_claims WHERE obligation_id=? UNION ALL SELECT sources FROM lk_service_performance_claims WHERE obligation_id=?').bind(obligation.id,obligation.id).first<{sources:string}>();if(!claim||await canReadServiceSources(db,actor,claim.sources))obligations.push(obligation)}
  const now=Date.now()
  const obligationView = obligationWorkspace(obligations, agreements, now)
  const settings = await installationSettings(db), notices = mine(await all(db, 'SELECT * FROM lk_notices ORDER BY created_at'), ids)
  const parties = (await all(db, 'SELECT * FROM lk_parties ORDER BY name')).filter(p => !hiddenParties.has(p.id))
  if (scheduledReport) await recordReportReads(env, actor, agreements, scheduledReport)
  else await recordReads(env, actor, agreements.filter(a => a.restricted).map(a => ({ action: 'agreement.view', agreementId: a.id, summary: 'Read restricted agreement in workspace state.' })))
  const renewalBriefs=[]
  for(const b of mine(await all(db,'SELECT * FROM lk_renewal_briefs ORDER BY prepared_at DESC'),ids)) if(await canReadBrief(db,actor,b))renewalBriefs.push(b)
  const playbooks=await all(db,'SELECT * FROM lk_playbook_versions ORDER BY number')
  const applications=await all(db,'SELECT id,source_playbook_id,scope FROM lk_playbook_applications')
  const activePlaybook=playbooks.find(p=>p.status==='active')
  return redactWorkspace({
    questions: await questionWorkspace(env,actor),
    summaries: await agreementSummaries(env,actor,ids),
    models: await modelWorkspace(env,actor,ids,now),
    redactedRenditions:fullReaders.includes(actor.role)?mine(await all(db,'SELECT * FROM lk_redacted_renditions ORDER BY id'),ids):[],
    remediation:await remediationState(env,actor),
    outcomeReports:await outcomeReportState(env,actor),
    approvalChannels:await approvalChannelState(env,actor,ids),
    signature:await signatureState(db,actor,ids),
    proposalSources:mine(await all(db,'SELECT * FROM lk_proposal_sources'),ids),
    billingProposals:mine(await all(db,'SELECT * FROM lk_billing_proposals'),ids),
    executionDestinations:actor.role==='owner'?await all(db,'SELECT * FROM lk_execution_destinations'):[],
    executionFollowups:mine(await all(db,'SELECT id,agreement_id,package_id,kind,destination,status,outcome,created_at,updated_at FROM lk_execution_followups'),ids),
    executionRetrievals:mine(await all(db,'SELECT id,agreement_id,package_id,status,attempts,next_attempt_at,last_error,execution_id,created_at,updated_at,outcomes FROM lk_execution_retrievals'),ids),
    ...await renewalLifecycleState(db,ids),...await renewalCalendarState(db,actor,ids),
    playbookRecommendations: await playbookRecommendationState({db,actor}),
    agreementPlaybooks: Object.fromEntries(agreements.map(a=>[a.id,selectScopedPlaybook(a,activePlaybook,playbooks,applications)?.id??null])),
    ...await reconciliationState(env,actor),
    serviceLevels:await serviceLevelState(env,actor),
    ...await familyAnalysisState(env,agreements,terms),
    familyModel: fullReaders.includes(actor.role)?{enabled:await modelSwitchAllows(db)&&env.AI_ENABLED==='true'&&env.AI_TRAINING_PROHIBITED==='true'&&await familyEvaluationApproved(env),model:env.AI_MODEL??null,endpoint:(()=>{try{return new URL(env.MODELS_SERVICE??env.AI_BASE_URL??'https://api.openai.com/v1').origin}catch{return null}})()}:null,
    renewalBriefs,
    renewalBriefSettings: mine(await all(db,'SELECT * FROM lk_renewal_brief_settings'),ids),
    accountingReads: mine(await all(db,'SELECT * FROM lk_accounting_reads ORDER BY read_at DESC,id DESC'),ids),
    accountingAllocations: mine(await all(db,'SELECT * FROM lk_accounting_allocations'),ids),
    accountingSchedules: mine(await all(db,"SELECT s.*,CASE WHEN d.enabled=1 AND s.destination_revision=d.revision AND s.origin=d.origin THEN 1 ELSE 0 END AS destination_current FROM lk_accounting_schedules s LEFT JOIN lk_accounting_destinations d ON d.provider='pantry' ORDER BY s.prepared_at DESC"),ids).map(r=>({...r,destination_current:!!r.destination_current&&pantryServerMatches(env,r.origin)})),
    accountingLinks: mine(await all(db,'SELECT * FROM lk_accounting_links'),ids),
    legalHolds: mine(await all(db,'SELECT * FROM lk_legal_holds'),ids),
    retentionRule: actor.role==='owner' ? await db.prepare("SELECT * FROM lk_retention_rules WHERE id='installation'").first() : null,
    connections: actor.role==='owner'?await connectionRegistry(env):[],
    privacyScopes: actor.role==='owner'?await all(db,'SELECT * FROM lk_privacy_scopes'):(await db.prepare('SELECT * FROM lk_privacy_scopes WHERE operator_id=?').bind(actor.id).all()).results,
    erasureRecovery: actor.role==='owner'?await all(db,'SELECT e.subject_token FROM lk_erasures e LEFT JOIN lk_erasure_blocks b ON b.subject_token=e.subject_token WHERE b.subject_token IS NULL'):[],
    erasures: actor.role==='owner' ? await all(db,'SELECT * FROM lk_erasures ORDER BY at DESC') : [],
    approvalRules: actor.role==='owner'?await ruleDraft(db):null,
    approvalInputs: mine(await all(db,'SELECT * FROM lk_approval_inputs'),ids),
    approvalAbsences: (await all(db,'SELECT * FROM lk_approval_absences')).filter(r=>actor.role==='owner'||r.operator_id===actor.id),
    ruleDecisions: (await all(db,'SELECT d.*,a.agreement_id FROM lk_approval_rule_decisions d JOIN lk_approvals a ON a.id=d.approval_id')).filter(r=>ids.has(r.agreement_id)),
    rulePending: mine(await all(db,'SELECT * FROM lk_rule_pending WHERE active=1'),ids),
    ruleReminders: mine(await all(db,'SELECT e.*,n.email_status FROM lk_rule_reminder_events e LEFT JOIN lk_notifications n ON n.event_key=e.id AND n.recipient_id=e.recipient_id ORDER BY e.at'),ids),
    fieldAccess: {hidden:[] as string[],documentsWithheld:false},
    repositoryPolicy: actor.role==='owner'?await repositoryPolicy(db):null,
    agreementDepartments: mine(await all(db,'SELECT * FROM lk_agreement_departments'),ids),
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
    chatNotifications: scheduledReport ? {preferences:{channels:[],version:0},identities:[],deliveries:[]} : await chatState(env,actor,ids),
    notifications: scheduledReport ? {preferences:{inApp:false,email:false,digest:false,timezone:settings.timezone},items:[]} : await notificationState(env, actor),
    now,
    settings,
    operators: operators.map(o => (actor.role === 'owner' ? o : { id: o.id, name: o.name, role: o.role, status: o.status })),
    parties,
    counterparties: counterpartySummaries({ agreements, terms, renewals, notices, parties }, now, settings.rollNoticeDeadlines),
    entities: await all(db, 'SELECT * FROM lk_entities ORDER BY legal_name'),
    agreements,
    workflowStages: mine(await all(db,'SELECT * FROM lk_workflow_stages ORDER BY at,rowid'),ids),
    workflowServiceLevels: mine(await all(db,'SELECT * FROM lk_workflow_service_levels'),ids),
    workflowHistory: mine(await all(db, 'SELECT * FROM lk_workflow_history ORDER BY at,rowid'), ids),
    routes,
    requirements: mine(await all(db, 'SELECT * FROM lk_requirements ORDER BY created_at'), ids),
    versionAudiences: mine(await all(db,'SELECT side.version_id AS id,v.agreement_id,side.audience FROM lk_version_audiences side JOIN lk_versions v ON v.id=side.version_id'),ids),
    commentAudiences: mine(await all(db,'SELECT side.comment_id AS id,c.agreement_id,side.audience FROM lk_comment_audiences side JOIN lk_comments c ON c.id=side.comment_id'),ids),
    versions,
    artifacts,
    comments: mine(await all(db, 'SELECT * FROM lk_comments ORDER BY at'), ids),
    wordTemplates: await all(db,'SELECT * FROM lk_word_templates'),
    templates: await all(db, 'SELECT * FROM lk_templates ORDER BY name'),
    templateVersions: await all(db, 'SELECT * FROM lk_template_versions ORDER BY template_id, number'),
    playbooks,
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
    obligations: obligationView,
    ownerObligations: obligationView.filter(o => o.owner_id === actor.id && !['proposed','rejected'].includes(o.status)),
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
    privilegedNotes: fullReaders.includes(actor.role)?mine(await all(db,'SELECT * FROM lk_privileged_notes ORDER BY created_at'),ids):[],
    accessExceptions: fullReaders.includes(actor.role)?mine(await all(db,'SELECT * FROM lk_access_exceptions'),ids):[],
    access: mine(await all(db, 'SELECT * FROM lk_access'), ids),
    audit: (await all(db, 'SELECT * FROM lk_audit ORDER BY at DESC, id')).filter(a=>fullReaders.includes(actor.role)||a.agreement_id===null||ids.has(a.agreement_id)).filter(a=>fullReaders.includes(actor.role)||!['repository.access','agreement.department','agreement.classification','access.exception'].includes(a.action)).filter(a => !a.action.startsWith('view.') || a.actor_id === actor.id).filter(a => !a.action.startsWith('report.') || a.actor_id === actor.id).filter(a => !a.action.startsWith('clickwrap.') || fullReaders.includes(actor.role) || a.actor_id === actor.id),
  },await hiddenFields(db,actor),await approvedRenditions(db,actor))
}

export async function compare(env: Bindings, actor: Actor, from: string, to: string) {
  requireRole(actor, may.read, 'compare versions')
  const hidden=await hiddenFields(env.DB,actor)
  const { ids } = await visibleIds(env, actor)
  const rows = await all(env.DB, 'SELECT id, agreement_id, number, text FROM lk_versions WHERE id IN (?,?)', from, to)
  const a = rows.find(r => r.id === from), b = rows.find(r => r.id === to)
  if (!a || !b || !ids.has(a.agreement_id) || a.agreement_id !== b.agreement_id) fail('NOT_FOUND', 'Choose two versions of one agreement you can access.', 404)
  if(hidden.length){
    const approved=await approvedRenditions(env.DB,actor)
    for(const v of [a,b]){const rendition=approved.find(r=>r.version_id===v.id);if(!rendition)fail('FIELD_ACCESS','Counsel has not approved a current rendition for this role.',403);v.text=rendition.text}
  }
  if (a.text === null || b.text === null) fail('NO_TEXT', 'Both versions need text to compare. Upload DOCX files or supply the text with each version.', 409)
  const agreement = await env.DB.prepare('SELECT restricted FROM lk_agreements WHERE id=?').bind(a.agreement_id).first<{ restricted: number }>()
  if (agreement?.restricted) await recordReads(env, actor, [{ action: 'agreement.view', agreementId: a.agreement_id, summary: `Compared restricted agreement versions ${a.number} and ${b.number}.` }])
  return { from: a.number, to: b.number, lines: diffLines(a.text, b.text) }
}

export async function download(env: Bindings, actor: Actor, id: string): Promise<Response> {
  requireRole(actor, may.read, 'download files')
  if((await hiddenFields(env.DB,actor)).length&&!(await approvedRenditions(env.DB,actor)).some(r=>r.artifact_id===id))fail('FIELD_ACCESS','Only current counsel-approved renditions may be downloaded by this role.',403)
  const artifact = await env.DB.prepare('SELECT * FROM lk_artifacts WHERE id=?').bind(id).first<any>()
  const { ids } = await visibleIds(env, actor)
  if (!artifact || (artifact.agreement_id && !ids.has(artifact.agreement_id))) fail('NOT_FOUND', 'No file you can access has that identity.', 404)
  if(JSON.parse(artifact.provenance).kind==='service_level_evidence'&&!await canReadServiceSources(env.DB,actor,JSON.stringify(JSON.parse(artifact.provenance).sources)))fail('NOT_FOUND','Some monitoring evidence sources are no longer accessible.',404)
  if(JSON.parse(artifact.provenance).kind==='renewal_brief') {const provenance=JSON.parse(artifact.provenance);if(!await canReadBrief(env.DB,actor,{sources:JSON.stringify(provenance.sources)}))fail('NOT_FOUND','The brief contains sources you cannot currently access.',404)}
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
  const tables = ['lk_repository_questions','lk_accounting_destinations','lk_execution_destinations','lk_execution_followups','lk_model_settings', 'lk_model_outputs', 'lk_model_usage', 'lk_proposal_sources','lk_billing_proposals','lk_execution_retrievals','lk_accounting_allocations','lk_accounting_reads','lk_accounting_schedules','lk_privileged_notes','lk_access_exceptions','lk_redacted_renditions','lk_connection_expiries','lk_workforce_settings','lk_workforce_groups','lk_workforce_users','lk_workforce_members','lk_api_tokens','lk_connection_health','lk_privacy_scopes','lk_service_performance_terms','lk_service_performance_reports','lk_service_performance_claims','lk_service_performance_breaches','lk_service_performance_dispatches','lk_service_level_links','lk_service_level_terms','lk_service_level_reads','lk_service_level_claims','lk_service_level_breaches','lk_service_level_dispatches','lk_reconciliation_settings','lk_reconciliation_interpretations','lk_reconciliation_scans','lk_reconciliation_findings','lk_reconciliation_dispatches','lk_negotiation_outcomes','lk_playbook_issues','lk_playbook_recommendations','lk_playbook_applications','lk_family_analyses','lk_family_obligation_sources','lk_word_templates','lk_price_caps','lk_accounting_links','lk_renewal_brief_settings','lk_renewal_briefs','lk_repository_bulk','lk_repository_bulk_items','lk_agreement_groups','lk_exchanges','lk_exchange_commands','lk_version_audiences','lk_comment_audiences','lk_workflow_stages','lk_workflow_service_levels','lk_legal_holds','lk_erasure_previews','lk_erasure_blocks','lk_erasure_keys','lk_erasures','lk_retention_rules','lk_retention_previews','lk_approval_rule_drafts','lk_approval_rule_versions','lk_approval_rule_snapshots','lk_approval_inputs','lk_approval_absences','lk_approval_rule_decisions','lk_rule_pending','lk_rule_reminder_events','lk_repository_policy','lk_agreement_departments','lk_view_groups','lk_queue_rules','lk_request_work','lk_request_cancellations','lk_queue_escalations','lk_intake_audiences', 'lk_intake_members', 'lk_intake_forms', 'lk_intake_form_versions', 'lk_request_forms', 'lk_custom_fields', 'lk_custom_values', 'lk_workflow_history', 'lk_notice_sources', 'lk_notice_plans', 'lk_entities', 'lk_parties', 'lk_agreements', 'lk_access', 'lk_requirements', 'lk_versions', 'lk_comments', 'lk_templates', 'lk_template_versions', 'lk_playbook_versions', 'lk_deviations', 'lk_approvals', 'lk_packages', 'lk_executions', 'lk_terms', 'lk_obligations', 'lk_renewals', 'lk_notices', 'lk_proposals', 'lk_import_batches', 'lk_roles', 'lk_audit', 'lk_clickwrap_terms', 'lk_clickwrap_versions', 'lk_clickwrap_acceptances', 'lk_approval_mail', 'lk_family_terms', 'lk_bulk_reminder_previews', 'lk_reminder_schedules', 'lk_bulk_reminder_operations', 'lk_notice_letters', 'lk_notice_dispatches', 'lk_notice_events', 'lk_notice_tracking', 'lk_saved_views', 'lk_view_pins', 'lk_approval_reminder_settings', 'lk_person_preferences', 'lk_deadline_reminder_settings', 'lk_deadline_reminders', 'lk_deadline_reminder_events', 'lk_approval_reminders', 'lk_installation_settings', 'lk_reports', 'lk_report_deliveries', 'lk_notifications', 'lk_notification_deliveries']
  const records: Record<string, unknown[]> = {}
  for (const t of [...tables,...chatTables, 'lk_reminder_routing',...remediationArchiveTables,...outcomeArchiveTables,...approvalChannelTables,...signatureArchiveTables,'lk_renewal_generations','lk_renewal_history','lk_renewal_settings','lk_renewal_terminations','lk_calendar_events']) records[t] = await all(db, `SELECT * FROM ${t}`)
  records.lk_execution_followups=(records.lk_execution_followups as any[]).map(row=>({...row,actor:JSON.stringify({...JSON.parse(row.actor),sessionId:''}),status:row.status==='waiting'?'cancelled':row.status}))
  records.lk_execution_retrievals=(records.lk_execution_retrievals as any[]).map(row=>({...row,actor:JSON.stringify({...JSON.parse(row.actor),sessionId:''}),status:['waiting','retrying','retrieving'].includes(row.status)?'cancelled':row.status,lease_until:null}))
  records.lk_calendar_connections=await all(db,'SELECT id,operator_id,provider,calendar_id,last_error,created_at,version FROM lk_calendar_connections')
  const files = []
  for (const a of await all(db, 'SELECT * FROM lk_artifacts ORDER BY uploaded_at')) files.push({ ...a, base64: encodeBase64(await readArtifactBytes(db, a.id)) })
  return { format: 'locket-archive/1', exportedAt: new Date().toISOString(), records, files }
}
