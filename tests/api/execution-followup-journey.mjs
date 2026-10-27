import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { installation } from './harness.mjs'
import { team, library, outForSignature, pdf } from './setup.mjs'
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
 const tm=await team(h),lib=await library(h,tm),{id,pkg}=await outForSignature(h,tm,lib,{restricted})
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

if(process.argv.includes('--clock')){
 const {execFileSync}=await import('node:child_process')
 const cleanups=[]
 try{
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
  const result=await executionFollowupJourney({after:fn=>cleanups.push(fn)})
  console.log(JSON.stringify({runId:'sx-locket-c-f1-clock-'+head,head,...result}))
 }finally{for(const cleanup of cleanups.reverse())await cleanup()}
}
