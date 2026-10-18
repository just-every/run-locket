import type { Bindings } from './auth.server'
import { clauses, examples, ownerName, rules, team } from './demo/examples'
import { seedJourneys } from './demo/journeys'
import { noticeDeadline } from './locket/dates'
import { canonical, sha256 } from './locket/model'
import { textPdf } from './locket/pdf'
import { versionDigest } from './locket/records'

/** Fixed identities and conflict-safe inserts make a partial seed safe to resume. Never fetches. */
export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }) {
  const owner = await env.DB.prepare("SELECT id FROM oa_operators WHERE email=? AND role='owner' AND status='active'").bind(ownerEmail).first<{ id: string }>()
  if (!owner) throw new Error('Demo owner is not ready')
  const at = now.getTime(), day = 86_400_000
  const date = (offset: number) => new Date(at + offset * day).toISOString().slice(0, 10)
  const writes: D1PreparedStatement[] = []
  const add = (table: string, row: Record<string, unknown>) => {
    const names = Object.keys(row)
    writes.push(env.DB.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')}) ON CONFLICT DO NOTHING`).bind(...Object.values(row)))
  }
  // A fresh demo owner claims with Base's placeholder name; give it the studio lead's.
  writes.push(env.DB.prepare("UPDATE oa_operators SET display_name=? WHERE id=? AND display_name='Owner'").bind(ownerName, owner.id))
  for (const [id, name, email, role] of team) {
    add('oa_operators', { id, email, display_name: name, role: 'member', status: 'active', created_at: at - 40 * day })
    add('lk_roles', { operator_id: id, role, updated_by: owner.id, updated_at: at - 40 * day })
  }
  const fields = [{ name: 'scope', label: 'Scope of work', required: true }]
  for (const [key, name, type] of [['services', 'Professional services', 'customer'], ['supply', 'Supply agreement', 'supplier']]) {
    const body = `SAMPLE AGREEMENT - ${name}\nBetween Northbank Studio and {{counterparty}}.\nScope: {{scope}}.\n[[clause:payment]]\n[[clause:liability]]\nGoverning law: Delaware.`
    add('lk_templates', { id: `demo-template-${key}`, name, type, created_by: 'demo-counsel', created_at: at - 35 * day })
    add('lk_template_versions', { id: `demo-template-${key}-v1`, template_id: `demo-template-${key}`, number: 1, body, fields: JSON.stringify(fields), clauses: JSON.stringify(clauses), status: 'approved', created_by: 'demo-counsel', created_at: at - 35 * day, approved_by: owner.id, approved_at: at - 34 * day })
  }
  add('lk_playbook_versions', { id: 'demo-playbook', number: 1, rules: JSON.stringify(rules), status: 'active', created_by: 'demo-counsel', created_at: at - 34 * day, activated_by: owner.id, activated_at: at - 33 * day })
  for (const [index, [key, party, title, type, status, value, days]] of examples.entries()) {
    const id = `demo-${key}`, versionId = `${id}-v1`, partyId = `${id}-party`, created = at - (30 - index) * day
    const historical = status === 'imported', end = date(days + 30)
    const quote = key === 'harbour' ? 'Invoices are payable within 60 days.' : 'Invoices are payable within 30 days.'
    const body = `SAMPLE ONLY - fictional ${historical ? 'historical agreement summary' : 'unsigned draft'}\n${title}\nBetween Northbank Studio and ${party}.\nScope: ${title}.\n${quote}\nLiability is capped at fees paid in the prior 12 months.\nTerm ends on ${end}. Give 30 days notice before the end date.\nGoverning law: Delaware.\nNo signatures or execution evidence are supplied in this demo.`
    const bytes = textPdf(title, body, 'Fictional sample - unsigned; no execution evidence'), hash = await sha256(bytes)
    const values = { values: { scope: title }, clauses: { payment: 'net30', liability: 'cap' } }
    const digest = await versionDigest({ agreementId: id, number: 1, files: [{ role: 'rendition', sha256: hash }], text: body, fields: values })
    add('lk_parties', { id: partyId, name: party, kind: type === 'supplier' ? 'supplier' : 'customer', email: `contracts@${key}.example`, created_by: 'demo-operations', created_at: created })
    add('lk_agreements', { id, reference: `LK-${String(index + 1).padStart(4, '0')}`, title, type, party_id: partyId, value_cents: value, currency: 'USD', owner_id: [owner.id, 'demo-counsel', 'demo-commercial', 'demo-operations'][index % 4], requester_id: 'demo-operations', status, restricted: 0, needed_by: date(days), start_date: date(-60), timezone: 'America/New_York', origin: historical ? 'legacy' : 'intake', current_version_id: versionId, created_at: created, updated_at: at - index * 3600000 })
    add('lk_versions', { id: versionId, agreement_id: id, number: 1, kind: historical ? 'legacy' : 'template', label: historical ? 'Fictional historical summary (no signed original)' : 'Sample draft for review', template_version_id: historical ? null : `demo-template-${type === 'supplier' ? 'supply' : 'services'}-v1`, fields: JSON.stringify(values), text: body, text_source: historical ? 'person' : 'template', digest, created_by: 'demo-operations', created_at: created })
    add('lk_artifacts', { id: `${id}-pdf`, agreement_id: id, version_id: versionId, role: 'rendition', filename: `${key}-sample-unsigned.pdf`, media_type: 'application/pdf', size: bytes.length, sha256: hash, provenance: JSON.stringify({ source: 'fictional-demo', note: 'Unsigned sample, not execution evidence' }), imported: 0, uploaded_by: 'demo-operations', uploaded_at: created })
    add('lk_artifact_chunks', { artifact_id: `${id}-pdf`, ordinal: 0, bytes: [...bytes] })
    add('lk_comments', { id: `${id}-comment`, agreement_id: id, version_id: versionId, author_id: 'demo-counsel', body: historical ? 'Sample summary only. Upload the actual signed original before relying on these terms.' : index === 0 ? 'Please bring the payment window back to our approved wording before commercial sign-off.' : 'Scope checked with the project lead. Please confirm the delivery dates.', at: at - (index + 1) * 3600000 })
    add('lk_audit', { id: `${id}-audit`, at: at - index * 3600000, actor_id: 'demo-operations', actor_name: 'Ella Wilson', actor_role: 'requester', action: historical ? 'legacy.import' : 'request.create', agreement_id: id, summary: `${historical ? 'Added fictional historical summary' : 'Prepared sample request'}: ${title}` })
    if (status === 'approved') {
      const context = { versionDigest: digest, valueCents: value, partyId, deviations: [] }
      add('lk_approvals', { id: `${id}-approval`, agreement_id: id, version_id: versionId, version_digest: digest, kind: 'commercial', decision: 'approved', actor_id: 'demo-commercial', actor_role: 'approver', context: JSON.stringify(context), context_digest: await sha256(canonical(context)), reason: 'Sample commercial approval; scope and budget agreed.', at: at - day })
    }
    if (index === 0) {
      const start = body.indexOf(quote)
      add('lk_deviations', { id: 'demo-payment-finding', agreement_id: id, version_id: versionId, playbook_version_id: 'demo-playbook', clause_key: 'payment', result: 'breached', start_offset: start, end_offset: start + quote.length, quote, proposed_wording: 'Invoices are payable within 30 days.', explanation: 'The supplier asks for 60 days; our approved alternative is at most 45 days.', questions: JSON.stringify(['Can the supplier accept net 30?']), authority: 'approver', created_by: 'demo-counsel', created_at: at - 3600000 })
    }
    if (historical) {
      for (const [term, value] of [['end_date', end], ['notice_days', '30'], ['auto_renew', 'yes']]) add('lk_terms', { id: `${id}-${term}`, agreement_id: id, key: term, value, citation: JSON.stringify({ source: 'version-text', versionId, quote: term === 'end_date' ? `Term ends on ${end}.` : 'Give 30 days notice before the end date.' }), status: 'confirmed', proposed_by: 'demo-operations', confirmed_by: owner.id, confirmed_at: at - day, reason: 'Fictional demo terms, not verified against a signed original.', created_at: created })
      const deadline = noticeDeadline(end, 30, 'America/New_York'), decision = key === 'atlas' ? 'renegotiate' : null
      add('lk_renewals', { id: `${id}-renewal`, agreement_id: id, end_date: end, notice_days: 30, deadline_date: deadline.date, deadline_at: deadline.at, timezone: 'America/New_York', auto_renew: 1, decision, decided_by: decision ? owner.id : null, decided_at: decision ? at - day : null, decision_reason: decision ? 'Review the annual price increase before renewing.' : null, updated_at: at })
      for (let n = 0; n < 2; n++) add('lk_obligations', { id: `${id}-obligation-${n}`, agreement_id: id, description: n ? 'Review supplier pricing before the renewal window' : 'Complete the quarterly service review', owner_id: n ? owner.id : 'demo-operations', due_date: date(n ? days - 7 : 7 + index), recurrence: n ? 'annually' : 'quarterly', citation: JSON.stringify({ source: 'version-text', versionId, quote: 'Give 30 days notice before the end date.', page: null }), status: 'confirmed', created_by: owner.id, confirmed_by: owner.id, created_at: created })
      if (decision) add('lk_notices', { id: `${id}-notice`, renewal_id: `${id}-renewal`, agreement_id: id, recipient: 'contracts@atlas.example', body: 'We would like to discuss the pricing and service levels for the next term before renewing our freight services agreement.', prepared_by: 'demo-operations', status: 'draft', created_at: at - 3600000 })
    }
  }
  const proposals = [
    { id: 'demo-intake-proposal', kind: 'intake', agreement_id: null, payload: { title: 'Website accessibility review', type: 'customer', party: { name: 'Banksia Health', kind: 'customer' }, value: '12500', templateVersionId: 'demo-template-services-v1', fields: { scope: 'Accessibility review and remediation plan' } }, evidence: ['Fictional project brief: accessibility review, two-week delivery, budget USD 12,500.'] },
    { id: 'demo-terms-proposal', kind: 'terms', agreement_id: 'demo-lumina', payload: { agreementId: 'demo-lumina', terms: [{ key: 'payment_terms', value: 'Net 30', citation: { quote: 'Invoices are payable within 30 days.' } }] }, evidence: ['Fictional Lumina summary, payment clause.'] },
  ]
  for (const p of proposals) add('lk_proposals', { ...p, payload: JSON.stringify(p.payload), evidence: JSON.stringify(p.evidence), assumptions: 'Fictional sample data for exploration; no third-party records were read.', prepared_by: 'demo-agent', prepared_at: at - 7200000, status: 'pending' })
  add('oa_first_run', { singleton: 1, completed_by: owner.id, completed_at: at })
  // Keep each D1 request comfortably below provider parameter limits.
  for (let i = 0; i < writes.length; i += 40) await env.DB.batch(writes.slice(i, i + 40))
  await seedJourneys(env, owner.id, now)
}
