import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { installation } from './harness.mjs'
import { team, library, outForSignature, approved, pdf } from './setup.mjs'
import { zip, file } from './files.mjs'
import { configureModel } from './model-settings-fixture.mjs'

export function followupProvider() {
 const edge={completed:false,signed:null,certificate:pdf('synthetic-locket-8 certificate'),files:new Map(),writes:[],crm:null,beforeWrite:null,beforeReadback:null,wrongDigest:false}
 edge.bindings={CHEST_ORIGIN:'https://chest.example.test',CHEST_TOKEN:'synthetic-locket-14',SIGNATURE_DOCUSIGN_TOKEN:'synthetic-locket-8',SIGNATURE_DOCUSIGN_CONNECT_SECRET:'synthetic-locket-9',EXECUTION_GOOGLE_DRIVE_TOKEN:'synthetic-locket-10',EXECUTION_MICROSOFT_TOKEN:'synthetic-locket-11',HUBSPOT_ACCESS_TOKEN:'synthetic-locket-12',LOCKET_MODEL_SIMULATION:'true',AI_API_KEY:'synthetic-locket-13'}
 edge.outboundResponse=async request=>{
  const u=new URL(request.url),path=u.pathname
  if(u.hostname==='demo.docusign.net'){
   if(path.endsWith('/recipients'))return Response.json({signers:[{name:'Hana Park',email:'hana@harbour.example',status:'completed'},{name:'Olive Owner',email:'owner@example.test',status:'completed'}]})
   if(path.endsWith('/documents/combined'))return new Response(edge.signed)
   if(path.endsWith('/documents/certificate'))return new Response(edge.certificate)
   return Response.json({envelopeId:decodeURIComponent(path.split('/').at(-1)),status:edge.completed?'completed':'sent',completedDateTime:'2026-10-26T12:00:00Z'})
  }
  if(u.hostname==='synthetic-locket.sharepoint.com'){
   assert.equal(request.headers.get('authorization'),null,'Graph credentials never reach the original download host')
   const id=path.split('/').at(-1);assert.ok(edge.files.has(id))
   return new Response(edge.files.get(id))
  }
  if(u.hostname==='api.openai.com'){
   const body=await request.json(),input=JSON.parse(body.messages.at(-1).content)
   assert.ok(input.text.includes('Payment terms: invoices are payable within 30 days.'))
   edge.writes.push({kind:'extraction'})
   return Response.json({choices:[{message:{content:JSON.stringify({proposals:[{key:'payment_terms',value:'30 days',quote:'Payment terms: invoices are payable within 30 days.'}]})}}],usage:{prompt_tokens:100,completion_tokens:20}})
  }
  if(u.hostname==='chest.example.test'){
   const base='/api/chest/integrations/v1/items'
   if(request.method==='POST'){
    assert.equal(path,base);assert.ok(request.headers.get('idempotency-key'))
    const body=await request.json();assert.equal(body.parent,'synthetic-locket-folder')
    const id='synthetic-locket-file-'+edge.files.size,bytes=Buffer.from(body.base64,'base64')
    edge.files.set(id,{bytes,name:body.name,parent:body.parent});edge.writes.push({kind:'chest',name:body.name,bytes})
    return Response.json({id})
   }
   const id=path.split('/')[6],file=edge.files.get(id);assert.ok(file,request.url)
   return path.includes('/bytes/')?new Response(file.bytes):Response.json({id,name:file.name,parent:file.parent,version:'synthetic-locket-version'})
  }
  if(path==='/drive/v3/about')return Response.json({user:{emailAddress:'synthetic-locket-owner@example.test'}})
  if(path==='/account-info/v3/details')return Response.json({portalId:'synthetic-locket-account'})
  if(u.hostname==='api.hubapi.com'){
   assert.equal(path,'/crm/v3/objects/deals/synthetic-locket-deal')
   if(request.method==='PATCH'){
    const payload=await request.json();assert.deepEqual(payload,{properties:{contract_status:'executed'}})
    edge.writes.push({kind:'hubspot',payload});edge.crm=payload
    if(edge.beforeWrite){const action=edge.beforeWrite;edge.beforeWrite=null;await action()}
   }
   if(request.method==='GET'&&edge.beforeReadback){const action=edge.beforeReadback;edge.beforeReadback=null;await action()}
   return Response.json({id:'synthetic-locket-deal',...(edge.wrongCrm?{properties:{contract_status:'draft'}}:edge.crm)})
  }
  if(request.method==='POST'){
   assert.equal(path,'/upload/drive/v3/files')
   const raw=Buffer.from(await request.arrayBuffer()),boundary=request.headers.get('content-type').split('boundary=')[1]
   const split=raw.indexOf('\r\n--'+boundary),metadata=JSON.parse(raw.subarray(raw.indexOf('\r\n\r\n')+4,split).toString())
   const start=raw.indexOf('\r\n\r\n',split)+4,end=raw.lastIndexOf('\r\n--'+boundary)
   assert.deepEqual(metadata.parents,['synthetic-locket-folder']);assert.ok(metadata.name.startsWith('LKT-'))
   const id='synthetic-locket-file-'+edge.files.size,bytes=raw.subarray(start,end)
   edge.files.set(id,bytes);edge.writes.push({kind:'google-drive',name:metadata.name,bytes})
   return Response.json({id,name:metadata.name,parents:metadata.parents})
  }
  if(request.method==='PUT'){
   const name=decodeURIComponent(path.match(/:\/(.+):\/content$/)[1]),drive=decodeURIComponent(path.split('/')[3]),folder=decodeURIComponent(path.split('/')[5].split(':')[0])
   const id='synthetic-locket-file-'+edge.files.size,bytes=Buffer.from(await request.arrayBuffer())
   edge.files.set(id,bytes);edge.writes.push({kind:drive,name,bytes})
   return Response.json({id,name,parentReference:{id:folder,driveId:drive}})
  }
  const id=path.split('/').filter(Boolean).find(p=>p.startsWith('synthetic-locket-file-'))
  assert.ok(edge.files.has(id),request.url)
  if(u.hostname==='graph.microsoft.com')return new Response(null,{status:302,headers:{location:edge.badRedirect?'https://synthetic-locket.invalid/private':'https://synthetic-locket.sharepoint.com/originals/'+id}})
  return new Response(edge.wrongDigest?pdf('synthetic-locket-8 wrong copy'):edge.files.get(id))
 }
 return edge
}
export async function prepareFollowupFixture(h,edge,{restricted=false}={}) {
 const tm=await team(h),lib=await library(h,tm),ownerId=(await tm.owner.state()).actor.id
 const {id,pkg}=await outForSignature(h,tm,lib,{restricted,ownerId})
 edge.signed=Buffer.from(await(await tm.owner.request('/api/locket/files/'+pkg.pdfArtifactId)).arrayBuffer())
 await tm.owner.command('signature.connection.configure',{provider:'docusign',baseUrl:'https://demo.docusign.net/restapi/v2.1',accountId:'synthetic-locket-signing',version:0})
 await configureModel(h,{ocrProvider:'none'})
 const a=(await tm.owner.state()).agreements.find(a=>a.id===id)
 const base={agreementId:id,version:a.version,packageId:pkg.packageId,consent:true}
 const authorize=async(kind,changes={})=>{
  const destination={accountId:kind==='google-drive'?'synthetic-locket-owner@example.test':kind==='hubspot'?'synthetic-locket-account':kind==='chest'?edge.bindings.CHEST_ORIGIN:kind,connectionRevision:1}
  if(kind!=='extraction')await tm.owner.command('execution.destination.configure',{kind,accountId:destination.accountId,revision:0})
  return tm.owner.command('execution.followup.authorize',{...base,kind,...destination,folderId:'synthetic-locket-folder',namingRule:'{reference}-{role}',dealId:'synthetic-locket-deal',property:'contract_status',value:'executed',simulated:true,...changes})
 }
 const complete=async()=>{
  edge.completed=true
  const event={event:'envelope-completed',data:{accountId:'synthetic-locket-signing',envelopeId:`ENV-${id.slice(0,8)}`}},body=JSON.stringify(event)
  const response=await h.request('/api/locket/events/docusign',{method:'POST',body:event,headers:{'x-docusign-signature-1':createHmac('sha256',edge.bindings.SIGNATURE_DOCUSIGN_CONNECT_SECRET).update(body).digest('base64')}})
  assert.equal(response.status,204)
 }
 return {tm,id,pkg,base,authorize,complete}
}
export async function executionFollowupJourney(t) {
 const edge=followupProvider(),h=await installation(edge);t.after(()=>h.close())
 const f=await prepareFollowupFixture(h,edge,{restricted:true})
 await f.tm.requester.command('execution.followup.authorize',{...f.base,kind:'extraction'},{error:'FORBIDDEN'})
 await f.tm.owner.command('execution.followup.authorize',{...f.base,kind:'extraction',consent:false},{error:'CONSENT'})
 await f.tm.requester.command('execution.destination.configure',{kind:'google-drive',accountId:'synthetic-locket-owner@example.test',revision:0},{error:'FORBIDDEN'})
 const decisionStart=Date.now(),decisions=[]
 for(const kind of ['extraction','google-drive','onedrive','sharepoint','chest','hubspot'])decisions.push(await f.authorize(kind))
 const decisionEnd=Date.now()
 assert.equal(edge.writes.length,0,'follow-up consent never sends before clean execution')
 const retrieval=await f.tm.owner.command('execution.retrieval.authorize',f.base)
 assert.equal(edge.writes.length,0)
 const started=performance.now()
 await f.complete()
 const state=await f.tm.owner.state()
 assert.equal(state.agreements.find(a=>a.id===f.id).status,'executed')
 assert.equal(state.agreements.find(a=>a.id===f.id).owner_id,state.actor.id)
 assert.notEqual(state.agreements.find(a=>a.id===f.id).requester_id,state.actor.id)
 const execution=state.executions.find(e=>e.agreement_id===f.id)
 assert.equal(state.artifacts.find(a=>a.id===execution.signed_artifact_id).sha256,createHash('sha256').update(edge.signed).digest('hex'))
 assert.equal(state.artifacts.find(a=>a.id===execution.certificate_artifact_id).sha256,createHash('sha256').update(edge.certificate).digest('hex'))
 const rows=state.executionFollowups.filter(r=>r.agreement_id===f.id)
 assert.deepEqual(rows.map(r=>r.kind).sort(),['chest','extraction','google-drive','hubspot','onedrive','sharepoint'])
 assert.deepEqual(rows.map(r=>r.status),['completed','completed','completed','completed','completed','completed'])
 const output=state.models.outputs.find(o=>o.agreement_id===f.id)
 assert.equal(output.task,'extraction');assert.equal(output.status,'proposed');assert.equal(output.accepted_by,null)
 assert.deepEqual(JSON.parse(output.content).proposals,[{key:'payment_terms',value:'30 days',quote:'Payment terms: invoices are payable within 30 days.'}])
 assert.equal(state.terms.filter(r=>r.agreement_id===f.id).length,0,'kickoff never confirms extracted terms')
 for(const kind of ['google-drive','onedrive','sharepoint','chest']){
  const copies=edge.writes.filter(w=>w.kind===kind)
  assert.deepEqual(copies.map(c=>c.name).sort(),[`${state.agreements.find(a=>a.id===f.id).reference}-certificate.pdf`,`${state.agreements.find(a=>a.id===f.id).reference}-signed.pdf`])
  assert.deepEqual(copies.find(c=>c.name.endsWith('-signed.pdf')).bytes,edge.signed)
  assert.deepEqual(copies.find(c=>c.name.endsWith('-certificate.pdf')).bytes,edge.certificate)
 }
 assert.deepEqual(edge.crm,{properties:{contract_status:'executed'}})
 assert.equal((await f.tm.requester.state()).notifications.items.filter(n=>n.agreement_id===f.id&&n.kind==='signature'&&n.event_key===retrieval.id).length,1,'requester must receive this completion event, independently of the earlier sent-package notice')
 assert.equal(state.notifications.items.filter(n=>n.agreement_id===f.id&&n.kind==='signature'&&n.event_key===retrieval.id).length,1,'owner also receives the same completion event')
 const elapsedMs=performance.now()-started
 assert.ok(elapsedMs<60_000,'Docusign completion, filing, extraction kickoff and CRM must finish within one minute')
 const writes=edge.writes.length
 await h.scheduled(Date.now()+60_000)
 assert.equal(edge.writes.length,writes,'completed actions never resend')
 const archive=await(await f.tm.owner.request('/api/locket/export')).json()
 assert.equal(archive.records.lk_execution_followups.length,6)
 for(const row of archive.records.lk_execution_followups){assert.equal(JSON.parse(row.actor).sessionId,'');assert.equal(JSON.parse(row.actor).id,state.actor.id);assert.ok(row.created_at>=decisionStart&&row.created_at<=decisionEnd);assert.equal(JSON.parse(row.binding).id,f.pkg.packageId);assert.ok(row.outcome)}
 assert.ok(state.audit.some(a=>a.action==='execution.followup.authorize'))
 assert.ok(state.audit.some(a=>a.action==='execution.followup.complete'))
 // Populated custody remains scoped even when the caller can open the record.
 const viewer=await h.invite('synthetic-locket-followup-viewer@example.test','viewer')
 assert.equal((await viewer.state()).executionFollowups.length,0)
 await f.tm.owner.command('access.set',{agreementId:f.id,operatorId:viewer.id,grant:'grant'})
 assert.equal((await viewer.state()).executionFollowups.length,6)
 await f.tm.owner.command('repository.access',{version:0,enabled:false,grants:[],hiddenFields:[{role:'viewer',fields:['value']}]})
 assert.deepEqual((await viewer.state()).executionFollowups,[])
 await viewer.command('execution.followup.authorize',f.base,{error:'FIELD_ACCESS'})
 await f.tm.owner.command('repository.access',{version:1,enabled:false,grants:[],hiddenFields:[]})
 // The same stored destination is retained under hold and minimized without it.
 const subject='synthetic-locket-owner@example.test',current=await f.tm.owner.state(),party=current.parties.find(p=>p.id===current.agreements.find(a=>a.id===f.id).party_id)
 await f.tm.owner.command('party.save',{id:party.id,version:party.version,name:party.name,kind:party.kind,contacts:[{name:'Synthetic storage contact',email:subject}]})
 const {erasureRequest}=await import('./erasure-fixture.mjs')
 const version=current.agreements.find(a=>a.id===f.id).version
 await f.tm.owner.command('hold.set',{agreementId:f.id,version,holdVersion:0,active:true,reason:'Preserve execution custody',reviewOn:'2027-01-01'})
 let preview=await f.tm.owner.command('person.erase.preview',erasureRequest(subject))
 const google=rows.find(r=>r.kind==='google-drive')
 assert.ok(preview.retained.some(r=>r.table==='lk_execution_followups'&&r.id===google.id&&r.reason==='legal_hold'))
 assert.ok(!preview.patches.some(r=>r.table==='lk_execution_followups'&&r.id===google.id))
 await f.tm.counsel.command('hold.set',{agreementId:f.id,version,holdVersion:1,active:false,reason:'Counsel released preservation'})
 preview=await f.tm.owner.command('person.erase.preview',erasureRequest(subject))
 assert.ok(preview.patches.some(r=>r.table==='lk_execution_followups'&&r.id===google.id&&!r.after.destination.includes(subject)))
 return {elapsedMs,actions:rows.length,destinations:['google-drive','onedrive','sharepoint','chest'],digests:'matching',crm:'executed',requesterNotice:true}
}

export async function executionFollowupRefusals(t) {
 for(const scenario of ['no-followup-consent','wrong-digest','wrong-crm','unsafe-redirect','changed-connection','changed-model','cancelled','inflight-authority','inflight-connection']){
  const edge=followupProvider(),h=await installation(edge);t.after(()=>h.close())
  const f=await prepareFollowupFixture(h,edge)
  let decision
  if(scenario!=='no-followup-consent')decision=await f.authorize(['inflight-authority','inflight-connection','wrong-crm'].includes(scenario)?'hubspot':scenario==='unsafe-redirect'?'onedrive':scenario==='changed-model'?'extraction':'google-drive')
  if(scenario==='wrong-digest')edge.wrongDigest=true
  if(scenario==='wrong-crm')edge.wrongCrm=true
  if(scenario==='unsafe-redirect')edge.badRedirect=true
  if(scenario==='changed-model')await configureModel(h,{model:'synthetic-locket-new-model'})
  if(scenario==='changed-connection')await f.tm.owner.command('execution.destination.configure',{kind:'google-drive',accountId:'synthetic-locket-owner@example.test',revision:1})
  if(scenario==='cancelled')await f.tm.owner.command('execution.followup.cancel',{agreementId:f.id,version:f.base.version,id:decision.id})
  if(scenario==='inflight-authority')edge.beforeReadback=async()=>{const res=await f.tm.owner.request('/auth/signout',{method:'POST',body:{}});assert.equal(res.status,204)}
  if(scenario==='inflight-connection')edge.beforeReadback=()=>f.tm.owner.command('execution.destination.configure',{kind:'hubspot',accountId:'synthetic-locket-account',revision:1})
  await f.tm.owner.command('execution.retrieval.authorize',f.base)
  await f.complete()
  if(scenario==='inflight-authority'){f.tm.owner=await h.signIn('owner@example.test');h.owner=f.tm.owner}
  const state=await f.tm.owner.state()
  assert.equal(state.agreements.find(a=>a.id===f.id).status,'executed')
  const row=state.executionFollowups.find(r=>r.id===decision?.id)
  if(scenario==='no-followup-consent'){assert.equal(edge.writes.length,0);assert.equal(state.executionFollowups.length,0)}
  else if(scenario==='wrong-digest'){assert.equal(row.status,'uncertain');assert.equal(JSON.parse(row.outcome).code,'provider_filing_digest_mismatch');assert.equal(state.connections.find(c=>c.id==='execution:google-drive').status,'failing');assert.deepEqual(state.connections.find(c=>c.id==='execution:google-drive').agreementIds,[f.id]);assert.equal(edge.writes.length,1,'certificate must not send after a wrong signed copy')}
  else if(['wrong-crm','unsafe-redirect'].includes(scenario)){assert.equal(row.status,'uncertain');assert.equal(JSON.parse(row.outcome).code,scenario==='wrong-crm'?'provider_crm_mismatch':'provider_redirect_refused');assert.equal(edge.writes.length,1)}
  else if(['inflight-authority','inflight-connection'].includes(scenario)){assert.equal(row.status,'uncertain');assert.equal(edge.writes.length,1);assert.equal(state.audit.filter(a=>a.action==='execution.followup.complete').length,0)}
  else {assert.equal(row.status,'cancelled');assert.equal(edge.writes.length,0)}
  const count=edge.writes.length
  await h.scheduled(Date.now()+120_000)
  assert.equal(edge.writes.length,count,'a later session or schedule cannot repeat uncertain or cancelled writes')
 }
}


export function acrobatProvider() {
 const edge={status:'OUT_FOR_SIGNATURE',signed:null,certificate:pdf('synthetic-locket-20 Acrobat audit trail'),reads:[],failCertificate:false,badIdentity:false,badMembers:false,badDate:false,beforeSigned:null,incompleteMembers:false,ambiguousMembers:false,recipientGroup:false}
 edge.bindings={SIGNATURE_ACROBAT_TOKEN:'synthetic-locket-20'}
 edge.outboundResponse=async request=>{
  const u=new URL(request.url);assert.equal(u.hostname,'api.na1.adobesign.com')
  assert.equal(request.headers.get('authorization'),'Bearer synthetic-locket-20')
  assert.equal(request.method,'GET');edge.reads.push(u.pathname)
  if(u.pathname.endsWith('/members'))return Response.json({participantSets:[
   {role:'SIGNER',status:edge.incompleteMembers?'WAITING_FOR_MY_SIGNATURE':'COMPLETED',memberInfos:[{name:'Hana Park',email:edge.badMembers?'synthetic-locket-wrong@example.test':'hana@harbour.example'},...(edge.ambiguousMembers||edge.recipientGroup?[{name:'Synthetic alternate',email:'synthetic-locket-alternate@example.test'}]:[])]},
   {role:'SIGNER',status:'COMPLETED',memberInfos:[{name:'Olive Owner',email:'owner@example.test'}]},
   {role:'CC',status:'WAITING_FOR_MY_ACKNOWLEDGEMENT',memberInfos:[{name:'Synthetic copy',email:'synthetic-locket-copy@example.test'}]}]})
  if(u.pathname.endsWith('/events'))return Response.json({events:[
   {type:'CREATED',date:'2026-10-26T10:00:00Z'},
   {type:'ESIGNED',participantEmail:edge.badMembers?'synthetic-locket-wrong@example.test':'hana@harbour.example',date:'2026-10-26T11:00:00Z'},
   {type:'ESIGNED',participantEmail:'owner@example.test',date:edge.badDate?'unreadable':'2026-10-26T12:00:00Z'},
   ...(edge.ambiguousMembers?[{type:'ESIGNED',participantEmail:'synthetic-locket-alternate@example.test',date:'2026-10-26T11:30:00Z'}]:[])]})
  if(u.pathname.endsWith('/combinedDocument')){assert.equal(u.searchParams.get('attachAuditReport'),'false');if(edge.beforeSigned){const action=edge.beforeSigned;edge.beforeSigned=null;await action()};return new Response(edge.signed)}
  if(u.pathname.endsWith('/auditTrail'))return edge.failCertificate?new Response('Unavailable',{status:503}):new Response(edge.certificate)
  return Response.json({id:edge.badIdentity?'synthetic-locket-other':decodeURIComponent(u.pathname.split('/').at(-1)),status:edge.status})
 }
 return edge
}
export async function prepareAcrobatFixture(h,edge,{provider='adobe-acrobat-sign',packetPurpose}={}) {
 const {configurePacket,preparePacket,approvePacket}=await import('./signature-packet-fixture.mjs')
 const tm=await team(h),lib=await library(h,tm),id=await approved(h,tm,lib)
 let documents=[]
 if(packetPurpose){
  const a=(await tm.owner.state()).agreements.find(a=>a.id===id)
  const extra=await tm.owner.command('package.document.add',{agreementId:id,version:a.version,file:file('synthetic-locket-22.pdf',pdf('synthetic-locket-22 attachment'))})
  documents=[{artifactId:extra.artifactId,purpose:packetPurpose}]
 }
 await configurePacket(tm.owner,id,{documents,recipients:[{name:'Hana Park',email:'hana@harbour.example',action:'sign',partyRole:'counterparty'},{name:'Olive Owner',email:'owner@example.test',action:'sign',partyRole:'internal'}]})
 await approvePacket(tm.owner,id)
 const pkg=await preparePacket(tm.owner,id,provider)
 let a=(await tm.owner.state()).agreements.find(a=>a.id===id)
 await tm.owner.command('package.sent',{agreementId:id,version:a.version,packageId:pkg.packageId,envelopeId:'synthetic-locket-acrobat-'+id})
 if(['adobe-acrobat-sign','dropbox-sign'].includes(provider))await tm.owner.command('signature.connection.configure',{provider,baseUrl:provider==='dropbox-sign'?'https://api.hellosign.com/v3':'https://api.na1.adobesign.com/api/rest/v6',accountId:'synthetic-locket-acrobat-account',version:0})
 edge.signed=Buffer.from(await(await tm.owner.request('/api/locket/files/'+pkg.pdfArtifactId)).arrayBuffer())
 a=(await tm.owner.state()).agreements.find(a=>a.id===id)
 return {tm,id,pkg,base:{agreementId:id,version:a.version,packageId:pkg.packageId,consent:true}}
}
export async function acrobatRetrievalJourney(t,scenarios) {
 for(const scenario of scenarios??['complete','recipient-group','reference-packet','signable-packet','wrong-envelope','wrong-signers','incomplete-signers','ambiguous-signers','bad-date','revoked-between-reads','unsupported-inkwell']){
  const edge=acrobatProvider(),h=await installation(edge);t.after(()=>h.close())
  const f=await prepareAcrobatFixture(h,edge,{provider:scenario==='unsupported-inkwell'?'inkwell':'adobe-acrobat-sign',packetPurpose:scenario==='reference-packet'?'reference':scenario==='signable-packet'?'sign':undefined})
  if(scenario.startsWith('unsupported-')){await f.tm.owner.command('execution.retrieval.authorize',f.base,{error:'RETRIEVAL_UNSUPPORTED'});assert.equal(edge.reads.length,0);assert.equal((await f.tm.owner.state()).executionRetrievals.length,0);continue}
  await f.tm.requester.command('execution.retrieval.authorize',f.base,{error:'FORBIDDEN'})
  await f.tm.owner.command('execution.retrieval.authorize',{...f.base,consent:false},{error:'CONSENT'})
  const decision=await f.tm.owner.command('execution.retrieval.authorize',f.base)
  let state=await f.tm.owner.state(),row=state.executionRetrievals.find(r=>r.id===decision.id)
  assert.equal(row.status,'waiting');assert.equal(state.executions.length,0)
  assert.equal(edge.reads.length,1,'incomplete agreement must not download documents')
  edge.status='SIGNED'
  edge.badIdentity=scenario==='wrong-envelope';edge.badMembers=scenario==='wrong-signers';edge.badDate=scenario==='bad-date';edge.incompleteMembers=scenario==='incomplete-signers';edge.ambiguousMembers=scenario==='ambiguous-signers';edge.recipientGroup=scenario==='recipient-group'
  if(scenario==='revoked-between-reads')edge.beforeSigned=async()=>{assert.equal((await f.tm.owner.request('/auth/signout',{method:'POST',body:{}})).status,204)}
  edge.failCertificate=scenario==='complete'
  await h.scheduled(row.next_attempt_at+1)
  if(scenario==='revoked-between-reads'){f.tm.owner=await h.signIn('owner@example.test');h.owner=f.tm.owner}
  state=await f.tm.owner.state();row=state.executionRetrievals.find(r=>r.id===decision.id)
  if(scenario==='complete'){
   assert.equal(row.status,'retrying');assert.equal(row.last_error,'provider_http_503')
   assert.equal(state.executions.length,0);assert.equal(state.agreements.find(a=>a.id===f.id).status,'out_for_signature')
   assert.equal(row.next_attempt_at-row.updated_at,60000)
   edge.failCertificate=false;await h.scheduled(row.next_attempt_at+1)
   state=await f.tm.owner.state();row=state.executionRetrievals.find(r=>r.id===decision.id)
   assert.equal(row.status,'reconciled');assert.equal(state.agreements.find(a=>a.id===f.id).status,'executed')
   const e=state.executions.find(e=>e.agreement_id===f.id)
   assert.equal(e.provider,'adobe-acrobat-sign');assert.equal(e.executed_on,'2026-10-26')
   assert.deepEqual(JSON.parse(e.signers).map(s=>s.email),['hana@harbour.example','owner@example.test'])
   for(const [artifact,bytes] of [[e.signed_artifact_id,edge.signed],[e.certificate_artifact_id,edge.certificate]]){
    const response=await f.tm.owner.request('/api/locket/files/'+artifact)
    assert.equal(response.headers.get('x-locket-sha256'),createHash('sha256').update(bytes).digest('hex'))
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes)
   }
   assert.deepEqual(JSON.parse(row.outcomes).map(o=>o.status),['waiting','retrying','reconciled'])
   assert.equal((await f.tm.requester.state()).notifications.items.filter(n=>n.event_key===decision.id).length,1)
  }else if(['recipient-group','reference-packet'].includes(scenario)){
   assert.equal(row.status,'reconciled');assert.equal(state.agreements.find(a=>a.id===f.id).status,'executed')
   const e=state.executions.find(e=>e.agreement_id===f.id)
   assert.deepEqual(JSON.parse(e.signers).map(s=>s.email),['hana@harbour.example','owner@example.test'])
   assert.deepEqual(Buffer.from(await(await f.tm.owner.request('/api/locket/files/'+e.signed_artifact_id)).arrayBuffer()),edge.signed)
  }else if(scenario==='signable-packet'){
   assert.equal(row.status,'needs_review');assert.equal(state.agreements.find(a=>a.id===f.id).status,'out_for_signature')
   const e=state.executions.find(e=>e.agreement_id===f.id)
   assert.equal(JSON.parse(e.checks).find(c=>c.check==='packet_documents').ok,false)
   assert.equal((await f.tm.requester.state()).notifications.items.filter(n=>n.event_key===decision.id).length,0)
   await f.tm.requester.command('execution.resolve',{agreementId:f.id,version:state.agreements.find(a=>a.id===f.id).version,executionId:e.id,reason:'Requester cannot clear packet evidence'},{error:'FORBIDDEN'})
   await f.tm.counsel.command('execution.resolve',{agreementId:f.id,version:state.agreements.find(a=>a.id===f.id).version,executionId:e.id,reason:'Counsel reviewed every returned document against the approved packet.'})
   assert.equal((await f.tm.owner.state()).agreements.find(a=>a.id===f.id).status,'executed')
  }else if(scenario==='wrong-signers'){
   assert.equal(row.status,'needs_review');assert.equal(state.agreements.find(a=>a.id===f.id).status,'out_for_signature')
   const e=state.executions.find(e=>e.agreement_id===f.id);assert.equal(e.status,'needs_review');assert.equal(JSON.parse(e.checks).find(c=>c.check==='signers').ok,false)
   await f.tm.requester.command('execution.resolve',{agreementId:f.id,version:state.agreements.find(a=>a.id===f.id).version,executionId:e.id,reason:'Requester cannot accept mismatches'},{error:'FORBIDDEN'})
  }else if(scenario==='revoked-between-reads'){
   assert.equal(row.status,'cancelled');assert.equal(row.last_error,'AUTHORITY');assert.equal(state.executions.length,0)
   assert.equal(edge.reads.filter(p=>p.endsWith('/auditTrail')).length,0,'revocation stops the next network read')
  }else{
   assert.equal(row.status,'retrying');assert.equal(row.last_error,scenario==='wrong-envelope'?'provider_envelope_mismatch':'provider_completion_incomplete')
   assert.equal(state.executions.length,0);assert.equal(edge.reads.filter(p=>p.endsWith('/combinedDocument')).length,0)
  }
  if(['complete','revoked-between-reads'].includes(scenario)){
   const reads=edge.reads.length;await h.scheduled(row.next_attempt_at+3600001)
   assert.equal(edge.reads.length,reads,'completion and ended consent never reread provider files')
  }
 }
}


export function dropboxProvider() {
 const edge={completed:false,signed:null,certificate:pdf('synthetic-locket-21 Dropbox audit trail'),reads:[],filesReady:false,archiveFault:null,beforeFiles:null}
 edge.bindings={SIGNATURE_DROPBOX_KEY:'synthetic-locket-21'}
 edge.outboundResponse=async request=>{
  const u=new URL(request.url);assert.equal(u.hostname,'api.hellosign.com');assert.equal(request.method,'GET')
  assert.equal(request.headers.get('authorization'),'Basic '+Buffer.from('synthetic-locket-21:').toString('base64'))
  edge.reads.push(u.pathname)
  if(u.pathname.startsWith('/v3/signature_request/files/')){
   assert.equal(u.searchParams.get('file_type'),'zip')
   if(edge.beforeFiles){const action=edge.beforeFiles;edge.beforeFiles=null;await action()}
   if(!edge.filesReady)return new Response('Files preparing',{status:409})
   const entries=[['signed.pdf',edge.signed],...(edge.extraSigned?[['schedule.pdf',edge.extraSigned]]:[]),['audit.pdf',edge.certificate]]
   if(edge.archiveFault==='missing')entries.pop()
   if(edge.archiveFault==='duplicate')entries[entries.length-1][0]='signed.pdf'
   if(edge.archiveFault==='unsafe')entries.splice(1,0,['../schedule.pdf',pdf('synthetic-locket-23')])
   const archive=zip(entries)
   if(['crc','extra-crc'].includes(edge.archiveFault)){let central=archive.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));if(edge.archiveFault==='extra-crc')central=archive.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]),central+4);archive[central+16]^=1}
   edge.archive=archive
   return new Response(archive,{headers:{'content-type':'application/zip'}})
  }
  return Response.json({signature_request:{signature_request_id:decodeURIComponent(u.pathname.split('/').at(-1)),is_complete:edge.completed,is_declined:false,has_error:false,signatures:[
   {signer_name:'Hana Park',signer_email_address:'hana@harbour.example',status_code:'signed',signed_at:1793012400},
   {signer_name:'Olive Owner',signer_email_address:'owner@example.test',status_code:'signed',signed_at:1793016000}]}})
 }
 return edge
}
export async function dropboxRetrievalJourney(t,scenarios) {
 for(const scenario of scenarios??['complete','signable-packet','missing','duplicate','crc','unsafe','extra-crc','revoked']){
  const edge=dropboxProvider(),h=await installation(edge);t.after(()=>h.close())
  const f=await prepareAcrobatFixture(h,edge,{provider:'dropbox-sign',packetPurpose:scenario==='signable-packet'?'sign':undefined})
  if(['signable-packet','extra-crc'].includes(scenario))edge.extraSigned=pdf('synthetic-locket-22 returned signed schedule')
  await f.tm.owner.command('execution.retrieval.authorize',f.base,{error:'INVALID'})
  const base={...f.base,signedName:'signed.pdf',certificateName:'audit.pdf'}
  await f.tm.owner.command('execution.retrieval.authorize',{...base,certificateName:'signed.pdf'},{error:'RETRIEVAL_FILES'})
  const decision=await f.tm.owner.command('execution.retrieval.authorize',base)
  let state=await f.tm.owner.state(),row=state.executionRetrievals.find(r=>r.id===decision.id)
  assert.equal(row.status,'waiting');assert.equal(edge.reads.length,1)
  const archive=await(await f.tm.owner.request('/api/locket/export')).json()
  assert.deepEqual(JSON.parse(archive.records.lk_execution_retrievals.find(r=>r.id===decision.id).binding).providerFiles,{signedName:'signed.pdf',certificateName:'audit.pdf'})
  edge.completed=true
  if(scenario==='complete'){
   await h.scheduled(row.next_attempt_at+1)
   state=await f.tm.owner.state();row=state.executionRetrievals.find(r=>r.id===decision.id)
   assert.equal(row.status,'retrying');assert.equal(row.last_error,'provider_http_409');assert.equal(state.executions.length,0)
  }
  edge.filesReady=true;edge.archiveFault=['complete','signable-packet','revoked'].includes(scenario)?null:scenario
  if(scenario==='revoked')edge.beforeFiles=async()=>assert.equal((await f.tm.owner.request('/auth/signout',{method:'POST',body:{}})).status,204)
  await h.scheduled(row.next_attempt_at+1)
  if(scenario==='revoked'){f.tm.owner=await h.signIn('owner@example.test');h.owner=f.tm.owner}
  state=await f.tm.owner.state();row=state.executionRetrievals.find(r=>r.id===decision.id)
  if(scenario==='complete'){
   assert.equal(row.status,'reconciled');assert.equal(state.agreements.find(a=>a.id===f.id).status,'executed')
   const e=state.executions.find(e=>e.agreement_id===f.id);assert.equal(e.provider,'dropbox-sign');assert.equal(e.executed_on,'2026-10-26')
   assert.deepEqual(JSON.parse(e.signers).map(s=>s.email),['hana@harbour.example','owner@example.test'])
   for(const [id,bytes] of [[e.signed_artifact_id,edge.signed],[e.certificate_artifact_id,edge.certificate]]){
    const response=await f.tm.owner.request('/api/locket/files/'+id)
    assert.equal(response.headers.get('x-locket-sha256'),createHash('sha256').update(bytes).digest('hex'));assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes)
   }
   assert.equal((await f.tm.requester.state()).notifications.items.filter(n=>n.event_key===decision.id).length,1)
  }else if(scenario==='signable-packet'){
   assert.equal(row.status,'needs_review','the real three-entry Dropbox packet must reach reconciliation')
   assert.equal(state.agreements.find(a=>a.id===f.id).status,'out_for_signature')
   const e=state.executions.find(e=>e.agreement_id===f.id)
   assert.equal(JSON.parse(e.checks).find(c=>c.check==='packet_documents').ok,false)
   assert.equal((await f.tm.requester.state()).notifications.items.filter(n=>n.event_key===decision.id).length,0)
   const originals=state.artifacts.filter(a=>JSON.parse(a.provenance).providerArchive)
   assert.equal(originals.length,1,'retain every unmerged document in the original provider ZIP')
   assert.equal(JSON.parse(originals[0].provenance).executionId,e.id)
   assert.equal(originals[0].sha256,createHash('sha256').update(edge.archive).digest('hex'))
   assert.deepEqual(Buffer.from(await(await f.tm.owner.request('/api/locket/files/'+originals[0].id)).arrayBuffer()),edge.archive)
   for(const [id,bytes] of [[e.signed_artifact_id,edge.signed],[e.certificate_artifact_id,edge.certificate]])assert.deepEqual(Buffer.from(await(await f.tm.owner.request('/api/locket/files/'+id)).arrayBuffer()),bytes)
   await f.tm.requester.command('execution.resolve',{agreementId:f.id,version:state.agreements.find(a=>a.id===f.id).version,executionId:e.id,reason:'Requester cannot clear packet evidence'},{error:'FORBIDDEN'})
   await f.tm.counsel.command('execution.resolve',{agreementId:f.id,version:state.agreements.find(a=>a.id===f.id).version,executionId:e.id,reason:'Counsel reviewed both returned PDFs and the separate audit trail against the approved packet.'})
   assert.equal((await f.tm.owner.state()).agreements.find(a=>a.id===f.id).status,'executed')
   const reads=edge.reads.length;await h.scheduled(row.next_attempt_at+3600001);assert.equal(edge.reads.length,reads)
  }else{
   assert.equal(row.status,scenario==='revoked'?'cancelled':'retrying')
   assert.equal(row.last_error,scenario==='revoked'?'AUTHORITY':'provider_archive_invalid')
   assert.equal(state.executions.length,0);assert.equal(state.artifacts.filter(a=>['signed','certificate'].includes(a.role)).length,0)
   assert.equal(state.agreements.find(a=>a.id===f.id).status,'out_for_signature')
  }
  if(scenario==='complete'||scenario==='revoked'){const reads=edge.reads.length;await h.scheduled(row.next_attempt_at+3600001);assert.equal(edge.reads.length,reads)}
  await h.close()
 }
}

if(process.argv.includes('--clock')){
 const {execFileSync}=await import('node:child_process')
 const cleanups=[]
 try{
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
  const result=await executionFollowupJourney({after:fn=>cleanups.push(fn)})
  console.log(JSON.stringify({runId:'sx-locket-c-f4-clock-'+head,head,...result}))
 }finally{for(const cleanup of cleanups.reverse())await cleanup()}
}
