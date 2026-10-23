import assert from 'node:assert/strict'
import test from 'node:test'
import { installation } from './harness.mjs'
import { file, docx } from './files.mjs'
import { erasureRequest, erasureConfirmation } from './erasure-fixture.mjs'
import { uploadedWordReview, wordReviewFixture } from './word-review-fixture.mjs'

test('Word review preserves twelve authored revisions, resolves nine and rejects three, round-trips comments and replies, and strips private outgoing content',async t=>{
 const h=await installation();t.after(()=>h.close())
 const x=await uploadedWordReview(h),view=async id=>(await(await h.owner.request('/api/locket/word-review?versionId='+id)).json())
 let model=await view(x.uploaded.versionId),state=await h.owner.state(),a=state.agreements.find(row=>row.id===x.a.id)
 assert.equal(model.changes.length,12);assert.equal(model.comments.length,4);assert.equal(model.baseVersionId,x.initial.versionId)
 assert.deepEqual(new Set(model.changes.map(change=>change.kind)),new Set(['insertion','deletion','moveFrom','moveTo','formatting']))
 assert.deepEqual(new Set(model.changes.map(change=>change.author)),new Set(['Alicia Counsel','Morgan Supplier']))
 const comparison=await(await h.owner.request(`/api/locket/compare?from=${x.initial.versionId}&to=${x.uploaded.versionId}`)).json()
 assert.ok(comparison.lines.some(line=>line.op==='del'&&line.text.includes('60 days')));assert.ok(comparison.lines.some(line=>line.op==='add'&&line.text.includes('30 days')))
 for(const change of model.changes){assert.ok(change.start>=0&&change.end>=change.start&&change.end<=model.text.length);if(change.kind==='insertion'||change.kind==='moveTo')assert.equal(model.text.slice(change.start,change.end),change.after)}
 for(const comment of model.comments){assert.ok(comment.author);assert.equal(model.text.slice(comment.start,comment.end),comment.quote)}
 const roots=state.comments.filter(row=>row.version_id===x.uploaded.versionId),root=roots.find(row=>row.body===x.commentBodies[0])
 assert.equal(roots.length,4);assert.ok(roots.every(row=>!state.commentAudiences.some(side=>side.id===row.id&&side.audience==='external')))
 const reply=await h.owner.command('comment.add',{agreementId:a.id,versionId:x.uploaded.versionId,parentId:root.id,body:'Our reply: the 30-day payment period is agreed.'})
 for(const row of [...roots.filter(row=>row.body!==x.commentBodies[3]),{id:reply.commentId}]){
  a=(await h.owner.state()).agreements.find(row=>row.id===a.id)
  await h.owner.command('comment.audience',{agreementId:a.id,version:a.version,commentId:row.id,audience:'external',confirmExternal:true})
 }
 a=(await h.owner.state()).agreements.find(row=>row.id===a.id)
 const changed=await h.owner.command('word.review',{agreementId:a.id,version:a.version,versionId:x.uploaded.versionId,decisions:x.decisions})
 model=await view(changed.versionId);assert.equal(model.changes.length,0);assert.equal(model.comments.length,5)
 assert.ok(model.text.includes('30 days'));assert.ok(!model.text.includes('60 days'));assert.ok(model.text.includes('$2,000,000'));assert.ok(!model.text.includes('$1,000,000'));assert.ok(model.text.includes('courier'));assert.ok(!model.text.includes('email'));assert.equal(model.text.match(/Maintain insurance\./g)?.length,1)
 const state2=await h.owner.state(),next=state2.versions.find(row=>row.id===changed.versionId),newComments=state2.comments.filter(row=>row.version_id===next.id)
 assert.ok(newComments.find(row=>row.body.includes('Our reply:')).parent_id)
 a=state2.agreements.find(row=>row.id===a.id)
 const firstWord=await h.owner.command('word.review',{agreementId:a.id,version:a.version,versionId:next.id,edit:{start:0,end:1,replacement:'One'}})
 const attributed=await view(firstWord.versionId)
 assert.deepEqual(attributed.changes.map(change=>change.kind),['deletion','insertion']);assert.ok(attributed.changes.every(change=>change.author===state.actor.name))
 assert.ok(attributed.text.startsWith('One. Payment'))
 a=(await h.owner.state()).agreements.find(row=>row.id===a.id)
 await h.owner.command('word.output',{agreementId:a.id,version:a.version,versionId:firstWord.versionId,kind:'redline'},{error:'CONSENT'})
 for(const kind of ['redline','clean']){
  const out=await h.owner.command('word.output',{agreementId:a.id,version:a.version,versionId:firstWord.versionId,kind,confirmCleanup:true}),download=await h.owner.request('/api/locket/files/'+out.artifactId),bytes=Buffer.from(await download.arrayBuffer()),xml=bytes.toString()
  assert.ok(xml.includes('Our reply:'));assert.ok(!xml.includes(x.commentBodies[3]));assert.ok(!xml.includes('synthetic-locket-private-author'));assert.ok(!xml.includes('synthetic-locket-private-editor'))
  for(const part of ['word/styles.xml','word/numbering.xml','word/header1.xml','word/footer1.xml'])assert.ok(xml.includes(part),part)
  assert.ok(xml.includes('Firm legal department'));assert.ok(xml.includes('Confidential template'));assert.ok(xml.includes('<w:tbl>'))
  assert.equal(xml.includes('<w:del '),kind==='redline');assert.equal(xml.includes('<w:ins '),kind==='redline')
 }
 await h.owner.command('version.audience',{agreementId:a.id,version:a.version,versionId:firstWord.versionId,audience:'external',confirmExternal:true})
 a=(await h.owner.state()).agreements.find(row=>row.id===a.id)
 const sharing=await h.owner.command('exchange.send',{agreementId:a.id,version:a.version,versionId:firstWord.versionId,rendition:'word-redline',recipientEmail:'synthetic-locket-26@example.test',contactConsent:'Review this exact supplier Word markup and external comments.',confirmCleanRendition:true,channel:'link',expiresAt:Date.now()+3600000})
 const exchanged=await h.request('/api/locket/exchange/download',{method:'POST',headers:{authorization:'Bearer '+sharing.token},body:{}}),outgoing=Buffer.from(await exchanged.arrayBuffer()).toString()
 assert.equal(exchanged.status,200);assert.ok(outgoing.includes('word/header1.xml'));assert.ok(outgoing.includes('Our reply:'));assert.ok(!outgoing.includes(x.commentBodies[3]));assert.ok(!outgoing.includes('synthetic-locket-private-author'))
 const original=state.artifacts.find(row=>row.version_id===x.uploaded.versionId&&row.role==='original'),res=await h.owner.request('/api/locket/files/'+original.id)
 assert.equal(res.headers.get('x-locket-sha256'),createHash('sha256').update(x.bytes).digest('hex'));assert.deepEqual(Buffer.from(await res.arrayBuffer()),x.bytes)
 const archive=await(await h.owner.request('/api/locket/export')).json()
 assert.deepEqual(Buffer.from(archive.files.find(row=>row.id===original.id).base64,'base64'),x.bytes)
 assert.equal(JSON.parse(archive.records.lk_versions.find(row=>row.id===changed.versionId).fields).wordReview.decidedBy,state.actor.id)
})

test('Word review refuses stale and unauthorized changes, mismatched move decisions and inaccessible originals',async t=>{
 const h=await installation();t.after(()=>h.close());const x=await uploadedWordReview(h),a=x.a
 const viewer=await h.invite('synthetic-locket-28@example.test','viewer'),agent=await h.invite('synthetic-locket-29@example.test','agent')
 const payload={agreementId:a.id,version:a.version,versionId:x.uploaded.versionId,decisions:x.decisions}
 for(const actor of [viewer,agent])await actor.command('word.review',payload,{error:'FORBIDDEN'})
 await h.owner.command('word.review',{...payload,version:a.version+1},{error:'STALE'})
 await h.owner.command('word.review',{...payload,decisions:{8:'accept',9:'reject'}},{error:'WORD_CHANGE'})
 await h.owner.command('word.review',{...payload,decisions:{999:'accept'}},{error:'WORD_CHANGE'})
 await h.owner.command('request.update',{agreementId:a.id,version:a.version,restricted:true})
 assert.equal((await viewer.request('/api/locket/word-review?versionId='+x.uploaded.versionId)).status,404)
 const current=(await h.owner.state()).agreements.find(row=>row.id===a.id)
 const changed=await h.owner.command('word.review',{...payload,version:current.version})
 await h.owner.command('word.review',payload,{error:'NOT_CURRENT'})
 const result=await h.owner.request('/api/locket/word-review?versionId='+changed.versionId)
 assert.equal(result.status,200)
})

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

// Counterparty calls use the real public capability door, without Base cookies.
import { randomUUID, createHash } from 'node:crypto'
import { exchangeFixture, counterpartyText, freshToken } from './exchange-fixture.mjs'

test('NEG-006 sends a clean external v2 through Postmark, accepts an exact v3 markup and audits scoped account-free use',async t=>{
  const h=await installation({bindings:{POSTMARK_SERVER_TOKEN:'synthetic-locket-1',POSTMARK_INBOUND_SECRET:'synthetic-locket-16',POSTMARK_REPLY_DOMAIN:'synthetic-locket.test'}});t.after(()=>h.close())
  const x=await exchangeFixture(h,{channel:'email'})
  const mail=h.mails.find(mail=>(mail.provider==='postmark'||mail.postmark)&&mail.text?.includes('/exchange#'))??h.mails.find(mail=>mail.text?.includes('/exchange#'))
  assert.ok(mail,'Postmark captured the email at the network edge')
  assert.deepEqual(mail.to,['synthetic-locket-3@example.test'])
  assert.ok(mail.text.includes('/exchange#'+x.token));assert.equal(mail.ReplyTo,`locket+${x.sent.replyToken}@synthetic-locket.test`);assert.notEqual(x.sent.replyToken,x.token)
  assert.deepEqual(await h.owner.command('exchange.send',x.payload,{commandId:x.sent.id}),x.sent)
  assert.equal(h.mails.filter(m=>m.text?.includes('/exchange#')).length,1)
  assert.equal((await h.request('/api/locket/exchange/open',{method:'POST',headers:{authorization:'Bearer '+x.sent.replyToken},body:{}})).status,404)
  await h.owner.command('exchange.send',{...x.payload,token:freshToken()},{error:'INVALID'})
  assert.ok(!mail.text.includes('private legal position'));assert.ok(!mail.text.includes('Invoices'))
  const opened=await x.request('open'),view=await opened.json()
  assert.equal(opened.status,200,JSON.stringify(view));assert.equal(view.version.number,2)
  assert.deepEqual(view.comments.map(c=>c.body),['synthetic-locket-7 external question'])
  assert.ok(!JSON.stringify(view).includes('private'));assert.equal(view.approvals,undefined);assert.equal(view.fields,undefined)
  const downloaded=await x.request('download'),bytes=Buffer.from(await downloaded.arrayBuffer())
  assert.equal(downloaded.headers.get('x-content-sha256'),createHash('sha256').update(bytes).digest('hex'))
  assert.ok(bytes.toString().includes('synthetic-locket-7 external question'))
  assert.ok(!bytes.toString().includes('private legal position'));assert.ok(!bytes.toString().includes('private approval note'))
  assert.ok(!bytes.toString().includes('synthetic-locket-26'));assert.ok(!bytes.toString().includes('synthetic-locket-27'))
  assert.ok(x.source.includes(Buffer.from('word/comments.xml')));assert.ok(x.source.includes(Buffer.from('docProps/core.xml')))
  const sourceArtifact=(await h.owner.state()).artifacts.find(a=>a.version_id===x.version.versionId&&a.role==='original')
  assert.deepEqual(Buffer.from(await(await h.owner.request('/api/locket/files/'+sourceArtifact.id)).arrayBuffer()),x.source)
  const commentId=randomUUID(),comment={commandId:commentId,payload:{body:'synthetic-locket-9 counterparty question',quote:'Invoices are due within 30 days.'}}
  const commented=await(await x.request('comment',comment)).json()
  assert.equal(commented.ok,true);assert.deepEqual(await(await x.request('comment',comment)).json(),commented)
  const markup=docx(counterpartyText.split('\n')),upload={commandId:randomUUID(),payload:{file:file('synthetic-locket-3.docx',markup)}}
  const uploaded=await(await x.request('upload',upload)).json()
  assert.equal(uploaded.ok,true,JSON.stringify(uploaded));assert.equal(uploaded.result.number,3)
  assert.deepEqual(await(await x.request('upload',upload)).json(),uploaded)
  const stale=await x.request('upload',{commandId:randomUUID(),payload:upload.payload});assert.equal(stale.status,409);assert.equal((await stale.json()).error.code,'NOT_CURRENT')
  const state=await h.owner.state(),v3=state.versions.find(v=>v.id===uploaded.result.versionId)
  assert.equal(v3.kind,'counterparty');assert.equal(v3.text,counterpartyText);assert.equal(v3.digest,uploaded.result.digest)
  const artifact=state.artifacts.find(f=>f.version_id===v3.id)
  assert.equal(artifact.sha256,createHash('sha256').update(markup).digest('hex'))
  assert.deepEqual(Buffer.from(await(await h.owner.request('/api/locket/files/'+artifact.id)).arrayBuffer()),markup)
  const c=state.comments.find(c=>c.id===commented.result.commentId)
  assert.equal(c.external_author_name,'synthetic-locket-3');assert.equal(c.external_author_email,'synthetic-locket-3@example.test')
  for(const action of ['exchange.sent','exchange.opened','exchange.downloaded','exchange.commented','exchange.uploaded','exchange.email.accepted'])assert.ok(state.audit.some(e=>e.action===action),action)
  assert.ok(state.audit.filter(e=>['exchange.opened','exchange.uploaded'].includes(e.action)).every(e=>e.actor_role==='counterparty_link'))
  const current=state.agreements.find(a=>a.id===x.a.id)
  const replyExchange=await h.owner.command('exchange.send',{...x.payload,version:current.version,versionId:v3.id})
  const replyToken=replyExchange.replyToken
  const replyFiles=[docx(['synthetic-locket-17 first email markup']),docx(['synthetic-locket-18 second email markup'])]
  const inbound={OriginalRecipient:`locket+${replyToken}@synthetic-locket.test`,From:'synthetic-locket-3@example.test',FromFull:{Email:'synthetic-locket-3@example.test',Name:'synthetic-locket-3'},MessageID:'synthetic-locket-19',StrippedTextReply:`synthetic-locket-20 email response ${replyToken}`,Attachments:replyFiles.map((bytes,i)=>({Name:`synthetic-locket-${i+4}.docx`,ContentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',Content:bytes.toString('base64'),ContentLength:bytes.length}))}
  const inboundRequest=(body=inbound,authorization='Basic '+Buffer.from('locket:synthetic-locket-16').toString('base64'))=>h.request('/api/locket/exchange/inbound',{method:'POST',headers:{authorization,origin:''},body})
  assert.equal((await inboundRequest({...inbound,OriginalRecipient:`locket+${replyExchange.token}@synthetic-locket.test`})).status,404)
  assert.equal((await inboundRequest(inbound,'Bearer wrong')).status,401)
  assert.equal((await inboundRequest({...inbound,From:'other@example.test'})).status,403)
  assert.equal((await inboundRequest({...inbound,OriginalRecipient:`locket+${replyToken}@other.example`})).status,403)
  const invalidAttachments={...inbound,MessageID:'synthetic-locket-21',Attachments:[inbound.Attachments[0],{Name:'synthetic-locket-22.txt',ContentType:'text/plain',Content:Buffer.from('synthetic-locket-22').toString('base64')}]}
  assert.equal((await inboundRequest(invalidAttachments)).status,415)
  assert.equal((await h.owner.state()).versions.filter(v=>v.agreement_id===x.a.id).length,3,'unsupported companion attachment saves no versions or comment')
  const replyResponse=await inboundRequest(),replyResult=await replyResponse.json()
  assert.equal(replyResponse.status,200,JSON.stringify(replyResult));assert.deepEqual(replyResult.result.versions.map(v=>v.number),[4,5])
  assert.deepEqual(await(await inboundRequest()).json(),replyResult,'provider retry never creates duplicate versions')
  assert.equal((await inboundRequest({...inbound,StrippedTextReply:'different reply content'})).status,409)
  const afterReply=await h.owner.state()
  assert.equal(afterReply.agreements.find(a=>a.id===x.a.id).current_version_id,replyResult.result.versions[1].versionId)
  assert.ok(afterReply.audit.some(e=>e.action==='exchange.replied'&&e.summary.includes('sender identity not verified')))
  for(const [i,version]of replyResult.result.versions.entries()){
    const stored=afterReply.artifacts.find(a=>a.version_id===version.versionId)
    assert.deepEqual(Buffer.from(await(await h.owner.request('/api/locket/files/'+stored.id)).arrayBuffer()),replyFiles[i])
    assert.equal(stored.sha256,createHash('sha256').update(replyFiles[i]).digest('hex'))
  }
  assert.ok(afterReply.comments.some(c=>c.body.includes('synthetic-locket-20 email response')&&!c.body.includes(replyToken)))
  const archive=await(await h.owner.request('/api/locket/export')).json()
  assert.equal(archive.records.lk_exchanges.length,2);assert.equal(archive.records.lk_exchange_commands.length,3)
  assert.ok(!JSON.stringify(archive).includes(replyToken))
  assert.ok(!JSON.stringify(archive).includes(x.sent.replyToken));assert.ok(!JSON.stringify(archive).includes(replyExchange.token))
  assert.ok(!JSON.stringify(archive).includes(x.token),'raw bearer token is not retained in any record')
  await h.setTime(x.payload.expiresAt+1)
  for(const action of ['open','download','comment','upload'])assert.equal((await x.request(action,action==='upload'?upload:comment)).status,404)
  assert.equal((await inboundRequest()).status,404,'expired capabilities also refuse email reply retries')
})

test('NEG-006 refuses internal versions, unsafe disclosure, forged scope, revoked links and removed sender authority',async t=>{
  const h=await installation();t.after(()=>h.close())
  const x=await exchangeFixture(h)
  const viewer=await h.invite('synthetic-locket-10@example.test','viewer'),agent=await h.invite('synthetic-locket-11@example.test','agent'),counsel=await h.invite('synthetic-locket-12@example.test','counsel')
  for(const person of [viewer,agent])await person.command('exchange.send',{...x.payload},{error:'FORBIDDEN'})
  await h.owner.command('exchange.send',{...x.payload,confirmCleanRendition:false},{error:'CONSENT'})
  await h.owner.command('exchange.send',{...x.payload,recipientEmail:'other@example.test'},{error:'RECIPIENT'})
  assert.equal((await h.request('/api/locket/exchange/open',{method:'POST',body:{},headers:{authorization:'Bearer '+freshToken()}})).status,404)
  assert.equal((await h.request('/api/locket/exchange/open',{method:'POST',body:{},headers:{authorization:'Bearer '+x.token,origin:'https://other.example'}})).status,403)
  assert.equal((await viewer.request('/api/locket/exchanges?agreementId='+x.a.id)).status,403)
  const revoked=await h.owner.command('exchange.revoke',{agreementId:x.a.id,version:x.a.version,exchangeId:x.sent.id,reason:'synthetic-locket-13 authority withdrawn'})
  assert.equal(revoked.id,x.sent.id);assert.equal((await x.request('open')).status,404)
  let a=(await h.owner.state()).agreements.find(a=>a.id===x.a.id)
  await h.owner.command('version.audience',{agreementId:a.id,version:a.version,versionId:a.current_version_id,audience:'internal'})
  a=(await h.owner.state()).agreements.find(a=>a.id===x.a.id)
  await h.owner.command('exchange.send',{...x.payload,version:a.version},{error:'INTERNAL_VERSION'})
  await h.owner.command('version.audience',{agreementId:a.id,version:a.version,versionId:a.current_version_id,audience:'external',confirmExternal:true})
  a=(await h.owner.state()).agreements.find(a=>a.id===x.a.id)
  const sent=await counsel.command('exchange.send',{...x.payload,version:a.version}),token=sent.token
  await h.owner.command('role.set',{operatorId:counsel.id,role:'viewer'})
  assert.equal((await h.request('/api/locket/exchange/open',{method:'POST',body:{},headers:{authorization:'Bearer '+token}})).status,404)
  assert.ok(sent.id)
  // Erasing one contact also revokes another contact's frozen rendition when
  // it could still contain the first contact's external comment identity.
  const party=(await h.owner.state()).parties.find(p=>p.id===a.party_id)
  await h.owner.command('party.save',{id:party.id,version:party.version,name:party.name,kind:party.kind,contacts:[...JSON.parse(party.contacts),{name:'synthetic-locket-23',email:'synthetic-locket-23@example.test'}],signatories:[]})
  const originalToken=(await h.owner.command('exchange.send',{...x.payload,version:a.version})).token
  const otherToken=(await h.owner.command('exchange.send',{...x.payload,version:a.version,recipientEmail:'synthetic-locket-23@example.test'})).token
  const scoped=(action,token,payload={})=>h.request('/api/locket/exchange/'+action,{method:'POST',headers:{authorization:'Bearer '+token},body:payload})
  assert.equal((await scoped('open',otherToken)).status,200)
  assert.equal((await scoped('comment',originalToken,{commandId:randomUUID(),payload:{body:'synthetic-locket-3 confirms this external comment'}})).status,200)
  const eraseEmail='synthetic-locket-3@example.test'
  const erasePreview=await h.owner.command('person.erase.preview',erasureRequest(eraseEmail))
  await h.owner.command('person.erase',erasureConfirmation(erasePreview,eraseEmail,erasePreview.drafts.map(d=>({agreementId:d.id,action:'retain',reason:d.held?'legal_hold':'business_retention'}))))
  assert.equal((await scoped('open',otherToken)).status,404,'frozen renderings containing erased comments cannot be reopened by another contact')
  assert.ok(!(await h.owner.state()).comments.some(c=>c.external_author_email==='synthetic-locket-3@example.test'))
})

test('Accepted findings become three reviewer-attributed browser and Word redlines with edited wording, reasons and retained model provenance',async t=>{
 const h=await installation();t.after(()=>h.close());const {reviewRedlinesFixture}=await import('./review-redlines-fixture.mjs'),x=await reviewRedlinesFixture(h)
 const a=await x.current(),payload={agreementId:a.id,version:a.version,versionId:x.v.id,changes:x.changes},commandId=crypto.randomUUID()
 const result=await h.owner.command('review.redlines',payload,{commandId});assert.deepEqual(await h.owner.command('review.redlines',payload,{commandId}),result)
 const state=await h.owner.state(),v=state.versions.find(row=>row.id===result.versionId),fields=JSON.parse(v.fields),records=fields.reviewRedlines.changes
 assert.equal(records.length,3);assert.ok(records.every(r=>r.reviewerId===state.actor.id&&r.provenance.proposalId===x.proposal.id&&r.provenance.inputDigest===x.v.digest));assert.deepEqual(records[0].provenance.declaredModel,x.provenance)
 assert.ok(v.text.includes('45 days'));assert.ok(records.some(r=>r.reason==='Counsel reviewed the higher cap for this scope.'))
 const word=await(await h.owner.request('/api/locket/word-review?versionId='+v.id)).json()
 assert.equal(word.changes.filter(c=>c.kind==='insertion').length,3);assert.equal(word.changes.filter(c=>c.kind==='deletion').length,3);assert.ok(word.changes.every(c=>c.author===state.actor.name));assert.equal(word.comments.length,3)
 const comments=state.comments.filter(c=>c.version_id===v.id),external=state.commentAudiences.filter(side=>side.audience==='external'&&comments.some(c=>c.id===side.id))
 assert.equal(comments.length,3);assert.equal(external.length,1);assert.equal(comments.find(c=>c.id===external[0].id).body,'Match the accepted supplier playbook for confidentiality')
 const comparison=await(await h.owner.request(`/api/locket/compare?from=${x.v.id}&to=${v.id}`)).json();assert.equal(comparison.lines.filter(l=>l.op==='add').length,3);assert.equal(comparison.lines.filter(l=>l.op==='del').length,3)
 const current=await x.current(),out=await h.owner.command('word.output',{agreementId:a.id,version:current.version,versionId:v.id,kind:'redline',confirmCleanup:true}),outgoing=Buffer.from(await(await h.owner.request('/api/locket/files/'+out.artifactId)).arrayBuffer()).toString()
 assert.ok(outgoing.includes('Match the accepted supplier playbook for confidentiality'));assert.ok(!outgoing.includes('Counsel reviewed the higher cap'));assert.ok(!outgoing.includes('Match the accepted supplier playbook for payment'))
 const source=state.artifacts.find(row=>row.version_id===x.v.id&&row.role==='original');assert.deepEqual(Buffer.from(await(await h.owner.request('/api/locket/files/'+source.id)).arrayBuffer()),x.bytes)
 const archive=await(await h.owner.request('/api/locket/export')).json();assert.deepEqual(JSON.parse(archive.records.lk_versions.find(row=>row.id===v.id).fields).reviewRedlines,fields.reviewRedlines)
 assert.ok(state.audit.some(e=>e.action==='review.redlines'));assert.equal(archive.records.lk_exchanges.length,0)
})

test('Review redlines refuse unaccepted, overlapping, stale and unauthorized application without sending or changing originals',async t=>{
 const h=await installation();t.after(()=>h.close());const {reviewRedlinesFixture}=await import('./review-redlines-fixture.mjs'),x=await reviewRedlinesFixture(h,{decide:false})
 let a=await x.current();await h.owner.command('review.redlines',{agreementId:a.id,version:a.version,versionId:x.v.id,changes:[]},{error:'INVALID'})
 const quote='Invoices are due within 60 days.',start=x.v.text.indexOf(quote),manual=await h.owner.command('deviation.add',{agreementId:a.id,versionId:x.v.id,clauseKey:'payment',result:'breached',start,end:start+quote.length,quote,explanation:'Manual finding awaiting proposal acceptance.',proposedWording:'Invoices are due within 30 days.',questions:[]})
 a=await x.current();await h.owner.command('review.redlines',{agreementId:a.id,version:a.version,versionId:x.v.id,changes:[{findingId:manual.id}]},{error:'FINDING'})
 await h.owner.command('proposal.decide',{proposalId:x.proposal.id,decision:'approve'})
 const state=await h.owner.state(),finding=state.deviations.find(d=>d.proposal_id===x.proposal.id),changes=[{findingId:finding.id,wording:'Reviewed replacement.',reason:'Reviewed reason.'}]
 a=await x.current();const p={agreementId:a.id,version:a.version,versionId:x.v.id,changes}
 const viewer=await h.invite('synthetic-locket-92@example.test','viewer'),agent=await h.invite('synthetic-locket-93@example.test','agent')
 for(const actor of [viewer,agent])await actor.command('review.redlines',p,{error:'FORBIDDEN'})
 await h.owner.command('review.redlines',{...p,changes:[...changes,...changes]},{error:'OVERLAP'})
 await h.owner.command('review.redlines',{...p,version:a.version+1},{error:'STALE'})
 await h.owner.command('review.redlines',p)
 await h.owner.command('review.redlines',p,{error:'NOT_CURRENT'})
 assert.equal((await(await h.owner.request('/api/locket/export')).json()).records.lk_exchanges.length,0)
})

test('Exchange capabilities end when the contact, external comment or sending session is withdrawn',async t=>{
 for(const boundary of ['contact','comment','signout','revocation']){
  const h=await installation();t.after(()=>h.close())
  const sender=await h.invite('synthetic-locket-'+boundary+'@example.test','counsel'),x=await exchangeFixture(h,{sender})
  assert.equal((await x.request('open')).status,200)
  if(boundary==='contact'){
   const party=(await h.owner.state()).parties.find(p=>p.id===x.a.party_id)
   await h.owner.command('party.save',{id:party.id,version:party.version,name:party.name,kind:party.kind,contacts:[],signatories:[]})
  }else if(boundary==='comment'){
   await sender.command('comment.audience',{agreementId:x.a.id,version:x.a.version,commentId:x.external.commentId,audience:'internal'})
  }else if(boundary==='signout'){
   const response=await sender.request('/auth/signout',{method:'POST',body:{}});assert.equal(response.status,204)
  }else{
   const sessions=await(await sender.request('/auth/sessions')).json()
   const session=sessions.find(s=>s.active)
   assert.ok(session)
   const revoked=await sender.request('/auth/session/revoke',{method:'POST',body:{sessionId:session.id}});assert.equal(revoked.status,204)
  }
  for(const action of ['open','download','comment','upload'])assert.equal((await x.request(action,{commandId:randomUUID(),payload:{body:'synthetic-locket-30'}})).status,404,boundary+' '+action)
 }
})

test('Rejected, uncertain and rate-limited exchange mail attempts retain honest outcomes and never resend',async t=>{
 for(const outcome of ['rejected','uncertain','rate_limited']){
  const h=await installation({bindings:{POSTMARK_SERVER_TOKEN:'synthetic-locket-31'},mailResponse:mail=>mail.From?(outcome==='rejected'?Response.json({ErrorCode:422},{status:422}):outcome==='rate_limited'?Response.json({ErrorCode:429},{status:429}):Response.json({ErrorCode:0})):Response.json({id:'synthetic-locket-32'})})
  try{
   const x=await exchangeFixture(h,{channel:'email'})
   assert.equal(x.sent.mailReceipt.status,outcome)
   for(let i=0;i<2;i++)assert.deepEqual(await h.owner.command('exchange.send',x.payload,{commandId:x.sent.id}),x.sent)
   assert.equal(h.mails.filter(m=>m.From).length,1)
   const state=await h.owner.state();assert.ok(state.audit.some(e=>e.action==='exchange.email.'+outcome))
  }finally{await h.close()}
 }
})
