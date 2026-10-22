import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {file,pdf} from './files.mjs'
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
export async function repositoryBulkFixture(owner,count=8,start=1){
 const ids=[],originals=new Map()
 for(let i=0;i<count;i++){
  const name=`synthetic-locket-${start+i}`,bytes=pdf(`Agreed terms. ${name}`)
  const a=await owner.command('legacy.import',{title:name,type:'supplier',party:{name,kind:'supplier'},sourceSystem:'Synthetic repository fixture',sourceId:name,signed:true,file:file(name+'.pdf',bytes),text:`Agreed terms. ${name}`})
  ids.push(a.id);originals.set(a.id,bytes)
 }
 return {ids,originals}
}
export const bulkView=async(owner,id)=>{
 const r=await owner.request('/api/locket/repository/bulk?operationId='+id)
 assert.equal(r.status,200,await r.clone().text());return r.json()
}
export async function reviewBulk(owner,id){
 let result
 do{result=await owner.command('repository.bulk.review',{operationId:id})}while(result.remaining)
 return bulkView(owner,id)
}
export async function prepareBulk(owner,selection,input){
 const s=await owner.command('repository.bulk.select',Array.isArray(selection)?{agreementIds:selection}:selection)
 await owner.command('repository.bulk.preview',{operationId:s.operationId,...input})
 return reviewBulk(owner,s.operationId)
}
export async function applyBulk(owner,id){
 let result
 do{result=await owner.command('repository.bulk.next',{operationId:id})}while(result.remaining)
 return bulkView(owner,id)
}
export function unzipStored(buffer){
 const bytes=Buffer.from(buffer),entries=new Map();let offset=0
 while(bytes.readUInt32LE(offset)===0x04034b50){
  assert.equal(bytes.readUInt16LE(offset+8),0,'exact files use stored ZIP entries')
  const size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extraLength=bytes.readUInt16LE(offset+28)
  const name=bytes.subarray(offset+30,offset+30+nameLength).toString(),start=offset+30+nameLength+extraLength
  entries.set(name,bytes.subarray(start,start+size));offset=start+size
 }
 assert.equal(bytes.readUInt32LE(offset),0x02014b50)
 return entries
}
export function csvRecords(text){
 const records=[];let row=[],cell='',quoted=false
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(!quoted&&c===','){row.push(cell);cell=''}else if(!quoted&&(c==='\r'||c==='\n')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))records.push(row);row=[];cell=''}else cell+=c}
 if(row.length||cell){row.push(cell);records.push(row)}return records
}
export const writeCsv=rows=>rows.map(row=>row.map(s=>'"'+s.replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n'
