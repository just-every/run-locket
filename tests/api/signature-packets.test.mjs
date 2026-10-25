import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { installation } from './harness.mjs'
import { agreement,assertTemplatePlacements,approvePacket,configureConnection,configurePacket,digest,manualPacket,preparePacket,recipient,sendPacket,signatureEdge,signerRules,signingTemplate,templatePacket } from './signature-packet-fixture.mjs'

test('Signer rules preview and freeze type, exact USD bounds, entity, department and unavailable fallback before packet approval',async t=>{
 const h=await installation();t.after(()=>h.close())
 const department=await h.owner.command('audience.save',{name:'Synthetic Sales',kind:'department',memberIds:[]})
 const entity=await h.owner.command('entity.save',{legalName:'Synthetic Holdings Inc.',entityType:'Corporation',formation:'Delaware, United States',registeredAddress:'Synthetic address',noticeAddress:'Synthetic notice address',currency:'USD',timezone:'America/New_York',signatories:[{name:'Synthetic CFO',email:'cfo@example.test',title:'CFO'}]})
 const f=await signerRules(h,{departmentId:department.id,entityId:entity.id})
 for(const [type,value,departmentId,expected,fallback] of [['customer','250000',department.id,f.cfo.id,false],['customer','50000',department.id,f.vp.id,false],['customer','100000',department.id,f.cfo.id,false],['nda','250000',department.id,f.fallback.id,true],['customer','250000',null,f.fallback.id,true]]){
  const route=await h.owner.command('signature.rules.preview',{version:1,sample:{type,value,departmentId,entityId:entity.id}});assert.equal(route.signer.id,expected);assert.equal(route.fallback,fallback)
 }
 const wrongEntity=await h.owner.command('signature.rules.preview',{version:1,sample:{type:'customer',value:'250000',departmentId:department.id}});assert.equal(wrongEntity.signer.id,f.fallback.id)
 await h.owner.command('signature.availability',{operatorId:f.cfo.id,version:0,away:true})
 const route=await h.owner.command('signature.rules.preview',{version:1,sample:{type:'customer',value:'250000',departmentId:department.id,entityId:entity.id}})
 assert.equal(route.signer.id,f.fallback.id);assert.equal(route.fallback,true)
 await h.owner.command('signature.availability',{operatorId:f.fallback.id,version:0,away:true})
 await h.owner.command('signature.rules.preview',{version:1,sample:{type:'customer',value:'250000',departmentId:department.id,entityId:entity.id}},{error:'SIGNER_UNAVAILABLE'})
 await f.vp.command('signature.rules.save',{version:1,fallbackId:f.vp.id,rules:[]},{error:'FORBIDDEN'})
 await h.owner.command('signature.rules.save',{version:1,fallbackId:f.vp.id,rules:[]})
 await h.owner.command('signature.rules.publish',{version:2},{error:'PREVIEW'})
})

test('Approved MSA plus DPA and template fields reach three real adapter network edges; the identical manifest shape prepares only a draft in Inkwell',async t=>{
 const edge=signatureEdge(),h=await installation(edge);t.after(()=>h.close())
 const f=await signerRules(h),main=await signingTemplate(h.owner,'MSA'),dpa=await signingTemplate(h.owner,'DPA')
 for(const provider of ['docusign','adobe-acrobat-sign','dropbox-sign','inkwell']){
  await configureConnection(h.owner,provider)
  const id=await templatePacket(h.owner,{main,dpa}),prepared=await preparePacket(h.owner,id,provider),manifest=prepared.manifest
  assert.equal(manifest.documents.length,2);assert.equal(manifest.fields.length,20);assert.equal(manifest.signerRule.signerId,f.cfo.id)
  assert.ok(manifest.fields.every(f=>f.anchor&&f.page===1));assert.equal(new Set(manifest.documents.map(d=>d.sha256)).size,2)
  const approval=(await h.owner.state()).approvals.find(a=>a.id===manifest.approvals[0]);const context=JSON.parse(approval.context)
  if(['adobe-acrobat-sign','dropbox-sign'].includes(provider)){const pinned=JSON.parse(context.signaturePacket.providerRenditions.find(r=>r.provider===provider).definition);assert.deepEqual(pinned.documents.map(d=>d.sha256),manifest.documents.map(d=>d.sha256));assert.equal(pinned.derivations.length,2)}else assert.deepEqual([context.signaturePacket.mainDocument.sha256,...context.signaturePacket.documents.map(d=>d.sha256)],manifest.documents.map(d=>d.sha256))
  const commandId=randomUUID(),payload={agreementId:id,version:(await agreement(h.owner,id)).version,packageId:prepared.packageId,connectionVersion:1,manifestDigest:digest(prepared.pkg.manifest),consent:true,mode:provider==='inkwell'?'prepare':'send'}
  if(provider==='inkwell')await h.owner.command('package.send',{...payload,mode:'send'},{error:'INKWELL_SEND_UNAVAILABLE'})
  await h.owner.command('package.send',payload,{commandId})
  await h.owner.command('package.send',payload,{commandId})
  const request=edge.requests.at(-1),dispatch=(await h.owner.state()).signature.dispatches.find(d=>d.package_id===prepared.packageId)
  const observed=(await h.owner.state()).connections.find(c=>c.id===provider);assert.equal(observed.status,'healthy');assert.ok(observed.last_sync_at);assert.equal(observed.last_success_at,null)
  assert.equal(dispatch.status,provider==='inkwell'?'provider_prepared':'sent',provider+': '+dispatch.outcome_code)
  if(provider!=='inkwell'){const delivered=await h.owner.state();assert.equal(delivered.notifications.items.filter(n=>n.agreement_id===id&&n.kind==='signature').length,1,provider+' signature notification; '+JSON.stringify(delivered.notifications.items.map(n=>({kind:n.kind,agreementId:n.agreement_id}))));assert.ok(delivered.workflowHistory.some(w=>w.agreement_id===id&&w.from_status==='approved'&&w.to_status==='out_for_signature'))}
  assert.equal(dispatch.status,provider==='inkwell'?'provider_prepared':'sent');assert.equal(edge.requests.filter(r=>r.provider===provider).length,1)
  assert.deepEqual(request.documents.map(d=>d.sha256),manifest.documents.map(d=>d.sha256))
  for(const [i,d] of request.documents.entries())assert.deepEqual(Buffer.from(await (await h.owner.request('/api/locket/files/'+manifest.documents[i].artifactId)).arrayBuffer()),d.bytes)
  if(provider==='docusign'){await assertTemplatePlacements(request.documents.map((d,i)=>({...d,id:manifest.documents[i].id})),manifest.fields);assert.equal(request.body.recipients.signers.length,2);assert.equal(request.body.recipients.signers.flatMap(s=>s.tabs.signHereTabs).length,4)}
  if(provider==='dropbox-sign')assert.equal(request.fields.length,manifest.fields.length)
  if(provider==='adobe-acrobat-sign'){assert.equal(request.fields.length,manifest.fields.length);assert.equal(request.sent,true)}
  if(provider==='inkwell'){assert.equal(request.body.fields.length,manifest.fields.length);assert.equal((await agreement(h.owner,id)).status,'approved')}
 }

 const low=await templatePacket(h.owner,{main,dpa,value:'50000'}),lowPacket=await preparePacket(h.owner,low)
 assert.equal(lowPacket.manifest.signerRule.signerId,f.vp.id)
 const frozen=await templatePacket(h.owner,{main,dpa})
 await h.owner.command('signature.rules.save',{version:1,fallbackId:f.vp.id,rules:[]})
 await h.owner.command('signature.rules.preview',{version:2,sample:{type:'customer',value:'250000'}})
 await h.owner.command('signature.rules.publish',{version:2})
 assert.equal((await preparePacket(h.owner,frozen)).manifest.signerRule.signerId,f.cfo.id)
 await h.owner.command('signature.availability',{operatorId:f.cfo.id,version:0,away:true})
 await h.owner.command('package.prepare',{agreementId:frozen,version:(await agreement(h.owner,frozen)).version,provider:'docusign',recipients:[]},{error:'SIGNER_CHANGED'})
 const frozenRow=(await h.owner.state()).signature.packets.find(p=>p.agreement_id===frozen)
 await configurePacket(h.owner,frozen,{documents:JSON.parse(frozenRow.documents).map(d=>({artifactId:d.artifactId,purpose:d.purpose})),fields:JSON.parse(frozenRow.fields),recipients:JSON.parse(frozenRow.recipients),reason:'Coordinator reviewed the current required fallback after availability changed.'})
 await approvePacket(h.owner,frozen)
 const fallback=await preparePacket(h.owner,frozen)
 assert.equal(fallback.manifest.signerRule.signerId,f.fallback.id)
 assert.equal(fallback.manifest.signerRule.fallback,true)
})

test('Counterparty PDF page seven signature and date plus CC travel through every adapter without changing approved bytes',async t=>{
 const edge=signatureEdge(),h=await installation(edge);t.after(()=>h.close())
 for(const provider of ['docusign','adobe-acrobat-sign','dropbox-sign','inkwell']){
  await configureConnection(h.owner,provider)
  const f=await manualPacket(h.owner),prepared=await preparePacket(h.owner,f.id,provider)
  assert.deepEqual(prepared.manifest.fields.map(f=>[f.kind,f.page,f.x,f.y]),[['signature',7,70,500],['date',7,70,550]])
  await sendPacket(h.owner,f.id,prepared)
  const receipt=(await h.owner.state()).signature.dispatches.find(d=>d.package_id===prepared.packageId);assert.equal(receipt.status,provider==='inkwell'?'provider_prepared':'sent',provider+': '+receipt.outcome_code)
  const request=edge.requests.at(-1);const original=(await h.owner.state()).artifacts.find(a=>a.agreement_id===f.id&&a.role==='original');assert.deepEqual(Buffer.from(await(await h.owner.request('/api/locket/files/'+original.id)).arrayBuffer()),f.bytes);assert.ok(request.documents[0].bytes.equals(Buffer.from(await(await h.owner.request('/api/locket/files/'+prepared.manifest.documents[0].artifactId)).arrayBuffer())),provider+' must send the exact reviewed bytes');if(!['adobe-acrobat-sign','dropbox-sign'].includes(provider))assert.deepEqual(request.documents[0].bytes,f.bytes)
  if(provider==='docusign'){assert.equal(request.body.recipients.carbonCopies[0].email,'cc@example.test');assert.equal(request.body.recipients.signers[0].tabs.signHereTabs[0].pageNumber,'7')}
  if(provider==='dropbox-sign'){assert.equal(request.values['cc_email_addresses[0]'],'cc@example.test');assert.equal(request.values.use_text_tags,'true');assert.deepEqual(request.fields.map(f=>f.page),[7,7]);assert.match(request.fields[0].tag,/signer0/)}
  if(provider==='adobe-acrobat-sign'){assert.equal(request.body.ccs[0].email,'cc@example.test');assert.deepEqual(request.fields.map(f=>f.page),[7,7]);assert.match(request.fields[0].tag,/signer1:signature/)}
  if(provider==='inkwell'){assert.equal(request.body.copies[0].email,'cc@example.test');assert.deepEqual(request.body.fields.map(f=>f.documentPage),[6,6])}
 }
})

test('Current coordinator group and requester relationship guard signer edits; edits withdraw exact packet approval and archives retain evidence',async t=>{
 const h=await installation();t.after(()=>h.close())
 const requester=await h.invite('requester@example.test','requester'),other=await h.invite('other-requester@example.test','requester'),viewer=await h.invite('viewer@example.test','viewer'),approver=await h.invite('coordinator@example.test','approver')
 const f=await manualPacket(h.owner,{creator:requester}),a=await agreement(h.owner,f.id),group=await h.owner.command('audience.save',{name:'Signature coordinators',kind:'group',memberIds:[approver.id]})
 await h.owner.command('signature.coordinators',{type:'nda',audienceId:group.id,version:0})
 const packet=(await h.owner.state()).signature.packets.find(p=>p.agreement_id===f.id),payload={agreementId:f.id,version:a.version,revision:packet.revision,documents:[],fields:JSON.parse(packet.fields),recipients:[{name:'CC',email:'cc@example.test',action:'copy',partyRole:'copy'},recipient],reason:'Reorder recipients'}
 for(const client of [requester,other,viewer])await client.command('package.configure',payload,{error:'FORBIDDEN'})
 const editId=randomUUID()
 await approver.command('package.configure',payload,{commandId:editId})
 assert.equal((await agreement(h.owner,f.id)).status,'in_review')
 assert.ok((await h.owner.state()).approvals.filter(a=>a.agreement_id===f.id).every(a=>a.invalidated_at))
 await h.owner.command('package.prepare',{agreementId:f.id,version:(await agreement(h.owner,f.id)).version,provider:'docusign',recipients:[]},{error:'STATUS'})
 await approvePacket(h.owner,f.id)
 const prepared=await preparePacket(h.owner,f.id)
 assert.equal(prepared.manifest.recipients[0].email,'cc@example.test');assert.equal(prepared.manifest.changes.at(-1).actor_id,approver.id)
 const archive=await (await h.owner.request('/api/locket/export')).json()
 assert.ok(archive.records.lk_signature_packet_changes.some(r=>r.agreement_id===f.id&&r.actor_id===approver.id))
 const agent=await h.invite('synthetic-locket-packet-agent@example.test','agent'),beforeProposal=(await h.owner.state()).signature.packets.find(p=>p.agreement_id===f.id),agentPayload={...payload,version:(await agreement(h.owner,f.id)).version,revision:beforeProposal.revision,reason:'Agent suggests the same reviewed routing for coordinator confirmation.'}
 await agent.command('package.configure',agentPayload,{error:'FORBIDDEN'})
 const proposal=await agent.command('proposal.prepare',{kind:'signature',payload:agentPayload,evidence:['The retained page-seven PDF and current coordinator routing.']})
 await approver.command('proposal.decide',{proposalId:proposal.id,decision:'approve'})
 assert.equal((await h.owner.state()).proposals.find(p=>p.id===proposal.id).decided_by,approver.id)
 await approvePacket(h.owner,f.id)
 // Removing current membership takes effect without changing packet configuration.
 await h.owner.command('audience.save',{id:group.id,version:group.version,name:'Signature coordinators',kind:'group',memberIds:[]})
 await approver.command('package.configure',payload,{commandId:editId,error:'FORBIDDEN'})
 await approver.command('package.prepare',{agreementId:f.id,version:(await agreement(h.owner,f.id)).version,provider:'docusign',recipients:[]},{error:'FORBIDDEN'})
})

test('An uncertain provider send is visible, has one network attempt and cannot silently retry or be marked sent manually',async t=>{
 const edge=signatureEdge({failSend:true}),h=await installation(edge);t.after(()=>h.close())
 await configureConnection(h.owner,'docusign')
 const f=await manualPacket(h.owner),prepared=await preparePacket(h.owner,f.id)
 const sendId=randomUUID()
 await Promise.all([sendPacket(h.owner,f.id,prepared,{commandId:sendId}),sendPacket(h.owner,f.id,prepared,{commandId:sendId})])
 const dispatch=(await h.owner.state()).signature.dispatches.find(d=>d.package_id===prepared.packageId)
 assert.equal(dispatch.status,'uncertain');assert.equal((await agreement(h.owner,f.id)).status,'approved')
 const observed=(await h.owner.state()).connections.find(c=>c.id==='docusign');assert.equal(observed.status,'failing');assert.equal(observed.reason,'provider_http_503');assert.equal(observed.last_sync_at,null);assert.equal(observed.alert_status,'accepted');assert.equal(h.mails.filter(m=>m.subject==='A Locket connection needs attention').length,1)
 const a=await agreement(h.owner,f.id)
 await h.owner.command('package.send',{agreementId:f.id,version:a.version,packageId:prepared.packageId,connectionVersion:1,manifestDigest:digest(prepared.pkg.manifest),consent:true},{error:'ALREADY_SENT'})
 assert.equal(edge.attempts.filter(a=>a.path.endsWith('/envelopes')).length,1)
 await h.owner.command('package.sent',{agreementId:f.id,version:(await agreement(h.owner,f.id)).version,packageId:prepared.packageId,envelopeId:'synthetic-locket-7'},{error:'SEND_PENDING'})
 assert.ok((await h.owner.state()).audit.some(e=>e.action==='signature.provider.uncertain'))
})


test('Connection checks expose credential failure, one owner alert, current affected agreements and read-only recovery',async t=>{
 let failing=true,probes=0,invalidHubspot=false,uncertainExpiry=false
 const h=await installation({mailResponse:mail=>{if(uncertainExpiry&&mail.subject==='A Locket credential needs renewal')throw Error('synthetic-locket-mail-outcome');return Response.json({id:'synthetic-locket-mail-receipt'})},bindings:{HUBSPOT_ACCESS_TOKEN:'synthetic-locket-69',SIGNATURE_DOCUSIGN_TOKEN:'synthetic-locket-70',APPROVAL_SLACK_TOKEN:'synthetic-locket-71',APPROVAL_TEAMS_TOKEN:'synthetic-locket-72',QUICKBOOKS_ACCESS_TOKEN:'synthetic-locket-73',QUICKBOOKS_REALM_ID:'12345'},outboundResponse:async request=>{
  const url=new URL(request.url);probes++
  if(url.hostname==='demo.docusign.net'){
   assert.equal(request.method,'GET');assert.equal(url.pathname,'/restapi/v2.1/accounts/synthetic-locket-account')
   return failing?Response.json({error:'synthetic-locket-74'},{status:401}):Response.json({accountId:'synthetic-locket-account'})
  }
  if(url.hostname==='api.hubapi.com'){assert.equal(request.method,'GET');assert.equal(url.pathname,'/account-info/v3/details');assert.equal(request.headers.get('authorization'),'Bearer synthetic-locket-69');return Response.json({portalId:invalidHubspot?'not-an-account':123456,accountType:'DEVELOPER_TEST'})}
  if(url.hostname==='slack.com')return Response.json({ok:true,user_id:'synthetic-locket-75'})
  if(url.hostname==='graph.microsoft.com')return Response.json({id:'synthetic-locket-76'})
  return Response.json({CompanyInfo:{Id:'12345'}})
 }});t.after(()=>h.close())
 const viewer=await h.invite('synthetic-locket-77@example.test','viewer')
 await h.owner.command('signature.connection.configure',{provider:'docusign',baseUrl:'https://demo.docusign.net/restapi/v2.1',accountId:'synthetic-locket-account',version:0})
 const f=await manualPacket(h.owner)
 await preparePacket(h.owner,f.id)
 const commandId=randomUUID(),before=probes
 await viewer.command('connection.check',{id:'docusign'},{error:'FORBIDDEN'})
 assert.equal(probes,before)
 await h.owner.command('connection.check',{id:'docusign'},{commandId})
 let row=(await h.owner.state()).connections.find(c=>c.id==='docusign')
 assert.equal(row.status,'failing');assert.equal(row.reason,'credential_rejected');assert.ok(row.agreementIds.includes(f.id));assert.equal(row.alert_status,'accepted')
 const alerts=()=>h.mails.filter(m=>m.subject==='A Locket connection needs attention')
 assert.equal(alerts().length,1);assert.ok(!JSON.stringify(alerts()).includes((await h.owner.state()).agreements.find(a=>a.id===f.id).title))
 await h.owner.command('connection.check',{id:'docusign'},{commandId})
 await h.owner.command('connection.check',{id:'docusign'})
 assert.equal(alerts().length,1)
 failing=false
 await h.owner.command('signature.connection.configure',{provider:'docusign',baseUrl:'https://demo.docusign.net/restapi/v2.1',accountId:'synthetic-locket-account',version:1})
 await h.owner.command('connection.check',{id:'docusign'})
 row=(await h.owner.state()).connections.find(c=>c.id==='docusign')
 assert.equal(row.status,'healthy');assert.ok(row.last_success_at);assert.equal(row.alert_status,null)
 for(const id of ['hubspot','slack','teams','quickbooks'])await h.owner.command('connection.check',{id})
 assert.ok((await h.owner.state()).connections.filter(c=>c.probe).every(c=>c.status==='healthy'))
 const verified=(await h.owner.state()).connections
 for(const [id,account]of [['hubspot','123456'],['slack','synthetic-locket-75'],['teams','synthetic-locket-76'],['docusign','synthetic-locket-account']])assert.equal(verified.find(c=>c.id===id).provider_account,account)
 invalidHubspot=true;await h.owner.command('connection.check',{id:'hubspot'})
 const refused=(await h.owner.state()).connections.find(c=>c.id==='hubspot')
 assert.equal(refused.status,'failing');assert.equal(refused.reason,'invalid_provider_receipt');assert.equal(refused.provider_account,null)
 invalidHubspot=false;await h.owner.command('connection.check',{id:'hubspot'})
 assert.equal((await h.owner.state()).connections.find(c=>c.id==='hubspot').provider_account,'123456')
 assert.deepEqual((await viewer.state()).connections,[])
 const now=Date.UTC(2026,9,25,12),expiresAt=now+8*86400000
 await h.setTime(now)
 await viewer.command('connection.expiry',{id:'docusign',version:0,expiresAt,consent:true},{error:'FORBIDDEN'})
 await h.owner.command('connection.expiry',{id:'docusign',version:0,expiresAt},{error:'CONSENT'})
 await h.owner.command('connection.expiry',{id:'docusign',version:0,expiresAt,consent:true})
 await h.owner.command('connection.expiry',{id:'docusign',version:0,expiresAt,consent:true},{error:'STALE'})
 const warnings=()=>h.mails.filter(m=>m.subject==='A Locket credential needs renewal')
 await h.scheduled(now);assert.equal(warnings().length,0)
 await h.setTime(now+86400000)
 await Promise.all([h.scheduled(now+86400000),h.scheduled(now+86400000)])
 assert.equal(warnings().length,1)
 assert.ok(!JSON.stringify(warnings()).includes('synthetic-locket-account'))
 row=(await h.owner.state()).connections.find(c=>c.id==='docusign')
 assert.equal(row.credentialExpiry.expires_at,expiresAt);assert.equal(row.credentialExpiry.alert_status,'accepted')
 await h.scheduled(now+2*86400000);assert.equal(warnings().length,1)
 await h.owner.command('connection.expiry',{id:'docusign',version:1,expiresAt:null,consent:true})
 await h.scheduled(now+20*86400000);assert.equal(warnings().length,1)
 assert.equal((await h.owner.state()).connections.find(c=>c.id==='docusign').credentialExpiry.expires_at,null)
 await h.owner.command('connection.expiry',{id:'docusign',version:2,expiresAt,consent:true})
 await h.owner.command('signature.connection.configure',{provider:'docusign',baseUrl:'https://demo.docusign.net/restapi/v2.1',accountId:'synthetic-locket-account',version:2})
 row=(await h.owner.state()).connections.find(c=>c.id==='docusign')
 assert.equal(row.status,'unverified');assert.equal(row.credentialExpiry.expires_at,undefined)
 await h.scheduled(now+20*86400000);assert.equal(warnings().length,1)
 uncertainExpiry=true
 await h.owner.command('connection.expiry',{id:'docusign',version:3,expiresAt,consent:true})
 await h.scheduled(now+20*86400000)
 assert.equal(warnings().length,2)
 assert.equal((await h.owner.state()).connections.find(c=>c.id==='docusign').credentialExpiry.alert_status,'uncertain')
 await h.scheduled(now+21*86400000);assert.equal(warnings().length,2)
 await h.owner.command('connection.check',{id:'docusign'})

 const archive=await(await h.owner.request('/api/locket/export')).json()
 assert.equal(archive.records.lk_connection_expiries.length,1)
 assert.equal(archive.records.lk_connection_health.length,5)
 for(const secret of ['synthetic-locket-69','synthetic-locket-70'])assert.ok(!JSON.stringify(archive).includes(secret))
})
