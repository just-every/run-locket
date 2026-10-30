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
  const entries = [...documents,...(orphan?[['unmatched/extra.pdf',pdf('Unmatched original')]]:[])]
  const archive = zip(entries)
  const table = records.map(r=>[r.id,r.workflowId,r.name,r.recordType,r.parentId,r.attachments[0].filename,r.status,...Object.values(r.properties)])
  const csv = [columns,...table].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')
  const cell = (v,c,r)=>r>1&&[8,9].includes(c)?`<c r="${String.fromCharCode(65+c)}${r}" s="1" t="n"><v>${(Date.parse(v)-Date.UTC(1899,11,30))/86400000}</v></c>`:`<c r="${String.fromCharCode(65+c)}${r}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`
  const xlsx=zip([
    ['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ['xl/styles.xml','<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'],
    ['xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Export" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml',`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[columns,...table].map((row,i)=>`<row r="${i+1}">${row.map((v,c)=>cell(v,c,i+1)).join('')}</row>`).join('')}</sheetData></worksheet>`],
  ])
  return {records,documents,entries,archive,csv,xlsx,payload:{kit:'ironclad-records',label:'Ironclad documented-shape archive',manifest:file('records.csv',Buffer.from(csv)),archive:file('attachments.zip',archive)}}
}
export function reviewedMapping(catalogue, businessUnitField) {
  return {types:{...catalogue.mapping.types,'Master Services Agreement':'supplier'},properties:{...catalogue.mapping.properties,'Business Unit':businessUnitField?`custom:${businessUnitField}`:'skip','Cost Center':'skip','Legacy Flag':'skip'}}
}
export const entity = {legalName:'Example Owner LLC',entityType:'LLC',formation:'Delaware, United States',registeredAddress:'1 Example Street, Wilmington, DE',noticeAddress:'1 Example Street, Wilmington, DE',currency:'USD',timezone:'America/New_York',signatories:[]}
export function ironcladEdge(fixture,{failJob=false,onRequest}={}) {
  const calls=[],polls=new Map()
  return {calls,async respond(request){
    const url=new URL(request.url);calls.push({method:request.method,path:url.pathname,query:url.search,authorization:request.headers.get('authorization')})
    await onRequest?.(request,calls)
    const base='/public/api/v1'
    if(url.pathname===base+'/records'){
      const page=Number(url.searchParams.get('page')??0),pageSize=25
      return Response.json({list:fixture.records.slice(page*pageSize,(page+1)*pageSize),count:fixture.records.length,page,pageSize})
    }
    if(url.pathname===base+'/records/attachments/download'){
      const input=await request.json();if(input.recordIds.length!==fixture.records.length)return new Response('Wrong record selection',{status:400})
      return Response.json({jobId:'synthetic-attachment-job'})
    }
    if(url.pathname===base+'/jobs/synthetic-attachment-job'){
      if(failJob)return new Response('temporarily unavailable',{status:503})
      const count=(polls.get(url.pathname)??0)+1;polls.set(url.pathname,count)
      return Response.json(count===1?{status:'pending'}:{status:'ready',downloadUrl:'https://synthetic-ironclad.s3.amazonaws.com/attachments.zip'})
    }
    if(url.hostname==='synthetic-ironclad.s3.amazonaws.com'){
      if(request.headers.has('authorization'))throw Error('Bearer credential leaked to download')
      return new Response(fixture.archive,{headers:{'content-type':'application/zip'}})
    }
    throw Error('Unexpected Ironclad network destination '+url.pathname)
  }}
}
