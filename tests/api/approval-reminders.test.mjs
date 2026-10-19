import assert from 'node:assert/strict'
import test from 'node:test'
import { installation } from './harness.mjs'
import { file, pdf } from './files.mjs'

const find = async (client, id) => (await client.state()).agreements.find(a => a.id === id)
const at = iso => Date.parse(iso)
async function inReview(client, title) {
  const created = await client.command('request.create', { title, type: 'nda', value: '72000', party: { name: `${title} counterparty`, kind: 'customer' }, file: file('nda.pdf', pdf(`${title} confidentiality.`)), text: `${title} confidentiality.` })
  const a = await find(client, created.id)
  await client.command('agreement.submit', { agreementId: a.id, version: a.version })
  return find(client, a.id)
}
const ask = (client, a, recipientId) => client.command('approval.email', { agreementId: a.id, version: a.version, versionId: a.current_version_id, recipientId })
const reminders = (h, to, subject = 'Reminder: approval waiting in Locket') => h.mails.filter(m => m.subject === subject && m.to[0] === to)

test('APPROVE-004 reminds the approver after 1 business day then daily in their zone, escalates to the delegate after 3, limits manual reminders to one per 4 hours and stops once approved', async t => {
  const h = await installation(); t.after(() => h.close())
  await h.setTime(at('2026-10-12T14:00:00Z')) // Monday 10:00 ET, 09:00 CT
  const requester = await h.invite('requester@example.test', 'requester')
  const approver = await h.invite('approver@example.test', 'approver')
  const delegate = await h.invite('delegate@example.test', 'approver')
  const viewer = await h.invite('viewer@example.test', 'viewer')
  await requester.command('preferences.set', { operatorId: requester.id, timezone: 'America/Chicago', delegateId: approver.id }, { error: 'INVALID' })
  await approver.command('preferences.set', { operatorId: delegate.id, timezone: 'America/Chicago' }, { error: 'FORBIDDEN' })
  await approver.command('preferences.set', { operatorId: approver.id, timezone: 'America/Chicago', delegateId: viewer.id }, { error: 'INVALID' })
  await approver.command('preferences.set', { operatorId: approver.id, timezone: 'America/Chicago', delegateId: delegate.id })
  const a = await inReview(requester, 'Reminder supply 581')
  await ask(requester, a, approver.id)
  const asked = h.mails.length

  await h.scheduled(at('2026-10-13T13:59:00Z')) // Tuesday 08:59 CT: not yet one business day
  assert.equal(h.mails.length, asked)
  await h.scheduled(at('2026-10-13T14:00:00Z')) // Tuesday 09:00 CT
  await h.scheduled(at('2026-10-13T14:30:00Z')) // an overlapping run sends nothing twice
  assert.equal(reminders(h, 'approver@example.test').length, 1)
  for (const content of [reminders(h, 'approver@example.test')[0].text, reminders(h, 'approver@example.test')[0].html]) {
    assert.ok(content.includes(`${h.origin}/app#agreement/${a.id}/review`))
    assert.ok(!content.includes('Reminder supply 581') && !content.includes('72000') && !content.includes('72,000'))
  }

  await h.setTime(at('2026-10-13T15:00:00Z'))
  await viewer.command('approval.remind', { agreementId: a.id, version: a.version, approverId: approver.id }, { error: 'FORBIDDEN' })
  await requester.command('approval.remind', { agreementId: a.id, version: a.version, approverId: delegate.id }, { error: 'NOT_PENDING' })
  const manual = await requester.command('approval.remind', { agreementId: a.id, version: a.version, approverId: approver.id })
  assert.equal(manual.status, 'queued')
  assert.equal(reminders(h, 'approver@example.test').length, 2)
  await h.setTime(at('2026-10-13T18:59:00Z'))
  const refused = await approver.request('/api/locket/commands', { method: 'POST', body: { commandId: crypto.randomUUID(), type: 'approval.remind', payload: { agreementId: a.id, version: a.version, approverId: approver.id } } })
  assert.equal(refused.status, 429)
  assert.equal((await refused.json()).error.code, 'TOO_SOON')
  assert.equal((await requester.state()).approvalReminders.pending.find(p => p.agreementId === a.id).manualAvailableAt, at('2026-10-13T19:00:00Z'))
  assert.equal(reminders(h, 'approver@example.test').length, 2)

  await h.scheduled(at('2026-10-14T14:00:00Z')) // Wednesday: second daily reminder
  await h.scheduled(at('2026-10-15T13:00:00Z')) // Thursday 08:00 CT: nothing due
  assert.equal(reminders(h, 'approver@example.test').length, 3)
  assert.equal(reminders(h, 'delegate@example.test', 'Escalated approval in Locket').length, 0)
  await h.scheduled(at('2026-10-15T14:00:00Z')) // Thursday 09:00 CT: third reminder and the 3-business-day escalation
  await h.scheduled(at('2026-10-15T15:00:00Z'))
  assert.equal(reminders(h, 'approver@example.test').length, 4)
  const escalated = reminders(h, 'delegate@example.test', 'Escalated approval in Locket')
  assert.equal(escalated.length, 1)
  assert.ok(escalated[0].text.includes('delegate') && !escalated[0].text.includes('Reminder supply 581'))
  await h.scheduled(at('2026-10-17T15:00:00Z')) // Saturday: Friday's reminder was missed, so the latest due one goes out once
  assert.equal(reminders(h, 'approver@example.test').length, 5)
  await h.scheduled(at('2026-10-18T15:00:00Z')) // Sunday: weekends are not business days, so nothing new is due
  await h.scheduled(at('2026-10-19T13:59:00Z')) // Monday 08:59 CT
  assert.equal(reminders(h, 'approver@example.test').length, 5)

  await h.setTime(at('2026-10-19T13:00:00Z'))
  const current = await find(approver, a.id)
  await approver.command('approval.decide', { agreementId: a.id, version: current.version, versionId: current.current_version_id, kind: 'commercial', decision: 'approved' })
  await h.scheduled(at('2026-10-19T14:00:00Z'))
  await h.scheduled(at('2026-10-22T14:00:00Z'))
  assert.equal(reminders(h, 'approver@example.test').length, 5)
  assert.equal(reminders(h, 'delegate@example.test', 'Escalated approval in Locket').length, 1)
  await requester.command('approval.remind', { agreementId: a.id, version: (await find(requester, a.id)).version, approverId: approver.id }, { error: 'STATUS' })

  const s = await requester.state()
  const activity = (await h.owner.state()).audit.filter(e => e.agreement_id === a.id)
  const automatic = activity.filter(e => e.action === 'approval.reminder.accepted' && e.actor_role === 'scheduler')
  assert.deepEqual(automatic.map(e => e.summary.match(/^Reminder (\d+)/)?.[1]).sort(), ['1', '2', '3', '4'])
  assert.ok(automatic.every(e => e.summary.includes('approver (approver): the mail provider accepted it; mailbox delivery is unconfirmed')))
  assert.ok(activity.some(e => e.action === 'approval.remind' && e.actor_id === requester.id))
  assert.ok(activity.some(e => e.action === 'approval.reminder.accepted' && e.actor_id === requester.id && e.summary.startsWith('Manual reminder to approver')))
  assert.ok(activity.some(e => e.action === 'approval.escalation.accepted' && e.summary === "Escalated approver's pending approval to delegate (delegate): the mail provider accepted it; mailbox delivery is unconfirmed."))
  assert.equal(s.approvalReminders.pending.filter(p => p.agreementId === a.id).length, 0)
  assert.equal(s.approvalReminders.sent.filter(r => r.agreement_id === a.id).length, 6)
  assert.ok(!('recipient_email' in s.approvalReminders.sent[0]))
})

test('APPROVE-004 uses the owner-configured intervals, skips US federal holidays, escalates to the escalation contact or else the owner, and computes business days in each approver zone and stops when declined or withdrawn', async t => {
  const h = await installation(); t.after(() => h.close())
  await h.setTime(at('2025-11-25T15:00:00Z')) // Tuesday before Thanksgiving, 10:00 ET
  const requester = await h.invite('requester@example.test', 'requester')
  const approver = await h.invite('approver@example.test', 'approver')
  const contact = await h.invite('contact@example.test', 'approver')
  const pacific = await h.invite('pacific@example.test', 'approver')
  await pacific.command('preferences.set', { operatorId: pacific.id, timezone: 'America/Los_Angeles' })
  await approver.command('approval.reminders.configure', { firstAfterDays: 2, repeatEveryDays: 2, escalateAfterDays: 2 }, { error: 'FORBIDDEN' })
  await h.owner.command('approval.reminders.configure', { firstAfterDays: 2, repeatEveryDays: 2, escalateAfterDays: 2, escalationContactId: contact.id })
  assert.deepEqual((await requester.state()).approvalReminders.settings, { firstAfterDays: 2, repeatEveryDays: 2, escalateAfterDays: 2, escalationContactId: contact.id })
  const declined = await inReview(requester, 'Holiday supply')
  const withdrawn = await inReview(requester, 'Withdrawn supply')
  // A restricted agreement the escalation contact cannot read escalates to the owner instead.
  const created = await requester.command('request.create', { title: 'Private supply', type: 'nda', restricted: true, value: '9100', party: { name: 'Private counterparty', kind: 'customer' }, file: file('nda.pdf', pdf('Private confidentiality.')), text: 'Private confidentiality.' })
  await h.owner.command('access.set', { agreementId: created.id, operatorId: approver.id, grant: 'grant' })
  await requester.command('agreement.submit', { agreementId: created.id, version: (await find(requester, created.id)).version })
  const restricted = await find(requester, created.id)
  for (const a of [declined, withdrawn, restricted]) await ask(requester, a, approver.id)

  // Business days after Tuesday Nov 25: Wed 26, (Thanksgiving Thu 27 skipped), Fri 28.
  await h.scheduled(at('2025-11-27T16:00:00Z'))
  assert.equal(reminders(h, 'approver@example.test').length, 0)
  await h.scheduled(at('2025-11-28T15:00:00Z'))
  assert.equal(reminders(h, 'approver@example.test').length, 3)
  assert.equal(reminders(h, 'contact@example.test', 'Escalated approval in Locket').length, 2)
  assert.equal(reminders(h, 'owner@example.test', 'Escalated approval in Locket').length, 1)
  const audit = (await h.owner.state()).audit
  assert.ok(audit.some(e => e.agreement_id === restricted.id && e.action === 'approval.escalation.accepted' && e.summary.includes('(owner)')))
  assert.ok(audit.some(e => e.agreement_id === declined.id && e.action === 'approval.escalation.accepted' && e.summary.includes('to contact (escalation contact)')))

  await h.setTime(at('2025-11-28T16:00:00Z'))
  const d = await find(approver, declined.id)
  await approver.command('approval.decide', { agreementId: d.id, version: d.version, versionId: d.current_version_id, kind: 'commercial', decision: 'rejected', reason: 'Price too high' })
  const w = await find(requester, withdrawn.id)
  await requester.command('version.upload', { agreementId: w.id, version: w.version, kind: 'counterparty', file: file('new.pdf', pdf('Replaced terms.')), text: 'Replaced terms.' })
  // Sat Nov 29 05:30 UTC is Saturday 00:30 in New York (the default zone) but Friday 21:30 in Los Angeles.
  await h.setTime(at('2025-11-29T05:30:00Z'))
  const zoned = await inReview(requester, 'Zoned supply')
  for (const id of [approver.id, pacific.id]) await ask(requester, zoned, id)
  await h.scheduled(at('2025-12-02T05:30:00Z')) // New York: Saturday + 2 business days = Tuesday 00:30
  assert.equal(reminders(h, 'approver@example.test').length, 4)
  assert.equal(reminders(h, 'pacific@example.test').length, 0)
  await h.scheduled(at('2025-12-02T14:59:00Z'))
  assert.equal(reminders(h, 'approver@example.test').length, 4)
  await h.scheduled(at('2025-12-02T15:00:00Z')) // the next 2-business-day slot: only the still-pending agreement
  assert.equal(reminders(h, 'approver@example.test').length, 5)
  await h.scheduled(at('2025-12-03T05:29:00Z'))
  assert.equal(reminders(h, 'pacific@example.test').length, 0)
  await h.scheduled(at('2025-12-03T05:30:00Z')) // Los Angeles: Friday + 2 business days = Tuesday 21:30
  assert.equal(reminders(h, 'pacific@example.test').length, 1)
  const second = (await h.owner.state()).audit.filter(e => e.action === 'approval.reminder.accepted' && e.summary.startsWith('Reminder 2'))
  assert.deepEqual(second.map(e => e.agreement_id), [restricted.id])
})
