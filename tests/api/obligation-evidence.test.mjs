import assert from 'node:assert/strict'
import test from 'node:test'
import { installation } from './harness.mjs'
import { executed, library, team } from './setup.mjs'
import { file, pdf } from './files.mjs'

const at = iso => Date.parse(iso)
const to = (h, email, subject) => h.mails.filter(m => m.to[0] === email && m.subject === subject)
const quote = 'Payment terms: invoices are payable within 30 days.'

test('OBL-002 evidence before done, overdue owner notice, escalation to the responsible person and approver after the configured days, and risk raised to the counterparty', async t => {
  const h = await installation(); t.after(() => h.close())
  await h.setTime(at('2026-08-03T15:00:00Z'))
  const people = await team(h), lib = await library(h, people)
  const { id } = await executed(h, people, lib, { title: 'Insured supply 5512' })
  const add = async (description, extra) => {
    const o = await people.requester.command('obligation.add', { agreementId: id, description, ownerId: people.requester.id, recurrence: 'none', citation: { quote }, ...extra })
    await people.counsel.command('obligation.update', { agreementId: id, obligationId: o.id, action: 'confirm' })
    return o.id
  }
  await people.counsel.command('deadline.reminders.configure', { offsets: [90, 60, 30, 7], overdueEscalationDays: 3 }, { error: 'FORBIDDEN' })
  await h.owner.command('deadline.reminders.configure', { offsets: [90, 60, 30, 7], overdueEscalationDays: 0 }, { error: 'INVALID' })
  await h.owner.command('deadline.reminders.configure', { offsets: [90, 60, 30, 7], overdueEscalationDays: 3 })
  await people.requester.command('obligation.add', { agreementId: id, description: 'Bad', ownerId: people.requester.id, recurrence: 'none', citation: { quote }, evidence: 'photo' }, { error: 'INVALID' })

  // An insurance obligation needs a certificate: refused without one, done with it.
  const insurance = await add('Provide a certificate of insurance', { evidence: 'file', risk: 'low', dueDate: '2026-12-31' })
  const refused = await people.requester.command('obligation.update', { agreementId: id, obligationId: insurance, action: 'done' }, { error: 'EVIDENCE' })
  assert.equal(refused.error.details.evidence, 'file')
  await people.requester.command('obligation.update', { agreementId: id, obligationId: insurance, action: 'done', note: 'Sent by broker' }, { error: 'EVIDENCE' })
  await people.requester.command('obligation.update', { agreementId: id, obligationId: insurance, action: 'done', file: file('coi.pdf', pdf('Certificate of insurance 2026')) })
  let s = await people.requester.state()
  const done = s.obligations.find(o => o.id === insurance)
  assert.equal(done.status, 'done')
  const certificate = s.artifacts.find(f => f.id === done.evidence_artifact_id)
  assert.deepEqual([certificate.filename, JSON.parse(certificate.provenance).obligationEvidence], ['coi.pdf', insurance])
  // A link-evidence obligation takes only a web link.
  const audit = await add('Publish the annual audit', { evidence: 'link', dueDate: '2026-12-31' })
  await people.requester.command('obligation.update', { agreementId: id, obligationId: audit, action: 'done', link: 'ftp://files.example/audit' }, { error: 'INVALID' })
  await people.requester.command('obligation.update', { agreementId: id, obligationId: audit, action: 'done', link: 'https://files.example/audit-2026.pdf' })
  assert.equal((await people.requester.state()).obligations.find(o => o.id === audit).evidence_link, 'https://files.example/audit-2026.pdf')

  // Two obligations fall due on Monday August 10 (Eastern); one is done late, the other stays open.
  const report = await add('Deliver the quarterly security report', { dueDate: '2026-08-10', risk: 'medium' })
  const training = await add('Complete onboarding training', { dueDate: '2026-08-10', risk: 'low' })
  const party = s.agreements.find(a => a.id === id).party_id
  s = await people.requester.state()
  assert.deepEqual(s.risk.parties[party], { risk: 'medium', overdue: 0 })

  const overdue = () => to(h, 'requester@example.test', 'Overdue obligation in Locket')
  await h.scheduled(at('2026-08-11T12:59:00Z'))
  assert.equal(overdue().length, 0)
  await h.scheduled(at('2026-08-11T13:00:00Z'))
  await h.scheduled(at('2026-08-11T13:30:00Z'))
  assert.equal(overdue().length, 2) // one per overdue obligation, once each
  for (const mail of overdue()) {
    assert.ok(mail.text.includes('An obligation is 1 day overdue') && mail.text.includes(`${h.origin}/app#agreement/${id}/terms`))
    assert.ok(!mail.text.includes('security report') && !mail.text.includes('Insured supply'))
  }
  await h.setTime(at('2026-08-12T14:00:00Z'))
  s = await h.owner.state()
  assert.deepEqual(s.risk.obligations[report], { rated: 'medium', risk: 'high', overdue: true })
  assert.deepEqual(s.risk.agreements[id], { risk: 'high', overdue: 2 })
  assert.deepEqual(s.risk.parties[party], { risk: 'high', overdue: 2 })
  await h.owner.command('obligation.update', { agreementId: id, obligationId: training, action: 'done' })

  // Three days after the owner's notice the responsible person and the approver are told; the training, done, is not escalated.
  const escalated = email => to(h, email, 'Escalated overdue obligation in Locket')
  await h.scheduled(at('2026-08-14T12:59:00Z'))
  assert.equal(escalated('approver@example.test').length, 0)
  await h.scheduled(at('2026-08-14T13:00:00Z'))
  await h.scheduled(at('2026-08-14T14:00:00Z'))
  assert.equal(escalated('approver@example.test').length, 1)
  assert.equal(escalated('requester@example.test').length, 1)
  assert.ok(escalated('approver@example.test')[0].text.includes("4 days overdue and not marked done. You receive this as the agreement's approver."))
  s = await h.owner.state()
  const rows = s.deadlineReminders.sent.filter(r => r.subject_id === report)
  assert.deepEqual(rows.map(r => [r.kind, r.offset_days, r.recipient_reason, r.status]).sort(), [['escalation', -4, 'approver', 'accepted'], ['escalation', -4, 'responsible person', 'accepted'], ['reminder', -1, 'obligation owner', 'accepted']])
  assert.ok(s.audit.some(a => a.agreement_id === id && a.summary.startsWith('Escalated the obligation 4 days overdue to')))
  assert.equal(s.deadlineReminders.overdueEscalationDays, 3)
})
