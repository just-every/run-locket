import { file, pdf, zip } from './files.mjs'
const esc = v => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
export function xlsx(rows) {
  const names=Object.keys(rows[0]), column=i=>{let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s}
  const sheet=[names,...rows.map(r=>names.map(n=>r[n]??''))].map((r,i)=>`<row r="${i+1}">${r.map((v,j)=>`<c r="${column(j)}${i+1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`).join('')
  return zip([
    ['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Contracts" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml',`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`],
  ])
}
export function enterpriseFixture(kit) {
  const idColumn=kit==='icertis'?'System ID':'Record ID', rows=[], files={}, sourceId=n=>kit==='icertis'?`${kit}-${String(n).padStart(3,'0')}`:String(1000+n)
  for(let i=0;i<30;i++) {
    const id=sourceId(i+1)
    rows.push({[idColumn]:id,...(kit==='icertis'?{'Agreement Code':`ICI-CODE-${i+1}`,'First Party':'Synthetic Owner LLC'}:{}),'Contract Type':i===1||i===2?'Amendment':'MSA',[kit==='agiloft'?'Contract Title':'Name']:`${kit} agreement ${i+1}`,Status:'Executed',[kit==='agiloft'?'Company':'Second Party']:`Synthetic ${kit} Counterparty ${i+1}`,[kit==='agiloft'?'Start Date':'Effective Date']:'2022-03-01',[kit==='agiloft'?'End Date':'Expiry Date']:i===1?'2023-03-31':'2023-02-28',[kit==='agiloft'?'Amount':'Value']:'12000.50',Currency:'USD','Parent ID':i===1||i===2?sourceId(1):'',Relation:i===1||i===2?'amends':'','Auto Renewal':'yes','Renewal Type':'auto_renew','Renewal Months':'12','Notice Days':'60','Governing Law':'Delaware','Payment Terms':'Net 30','Business Unit':'Operations','Risk Class':'Low',Region:'US'})
    if(i!==29) {
      files[`${id}/signed_document/signed.pdf`]=pdf(`${kit} signed agreement ${i+1}. End date February 28 2023. Auto renewal every 12 months. Notice 60 days. Amount USD 12000.50.`)
      files[`${id}/supporting_files/schedule.txt`]=Buffer.from(`${kit} unchanged supporting evidence ${i+1}\n`)
    }
  }
  files[`${sourceId(5)}/supporting_files/earlier.pdf`]=pdf(`${kit} unchanged earlier source version 5`)
  files['unknown-record/orphan.pdf']=pdf('Synthetic orphan; no metadata row')
  const profile={release:`synthetic-${kit}-profile/1`,documentation:'synthetic; tenant validation required',baseUrl:'https://synthetic-locket.invalid/',listPath:kit==='icertis'?'/ici/agreements?page=1':'EWSelect',recordsKey:kit==='icertis'?'agreements':'result',nextKey:kit==='icertis'?'next':undefined,idColumn,readPath:'EWRead',recordKey:'result',documentsPath:'/ici/agreements/{id}/documents',documentsKey:kit==='icertis'?'documents':'result',attachmentFields:['signed_document','supporting_files'],knowledgeBase:'SyntheticKB',table:'contract'}
  const calls=[]
  let failure=null
  async function outbound(request) {
    const u=new URL(request.url);calls.push({path:u.pathname,query:Object.fromEntries(u.searchParams),method:request.method,auth:request.headers.get('authorization')})
    if(failure==='redirect')return new Response(null,{status:302,headers:{location:'https://elsewhere.invalid/secret'}})
    if(failure==='status')return new Response('denied',{status:403})
    if(request.headers.get('authorization')!=='Bearer synthetic-read-only-token')return new Response('wrong credential',{status:401})
    if(u.pathname==='/ici/agreements')return Response.json({agreements:rows.slice(u.searchParams.get('page')==='1'?0:15,u.searchParams.get('page')==='1'?15:30),next:u.searchParams.get('page')==='1'?'/ici/agreements?page=2':null})
    const docs=u.pathname.match(/^\/ici\/agreements\/([^/]+)\/documents$/)
    if(docs)return Response.json({documents:Object.keys(files).filter(p=>p.startsWith(docs[1]+'/')).map(path=>({name:path.slice(path.indexOf('/')+1),url:'/original/'+path}))})
    if(u.pathname.startsWith('/original/'))return new Response(files[decodeURIComponent(u.pathname.slice(10))])
    const operation=u.pathname.slice(1),id=u.searchParams.get('$id'),field=u.searchParams.get('$field')
    if(operation==='EWSelect')return Response.json({result:rows.map(r=>Number(r[idColumn]))})
    if(operation==='EWRead')return Response.json({result:rows.find(r=>r[idColumn]===id)})
    const paths=Object.keys(files).filter(p=>p.startsWith(`${id}/${field}/`)),path=paths[Number(u.searchParams.get('$position')??0)]
    if(operation==='EWAttachInfo')return Response.json({result:paths.map((path,position)=>({name:path.split('/').pop(),position,size:files[path].length}))})
    if(operation==='EWRetrieve')return new Response(files[path])
    return new Response('Unknown fake endpoint',{status:404})
  }
  const csv=[Object.keys(rows[0]),...rows.map(r=>Object.values(r))].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')
  const payload={kit,label:`${kit} thirty agreements`,dateFormat:'iso',manifest:file(`${kit}.xlsx`,xlsx(rows)),files:Object.entries(files).map(([path,bytes])=>({path,base64:bytes.toString('base64')})),mapping:kit==='icertis'?{'First Party':'skip'}:{},typeMapping:{MSA:'supplier',Amendment:'amendment'},fileRoles:{signed_document:'signed',supporting_files:'attachment',[`${sourceId(5)}/supporting_files/earlier.pdf`]:'version'}}
  return {kit,rows,files,payload,csv,profile,calls,outbound,setFailure(value){failure=value},bindings:{[kit.toUpperCase()+'_IMPORT_PROFILE']:JSON.stringify(profile),[kit.toUpperCase()+'_IMPORT_TOKEN']:'synthetic-read-only-token'}}
}
