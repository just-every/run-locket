// Brightline Health's MSA + Order Form, the deal the demo opens on: their paper
// (v1), Fieldstone's redlines (v2) and their markup (v3), the agent's review of
// v3 against playbook v7, Marcus's commercial approval and comment, and Priya's
// rejection of the exclusivity clause. The days fall on last week's weekdays in
// Eastern time, so the story keeps its Monday-to-Friday shape on any demo day.
import { addDays, zonedInstant } from '../locket/dates'
import { DOCX } from '../locket/artifacts'
import { canonical, sha256 } from '../locket/model'
import { versionDigest } from '../locket/records'
import { msaText, playbookRules, v3Findings } from './brightline-msa'
import { textDocx } from './docx'

type Add = (table: string, row: Record<string, unknown>) => void
const ZONE = 'America/New_York'

/** Last week's Monday in Eastern time, and the first Friday after today: the deal's close date. */
export function storyWeek(now: Date) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const weekday = new Date(today + 'T12:00:00Z').getUTCDay() || 7
  const monday = addDays(today, 1 - weekday - 7)
  return {
    at: (offset: number, time: string) => zonedInstant(addDays(monday, offset), `${time}:00`, ZONE),
    closeDate: addDays(today, ((5 - weekday + 7) % 7) || 7),
  }
}

export async function seedBrightline(add: Add, ownerId: string, now: Date) {
  const { at, closeDate } = storyWeek(now)
  const id = 'demo-brightline', partyId = `${id}-party`
  const turns = [
    { n: 1, kind: 'counterparty', label: 'Their paper', file: 'Brightline_MSA.docx', by: ownerId, on: at(0, '10:20') },
    { n: 2, kind: 'upload', label: 'Ours', file: 'Brightline_MSA_v2_Fieldstone.docx', by: ownerId, on: at(1, '11:40') },
    { n: 3, kind: 'counterparty', label: 'Theirs', file: 'Brightline_MSA_v3.docx', by: ownerId, on: at(3, '17:40') },
  ] as const
  add('lk_parties', { id: partyId, name: 'Brightline Health', kind: 'customer', email: 'legal@brightline.example', created_by: 'demo-operations', created_at: at(0, '10:12') })
  add('lk_agreements', { id, reference: 'LKT-2291', title: 'MSA + Order Form', type: 'customer', party_id: partyId, value_cents: 18_600_000, currency: 'USD', owner_id: ownerId, requester_id: 'demo-operations', status: 'in_review', restricted: 0, needed_by: closeDate, start_date: '2026-11-01', timezone: ZONE, origin: 'intake', current_version_id: `${id}-v3`, created_at: at(0, '10:12'), updated_at: at(4, '10:41') })
  const versions: Record<number, { id: string; digest: string; text: string }> = {}
  for (const t of turns) {
    const text = msaText(t.n), bytes = textDocx(text), hash = await sha256(bytes), versionId = `${id}-v${t.n}`
    const digest = await versionDigest({ agreementId: id, number: t.n, files: [{ role: 'original', sha256: hash }], text, fields: null })
    versions[t.n] = { id: versionId, digest, text }
    add('lk_versions', { id: versionId, agreement_id: id, number: t.n, kind: t.kind, label: t.label, template_version_id: null, fields: null, text, text_source: 'docx', digest, created_by: t.by, created_at: t.on })
    add('lk_artifacts', { id: `${versionId}-docx`, agreement_id: id, version_id: versionId, role: 'original', filename: t.file, media_type: DOCX, size: bytes.length, sha256: hash, provenance: JSON.stringify({ uploadedAs: t.kind, label: t.label, source: 'fictional-demo' }), imported: 0, uploaded_by: t.by, uploaded_at: t.on })
    add('lk_artifact_chunks', { artifact_id: `${versionId}-docx`, ordinal: 0, bytes: [...bytes] })
    add('lk_audit', { id: `${versionId}-audit`, at: t.on, actor_id: t.by, actor_name: 'Priya Raman', actor_role: 'owner', action: 'version.add', agreement_id: id, summary: `Added version ${t.n} (${t.kind})` })
  }
  add('lk_audit', { id: `${id}-request`, at: at(0, '10:12'), actor_id: 'demo-operations', actor_name: 'Jenna Hart', actor_role: 'requester', action: 'request.create', agreement_id: id, summary: 'Request from HubSpot deal: Brightline Health · MSA + Order Form · $186,000' })

  // The agent's review of v3: one cited finding per rule, approved by Priya the next morning.
  const v3 = versions[3], proposalId = `${id}-review`
  const findings = playbookRules.map(rule => {
    const line = v3.text.split('\n').find(l => l.startsWith(`${rule.clause} `))!
    const quote = line.slice(rule.clause.length + 1), start = v3.text.indexOf(line) + rule.clause.length + 1
    const read = v3Findings[rule.key] ?? { result: 'met' as const, explanation: `Matches rule ${rule.key}.` }
    return { rule, clauseKey: rule.key, result: read.result, start, end: start + quote.length, quote, proposedWording: read.proposedWording, explanation: read.explanation, questions: [] as string[] }
  })
  const met = findings.filter(f => f.result === 'met').length
  add('lk_proposals', { id: proposalId, kind: 'review', agreement_id: id, payload: JSON.stringify({ agreementId: id, versionId: v3.id, findings: findings.map(({ rule, ...f }) => f) }), evidence: JSON.stringify([`Brightline_MSA_v3.docx read against Customer MSA playbook v7: ${met} of ${findings.length} rules met.`]), assumptions: '', prepared_by: 'demo-agent', prepared_at: at(3, '17:44'), status: 'approved', decided_by: ownerId, decided_at: at(4, '09:02'), decision_reason: null, outcome: JSON.stringify({ deviations: findings.map(f => `${id}-finding-${f.clauseKey}`) }) })
  for (const f of findings)
    add('lk_deviations', { id: `${id}-finding-${f.clauseKey}`, agreement_id: id, version_id: v3.id, playbook_version_id: 'demo-playbook', clause_key: f.clauseKey, result: f.result, start_offset: f.start, end_offset: f.end, quote: f.quote, proposed_wording: f.proposedWording ?? null, explanation: f.explanation, questions: '[]', authority: f.rule.authority, proposal_id: proposalId, created_by: ownerId, created_at: at(4, '09:02') })

  // Decisions on v3, each pinned to its digest and the open findings.
  const open = findings.filter(f => f.result !== 'met').map(f => ({ id: `${id}-finding-${f.clauseKey}`, result: f.result })).sort((a, b) => a.id.localeCompare(b.id))
  const context = { versionDigest: v3.digest, valueCents: 18_600_000, partyId, deviations: open }
  const contextDigest = await sha256(canonical(context))
  const decisions = [
    { key: 'commercial', kind: 'commercial', deviation: null, actor: 'demo-commercial', role: 'approver', name: 'Marcus Lee', reason: 'Fine on Net 45.', on: at(4, '10:14') },
    { key: 'exclusivity', kind: 'exception', deviation: `${id}-finding-C-4`, actor: ownerId, role: 'owner', name: 'Priya Raman', reason: 'No exclusivity; send back in v4.', on: at(4, '10:41') },
  ]
  for (const d of decisions) {
    add('lk_approvals', { id: `${id}-approval-${d.key}`, agreement_id: id, version_id: v3.id, version_digest: v3.digest, kind: d.kind, deviation_id: d.deviation, decision: d.kind === 'commercial' ? 'approved' : 'rejected', actor_id: d.actor, actor_role: d.role, context: JSON.stringify(context), context_digest: contextDigest, reason: d.reason, at: d.on })
    add('lk_audit', { id: `${id}-audit-${d.key}`, at: d.on, actor_id: d.actor, actor_name: d.name, actor_role: d.role, action: d.kind === 'commercial' ? 'approval.approved' : 'approval.rejected', agreement_id: id, summary: d.kind === 'commercial' ? 'Commercial approval approved on v3' : 'Counsel exception: C-4 (rule breached) rejected on v3' })
  }

  // Internal comments on v3, each quoting the passage it is about.
  const passage = (clause: string) => v3.text.split('\n').find(l => l.startsWith(`${clause} `))!.slice(clause.length + 1)
  const comments = [
    { key: 'cap', author: 'demo-commercial', body: 'Hold the cap, fine on Net 45.', quote: "each party's total liability under this Agreement is unlimited", on: at(4, '10:12') },
    { key: 'law', author: 'demo-operations', body: 'Delaware works for Brightline; Rachel Kim confirmed it on the deal call.', quote: passage('14.1'), on: at(4, '09:31') },
    { key: 'assign', author: ownerId, body: 'Fine as long as consent stays in writing.', quote: passage('15.2'), on: at(4, '09:48') },
    { key: 'soc2', author: 'demo-supply', body: 'Same successors wording we signed with Summit Ridge; fine.', quote: passage('15.1'), on: at(4, '09:55') },
  ]
  for (const c of comments) add('lk_comments', { id: `${id}-comment-${c.key}`, agreement_id: id, version_id: v3.id, author_id: c.author, body: c.body, quote: c.quote, at: c.on })
}
