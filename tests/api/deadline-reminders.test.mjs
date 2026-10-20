import assert from 'node:assert/strict'
import test from 'node:test'
import { installation } from './harness.mjs'
import { executed, library, team } from './setup.mjs'
import { file, pdf } from './files.mjs'
import { postEvent, signedEvent, webhookKey } from './notice-fixture.mjs'

const at = iso => Date.parse(iso)
const to = (h, email, subject) => h.mails.filter(m => m.to[0] === email && (!subject || m.subject === subject))
const stamped = iso => ({ timestamp: Math.floor(at(iso) / 1000), createdAt: iso })
const archive = async h => (await (await h.owner.request('/api/locket/export')).json()).records
async function confirm(client, agreementId, terms, quote) {
  for (const [key, value] of terms) {
    const t = await client.command('term.propose', { agreementId, key, value, citation: { quote } })
    await client.command('term.decide', { agreementId, termId: t.id, decision: 'confirm' })
  }
}

test('RENEW-002 emails the four reminders at 9:00 Chicago time, escalates an undecided renewal at 30 days to its approver and the owner, and retries a bounced reminder to the alternate recipient', async t => {
  const key = webhookKey()
  const h = await installation({ bindings: { NOTICE_RESEND_WEBHOOK_SECRET: key } }); t.after(() => h.close())
  await h.setTime(at('2026-07-10T15:00:00Z'))
  const people = await team(h), lib = await library(h, people)
  const { id } = await executed(h, people, lib, { title: 'Chicago supply 4471', timezone: 'America/Chicago' })
  await people.requester.command('preferences.set', { operatorId: people.requester.id, timezone: 'America/Chicago', alternateId: people.counsel.id })
  await confirm(h.owner, id, [['end_date', '2026-12-31'], ['notice_days', '60']], 'Payment terms: invoices are payable within 30 days.')
  const renewal = (await h.owner.state()).renewals.find(r => r.agreement_id === id)
  assert.equal(renewal.deadline_date, '2026-11-01')
  const reminders = () => to(h, 'requester@example.test', 'Renewal notice deadline in Locket')

  // 90, 60, 30 and 7 days before Nov 1 at 9:00 CDT (14:00 UTC); a run a minute early sends nothing.
  for (const [day, count] of [['2026-08-03', 1], ['2026-09-02', 2], ['2026-10-02', 3], ['2026-10-25', 4]]) {
    await h.scheduled(at(`${day}T13:59:00Z`))
    assert.equal(reminders().length, count - 1, `${day} before 9:00`)
    await h.scheduled(at(`${day}T14:00:00Z`))
    await h.scheduled(at(`${day}T14:30:00Z`))
    assert.equal(reminders().length, count, `${day} at 9:00`)
    if (day === '2026-10-02') {
      // No decision by the 30-day reminder: the approver who approved it and the owner are told once.
      assert.equal(to(h, 'approver@example.test', 'Escalated renewal deadline in Locket').length, 1)
      assert.equal(to(h, 'owner@example.test', 'Escalated renewal deadline in Locket').length, 1)
      const thirty = (await archive(h)).lk_deadline_reminders.find(r => r.kind === 'reminder' && r.offset_days === 30)
      await h.setTime(at('2026-10-02T15:00:00Z'))
      const bounce = signedEvent(key, thirty.provider_message_id, { type: 'email.bounced', to: 'requester@example.test', ...stamped('2026-10-02T15:00:00Z') })
      assert.equal((await postEvent(h, bounce)).status, 200)
      assert.equal((await postEvent(h, bounce)).status, 200) // an identical provider retry changes nothing
      assert.equal(to(h, 'counsel@example.test', 'Renewal notice deadline in Locket').length, 1)
      assert.ok(to(h, 'counsel@example.test', 'Renewal notice deadline in Locket')[0].text.includes('alternate recipient'))
      assert.equal((await postEvent(h, signedEvent(key, thirty.provider_message_id, { type: 'email.bounced', to: 'someone@example.test', ...stamped('2026-10-02T15:00:00Z') }))).status, 409)
    }
  }
  for (const mail of [...reminders(), ...to(h, 'owner@example.test', 'Escalated renewal deadline in Locket')]) {
    assert.ok(!mail.text.includes('Chicago supply 4471') && !mail.text.includes('Harbour') && !mail.text.includes('48,000') && !mail.text.includes('48000'))
    assert.ok(mail.text.includes(`${h.origin}/app#renewals`))
  }
  const s = await h.owner.state()
  const sent = s.deadlineReminders.sent.filter(r => r.agreement_id === id)
  assert.deepEqual(sent.filter(r => r.kind === 'reminder').map(r => [r.offset_days, r.status, new Date(r.due_at).toISOString()]).sort((a, b) => b[0] - a[0]),
    [[90, 'accepted', '2026-08-03T14:00:00.000Z'], [60, 'accepted', '2026-09-02T14:00:00.000Z'], [30, 'accepted', '2026-10-02T14:00:00.000Z'], [7, 'accepted', '2026-10-25T14:00:00.000Z']])
  const thirty = sent.find(r => r.kind === 'reminder' && r.offset_days === 30)
  assert.deepEqual(s.deadlineReminders.events.filter(e => e.reminder_id === thirty.id).map(e => e.status), ['bounced'])
  assert.deepEqual(sent.filter(r => r.kind === 'alternate').map(r => [r.retry_of, r.recipient_id, r.recipient_reason, r.status]), [[thirty.id, people.counsel.id, 'alternate recipient', 'accepted']])
  assert.deepEqual(sent.filter(r => r.kind === 'escalation').map(r => r.recipient_reason).sort(), ['approver', 'owner'])
  const records = await archive(h)
  assert.ok(records.lk_deadline_reminders.filter(r => r.agreement_id === id && r.status === 'accepted').every(r => r.provider_message_id))
  const activity = s.audit.filter(e => e.agreement_id === id)
  assert.equal(activity.filter(e => e.action === 'deadline.reminder.accepted' && e.actor_role === 'scheduler').length, 4)
  assert.equal(activity.filter(e => e.action === 'deadline.escalation.accepted').length, 2)
  assert.ok(activity.some(e => e.action === 'deadline.delivery' && e.summary === 'Provider reported a deadline reminder bounced.'))
  assert.ok(activity.some(e => e.action === 'deadline.alternate.accepted' && e.summary.includes('to counsel (alternate recipient): the mail provider accepted it; mailbox delivery is unconfirmed')))
  // The responsible person's view never carries recipient addresses.
  assert.ok(!('recipient_email' in sent[0]))
})

test('RENEW-002 / NOTIFY-001 uses the owner-configured offsets, reminds obligation owners in their own zone, batches a daily digest, stops once a renewal is decided and records complaints', async t => {
  const key = webhookKey()
  const h = await installation({ bindings: { NOTICE_RESEND_WEBHOOK_SECRET: key } }); t.after(() => h.close())
  await h.setTime(at('2026-07-10T15:00:00Z'))
  const rhea = await h.invite('rhea@example.test', 'requester'), approver = await h.invite('approver@example.test', 'approver'), agent = await h.invite('agent@example.test', 'agent')
  await approver.command('deadline.reminders.configure', { offsets: [14, 3] }, { error: 'FORBIDDEN' })
  await h.owner.command('deadline.reminders.configure', { offsets: [3, 14] })
  assert.deepEqual((await rhea.state()).deadlineReminders.offsets, [14, 3])
  await agent.command('preferences.set', { operatorId: agent.id, timezone: 'America/Chicago' }, { error: 'FORBIDDEN' })
  await rhea.command('preferences.set', { operatorId: approver.id, timezone: 'America/Chicago' }, { error: 'FORBIDDEN' })
  await rhea.command('preferences.set', { operatorId: rhea.id, timezone: 'America/Los_Angeles', digest: true })
  const imported = async (title, text) => h.owner.command('legacy.import', { title, type: 'supplier', ownerId: rhea.id, party: { name: `${title} supplier`, kind: 'supplier' }, sourceSystem: 'Archive', sourceId: crypto.randomUUID(), file: file('signed.pdf', pdf(text)), text, signed: true })
  const a = await imported('Insurance supply', 'Supplier keeps insurance certificates current. Renewal is due August 1.')
  const b = await imported('Courier supply', 'The agreement ends September 30. Give 30 days notice.')
  const ob = await h.owner.command('obligation.add', { agreementId: a.id, description: 'Collect the insurance certificate', ownerId: rhea.id, dueDate: '2026-08-01', recurrence: 'none', citation: { quote: 'Supplier keeps insurance certificates current.' } })
  await h.owner.command('obligation.update', { agreementId: a.id, obligationId: ob.id, action: 'confirm' })
  await confirm(h.owner, b.id, [['end_date', '2026-09-30'], ['notice_days', '30']], 'Give 30 days notice.')
  const digests = () => to(h, 'rhea@example.test').filter(m => m.subject === 'Your daily Locket notifications')

  // The obligation's 14-day reminder is due Jul 18 at 9:00 in Los Angeles (16:00 UTC), in Rhea's digest.
  await h.scheduled(at('2026-07-18T15:59:00Z'))
  assert.equal(digests().length, 0)
  await h.scheduled(at('2026-07-18T16:00:00Z'))
  await h.scheduled(at('2026-07-18T17:00:00Z'))
  assert.equal(digests().length, 1)
  assert.ok(digests()[0].text.includes(`${h.origin}/app#agreement/${a.id}/terms`))
  assert.ok((await rhea.state()).notifications.items.some(n=>n.kind==='deadline' && n.agreement_id===a.id && n.email_status==='accepted'))
  assert.ok(!digests()[0].text.includes('insurance'))
  assert.equal(to(h, 'rhea@example.test', 'Obligation due in Locket').length, 0)

  // Both deadlines' reminders on the same morning share one digest.
  await h.owner.command('deadline.reminders.configure', { offsets: [14, 3, 1] })
  const renewal = (await h.owner.state()).renewals.find(r => r.agreement_id === b.id)
  assert.equal(renewal.deadline_date, '2026-08-31')
  await h.scheduled(at('2026-07-31T16:00:00Z')) // obligation 1 day; renewal not yet due
  await h.scheduled(at('2026-08-17T16:00:00Z')) // renewal 14 days
  assert.equal(digests().length, 3)
  let s = await h.owner.state()
  const inDigest = s.deadlineReminders.sent.filter(r => r.status === 'in_digest')
  assert.deepEqual(inDigest.map(r => [r.subject_id, r.offset_days]).sort(), [[ob.id, 1], [ob.id, 14], [ob.id, -4], [renewal.id, 14]].sort())
  assert.ok(inDigest.every(r => s.deadlineReminders.sent.find(d => d.id === r.digest_id).status === 'accepted'))

  await h.setTime(at('2026-08-18T15:00:00Z'))
  await h.owner.command('renewal.decide', { renewalId: renewal.id, decision: 'renew', reason: 'Keep the courier.' })
  await h.scheduled(at('2026-08-28T16:00:00Z')) // the 3-day slot: decided, so nothing
  await h.scheduled(at('2026-08-31T16:00:00Z'))
  assert.equal(digests().length, 3)

  const digest = (await archive(h)).lk_deadline_reminders.find(r => r.kind === 'digest' && r.status === 'accepted')
  await h.setTime(at('2026-08-31T17:00:00Z'))
  assert.equal((await postEvent(h, signedEvent(key, digest.provider_message_id, { type: 'email.complained', to: 'rhea@example.test', ...stamped('2026-08-31T17:00:00Z') }))).status, 200)
  s = await h.owner.state()
  assert.deepEqual(s.deadlineReminders.events.filter(e => e.reminder_id === digest.id).map(e => e.status), ['complained'])
  assert.equal(s.deadlineReminders.sent.filter(r => r.kind === 'alternate').length, 0)
  assert.ok(s.audit.some(e => e.action === 'deadline.digest.accepted' && e.command_id === digest.id))
})
