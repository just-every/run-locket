import assert from 'node:assert/strict'
import test from 'node:test'
import { installation } from './harness.mjs'
import { executed, library, team } from './setup.mjs'
import { file, pdf } from './files.mjs'
import {remediationFixture,certificate} from './remediation-fixture.mjs'
import { obligationLifecycleJourney } from './obligation-lifecycle-journey.mjs'
import {erasureRequest,erasureConfirmation} from './erasure-fixture.mjs'

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
  await obligationLifecycleJourney(h)
})

test('AGENT-008 owner approves exact requests and finite chases, rejects insufficient insurance and completes only with matching original evidence',async t=>{
 const h=await installation({bindings:{POSTMARK_INBOUND_SECRET:'synthetic-locket-81',POSTMARK_REPLY_DOMAIN:'replies.example.test'}});t.after(()=>h.close())
 const {a,o,requirement}=await remediationFixture(h)
 await h.owner.command('obligation.update',{agreementId:a.id,obligationId:o.id,action:'done',file:file('bypass.pdf',certificate('1000000'))},{error:'REMEDIATION_REQUIRED'})
 const request=await h.owner.command('remediation.prepare',{requirementId:requirement.id,target:'supplier',recipient:'broker@example.test',occurrences:[{sendAt:at('2026-08-04T15:00:00Z'),subject:'Please replace expired insurance',message:'Please send current USD 2M coverage naming Harbor Couriers.'},{sendAt:at('2026-08-05T15:00:00Z'),subject:'Insurance chase',message:'Following up on the approved request for current USD 2M insurance.'}]})
 await h.scheduled(at('2026-08-04T15:00:00Z'))
 assert.equal(to(h,'broker@example.test','Please replace expired insurance').length,0)
 const other=await h.invite('other-remediator@example.test','requester')
 await other.command('remediation.approve',{requestId:request.id,digest:request.digest,consent:true},{error:'FORBIDDEN'})
 await h.owner.command('remediation.approve',{requestId:request.id,digest:'unreviewed',consent:true},{error:'APPROVAL'})
 await h.owner.command('remediation.approve',{requestId:request.id,digest:request.digest,consent:true})
 await h.scheduled(at('2026-08-04T15:00:00Z'));await h.scheduled(at('2026-08-04T16:00:00Z'))
 assert.equal(to(h,'broker@example.test','Please replace expired insurance').length,1)
 await h.scheduled(at('2026-08-05T15:00:00Z'));await h.scheduled(at('2026-08-05T16:00:00Z'))
 assert.equal(to(h,'broker@example.test','Insurance chase').length,1)
 const insufficient=await h.owner.command('remediation.evidence',{requirementId:requirement.id,file:file('insufficient.pdf',certificate('1000000'))})
 assert.equal(insufficient.status,'rejected');assert.match(insufficient.assessment.reasons.join(' '),/Coverage is below/)
 assert.equal(insufficient.assessment.fields.coverageCents.page,1)
 for(const [label,content]of [['wrong-insured',certificate('2000000',{insured:'Another Insured'})],['late-start',certificate('2000000',{validFrom:'2026-09-01'})],['expired',certificate('2000000',{validThrough:'2026-07-31'})]]){
  const proof=await h.owner.command('remediation.evidence',{requirementId:requirement.id,file:file(label+'.pdf',content)})
  assert.equal(proof.status,'rejected',label)
 }
 assert.equal((await h.owner.state()).obligations.find(x=>x.id===o.id).status,'confirmed')
 await h.owner.command('remediation.confirm',{evidenceId:insufficient.id,values:{coverageCents:200000000},reason:'Waive the shortfall'},{error:'EVIDENCE'})
 const compliantBytes=certificate('2000000')
 const compliant=await h.owner.command('remediation.evidence',{requirementId:requirement.id,file:file('compliant.pdf',compliantBytes)})
 assert.equal(compliant.status,'needs_confirmation')
 assert.equal((await h.owner.state()).obligations.find(x=>x.id===o.id).status,'confirmed','matching text alone never verifies a certificate issuer')
 await h.owner.command('remediation.confirm',{evidenceId:compliant.id,values:{original:true},reason:'Reviewed the original issuer, conditions and coverage on page 1; certificate satisfies the signed requirement.'})
 const state=await h.owner.state(),done=state.obligations.find(x=>x.id===o.id)
 assert.equal(done.status,'done');assert.equal(done.evidence_artifact_id,compliant.artifactId)
 const original=await h.owner.request(`/api/locket/files/${compliant.artifactId}`)
 assert.deepEqual(Buffer.from(await original.arrayBuffer()),Buffer.from(compliantBytes))
 const archive=await(await h.owner.request('/api/locket/export')).json()
 assert.ok(archive.records.lk_remediation_evidence.some(x=>x.id===insufficient.id))
})

test('AGENT-008 uncertain installation mail is attempted once and the owner can withdraw future chases without waiving the obligation',async t=>{
 const h=await installation({bindings:{POSTMARK_INBOUND_SECRET:'synthetic-locket-81',POSTMARK_REPLY_DOMAIN:'replies.example.test'},mailResponse:mail=>mail.subject==='Request outcome unknown'?new Response('Unknown provider outcome',{status:503}):Response.json({id:'synthetic-locket-41'})});t.after(()=>h.close())
 const {o,requirement}=await remediationFixture(h)
 const drafted=await h.owner.command('remediation.prepare',{requirementId:requirement.id,target:'supplier',draftFromRequirement:true,occurrences:[{sendAt:at('2026-08-04T15:00:00Z')}]})
 let state=await h.owner.state(),item=state.remediation.occurrences.find(row=>row.request_id===drafted.id)
 assert.ok(item.message_text.includes('2000000.00')&&item.message_text.includes('Harbor Couriers'));assert.equal(state.remediation.requests.find(row=>row.id===drafted.id).recipient,'broker@example.test')
 await h.owner.command('remediation.approve',{requestId:drafted.id,digest:drafted.digest,consent:true})
 await h.owner.command('remediation.cancel',{requestId:drafted.id,reason:'Wait for counsel to approve revised chase timing.'})
 const pending=await h.owner.command('remediation.prepare',{requirementId:requirement.id,target:'supplier',recipient:'broker@example.test',occurrences:[{sendAt:at('2026-08-04T15:00:00Z'),subject:'Request outcome unknown',message:'Please provide the required original insurance certificate.'}]})
 await h.owner.command('remediation.approve',{requestId:pending.id,digest:pending.digest,consent:true})
 await h.setTime(at('2026-08-04T15:00:00Z'))
 state=await h.owner.state();item=state.remediation.occurrences.find(row=>row.request_id===pending.id)
 const commandId=crypto.randomUUID(),payload={requestId:pending.id,occurrenceId:item.id,digest:pending.digest,consent:true}
 const sent=await h.owner.command('remediation.send',payload,{commandId})
 assert.deepEqual(await h.owner.command('remediation.send',payload,{commandId}),sent)
 await h.scheduled(at('2026-08-04T16:00:00Z'))
 state=await h.owner.state();assert.equal(state.remediation.occurrences.find(row=>row.id===item.id).status,'uncertain')
 assert.equal(to(h,'broker@example.test','Request outcome unknown').length,1)
 assert.equal(state.remediation.occurrences.find(row=>row.request_id===drafted.id).status,'cancelled')
 assert.equal(state.obligations.find(row=>row.id===o.id).status,'confirmed')
})

test('AGENT-008 unreadable fields need human review and revoked contact approval cannot send',async t=>{
 const h=await installation({bindings:{POSTMARK_INBOUND_SECRET:'synthetic-locket-81',POSTMARK_REPLY_DOMAIN:'replies.example.test'}});t.after(()=>h.close())
 const {a,o,requirement}=await remediationFixture(h)
 const returned=await h.owner.command('remediation.evidence',{requirementId:requirement.id,file:file('manual-review.pdf',pdf('Scanned certificate requires original document review'))})
 assert.equal(returned.status,'needs_confirmation')
 await h.owner.command('remediation.confirm',{evidenceId:returned.id,values:{coverageCents:100000000,insured:'Harbor Couriers',validFrom:'2026-08-01',validThrough:'2027-08-01'},reason:'Original reviewed'},{error:'EVIDENCE'})
 assert.equal((await h.owner.state()).obligations.find(x=>x.id===o.id).status,'confirmed')
 const request=await h.owner.command('remediation.prepare',{requirementId:requirement.id,target:'supplier',recipient:'broker@example.test',occurrences:[{sendAt:at('2026-08-04T15:00:00Z'),subject:'Replace insurance',message:'Please supply compliant insurance.'}]})
 await h.owner.command('remediation.approve',{requestId:request.id,digest:request.digest,consent:true})
 const preview=await h.owner.command('person.erase.preview',{...erasureRequest('broker@example.test'),receivedOn:'2026-08-03'})
 await h.owner.command('person.erase',erasureConfirmation(preview,'broker@example.test',[]))
 const archive=await(await h.owner.request('/api/locket/export')).json()
 assert.ok(!archive.records.lk_remediation_requests.some(row=>row.recipient==='broker@example.test'),'mutable request recipients follow the installation erasure rule')
 await h.scheduled(at('2026-08-04T15:00:00Z'))
 assert.equal(to(h,'broker@example.test','Replace insurance').length,0)
 assert.equal((await h.owner.state()).remediation.occurrences.filter(x=>x.request_id===request.id).length,0,'erasure removes pending schedules rather than retaining mutable copies')
})


test('AGENT-008 recipient replies and opt-outs stop every future chase; legal hold retains erased schedules without authorizing mail',async t=>{
 const bindings={POSTMARK_INBOUND_SECRET:'synthetic-locket-81',POSTMARK_REPLY_DOMAIN:'replies.example.test'},h=await installation({bindings});t.after(()=>h.close())
 const {a,o,requirement}=await remediationFixture(h)
 const prepare=async()=>{
  const r=await h.owner.command('remediation.prepare',{requirementId:requirement.id,target:'supplier',recipient:'broker@example.test',draftFromRequirement:true,occurrences:[{sendAt:at('2026-08-04T15:00:00Z')},{sendAt:at('2026-08-05T15:00:00Z')},{sendAt:at('2026-08-06T15:00:00Z')}]})
  await h.owner.command('remediation.approve',{requestId:r.id,digest:r.digest,consent:true});return r
 }
 await h.owner.command('remediation.prepare',{requirementId:requirement.id,target:'supplier',recipient:'not-on-record@example.test',draftFromRequirement:true,occurrences:[{sendAt:at('2026-08-04T15:00:00Z')}]},{error:'RECIPIENT'})
 const r=await prepare(),body={OriginalRecipient:`remediation+${r.id}@replies.example.test`,From:'broker@example.test',MessageID:'synthetic-locket-82'}
 assert.equal((await h.request('/api/locket/remediation/inbound',{method:'POST',body})).status,401)
 assert.equal((await h.request('/api/locket/remediation/inbound',{method:'POST',headers:{authorization:'Bearer synthetic-locket-81'},body:{...body,From:'outsider@example.test'}})).status,403)
 await h.scheduled(at('2026-08-04T15:00:00Z'))
 const sent=h.mails.filter(m=>m.to.includes('broker@example.test'));assert.equal(sent.length,1);assert.equal(sent[0].reply_to??sent[0].replyTo,body.OriginalRecipient)
 for(let n=0;n<2;n++)assert.equal((await h.request('/api/locket/remediation/inbound',{method:'POST',headers:{authorization:'Bearer synthetic-locket-81'},body})).status,200)
 await h.scheduled(at('2026-08-07T15:00:00Z'))
 assert.equal(h.mails.filter(m=>m.to.includes('broker@example.test')).length,1)
 let state=await h.owner.state();assert.equal(state.remediation.requests.find(x=>x.id===r.id).stop_kind,'recipient_reply');assert.equal(state.remediation.occurrences.filter(x=>x.request_id===r.id&&x.status==='cancelled').length,2)
 // Restart at the fixture time through its public clock and sign-in door.
 await h.setTime(at('2026-08-03T15:00:00Z'));Object.assign(h.owner,await h.signIn('owner@example.test'))
 const optout=await prepare()
 assert.equal((await h.request('/api/locket/remediation/inbound',{method:'POST',headers:{authorization:'Bearer synthetic-locket-81'},body:{...body,OriginalRecipient:`remediation+${optout.id}@replies.example.test`,MessageID:'synthetic-locket-83',OptOut:true}})).status,200)
 const held=await prepare();state=await h.owner.state();const agreement=state.agreements.find(x=>x.id===a.id)
 await h.owner.command('hold.set',{agreementId:a.id,version:agreement.version,active:true,holdVersion:0,reviewOn:'2026-09-01',reason:'Preserve original requests for the dispute.'})
 const preview=await h.owner.command('person.erase.preview',{...erasureRequest('broker@example.test'),receivedOn:'2026-08-03'})
 assert.ok(preview.retained.some(x=>x.table==='lk_remediation_requests'&&x.id===held.id&&x.reason==='legal_hold'))
 await h.owner.command('person.erase',erasureConfirmation(preview,'broker@example.test',[]))
 state=await h.owner.state();assert.equal(state.remediation.requests.find(x=>x.id===held.id).recipient,'broker@example.test');assert.equal(state.remediation.occurrences.filter(x=>x.request_id===held.id).length,3)
 await h.scheduled(at('2026-08-07T15:00:00Z'))
 assert.equal(h.mails.filter(m=>m.to.includes('broker@example.test')).length,1,'retaining held evidence does not authorize contacting an erased recipient')
 assert.equal((await h.owner.state()).obligations.find(x=>x.id===o.id).status,'confirmed')
})

test('a role with hidden fields reads no obligation wording, quote or evidence note that may repeat a hidden value', async t => {
  const h = await installation(); t.after(() => h.close())
  const viewer = await h.invite('synthetic-locket-viewer@example.test', 'viewer')
  const clause = 'Pay USD 125000 each year.'
  const a = await h.owner.command('legacy.import', { title: 'synthetic-locket-3 licence', type: 'supplier', party: { name: 'synthetic-locket-3 vendor', kind: 'supplier' }, value: '125000', sourceSystem: 'Shared drive', sourceId: 'synthetic-locket-3', signed: true, file: file('synthetic-locket-3.pdf', pdf(clause)), text: clause })
  const o = await h.owner.command('obligation.add', { agreementId: a.id, description: 'Pay the USD 125000 licence fee', ownerId: (await h.owner.state()).actor.id, recurrence: 'annually', citation: { quote: clause }, evidence: 'note' })
  await h.owner.command('obligation.update', { agreementId: a.id, obligationId: o.id, action: 'confirm' })
  await h.owner.command('obligation.update', { agreementId: a.id, obligationId: o.id, action: 'done', note: 'Wired USD 125000 on receipt' })
  assert.match(JSON.stringify((await viewer.state()).obligations), /USD 125000 licence fee/)
  await h.owner.command('repository.access', { version: 0, enabled: false, grants: [], hiddenFields: [{ role: 'viewer', fields: ['value'] }] })
  const s = await viewer.state()
  assert.deepEqual(s.fieldAccess.hidden, ['value'])
  assert.deepEqual(s.agreements.map(x => x.id), [a.id])
  assert.deepEqual(Object.keys(s).filter(key => JSON.stringify(s[key]).includes('125000')), [], 'no part of the workspace repeats the hidden value')
})
