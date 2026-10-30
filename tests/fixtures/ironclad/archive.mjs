import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import { pdf, zip, file } from '../../api/files.mjs'
export const passage = 'Agreement begins 2022-03-01 and expires 2023-02-28. It auto-renews for 12 months with unlimited renewals and 60 days notice. Contract value USD 10000. Governing law New York. Payment Net 30.'
export const columns = ['Record Id','Workflow Id','Record Name','Record Type','Parent Id','Attachment Filenames','Stage','Counterparty','Agreement Date','Expiration Date','Auto-Renewal Type','Renewal Term Length','Number of Renewals','Notice Days','Contract Value','Business Unit','Cost Center','Legacy Flag']
const escape = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
export function ironcladArchive({ count = 50, prefix = 'ic', orphan = true } = {}) {
  const records = Array.from({length:count},(_,i)=>{
    const group = Math.floor(i/5), child = i%5, family = i<10
    const id = `${prefix}-record-${String(i+1).padStart(3,'0')}`
    return {id,workflowId:`${prefix}-workflow-${String(i+1).padStart(3,'0')}`,name:`Ironclad ${family ? child===0?'Master Services Agreement':child===4?'Amendment':'Order Form':'NDA'} ${i+1}`,recordType:family?child===0?'Master Services Agreement':child===4?'Amendment':'Order Form':'NDA',status:'completed',parentId:family&&child?`${prefix}-record-${String(group*5+1).padStart(3,'0')}`:'',properties:{Counterparty:`Example Counterparty ${group+1}`,'Agreement Date':'2022-03-01','Expiration Date':'2023-02-28','Auto-Renewal Type':'auto_renew','Renewal Term Length':'12','Number of Renewals':'unlimited','Notice Days':'60','Contract Value':'10000','Business Unit':'Operations','Cost Center':'4100','Legacy Flag':'historic'},attachments:[{filename:`${id}.pdf`}]}
  })
  const documents = records.map(r=>[`${r.id}/${r.id}.pdf`,pdf(`${r.name}. ${passage}`)])
  documents.push([`${records[0].id}/schedule.pdf`,pdf('Additional schedule for '+records[0].id)])
  records[0].attachments.push({filename:'schedule.pdf'})
  const entries = [...documents,...(orphan?[['unmatched/extra.pdf',pdf('Unmatched original')]]:[])]
  const archive = zip(entries)
  const table = records.map(r=>[r.id,r.workflowId,r.name,r.recordType,r.parentId,r.attachments.map(a=>a.filename).join(';'),r.status,...Object.values(r.properties)])
  const csv = [columns,...table].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')
  const cell = (v,c,r)=>r>1&&[8,9].includes(c)?`<c r="${String.fromCharCode(65+c)}${r}" s="1" t="n"><v>${(Date.parse(v)-Date.UTC(1899,11,30))/86400000}</v></c>`:`<c r="${String.fromCharCode(65+c)}${r}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`
  const xlsx=zip([
    ['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ['xl/styles.xml','<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'],
    ['xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Export" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml',`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[columns,...table].map((row,i)=>`<row r="${i+1}">${row.map((v,c)=>cell(v,c,i+1)).join('')}</row>`).join('')}</sheetData></worksheet>`],
  ])
  return {records,apiRecords:providerRecords(records,documents),documents,entries,archive,csv,xlsx,payload:{kit:'ironclad-records',label:'Ironclad documented-shape archive',manifest:file('records.csv',Buffer.from(csv)),archive:file('attachments.zip',archive)}}
}
export function reviewedMapping(catalogue, businessUnitField) {
  return {types:{...catalogue.mapping.types,'Master Services Agreement':'supplier'},properties:{...catalogue.mapping.properties,'Business Unit':businessUnitField?`custom:${businessUnitField}`:'skip','Cost Center':'skip','Legacy Flag':'skip'}}
}
export const entity = {legalName:'Example Owner LLC',entityType:'LLC',formation:'Delaware, United States',registeredAddress:'1 Example Street, Wilmington, DE',noticeAddress:'1 Example Street, Wilmington, DE',currency:'USD',timezone:'America/New_York',signatories:[]}
// RecordModel and RecordProperty* from the provider's published OpenAPI.
export function providerRecords(records,documents) {
 return records.map((r,i)=>({id:r.id,ironcladId:`IC-${i+1}`,name:r.name,type:r.recordType,typeDisplayName:r.recordType,lastUpdated:'2026-10-01T12:00:00Z',source:{type:'workflow',workflowId:r.workflowId},parentId:r.parentId||undefined,parentLinkType:r.recordType==='Amendment'?'amendment':undefined,childIds:records.filter(c=>c.parentId===r.id).map(c=>c.id),links:records.filter(c=>c.parentId===r.id).map(c=>({recordId:c.id})),properties:Object.fromEntries(Object.entries(r.properties).map(([k,v])=>[k,k.includes('Date')?{type:'date',value:v+'T00:00:00.000Z'}:k==='Contract Value'?{type:'monetary_amount',value:{amount:Number(v),currency:'USD'}}:k==='Renewal Term Length'?{type:'duration',value:'P1Y'}:{type:'string',value:v}])),attachments:Object.fromEntries(r.attachments.map((a,j)=>[j?'schedule':'signedCopy',{filename:a.filename,contentType:'application/pdf',href:`https://demo.ironcladapp.com/public/api/v1/records/${r.id}/attachments/${j?'schedule':'signedCopy'}`,fileHash:createHash('sha256').update(documents.find(([path])=>path===r.id+'/'+a.filename)[1]).digest('hex'),hashAlgorithm:'sha256'}]))}))
}
export function ironcladEdge(fixture,{failJob=false,partial=false,onRequest}={}) {
 const calls=[],polls=new Map(),jobs=new Map()
 return {calls,setFailure(failed,partialResults=false){failJob=failed;partial=partialResults},async respond(request){
  const url=new URL(request.url);calls.push({method:request.method,path:url.pathname,query:url.search,authorization:request.headers.get('authorization')})
  await onRequest?.(request,calls)
  const base='/public/api/v1'
  if(url.pathname===base+'/records'){
   assert.equal(request.method,'GET');assert.equal(request.headers.get('authorization'),'Bearer synthetic-ironclad-read-token')
   const page=Number(url.searchParams.get('page')??0),pageSize=25
   return Response.json({list:fixture.apiRecords.slice(page*pageSize,(page+1)*pageSize),count:fixture.apiRecords.length,page,pageSize})
  }
  if(url.pathname===base+'/records/attachments/download-urls'){
   assert.equal(request.method,'POST')
   const input=await request.json();assert.deepEqual(Object.keys(input).sort(),['identifiers','type']);assert.equal(input.type,'latestSignedCopy');assert.ok(input.identifiers.length<=100)
   assert.ok(input.identifiers.every(id=>fixture.apiRecords.some(r=>r.id===id)))
   const jobId='synthetic-job-'+jobs.size;jobs.set(jobId,input.identifiers)
   return Response.json({jobId,status:'processing'},{status:202})
  }
  if(url.pathname.startsWith(base+'/records/attachments/download-urls/')){
   if(failJob)return new Response('temporarily unavailable',{status:503})
   const jobId=url.pathname.split('/').pop(),ids=jobs.get(jobId);assert.ok(ids)
   const count=(polls.get(jobId)??0)+1;polls.set(jobId,count)
   const succeeded=ids.map(id=>{const r=fixture.apiRecords.find(r=>r.id===id),a=r.attachments.signedCopy;return {identifier:id,recordId:id,ironcladId:r.ironcladId,downloadUrl:`https://synthetic-ironclad.s3.amazonaws.com/${id}/signedCopy`,filename:a.filename,fileKey:'signedCopy',fileHash:a.fileHash,expiration:'2099-01-01T00:00:00Z'}})
   const failed=partial?[{identifier:succeeded.shift().identifier,errorCode:'ACCESS_DENIED',errorMessage:'Access denied'}]:[]
   return Response.json(count===1?{jobId,status:'processing'}:{jobId,status:'complete',succeeded,failed})
  }
  let recordId,key
  if(url.hostname==='synthetic-ironclad.s3.amazonaws.com'){
   assert.equal(request.headers.has('authorization'),false,'Bearer credential leaked to signed download')
   ;[recordId,key]=url.pathname.slice(1).split('/')
  }else if(url.pathname.startsWith(base+'/records/')){
   assert.equal(request.headers.get('authorization'),'Bearer synthetic-ironclad-read-token')
   const parts=url.pathname.split('/');recordId=parts[5];key=parts[7]
  }
  if(recordId){
   const r=fixture.apiRecords.find(r=>r.id===recordId),attachment=r?.attachments[key]
   assert.ok(attachment,'Unknown attachment identity '+recordId+'/'+key)
   return new Response(fixture.documents.find(([path])=>path===recordId+'/'+attachment.filename)[1],{headers:{'content-type':'application/pdf'}})
  }
  throw Error('Unexpected Ironclad network destination '+url.pathname)
 }}
}
