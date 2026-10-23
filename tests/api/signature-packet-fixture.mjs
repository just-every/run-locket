import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { file,pdf } from './files.mjs'
import { getDocumentProxy } from 'unpdf'
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
export const agreement=async(client,id)=>(await client.state()).agreements.find(a=>a.id===id)
export const recipient={name:'Synthetic counterparty signer',email:'signer@example.test',action:'sign',partyRole:'counterparty'}
async function detectedTags(documents,provider){
 const fields=[]
 for(const [documentIndex,d] of documents.entries()){
  const pdf=await getDocumentProxy(Uint8Array.from(d.bytes),{useWasm:false,useSystemFonts:false,disableFontFace:true,verbosity:0})
  try{for(let page=1;page<=pdf.numPages;page++)for(const item of (await(await pdf.getPage(page)).getTextContent()).items){
   if(!('str'in item))continue
   const pattern=provider==='adobe-acrobat-sign'?/\{\{\*lk_d\d+_f\d+_es_:signer\d+:[^}]+\}\}/g:/\[(?:sig|initial|text|date)\|req\|signer\d+\|[^\]]+\]/g
   for(const tag of item.str.matchAll(pattern))fields.push({tag:tag[0],documentIndex,page,x:item.transform[4],y:item.transform[5],width:item.width,height:item.height})
  }}finally{await pdf.loadingTask.destroy()}
 }
 return fields
}
export function signatureEdge({failSend=false}={}) {
 const requests=[],attempts=[],uploads=new Map();let sequence=0
 const bindings={MAIL_API_KEY:'synthetic-locket-1',SIGNATURE_DOCUSIGN_TOKEN:'synthetic-locket-2',SIGNATURE_ACROBAT_TOKEN:'synthetic-locket-3',SIGNATURE_DROPBOX_KEY:'synthetic-locket-4',SIGNATURE_INKWELL_TOKEN:'synthetic-locket-5',SIGNATURE_INKWELL_ORIGIN:'https://inkwell.example.test'}
 const outboundResponse=async request=>{
  const url=new URL(request.url),path=url.pathname;attempts.push({path,method:request.method})
  if(failSend&&(path.endsWith('/envelopes')||path.endsWith('/signature_request/send')))return new Response('Provider unavailable',{status:503})
  if(path.endsWith('/transientDocuments')) {const form=await request.formData(),f=form.get('File'),bytes=Buffer.from(await f.arrayBuffer()),id=`synthetic-locket-upload-${++sequence}`;uploads.set(id,{filename:f.name,bytes,sha256:digest(bytes)});return Response.json({transientDocumentId:id})}
  if(url.hostname==='demo.docusign.net'){
   const body=await request.json();assert.equal(body.status,'sent');const documents=body.documents.map(d=>({filename:d.name,bytes:Buffer.from(d.documentBase64,'base64'),sha256:digest(Buffer.from(d.documentBase64,'base64'))}));requests.push({provider:'docusign',documents,body});return Response.json({envelopeId:`synthetic-locket-envelope-${++sequence}`})
  }
  if(url.hostname==='api.hellosign.com'){
   const form=await request.formData(),documents=[];for(let i=0;form.has(`files[${i}]`);i++){const f=form.get(`files[${i}]`),bytes=Buffer.from(await f.arrayBuffer());documents.push({filename:f.name,bytes,sha256:digest(bytes)})}requests.push({provider:'dropbox-sign',documents,fields:await detectedTags(documents,'dropbox-sign'),values:Object.fromEntries([...form].filter(([,v])=>typeof v==='string'))});return Response.json({signature_request:{signature_request_id:`synthetic-locket-envelope-${++sequence}`}})
  }
  if(url.hostname==='inkwell.example.test'){
   assert.equal(path,'/api/v1/envelopes');const body=await request.json();assert.equal(body.status,'draft');const documents=body.documents.map(d=>({filename:d.filename,bytes:Buffer.from(d.pdfBase64,'base64'),sha256:digest(Buffer.from(d.pdfBase64,'base64'))}));requests.push({provider:'inkwell',documents,body});return Response.json({result:{id:`synthetic-locket-envelope-${++sequence}`}})
  }
  if(path.endsWith('/agreements')){const body=await request.json();assert.equal(body.state,'AUTHORING');const documents=body.fileInfos.map(f=>uploads.get(f.transientDocumentId));requests.push({provider:'adobe-acrobat-sign',documents,fields:await detectedTags(documents,'adobe-acrobat-sign'),body});return Response.json({id:`synthetic-locket-envelope-${++sequence}`})}
  if(path.endsWith('/formFields')){requests.at(-1).fields=(await request.json()).fields;return Response.json({})}
  if(path.endsWith('/state')){assert.equal((await request.json()).state,'IN_PROCESS');requests.at(-1).sent=true;return Response.json({})}
  throw Error('Unexpected signature network destination')
 }
 return {bindings,requests,attempts,outboundResponse}
}
export async function signingTemplate(client,name='MSA',entityId) {
 const blocks=['internal','counterparty'].flatMap(role=>['signature','name','title','date','initials'].map(kind=>({id:`${role}_${kind}`,partyRole:role,kind,anchor:`/${name}_${role}_${kind}/`,width:150,height:20})))
 const template=await client.command('template.create',{name,type:'customer',entityId,body:`${name} between ${entityId?'{{our_entity}}':'our business'} and {{counterparty}}.\nValue USD {{amount}}.\n`+blocks.map(b=>`${b.kind}: ${b.anchor}`).join('\n'),fields:[{name:'amount',label:'Amount',required:true}],clauses:[]})
 await client.command('template.signature.blocks',{templateVersionId:template.versionId,revision:0,blocks})
 await client.command('template.decide',{versionId:template.versionId,decision:'approve'})
 return template
}
export async function approvePacket(client,id) {
 let a=await agreement(client,id)
 for(const r of (await client.state()).requirements.filter(r=>r.agreement_id===id&&!r.artifact_id&&!r.waived_reason))await client.command('requirement.waive',{agreementId:id,requirementId:r.id,reason:'Synthetic packet fixture has no separate sales attachments.'})
 a=await agreement(client,id)
 if(a.status==='draft')await client.command('agreement.submit',{agreementId:id,version:a.version})
 a=await agreement(client,id)
 await client.command('approval.decide',{agreementId:id,version:a.version,versionId:a.current_version_id,kind:'commercial',decision:'approved'})
 return agreement(client,id)
}
export async function configurePacket(client,id,{documents=[],fields=[],recipients=[recipient],reason='Coordinator reviewed the packet.'}={}) {
 const a=await agreement(client,id),state=await client.state(),prior=state.signature?.packets.find(p=>p.agreement_id===id)
 return client.command('package.configure',{agreementId:id,version:a.version,revision:prior?.revision??0,documents,fields,recipients,reason})
}
export async function templatePacket(client,{main,dpa,value='250000',entityId}={}) {
 const request=await client.command('request.create',{title:'Synthetic MSA plus DPA',type:'customer',entityId,value,party:{name:'Synthetic counterparty',kind:'customer'},templateVersionId:main.versionId,fields:{amount:value}})
 let a=await agreement(client,request.id)
 const attachment=await client.command('package.document.add',{agreementId:a.id,version:a.version,templateVersionId:dpa.versionId,filename:'DPA.pdf',fields:{amount:value}})
 await configurePacket(client,a.id,{documents:[{artifactId:attachment.artifactId,purpose:'sign'}]})
 await approvePacket(client,a.id)
 return request.id
}
export async function configureConnection(client,provider) {
 const urls={docusign:'https://demo.docusign.net/restapi/v2.1','adobe-acrobat-sign':'https://api.na1.adobesign.com/api/rest/v6','dropbox-sign':'https://api.hellosign.com/v3',inkwell:'https://inkwell.example.test'}
 await client.command('signature.connection.configure',{provider,version:0,baseUrl:urls[provider],accountId:provider==='docusign'?'synthetic-locket-6':undefined})
}
export async function preparePacket(client,id,provider='docusign') {
 if(['adobe-acrobat-sign','dropbox-sign'].includes(provider)){const a=await agreement(client,id);await client.command('package.tags.prepare',{agreementId:id,version:a.version,provider});await approvePacket(client,id)}
 const a=await agreement(client,id),result=await client.command('package.prepare',{agreementId:id,version:a.version,provider,recipients:[]}),state=await client.state(),pkg=state.packages.find(p=>p.id===result.packageId)
 return {...result,pkg,manifest:JSON.parse(pkg.manifest)}
}
export async function sendPacket(client,id,prepared,{mode,commandId}={}) {
 const a=await agreement(client,id),connection=(await client.state()).signature.connections.find(c=>c.provider===prepared.pkg.provider)
 return client.command('package.send',{agreementId:id,version:a.version,packageId:prepared.packageId,connectionVersion:connection.version,manifestDigest:digest(prepared.pkg.manifest),consent:true,mode:mode??(prepared.pkg.provider==='inkwell'?'prepare':'send')},{commandId})
}
export async function signerRules(h,{entityId=null,departmentId=null}={}) {
 const cfo=await h.invite('cfo@example.test','approver'),vp=await h.invite('vp-sales@example.test','approver'),fallback=await h.invite('fallback@example.test','approver')
 const rules=[{id:'cfo',name:'CFO at USD 100000',signerId:cfo.id,order:1,when:{type:'customer',minimumValue:'100000',entityId,departmentId}},{id:'vp',name:'VP Sales below USD 100000',signerId:vp.id,order:2,when:{type:'customer',maximumValue:'100000',entityId,departmentId}}]
 await h.owner.command('signature.rules.save',{version:0,fallbackId:fallback.id,rules})
 await h.owner.command('signature.rules.preview',{version:1,sample:{type:'customer',value:'250000',entityId,departmentId}})
 await h.owner.command('signature.rules.publish',{version:1})
 return {cfo,vp,fallback,rules}
}
export async function manualPacket(client,{creator=client,pages=7,value='50000'}={}) {
 const bytes=pdf('Synthetic counterparty paper',pages),request=await creator.command('request.create',{title:'Synthetic page seven signing',type:'nda',value,party:{name:'Synthetic PDF counterparty',kind:'customer'},file:file('counterparty.pdf',bytes),text:'Synthetic counterparty paper'})
 await configurePacket(client,request.id,{recipients:[recipient,{name:'Synthetic CC',email:'cc@example.test',action:'copy',partyRole:'copy'}],fields:[{id:'page7_signature',documentId:'main',partyRole:'counterparty',kind:'signature',page:7,x:70,y:500,width:160,height:30},{id:'page7_date',documentId:'main',partyRole:'counterparty',kind:'date',page:7,x:70,y:550,width:160,height:25}]})
 await approvePacket(client,request.id)
 return {id:request.id,bytes}
}
