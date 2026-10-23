import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { installation } from './harness.mjs'
import { file, pdf } from './files.mjs'
import { approvalRuleFixture, ruleRequest } from './approval-rule-fixture.mjs'

const find = async (client, id) => (await client.state()).agreements.find(a => a.id === id)
async function review(client, { restricted = false, title = 'Confidential acquisition 940271' } = {}) {
  const created = await client.command('request.create', { title, type: 'nda', restricted, value: '940271', party: { name: `Private party ${randomUUID()}`, kind: 'customer' }, file: file('nda.pdf', pdf('Mutual confidentiality agreement.')), text: 'Mutual confidentiality agreement.' })
  const a = await find(client, created.id)
  await client.command('agreement.submit', { agreementId: a.id, version: a.version })
  return find(client, a.id)
}
const payload = (a, recipientId) => ({ agreementId: a.id, version: a.version, versionId: a.current_version_id, recipientId })
const delivery = async (client, a, recipientId, commandId) => (await (await client.request('/api/locket/commands', { method: 'POST', body: { commandId, type: 'approval.email', payload: payload(a, recipientId) } })).json()).mailReceipt

test('APPROVE-003 / MOBILE-001 / SEC-002 emails a generic authenticated review link once, then records the exact version through the normal approval command', async t => {
  const chats = []
  const h = await installation({bindings:{MAIL_PROVIDER:'postmark',APPROVAL_SLACK_TOKEN:'synthetic-locket-1',APPROVAL_TEAMS_TOKEN:'synthetic-locket-2',APPROVAL_NOOK_TOKEN:'synthetic-locket-3',APPROVAL_NOOK_ORIGIN:'https://nook.example.test'},outboundResponse:async request=>{
    const body=await request.json();chats.push({url:request.url,body})
    return Response.json(new URL(request.url).hostname==='graph.microsoft.com'?{id:`synthetic-locket-${chats.length}`}:{ok:true,ts:`synthetic-locket-${chats.length}`},{status:new URL(request.url).hostname==='graph.microsoft.com'?201:200})
  }}); t.after(() => h.close())
  const requester = await h.invite('requester@example.test', 'requester')
  const approver = await h.invite('approver@example.test', 'approver')
  const a = await review(requester), state = await requester.state(), version = state.versions.find(v => v.id === a.current_version_id)
  const count = h.mails.length, commandId = randomUUID()
  const concurrent = await Promise.all([requester.command('approval.email', payload(a, approver.id), { commandId }), requester.command('approval.email', payload(a, approver.id), { commandId })])
  assert.deepEqual(concurrent[0], concurrent[1], 'SEC-002 concurrent retries return the same first command outcome')
  const sent = await requester.command('approval.email', payload(a, approver.id), { commandId })
  assert.equal(sent.status, 'queued')
  assert.deepEqual(sent, concurrent[0])
  const receipt = await delivery(requester, a, approver.id, commandId)
  assert.equal(receipt.status, 'accepted')
  assert.ok(receipt.providerMessageId)
  assert.equal(h.mails.length, count + 1)
  const received = h.mails.at(-1), link = received.text.match(/https?:\/\/[^\s]+/)[0]
  assert.deepEqual(received.to, ['approver@example.test'])
  assert.equal(link, `${h.origin}/app#agreement/${a.id}/review`)
  assert.equal(sent.reviewUrl, link)
  for (const content of [received.subject, received.text, received.html]) {
    assert.ok(!content.includes(a.title))
    assert.ok(!content.includes('940271'))
    assert.ok(!content.includes(version.digest))
  }
  assert.deepEqual(await requester.command('approval.email', payload(a, approver.id), { commandId }), sent)
  assert.equal(h.mails.length, count + 1)
  const unauthorized = await h.request('/api/locket/state')
  assert.equal(unauthorized.status, 401)
  const opened = await find(approver, new URL(link).hash.split('/')[1])
  const approved = await approver.command('approval.decide', { agreementId: opened.id, version: opened.version, versionId: opened.current_version_id, kind: 'commercial', decision: 'approved' })
  assert.equal(approved.versionDigest, version.digest)
  assert.equal(approved.status, 'approved')
  assert.ok((await requester.state()).audit.some(e => e.action === 'approval.email.accepted' && e.agreement_id === a.id))
  const archive = await (await h.owner.request('/api/locket/export')).json()
  assert.equal(archive.records.lk_approval_mail.find(r => r.id === commandId).provider_message_id, receipt.providerMessageId)
  const stale = await review(requester)
  await requester.command('approval.email', payload(stale, approver.id))
  await requester.command('version.upload', { agreementId: stale.id, version: stale.version, kind: 'counterparty', file: file('new.pdf', pdf('Replaced confidentiality agreement.')), text: 'Replaced confidentiality agreement.' })
  await approver.command('approval.decide', { agreementId: stale.id, version: stale.version, versionId: stale.current_version_id, kind: 'commercial', decision: 'approved' }, { error: 'NOT_CURRENT' })
  assert.notEqual((await find(approver, stale.id)).current_version_id, stale.current_version_id)

  // Each provider sends its real wire payload to a network-edge substitute.
  // Buttons are authenticated review links, never a claimed provider identity.
  let bindingNumber=10
  for(const channel of ['slack','teams','nook'])await h.owner.command('approval.channel.bind',{operatorId:approver.id,channel,destination:`synthetic-locket-${bindingNumber++}`,version:0})
  await approver.command('approval.channel.preferences',{version:0,channels:['email','slack','teams','nook','word','phone']})
  const everywhere=await review(requester),channelsId=randomUUID(),beforeChannelMail=h.mails.length
  const requested=await requester.command('approval.channel.request',{...payload(everywhere,approver.id),kind:'commercial'},{commandId:channelsId})
  assert.equal(requested.status,'queued');assert.equal(h.mails.length,beforeChannelMail+1)
  assert.ok(h.mails.at(-1).TextBody, 'The approval email reached the Postmark network edge.')
  const emailLink=h.mails.at(-1).text.match(/https?:\/\/[^\s]+/)[0]
  assert.equal(emailLink,requested.reviewUrl);assert.equal(chats.length,3)
  const slack=chats.find(m=>new URL(m.url).hostname==='slack.com'),teams=chats.find(m=>new URL(m.url).hostname==='graph.microsoft.com'),nook=chats.find(m=>new URL(m.url).hostname==='nook.example.test')
  assert.equal(slack.url,'https://slack.com/api/chat.postMessage')
  assert.equal(nook.url,'https://nook.example.test/api/slack/chat.postMessage')
  assert.equal(slack.body.blocks[1].elements[0].url,requested.reviewUrl)
  assert.equal(nook.body.blocks[1].elements[0].url,requested.reviewUrl)
  assert.equal(JSON.parse(teams.body.attachments[0].content).actions[0].url,requested.reviewUrl)
  const requestPath='/api/locket/approval-channels/requests/'+channelsId
  assert.equal((await h.request(requestPath)).status,401)
  assert.equal((await requester.request(requestPath)).status,404,'A forwarded link gives no recipient identity or record access.')
  const viewed=await (await approver.request(requestPath)).json()
  assert.equal(viewed.canDecide,true)
  for(const content of [JSON.stringify(slack.body),JSON.stringify(teams.body),JSON.stringify(nook.body),h.mails.at(-1).text,h.mails.at(-1).html]){
    assert.ok(!content.includes(everywhere.title));assert.ok(!content.includes('940271'));assert.ok(!content.includes(viewed.version.digest))
  }
  assert.deepEqual(await requester.command('approval.channel.request',{...payload(everywhere,approver.id),kind:'commercial'},{commandId:channelsId}),requested)
  assert.equal(chats.length,3);assert.equal(h.mails.length,beforeChannelMail+1)
  const acted=await approver.command('approval.channel.decide',{requestId:channelsId,versionId:viewed.request.versionId,versionDigest:viewed.request.versionDigest,contextDigest:viewed.request.contextDigest,decision:'approved'})
  assert.equal(acted.versionDigest,viewed.version.digest)
  const exact=(await requester.state()).approvals.find(r=>r.id===acted.id)
  assert.equal(exact.actor_id,approver.id);assert.equal(exact.version_digest,viewed.version.digest)
  assert.ok((await requester.state()).audit.some(r=>r.action==='approval.channel.decided'&&r.agreement_id===everywhere.id))
  const manifest=await approver.request('/api/locket/approval-channels/word-manifest')
  assert.equal(manifest.status,200);assert.ok((await manifest.text()).includes('/app#approval-word'))
  const receipts=(await approver.state()).approvalChannels.deliveries.filter(r=>r.request_id===channelsId)
  assert.equal(receipts.filter(r=>r.status==='accepted').length,4)
  assert.deepEqual(receipts.filter(r=>r.status==='available').map(r=>r.channel).sort(),['phone','word'])

  const second=await h.invite('second-approver@example.test','approver'),replaced=await review(requester)
  const emailed=await requester.command('approval.channel.request',{...payload(replaced,second.id),kind:'commercial'})
  const captured=await (await second.request('/api/locket/approval-channels/requests/'+emailed.id)).json()
  await requester.command('version.upload',{agreementId:replaced.id,version:replaced.version,kind:'counterparty',file:file('updated.pdf',pdf('Current channel agreement.')),text:'Current channel agreement.'})
  await second.command('approval.channel.decide',{requestId:emailed.id,versionId:captured.request.versionId,versionDigest:captured.request.versionDigest,contextDigest:captured.request.contextDigest,decision:'approved'},{error:'NOT_CURRENT'})
  const current=await (await second.request('/api/locket/approval-channels/requests/'+emailed.id)).json()
  assert.equal(current.current,false);assert.equal(current.canDecide,false);assert.equal(current.version.number,2);assert.equal(current.version.text,'Current channel agreement.')

  await h.owner.command('approval.channel.configure',{version:0,automatic:true})
  const automatic=await review(requester),ownRequests=(await approver.state()).approvalChannels.requests.filter(r=>r.agreement_id===automatic.id)
  assert.equal(ownRequests.length,1);assert.equal(ownRequests[0].source,'automatic')
  const beforeTick={mail:h.mails.length,chat:chats.length}
  await h.scheduled(Date.now());await h.scheduled(Date.now())
  assert.equal(chats.length,beforeTick.chat);assert.equal(h.mails.length,beforeTick.mail)
  const exported=await (await h.owner.request('/api/locket/export')).json()
  assert.ok(exported.records.lk_approval_channel_requests.some(r=>r.id===channelsId))
  assert.equal(exported.records.lk_approval_channel_deliveries.filter(r=>r.request_id===channelsId).length,6)

  // The same channel request joins the recipient's existing daily digest;
  // opting out of email suppresses its next request without changing authority.
  await h.owner.command('approval.channel.configure',{version:1,automatic:false})
  await approver.command('approval.channel.preferences',{version:1,channels:['email','word']})
  await approver.command('notification.preferences',{inApp:true,email:true,digest:true,timezone:'America/New_York'})
  const digestAgreement=await review(requester,{title:'Private digest agreement 940271'}),digestRequest=await requester.command('approval.channel.request',{...payload(digestAgreement,approver.id),kind:'commercial'})
  assert.equal((await approver.state()).approvalChannels.deliveries.find(d=>d.request_id===digestRequest.id&&d.channel==='email').code,'daily_digest')
  const noon=new Date();noon.setUTCHours(18,0,0,0);if(noon.getTime()<Date.now())noon.setUTCDate(noon.getUTCDate()+1)
  const beforeDigest=h.mails.filter(m=>m.to.includes('approver@example.test')).length
  await h.scheduled(noon.getTime());await h.scheduled(noon.getTime())
  const digestMails=h.mails.filter(m=>m.to.includes('approver@example.test'))
  assert.equal(digestMails.length,beforeDigest+1)
  assert.ok(digestMails.at(-1).text.includes(digestRequest.reviewUrl));assert.ok(!JSON.stringify(digestMails.at(-1)).includes(digestAgreement.title))
  assert.equal((await approver.state()).approvalChannels.deliveries.find(d=>d.request_id===digestRequest.id&&d.channel==='email').status,'accepted')
  await approver.command('notification.preferences',{inApp:true,email:false,digest:true,timezone:'America/New_York'})
  const mutedAgreement=await review(requester),muted=await requester.command('approval.channel.request',{...payload(mutedAgreement,approver.id),kind:'commercial'})
  assert.equal((await approver.state()).approvalChannels.deliveries.find(d=>d.request_id===muted.id&&d.channel==='email').code,'email_disabled')
  assert.equal(h.mails.filter(m=>m.to.includes('approver@example.test')).length,digestMails.length)

  await h.owner.command('approval.channel.configure',{version:2,automatic:true})

  // Channel doors inherit the frozen named route, unlocked stage, current
  // delegate and configured manual reminder limit without their own policy.
  const named=await approvalRuleFixture(h)
  for(const [index,person]of [named.finance,named.delegate].entries()){
    await h.owner.command('approval.channel.bind',{operatorId:person.id,channel:'slack',destination:`synthetic-locket-${40+index}`,version:0})
    await person.command('approval.channel.preferences',{version:0,channels:['slack','word']})
  }
  const draft=await h.owner.command('approval.rules.save',{version:0,rules:named.rules})
  await h.owner.command('approval.rules.preview',{version:draft.version,sample:{type:'supplier',value:'600000',departmentId:named.department.id,risk:'medium',dataProcessing:true,findingKeys:[]}})
  await h.owner.command('approval.rules.publish',{version:draft.version})
  const namedId=await ruleRequest(h.owner,named.requester,named.department.id),namedAgreement=await find(named.requester,namedId)
  await named.requester.command('agreement.submit',{agreementId:namedId,version:namedAgreement.version})
  let namedState=await named.finance.state(),financeRequest=namedState.approvalChannels.requests.find(r=>r.agreement_id===namedId&&r.source==='automatic')
  assert.ok(financeRequest)
  assert.equal((await named.security.state()).approvalChannels.requests.filter(r=>r.agreement_id===namedId).length,0)
  await h.owner.command('approval.availability',{operatorId:named.finance.id,version:0,away:true,delegateId:named.delegate.id})
  const displaced=await (await named.finance.request('/api/locket/approval-channels/requests/'+financeRequest.id)).json()
  assert.equal(displaced.canDecide,false)
  await named.finance.command('approval.channel.decide',{requestId:financeRequest.id,versionId:displaced.request.versionId,versionDigest:displaced.request.versionDigest,contextDigest:displaced.request.contextDigest,decision:'approved'},{error:'FORBIDDEN'})
  const delegated=(await named.delegate.state()).approvalChannels.requests.find(r=>r.agreement_id===namedId&&r.source==='automatic')
  assert.ok(delegated)
  const pending=(await h.owner.state()).rulePending.find(r=>r.agreement_id===namedId&&r.active===1)
  const beforeReminder=chats.length,aNamed=await find(named.requester,namedId)
  await named.requester.command('approval.rule.remind',{agreementId:namedId,version:aNamed.version,stepId:pending.step_id})
  assert.equal(chats.length,beforeReminder+1)
  await named.requester.command('approval.rule.remind',{agreementId:namedId,version:aNamed.version,stepId:pending.step_id},{error:'TOO_SOON'})
  const delegateView=await(await named.delegate.request('/api/locket/approval-channels/requests/'+delegated.id)).json()
  const delegateDecision=await named.delegate.command('approval.channel.decide',{requestId:delegated.id,versionId:delegateView.request.versionId,versionDigest:delegateView.request.versionDigest,contextDigest:delegateView.request.contextDigest,decision:'approved'})
  namedState=await h.owner.state()
  assert.equal(namedState.ruleDecisions.find(r=>r.approval_id===delegateDecision.id).acted_as,'delegate')
  assert.ok((await named.security.state()).approvalChannels.requests.some(r=>r.agreement_id===namedId&&r.source==='automatic'))



})

test('MOBILE-001 / NOTIFY-001 approval email checks sender, recipient role, current version, self-approval and restricted visibility on the server', async t => {
  const h = await installation(); t.after(() => h.close())
  const requester = await h.invite('requester@example.test', 'requester'), approver = await h.invite('approver@example.test', 'approver')
  const viewer = await h.invite('viewer@example.test', 'viewer'), agent = await h.invite('agent@example.test', 'agent')
  const a = await review(requester)
  let count = h.mails.length
  for (const sender of [viewer, agent]) await sender.command('approval.email', payload(a, approver.id), { error: 'FORBIDDEN' })
  for (const id of [viewer.id, requester.id, randomUUID()]) await requester.command('approval.email', payload(a, id), { error: 'RECIPIENT' })
  await requester.command('approval.email', { ...payload(a, approver.id), versionId: randomUUID() }, { error: 'NOT_CURRENT' })
  await requester.command('approval.email', { ...payload(a, approver.id), version: a.version + 1 }, { error: 'STALE' })
  for(const sender of [viewer,agent])await sender.command('approval.channel.request',{...payload(a,approver.id),kind:'commercial'},{error:'FORBIDDEN'})
  for(const id of [viewer.id,requester.id,randomUUID()])await requester.command('approval.channel.request',{...payload(a,id),kind:'commercial'},{error:'RECIPIENT'})
  await requester.command('approval.channel.request',{...payload(a,approver.id),kind:'commercial',versionId:randomUUID()},{error:'NOT_CURRENT'})
  await requester.command('approval.channel.request',{...payload(a,approver.id),kind:'commercial',version:a.version+1},{error:'STALE'})
  await viewer.command('approval.channel.configure',{version:0,automatic:true},{error:'FORBIDDEN'})
  await approver.command('approval.channel.preferences',{operatorId:viewer.id,version:0,channels:['slack']},{error:'FORBIDDEN'})
  assert.equal(h.mails.length, count, 'Refused explicit email commands make no provider calls.')
  const privateAgreement = await review(requester, { restricted: true })
  count = h.mails.length
  await requester.command('approval.email', payload(privateAgreement, approver.id), { error: 'RECIPIENT' })
  await requester.command('approval.channel.request',{...payload(privateAgreement,approver.id),kind:'commercial'},{error:'RECIPIENT'})
  await approver.command('approval.email', payload(privateAgreement, approver.id), { error: 'NOT_FOUND' })
  await h.owner.command('role.set', { operatorId: approver.id, role: 'viewer' })
  await requester.command('approval.email', payload(a, approver.id), { error: 'RECIPIENT' })
  assert.equal(h.mails.length, count)
  const self = await h.invite('self@example.test', 'approver'), own = await review(self)
  await self.command('approval.email', payload(own, self.id), { error: 'RECIPIENT' })
  const ownerId = (await h.owner.state()).actor.id
  const owned = await requester.command('approval.email', payload(privateAgreement, ownerId))
  assert.equal((await delivery(requester, privateAgreement, ownerId, owned.id)).status, 'accepted')
})

test('MOBILE-001 / NOTIFY-001 local suppression and uncertain provider outcomes never claim sending or resend on replay', async t => {
  const h = await installation({ bindings: { AUTH_LOCAL: 'true' } }); t.after(() => h.close())
  const a = await review(h.owner), ownerId = (await h.owner.state()).actor.id, commandId = randomUUID()
  const sent = await h.owner.command('approval.email', payload(a, ownerId), { commandId })
  assert.equal(sent.status, 'queued')
  const suppressed = await delivery(h.owner, a, ownerId, commandId)
  assert.equal(suppressed.status, 'suppressed')
  assert.equal(suppressed.providerMessageId, null)
  assert.equal(h.mails.length, 0)
  assert.ok((await h.owner.state()).notifications.items.every(n => n.email_status === 'suppressed'))
  assert.deepEqual(await h.owner.command('approval.email', payload(a, ownerId), { commandId }), sent)
  assert.ok((await h.owner.state()).audit.some(e => e.action === 'approval.email.suppressed'))
  await h.owner.command('approval.channel.bind',{operatorId:ownerId,channel:'slack',destination:'synthetic-locket-50',version:0})
  await h.owner.command('approval.channel.preferences',{version:0,channels:['email','slack','word','phone']})
  const localRequest=await h.owner.command('approval.channel.request',{...payload(a,ownerId),kind:'commercial'})
  const local=(await h.owner.state()).approvalChannels.deliveries.filter(d=>d.request_id===localRequest.id)
  assert.equal(local.filter(d=>d.status==='suppressed').length,2)
  assert.equal(local.filter(d=>d.status==='available').length,2)
  assert.equal(h.mails.length,0)

  let chatCalls=0
  const failed = await installation({bindings:{APPROVAL_SLACK_TOKEN:'synthetic-locket-4'},outboundResponse:async()=>{chatCalls++;throw new Error('Network outcome unknown')}, mailResponse: () => new Response('Provider unavailable', { status: 503 }) }); t.after(() => failed.close())
  const pending = await review(failed.owner), recipientId = (await failed.owner.state()).actor.id, failedId = randomUUID()
  const beforeExplicit = failed.mails.length
  const outcome = await failed.owner.command('approval.email', payload(pending, recipientId), { commandId: failedId })
  assert.equal(outcome.status, 'queued')
  const uncertain = await delivery(failed.owner, pending, recipientId, failedId)
  assert.equal(uncertain.status, 'uncertain'); assert.equal(uncertain.providerMessageId, null)
  assert.deepEqual(await failed.owner.command('approval.email', payload(pending, recipientId), { commandId: failedId }), outcome)
  assert.equal(failed.mails.length, beforeExplicit + 1)
  assert.ok((await failed.owner.state()).audit.some(e => e.action === 'approval.email.uncertain'))
  await failed.owner.command('approval.channel.bind',{operatorId:recipientId,channel:'slack',destination:'synthetic-locket-5',version:0})
  await failed.owner.command('approval.channel.preferences',{version:0,channels:['slack','word']})
  const chatId=randomUUID(),chatRequest=await failed.owner.command('approval.channel.request',{...payload(pending,recipientId),kind:'commercial'},{commandId:chatId})
  const unknown=(await failed.owner.state()).approvalChannels.deliveries.find(d=>d.request_id===chatId&&d.channel==='slack')
  assert.equal(unknown.status,'uncertain');assert.equal(unknown.provider_message_id,null)
  assert.deepEqual(await failed.owner.command('approval.channel.request',{...payload(pending,recipientId),kind:'commercial'},{commandId:chatId}),chatRequest)
  await failed.scheduled(Date.now());assert.equal(chatCalls,1)

})
