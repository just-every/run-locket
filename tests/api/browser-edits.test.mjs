import assert from 'node:assert/strict'
import test from 'node:test'
import { installation } from './harness.mjs'
import { file, docx } from './files.mjs'

const original = '1. Payment\nInvoices are due within 30 days.\n2. Liability\nLiability is capped at $100,000.\n3. Confidentiality\nBoth parties protect confidential information.'
const edited = original.replace('30 days', '45 days').replace('$100,000', '$200,000')
const create = h => h.owner.command('request.create', {title:'Northwind services agreement',type:'nda',party:{name:'Northwind Technology Inc.',kind:'supplier'},file:file('northwind.docx',docx(original.split('\n')))})

test('NEG-004 records two attributed browser edits, exact comparison, selected mention, counsel reply/resolution and archive', async t => {
  const h = await installation(); t.after(() => h.close())
  const counsel = await h.invite('counsel@example.test','counsel')
  const request = await create(h)
  let state = await h.owner.state(), a = state.agreements.find(x => x.id === request.id)
  const artifact = state.artifacts.find(x => x.version_id === request.versionId)
  const bytes = Buffer.from(await (await h.owner.request('/api/locket/files/'+artifact.id)).arrayBuffer())
  await h.owner.command('agreement.submit',{agreementId:a.id,version:a.version})
  a = (await h.owner.state()).agreements.find(x=>x.id===a.id)
  await h.owner.command('approval.decide',{agreementId:a.id,version:a.version,versionId:a.current_version_id,kind:'commercial',decision:'approved'})
  a = (await h.owner.state()).agreements.find(x=>x.id===a.id)
  const change = await h.owner.command('version.edit',{agreementId:a.id,version:a.version,versionId:a.current_version_id,text:edited})
  state=await h.owner.state(); a=state.agreements.find(x=>x.id===a.id)
  const v=state.versions.find(x=>x.id===change.versionId), changes=JSON.parse(v.fields).browserEdits
  assert.equal(v.text,edited);assert.equal(changes.baseVersionId,request.versionId);assert.equal(changes.actorId,state.actor.id);assert.ok(changes.at)
  const compare=await (await h.owner.request(`/api/locket/compare?from=${request.versionId}&to=${v.id}`)).json()
  assert.deepEqual(compare.lines.filter(l=>l.op!=='same'),[{op:'del',text:'Invoices are due within 30 days.'},{op:'add',text:'Invoices are due within 45 days.'},{op:'del',text:'Liability is capped at $100,000.'},{op:'add',text:'Liability is capped at $200,000.'}])
  assert.deepEqual(changes.lines,compare.lines);assert.equal(a.status,'in_review');assert.ok(state.approvals.every(x=>x.invalidated_at))
  assert.deepEqual(Buffer.from(await (await h.owner.request('/api/locket/files/'+artifact.id)).arrayBuffer()),bytes)
  const generated=state.artifacts.find(x=>x.version_id===v.id)
  assert.match(Buffer.from(await (await h.owner.request('/api/locket/files/'+generated.id)).arrayBuffer()).toString(),/45 days/)
  const quote='Both parties protect confidential information.', start=edited.indexOf(quote)
  const root=await h.owner.command('comment.add',{agreementId:a.id,versionId:v.id,quote,start,end:start+quote.length,body:'Please confirm this confidentiality clause.',mentionIds:[counsel.id]})
  assert.ok((await counsel.state()).notifications.items.some(n=>n.kind==='mention'&&n.agreement_id===a.id))
  assert.ok(h.mails.some(m=>m.to.includes('counsel@example.test')&&m.text.includes('/app#agreement/')))
  const reply=await counsel.command('comment.add',{agreementId:a.id,versionId:v.id,parentId:root.commentId,body:'Confirmed; the reciprocal wording is suitable.'})
  state=await counsel.state();const thread=state.comments.find(c=>c.id===root.commentId)
  assert.equal(state.comments.find(c=>c.id===reply.commentId).parent_id,thread.id)
  await counsel.command('comment.resolve',{agreementId:a.id,commentId:thread.id,revision:thread.revision})
  state=await h.owner.state();assert.equal(state.comments.find(c=>c.id===thread.id).resolved_by,counsel.id)
  assert.ok(state.audit.some(e=>e.action==='version.edit'));assert.ok(state.audit.some(e=>e.action==='comment.resolve'))
  const archive=await (await h.owner.request('/api/locket/export')).json()
  assert.deepEqual(archive.records.lk_comments,state.comments)
  assert.deepEqual(JSON.parse(archive.records.lk_versions.find(x=>x.id===v.id).fields).browserEdits,changes)
})

test('NEG-004 refuses stale/unchanged edits, wrong passages, closed/cross-version threads and unauthorized writes', async t => {
  const h=await installation();t.after(()=>h.close())
  const request=await create(h), state=await h.owner.state(), a=state.agreements.find(x=>x.id===request.id)
  const p={agreementId:a.id,version:a.version,versionId:a.current_version_id,text:edited}
  const viewer=await h.invite('viewer@example.test','viewer'),agent=await h.invite('agent@example.test','agent')
  for(const person of [viewer,agent]) await person.command('version.edit',p,{error:'FORBIDDEN'})
  await h.owner.command('version.edit',{...p,text:original},{error:'UNCHANGED'})
  await h.owner.command('version.edit',{...p,version:p.version+1},{error:'STALE'})
  await h.owner.command('comment.add',{agreementId:a.id,versionId:p.versionId,body:'Wrong anchor',quote:'Liability',start:0,end:9},{error:'CITATION'})
  const root=await h.owner.command('comment.add',{agreementId:a.id,versionId:p.versionId,body:'Keep this thread on v1.'})
  const changed=await h.owner.command('version.edit',p)
  await h.owner.command('version.edit',p,{error:'NOT_CURRENT'})
  await h.owner.command('comment.add',{agreementId:a.id,versionId:changed.versionId,parentId:root.commentId,body:'Wrong version'},{error:'NOT_FOUND'})
  for(const person of [viewer,agent]) {
    await person.command('comment.add',{agreementId:a.id,versionId:p.versionId,parentId:root.commentId,body:'Not allowed'},{error:'FORBIDDEN'})
    await person.command('comment.resolve',{agreementId:a.id,commentId:root.commentId,revision:1},{error:'FORBIDDEN'})
  }
  await h.owner.command('comment.add',{agreementId:a.id,versionId:p.versionId,parentId:root.commentId,body:'A concurrent reply.'})
  await h.owner.command('comment.resolve',{agreementId:a.id,commentId:root.commentId,revision:1},{error:'STALE'})
  await h.owner.command('comment.resolve',{agreementId:a.id,commentId:root.commentId,revision:2})
  await h.owner.command('comment.add',{agreementId:a.id,versionId:p.versionId,parentId:root.commentId,body:'Too late'},{error:'RESOLVED'})
  const current=(await h.owner.state()).agreements.find(x=>x.id===a.id)
  await h.owner.command('request.update',{agreementId:a.id,version:current.version,restricted:true})
  assert.equal((await viewer.state()).comments.length,0)
  assert.equal((await viewer.request(`/api/locket/compare?from=${p.versionId}&to=${changed.versionId}`)).status,404)
})
