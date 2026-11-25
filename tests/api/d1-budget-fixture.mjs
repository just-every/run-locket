// A portfolio with retained history, written straight to D1: 100 executed agreements with their confirmed
// terms, renewals, notices and obligations, and 30 days of the records scheduled runs leave behind
// (reminders, notifications, approvals, notices, deliveries, executions, audit entries).
const DAY = 86400000
const iso = t => new Date(t).toISOString().slice(0, 10)
const cache = new Map()

async function insert(db, table, rows, chunk = 100) {
  if (!cache.has(table)) cache.set(table, (await db.prepare(`SELECT name,type,"notnull" AS nn,dflt_value AS d FROM pragma_table_info('${table}')`).all()).results)
  const columns = cache.get(table)
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = rows.slice(i, i + chunk).map(over => {
      const names = [], values = []
      for (const c of columns) {
        if (c.name in over) { names.push(c.name); values.push(over[c.name]) }
        else if (c.nn && c.d == null) { names.push(c.name); values.push(/INT|REAL|NUM/i.test(c.type) ? 1 : 'x') }
      }
      return db.prepare(`INSERT INTO ${table}(${names.map(n => `"${n}"`).join(',')}) VALUES(${names.map(() => '?').join(',')})`).bind(...values)
    })
    await db.batch(batch)
  }
}

export async function seedPortfolio(db, now, { agreements: N = 100, days = 30 } = {}) {
  const owner = (await db.prepare("SELECT id FROM oa_operators WHERE role='owner'").first()).id
  const a = i => 'a' + (i % N), P = Math.max(5, N / 4 | 0), per = (count, i) => now - (days - i / count * days) * DAY
  await insert(db, 'lk_parties', Array.from({ length: P }, (_, i) => ({ id: 'p' + i, name: 'Party ' + i, kind: 'customer', created_by: owner, created_at: now })))
  const created = i => now - (N - i) * DAY / 3
  await insert(db, 'lk_agreements', Array.from({ length: N }, (_, i) => ({ id: 'a' + i, reference: 'AG-' + i, title: 'Agreement ' + i, type: 'customer', party_id: 'p' + (i % P), owner_id: owner, requester_id: owner, status: 'executed', origin: 'intake', timezone: 'America/New_York', created_at: created(i), updated_at: created(i) })))
  await insert(db, 'lk_versions', Array.from({ length: N }, (_, i) => ({ id: 'v' + i, agreement_id: 'a' + i, number: 1, kind: 'upload', label: 'v1', text_source: 'none', digest: 'd' + i, created_by: owner, created_at: created(i) })))
  await db.prepare('UPDATE lk_agreements SET current_version_id=\'v\'||substr(id,2)').run()
  const terms = [], renewals = [], notices = [], obligations = []
  for (let i = 0; i < N; i++) {
    const end = now + ((i % 48) + 1) * 30 * DAY
    for (const [j, [key, value]] of [['effective_date', iso(created(i))], ['end_date', iso(end)], ['auto_renew', 'true'], ['renewal_term_months', '12'], ['notice_days', '60'], ['governing_law', 'NY'], ['payment_terms', 'Net 30']].entries())
      terms.push({ id: `t${i}_${j}`, agreement_id: 'a' + i, key, value, citation: '{}', status: 'confirmed', proposed_by: owner, confirmed_by: owner, confirmed_at: created(i), created_at: created(i) })
    renewals.push({ id: 'r' + i, agreement_id: 'a' + i, end_date: iso(end), notice_days: 60, deadline_date: iso(end - 60 * DAY), deadline_at: end - 60 * DAY, timezone: 'America/New_York', auto_renew: 1, updated_at: created(i) })
    notices.push({ id: 'n' + i, renewal_id: 'r' + i, agreement_id: 'a' + i, recipient: 'x', body: 'b', prepared_by: owner, status: 'draft', created_at: created(i) })
    for (let j = 0; j < 3; j++) obligations.push({ id: `o${i}_${j}`, agreement_id: 'a' + i, description: 'd', owner_id: owner, due_date: iso(now + (j + 1) * 20 * DAY + (i % 10) * DAY), recurrence: 'none', citation: '{}', status: 'confirmed', created_by: owner, created_at: created(i) })
  }
  await insert(db, 'lk_terms', terms); await insert(db, 'lk_renewals', renewals); await insert(db, 'lk_notices', notices); await insert(db, 'lk_obligations', obligations)
  // Thirty days of what the schedules and their recipients leave behind.
  const D = days
  await insert(db, 'lk_deadline_reminders', Array.from({ length: D * 8 }, (_, i) => ({ id: 'dr' + i, agreement_id: a(i), subject_kind: 'obligation', subject_id: `o${i % N}_${i % 3}`, deadline_date: '2026-0' + (1 + i % 5) + '-01', deadline_at: now + i, kind: 'reminder', offset_days: [90, 60, 30, 7][i % 4], recipient_id: owner, recipient_email: 'o@x.test', recipient_reason: 'owner', timezone: 'America/New_York', due_at: per(D * 8, i), status: 'accepted', created_at: per(D * 8, i) })))
  await insert(db, 'lk_notifications', Array.from({ length: D * 20 }, (_, i) => ({ id: 'nt' + i, event_key: 'ek' + i, agreement_id: a(i), recipient_id: owner, kind: 'deadline', created_at: per(D * 20, i), in_app: 1, email_status: 'accepted' })))
  await insert(db, 'lk_audit', Array.from({ length: D * 60 }, (_, i) => ({ id: 'au' + i, agreement_id: a(i), at: per(D * 60, i), actor_id: owner, action: 'x', summary: 'x' })))
  await insert(db, 'lk_approval_mail', Array.from({ length: D * 3 }, (_, i) => ({ id: 'am' + i, agreement_id: a(i), agreement_version: 1, version_id: 'v' + (i % N), version_digest: 'd' + (i % N), recipient_id: owner, recipient_email: 'o@x.test', review_url: 'u', status: 'accepted', created_at: per(D * 3, i) })))
  await insert(db, 'lk_rule_pending', Array.from({ length: D * 3 }, (_, i) => ({ id: 'rp' + i, agreement_id: a(i), agreement_version: 1, version_id: 'v' + (i % N), step_id: 's', approver_id: owner, requested_at: per(D * 3, i), active: 0, absence_version: 0, policy_version: 1 })))
  await insert(db, 'lk_rule_reminder_events', Array.from({ length: D * 3 }, (_, i) => ({ id: 'rre' + i, pending_id: 'rp' + i, agreement_id: a(i), kind: 'reminder', slot: 1, recipient_id: owner, at: per(D * 3, i) })))
  await insert(db, 'lk_request_work', Array.from({ length: N }, (_, i) => ({ agreement_id: 'a' + i, assignee_id: owner, team_id: 't1', lead_id: owner, business_days: 3, due_at: created(i) + 3 * DAY, warning_at: created(i) + 2 * DAY, stage: 'draft' })))
  await insert(db, 'lk_outcome_report_deliveries', Array.from({ length: D }, (_, i) => ({ id: 'ord' + i, month: `2026-${String(1 + Math.floor(i / 3)).padStart(2, '0')}-${i % 3}`, recipient_id: owner, settings_version: 1, status: 'accepted', created_at: per(D, i) })))
  await insert(db, 'lk_notice_sources', Array.from({ length: D }, (_, i) => ({ id: 'ns' + i, agreement_id: a(i), renewal_id: 'r' + (i % N), version_id: 'v' + (i % N), deadline_at: per(D, i) + 5 * DAY, created_at: per(D, i) })))
  await insert(db, 'lk_notice_plans', Array.from({ length: D }, (_, i) => ({ id: 'np' + i, agreement_id: a(i), source_id: 'ns' + i, method: 'email', status: 'sent', send_at: per(D, i), watch_at: per(D, i) + DAY, approved_by: owner, operator_version: 1, agreement_version: 1, recipient: 'x@y.test', alert_at: per(D, i) + DAY, outcome: 'sent' })))
  await insert(db, 'lk_packages', Array.from({ length: D }, (_, i) => ({ id: 'pk' + i, agreement_id: a(i), version_id: 'v' + (i % N), version_digest: 'd', pdf_artifact_id: 'x', manifest_artifact_id: 'x', manifest: '{}', provider: 'docusign', status: 'completed', created_by: owner, created_at: per(D, i) })))
  await insert(db, 'lk_executions', Array.from({ length: D }, (_, i) => ({ id: 'ex' + i, agreement_id: a(i), package_id: 'pk' + i, provider: 'docusign', signed_artifact_id: 'x', signers: '[]', executed_on: iso(per(D, i)), checks: '{}', status: 'reconciled', recorded_by: owner, recorded_at: per(D, i) })))
  await insert(db, 'lk_execution_followups', Array.from({ length: D * 2 }, (_, i) => ({ id: 'fu' + i, agreement_id: a(i), package_id: 'pk' + (i % D), actor: '{}', binding: 'b', kind: 'k' + (i % 2), destination: 'd' + i, status: 'completed', created_at: per(D * 2, i), updated_at: per(D * 2, i) })))
  // One version with a PDF text rendition: the workspace reads its progress.
  await insert(db, 'lk_artifacts', [{ id: 'art0', agreement_id: 'a0', version_id: 'v0', role: 'original', filename: 'a.pdf', media_type: 'application/pdf', size: 1, sha256: 'h0', provenance: '{}', uploaded_by: owner, uploaded_at: now }])
  await insert(db, 'lk_pdf_renditions', [{ id: 'pr0', agreement_id: 'a0', version_id: 'v0', artifact_id: 'art0', source_sha256: 'h0', version_digest: 'd0', status: 'ready', processed_pages: 9, total_pages: 9, created_at: now, updated_at: now }])
  return { owner }
}
