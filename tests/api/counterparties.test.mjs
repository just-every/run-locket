import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { installation } from './harness.mjs'
import { team, library, executed } from './setup.mjs'
import { file, pdf } from './files.mjs'
import { erasureSubject, erasureRequest, erasureConfirmation, erasureFixture } from './erasure-fixture.mjs'

const quote = 'This agreement runs from January 1, 2026 to December 31, 2027.'
const acme = {
  name: 'Acme Robotics, Inc.', kind: 'supplier', entityType: 'Corporation', formation: 'Delaware', taxIdKind: 'ein', taxId: '98-7654321', email: 'legal@acme.example',
  registeredAddress: '251 Little Falls Drive, Wilmington, DE 19808', noticeAddress: 'General Counsel, 1 Market Street, San Francisco, CA 94105', noticeMethod: 'courier',
  contacts: [{ name: 'Pat Lee', email: 'pat@acme.example', title: 'Contracts manager' }], signatories: [{ name: 'Jordan Diaz', email: 'jordan@acme.example', title: 'Chief Financial Officer' }],
}

test('REPO-010 counterparty details, notice address and signatories, three linked agreements by family, contracted and annual USD, next deadline, and merging an intake duplicate', async t => {
  const h = await installation(); t.after(() => h.close())
  const people = await team(h), viewer = await h.invite('viewer@example.test', 'viewer')
  await people.requester.command('party.save', { ...acme, signatories: [{ name: 'Jordan Diaz', email: 'jordan@acme.example' }] }, { error: 'INVALID' })
  await people.requester.command('party.save', { ...acme, noticeMethod: 'fax' }, { error: 'INVALID' })
  const kept = await people.requester.command('party.save', acme)
  let s = await viewer.state()

  // Three agreements link to it: an imported MSA with confirmed dates, its amendment (no dates) and a draft request.
  const imported = (title, value, extra = {}) => h.owner.command('legacy.import', { title, type: 'supplier', partyId: kept.id, value, sourceSystem: 'Shared drive', sourceId: `contracts/${title}.pdf`, signed: true, text: quote, file: file(`${title}.pdf`, pdf(`${title} ${quote}`)), ...extra })
  const msa = await imported('Acme MSA', '120000')
  const amendment = await imported('Acme amendment 1', '50000')
  const hidden = await imported('Acme restricted pilot', '10000', { restricted: true })
  const draft = await people.requester.command('request.create', { title: 'Acme spares order', type: 'nda', partyId: kept.id, value: '9000' })
  for (const [key, value] of [['effective_date', '2026-01-01'], ['end_date', '2027-12-31'], ['notice_days', '60'], ['auto_renew', 'no']]) {
    const term = await h.owner.command('term.propose', { agreementId: msa.id, key, value, citation: { quote } })
    await h.owner.command('term.decide', { agreementId: msa.id, termId: term.id, decision: 'confirm' })
  }
  const amendmentRow = (await h.owner.state()).agreements.find(a => a.id === amendment.id)
  await h.owner.command('family.link', { agreementId: amendment.id, version: amendmentRow.version, parentId: msa.id, relation: 'amends' })

  // A duplicate created by intake, approved before anyone noticed.
  const dupDeal = await people.requester.command('request.create', { title: 'Acme gripper NDA', type: 'nda', party: { name: 'ACME Robotics', kind: 'supplier' }, file: file('nda.pdf', pdf('NDA')), text: 'Mutual NDA' })
  let a = (await people.requester.state()).agreements.find(x => x.id === dupDeal.id)
  await people.requester.command('agreement.submit', { agreementId: a.id, version: a.version })
  a = (await people.approver.state()).agreements.find(x => x.id === dupDeal.id)
  await people.approver.command('approval.decide', { agreementId: a.id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' })
  s = await h.owner.state()
  const dup = s.parties.find(p => p.name === 'ACME Robotics'), keep = s.parties.find(p => p.id === kept.id)
  assert.notEqual(dup.id, keep.id)
  assert.deepEqual([keep.entity_type, keep.formation, keep.tax_id_kind, keep.tax_id, keep.notice_address, keep.notice_method], ['Corporation', 'Delaware', 'ein', '98-7654321', acme.noticeAddress, 'courier'])
  assert.deepEqual(JSON.parse(keep.signatories), acme.signatories)
  assert.deepEqual(JSON.parse(keep.contacts), acme.contacts)

  // Only owner or counsel merge; a stale version is refused; the merge moves agreements and withdraws approvals in negotiation.
  const merge = { keepId: keep.id, keepVersion: keep.version, duplicateId: dup.id, duplicateVersion: dup.version, reason: 'Same Delaware corporation, EIN 98-7654321' }
  await people.requester.command('party.merge', merge, { error: 'FORBIDDEN' })
  await people.counsel.command('party.merge', { ...merge, keepVersion: keep.version + 1 }, { error: 'STALE' })
  const merged = await people.counsel.command('party.merge', merge)
  assert.equal(merged.agreements, 1)
  await people.counsel.command('party.merge', { ...merge, keepVersion: keep.version + 1, duplicateVersion: dup.version + 1 }, { error: 'MERGED' })
  await people.requester.command('party.save', { id: dup.id, name: 'ACME Robotics', kind: 'supplier' }, { error: 'MERGED' })
  s = await h.owner.state()
  const moved = s.agreements.find(x => x.id === dupDeal.id)
  assert.deepEqual([moved.party_id, moved.status], [keep.id, 'in_review'])
  assert.ok(s.approvals.filter(x => x.agreement_id === dupDeal.id).every(x => x.invalidated_reason === 'Counterparty merged'))
  const history = s.parties.find(p => p.id === dup.id)
  assert.deepEqual([history.merged_into, history.merged_by, history.merge_reason], [keep.id, people.counsel.id, merge.reason])
  assert.ok(s.audit.some(x => x.action === 'party.merge' && x.agreement_id === dupDeal.id && x.summary.includes('earlier approvals no longer count')))
  // Intake by the duplicate's name or id now lands on the kept record.
  const again = await people.requester.command('request.create', { title: 'Acme follow-on', type: 'nda', party: { name: 'acme robotics', kind: 'supplier' } })
  const byId = await people.requester.command('request.create', { title: 'Acme second follow-on', type: 'nda', partyId: dup.id })
  s = await h.owner.state()
  assert.deepEqual([again.id, byId.id].map(id => s.agreements.find(x => x.id === id).party_id), [keep.id, keep.id])

  // The page's figures: contracted USD from executed/imported values, annual over the confirmed term, family grouping and the next deadline.
  const summary = s.counterparties[keep.id]
  assert.equal(summary.totalCents, 18000000)
  assert.equal(summary.annualCents, 6000000) // 120,000 over 730 days -> 60,000 a year; the pilot's 10,000 has no dates
  assert.deepEqual(summary.undated.sort(), [amendment.id, hidden.id].sort())
  assert.deepEqual(summary.families.find(f => f.rootId === msa.id).ids.sort(), [msa.id, amendment.id].sort())
  assert.ok(summary.families.some(f => f.rootId === draft.id))
  assert.deepEqual([summary.nextDeadline.agreementId, summary.nextDeadline.date], [msa.id, '2027-11-01'])
  // A viewer's figures leave out the restricted agreement they may not see.
  const seen = (await viewer.state()).counterparties[keep.id]
  assert.equal(seen.totalCents, 17000000)
  assert.ok(!seen.undated.includes(hidden.id))
})

test('ERASE-001 verified contact erasure preserves execution and audit, counsel holds fence every deletion door, owner approves expired draft retention', async t => {
 const h=await installation();t.after(()=>h.close())
 const counsel=await h.invite('synthetic-locket-1@example.test','counsel'),viewer=await h.invite('synthetic-locket-2@example.test','viewer')
 const contact=await h.invite(erasureSubject.email,'viewer'),x=await erasureFixture(h)
 const people={counsel,requester:h.owner,approver:h.owner},lib=await library(h,people)
 const a=await executed(h,people,lib,{title:'Executed supplier agreement',party:'Cardinal Systems'})
 let s=await h.owner.state(),row=s.agreements.find(x=>x.id===a.id)
 const executedComment=await h.owner.command('comment.add',{agreementId:a.id,versionId:row.current_version_id,body:'Ann confirms the Annual terms at morgan@example.test',mentionIds:[contact.id]})
 for(const[key,value]of[['end_date','2027-12-31'],['notice_days','60']]){
  const term=await h.owner.command('term.propose',{agreementId:a.id,key,value,citation:{quote:'Payment terms: invoices are payable within 30 days.'}})
  await h.owner.command('term.decide',{agreementId:a.id,termId:term.id,decision:'confirm'})
 }
 const renewal=(await h.owner.state()).renewals.find(r=>r.agreement_id===a.id)
 await h.owner.command('renewal.decide',{renewalId:renewal.id,decision:'terminate',reason:'Supplier replacement'})
 const notice=await h.owner.command('notice.prepare',{renewalId:renewal.id,recipient:erasureSubject.email,body:'Ann, please record this Annual notice of termination.'})
 const heldRow=x.rows[x.held.id],hold={agreementId:heldRow.id,version:heldRow.version,holdVersion:0,active:true,reason:'Litigation preservation',reviewOn:'2026-10-21'}
 await viewer.command('hold.set',hold,{error:'FORBIDDEN'})
 await h.owner.command('hold.set',{...hold,reviewOn:undefined},{error:'INVALID'})
 await h.owner.command('hold.set',hold)
 await h.owner.command('hold.set',{...hold,holdVersion:1,active:false,reason:'Owner asks to release'},{error:'FORBIDDEN'})
 await h.owner.command('draft.delete',{agreementId:heldRow.id,version:heldRow.version,reason:'Requested removal'},{error:'LEGAL_HOLD'})
 await h.owner.command('repository.access',{version:0,enabled:false,grants:[],hiddenFields:[{role:'viewer',fields:['value']}]})
 assert.deepEqual((await viewer.state()).legalHolds,[],'a hold never exposes arbitrary notes to a hidden-field role')
 await h.owner.command('repository.access',{version:1,enabled:false,grants:[],hiddenFields:[]})
 const heldFile=x.files[x.held.id][0]
 await assert.rejects(()=>h.db.prepare('DELETE FROM lk_artifact_chunks WHERE artifact_id=?').bind(heldFile.id).run(),/LOCKET_LEGAL_HOLD/)
 const before=await h.owner.state(),artifact=before.artifacts.find(f=>f.agreement_id===a.id&&f.role==='signed'),execution=before.executions.find(e=>e.agreement_id===a.id)
 const heldComment=before.comments.find(c=>c.id===x.heldComment.commentId),heldParty=before.parties.find(p=>p.id===x.heldParty.id)
 const bytes=Buffer.from(await(await h.owner.request('/api/locket/files/'+artifact.id)).arrayBuffer())
 const heldBytes=Buffer.from(await(await h.owner.request('/api/locket/files/'+heldFile.id)).arrayBuffer())
 const notificationBefore=await(await h.owner.request('/api/locket/export')).json()
 assert.ok(notificationBefore.records.lk_notification_deliveries.some(d=>d.recipient_email===erasureSubject.email))
 const payload=erasureRequest()
 for(const actor of [viewer,counsel]){
  await actor.command('person.erase.preview',payload,{error:'FORBIDDEN'})
  await actor.command('person.erase',{email:erasureSubject.email},{error:'FORBIDDEN'})
 }
 await h.owner.command('person.erase.preview',{...payload,verified:false},{error:'VERIFICATION'})
 await h.owner.command('person.erase.preview',{...payload,reason:'Privacy request for '+erasureSubject.email},{error:'INVALID'})
 await h.owner.command('person.erase.preview',{...payload,method:'Unverified email'},{error:'INVALID'})
 await h.owner.command('person.erase.preview',{...payload,receivedOn:'2026-02-30'},{error:'INVALID'})
 let preview=await h.owner.command('person.erase.preview',payload)
 const patch=preview.patches.find(p=>p.table==='lk_comments'&&p.id===x.comment.commentId)
 assert.ok(Object.hasOwn(patch.before,'body'),'preview identifies the exact changed field')
 assert.match(patch.after.body,/\[erased person\] reviews the Annual terms;/)
 assert.ok(!patch.after.body.includes(erasureSubject.email))
 assert.ok(!preview.patches.some(p=>p.id===heldComment.id),'held records are never offered for rewriting')
 const retained=preview.retained.find(r=>r.table==='lk_comments'&&r.id===heldComment.id)
 assert.deepEqual(retained,{table:'lk_comments',id:heldComment.id,agreementId:x.held.id,reason:'legal_hold',authorizer:before.actor.id,holdReason:hold.reason})
 assert.ok(preview.retained.some(r=>r.table==='lk_artifacts'&&r.id===artifact.id&&r.reason==='retained_by_law'))
 for(const draft of [x.keep,x.held,x.remove]){
  const found=preview.drafts.find(d=>d.id===draft.id)
  assert.ok(found,'every named unexecuted draft is disclosed, including PDF-only matches')
  assert.equal(found.held,draft.id===x.held.id)
  assert.deepEqual(found.files.map(f=>f.id).sort(),x.files[draft.id].map(f=>f.id).sort())
  assert.ok(found.versions.includes(draft.versionId))
 }
 assert.deepEqual((await h.owner.state()).comments.find(c=>c.id===x.comment.commentId),before.comments.find(c=>c.id===x.comment.commentId),'preview changes no personal record')
 const confirm=p=>erasureConfirmation(p,erasureSubject.email,x.dispositions)
 await h.owner.command('person.erase',{...confirm(preview),fingerprint:'unreviewed-fingerprint'},{error:'STALE'})
 await h.owner.command('person.erase',{...confirm(preview),draftDispositions:[]},{error:'DISPOSITION'})
 await h.owner.command('person.erase',{...confirm(preview),draftDispositions:x.dispositions.map(d=>d.agreementId===x.held.id?{...d,action:'delete',reason:'request_scope'}:d)},{error:'LEGAL_HOLD'})
 // A newly added matching comment changes the exact reviewed scope.
 const late=await h.owner.command('comment.add',{agreementId:x.keep.id,versionId:x.keep.versionId,body:'Ann confirms the later Annual review.'})
 await h.owner.command('person.erase',confirm(preview),{error:'STALE'})
 assert.equal((await h.owner.state()).parties.find(p=>p.id===x.party.id).email,erasureSubject.email)
 const priorToken=preview.subjectToken
 preview=await h.owner.command('person.erase.preview',payload)
 assert.notEqual(preview.subjectToken,priorToken,'a request token is generated independently of the contact address')
 const erased=await h.owner.command('person.erase',confirm(preview))
 await h.owner.command('person.erase',confirm(preview),{error:'STALE'})
 s=await h.owner.state()
 assert.ok(erased.changedRecords>=3)
 const minimized=await(await h.owner.request('/api/locket/export')).json()
 assert.ok(!minimized.records.lk_notification_deliveries.some(d=>d.recipient_email===erasureSubject.email))
 assert.equal(minimized.records.lk_person_preferences.find(p=>p.operator_id===contact.id).email,0)
 assert.equal((await contact.state()).actor.id,contact.id,'erasure preserves the separate sign-in identity')
 assert.ok(!s.parties.find(p=>p.id===x.party.id).contacts.includes('"name":"Ann"'))
 assert.equal(s.parties.find(p=>p.id===x.party.id).email,null)
 for(const id of [x.comment.commentId,executedComment.commentId,late.commentId]){
  const body=s.comments.find(c=>c.id===id).body
  assert.ok(body.includes('Annual'),'whole-word replacement leaves Annual intact')
  assert.ok(body.includes('[erased person]'))
  assert.ok(!body.includes(erasureSubject.email))
 }
 const minimizedNotice=s.notices.find(n=>n.id===notice.id)
 assert.ok(!JSON.stringify(minimizedNotice).includes(erasureSubject.email));assert.ok(minimizedNotice.body.includes('Annual'))
 assert.deepEqual(s.comments.find(c=>c.id===heldComment.id),heldComment)
 assert.deepEqual(s.parties.find(p=>p.id===heldParty.id),heldParty)
 assert.deepEqual(Buffer.from(await(await h.owner.request('/api/locket/files/'+heldFile.id)).arrayBuffer()),heldBytes)
 assert.deepEqual(erased.receipt.retained.find(r=>r.table==='lk_comments'&&r.id===heldComment.id),retained)
 for(const d of x.dispositions)assert.ok(erased.receipt.drafts.some(r=>r.id===d.agreementId&&r.action===d.action&&r.reason===d.reason))
 assert.ok(s.agreements.some(r=>r.id===x.keep.id));assert.ok(s.agreements.some(r=>r.id===x.held.id))
 assert.ok(!s.agreements.some(r=>r.id===x.remove.id))
 for(const f of x.files[x.remove.id])assert.equal((await h.owner.request('/api/locket/files/'+f.id)).status,404)
 assert.deepEqual(s.executions.find(e=>e.id===execution.id),execution)
 assert.deepEqual(s.artifacts.find(f=>f.id===artifact.id),artifact)
 assert.deepEqual(Buffer.from(await(await h.owner.request('/api/locket/files/'+artifact.id)).arrayBuffer()),bytes)
 for(const entry of before.audit)assert.deepEqual(s.audit.find(e=>e.id===entry.id),entry)
 assert.ok(s.audit.some(e=>e.action==='person.erase'&&e.summary.includes(erased.id)))
 const emailHash=createHash('sha256').update(erasureSubject.email).digest('hex')
 for(const state of [JSON.stringify(s),JSON.stringify(minimized)])assert.ok(!state.includes(emailHash)&&!state.includes(emailHash.slice(0,16)),'no guessable email digest remains in state or archive')
 assert.ok(!JSON.stringify(minimized.records.lk_erasures).includes(erasureSubject.email),'erasure metadata contains no personal free-text reason')
 await h.owner.command('legacy.import',{title:'Erased contact re-entry',type:'nda',party:{name:'New import',kind:'supplier',contacts:[erasureSubject]},sourceSystem:'Shared drive',sourceId:'synthetic-locket-erased-import',signed:false,file:file('reentry.pdf',pdf('New unrelated agreement'))},{error:'ERASED_CONTACT'})
 const imported=await h.owner.command('legacy.import',{title:'Unsigned imported draft',type:'nda',party:{name:'Independent archive supplier',kind:'supplier'},sourceSystem:'Shared drive',sourceId:'synthetic-locket-unsigned-import',signed:false,draft:true,file:file('unsigned.pdf',pdf('Unsigned imported NDA'))})
 await h.owner.command('retention.configure',{days:1,version:0})
 const expiredAt=Date.now()+3*86400000
 await h.setTime(expiredAt)
 await h.scheduled(expiredAt)
 await h.scheduled(expiredAt+3600000)
 s=await h.owner.state()
 assert.ok(s.agreements.some(r=>r.id===x.keep.id)&&s.agreements.some(r=>r.id===imported.id),'elapsed expiry never destroys an unreviewed draft')
 const reminders=s.notifications.items.filter(n=>n.kind==='draft_retention')
 for(const id of [x.keep.id,imported.id])assert.equal(reminders.filter(n=>n.agreement_id===id).length,1,'the owner receives one reminder for an unreviewed expired draft')
 assert.ok(!reminders.some(n=>n.agreement_id===heldRow.id),'held records are excluded from expiry prompts')
 assert.equal(s.legalHolds.find(r=>r.agreement_id===heldRow.id).active,1,'passing the review date never releases a hold')
 preview=await h.owner.command('retention.preview',{})
 assert.ok(!preview.candidates.some(a=>a.id===heldRow.id),'held draft excluded')
 assert.deepEqual(preview.candidates.map(a=>a.id).sort(),[x.keep.id,imported.id].sort(),'unsigned imported drafts participate in retention')
 await counsel.command('hold.set',{agreementId:heldRow.id,version:heldRow.version,holdVersion:1,active:false,reason:'Preservation released by counsel'})
 preview=await h.owner.command('retention.preview',{})
 assert.deepEqual(preview.candidates.map(a=>a.id).sort(),[x.keep.id,heldRow.id,imported.id].sort())
 await viewer.command('retention.apply',{previewId:preview.id,reason:'Expiry confirmed'},{error:'FORBIDDEN'})
 row=(await h.owner.state()).agreements.find(r=>r.id===x.keep.id)
 await h.owner.command('request.update',{agreementId:row.id,version:row.version,title:'Updated expired supplier draft',ownerId:s.actor.id,restricted:false})
 await h.owner.command('retention.apply',{previewId:preview.id,reason:'Old preview'},{error:'STALE'})
 preview=await h.owner.command('retention.preview',{})
 const result=await h.owner.command('retention.apply',{previewId:preview.id,reason:'Owner reviewed expired drafts'})
 assert.equal(result.deleted,3)
 s=await h.owner.state()
 for(const draft of [x.keep,x.held,imported])assert.ok(!s.agreements.some(a=>a.id===draft.id))
 assert.equal((await h.owner.request('/api/locket/files/'+heldFile.id)).status,404)
 assert.ok(s.agreements.some(r=>r.id===a.id));assert.ok(s.audit.some(e=>e.action==='hold.release'&&e.agreement_id===heldRow.id));assert.ok(s.audit.some(e=>e.action==='draft.delete'&&e.agreement_id===heldRow.id))
 // With no active counsel, the owner is also the release authority.
 await h.owner.command('role.set',{operatorId:counsel.id,role:'viewer'})
 row=s.agreements.find(r=>r.id===a.id)
 await h.owner.command('hold.set',{agreementId:a.id,version:row.version,holdVersion:0,active:true,reason:'Owner preservation',reviewOn:'2026-12-31'})
 await h.owner.command('hold.set',{agreementId:a.id,version:row.version,holdVersion:1,active:false,reason:'Owner reviewed preservation obligation'})
})
