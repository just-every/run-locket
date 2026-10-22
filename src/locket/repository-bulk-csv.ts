import type { CustomField } from './custom-fields'
import { parseCsv } from './imports/csv'
import { fail, json } from './model'
import { standardBulkFields, type BulkItem, type BulkSnapshot, type BulkChanges } from './repository-bulk-model'

const cell=(v:unknown)=>{let s=String(v??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}
const wire=(field:string,v:unknown,fields:CustomField[])=>{
 const kind=fields.find(f=>'custom:'+f.id===field)?.kind
 if(v===null||v===undefined)return ''
 if(field==='groups')return json(v)
 if(field==='value'||kind==='money')return (Number(v)/100).toFixed(2)
 return String(v)
}
export function bulkCsv(items:BulkItem[],fields:CustomField[]):string{
 const header=['agreement_id','version',...standardBulkFields,...fields.map(f=>'custom:'+f.id)]
 return [header.map(cell).join(','),...items.map(item=>{
  const s:BulkSnapshot=JSON.parse(item.snapshot)
  return [cell(item.agreement_id),cell(s.agreement.version),...header.slice(2).map(f=>cell(wire(f,s.values[f],fields)))].join(',')
 })].join('\r\n')+'\r\n'
}
/** Compare spreadsheet text with its exact exported baseline before parsing.
 * Untouched formula-safe values and nulls cannot become accidental changes. */
export function bulkCsvChanges(csv:string,items:BulkItem[],fields:CustomField[]):Map<string,BulkChanges>{
 if(csv.length>16*1024*1024)fail('INVALID','The metadata CSV is too large.')
 const {header,rows}=parseCsv(csv),allowed=['agreement_id','version',...standardBulkFields,...fields.map(f=>'custom:'+f.id)]
 if(!header.includes('agreement_id')||!header.includes('version')||new Set(header).size!==header.length||header.some(f=>!allowed.includes(f)))fail('INVALID','Keep agreement_id, version and known editable metadata columns.')
 if(rows.length>5000)fail('INVALID','A CSV update selects at most 5,000 agreements.')
 const originals=new Map(items.map(i=>[i.agreement_id,i])),result=new Map<string,BulkChanges>()
 for(const row of rows){
  const item=originals.get(row.agreement_id)
  if(!item||result.has(row.agreement_id))fail('INVALID','CSV identities must appear once and belong to the exported selection.')
  const s:BulkSnapshot=JSON.parse(item.snapshot)
  if(row.version!==String(s.agreement.version))fail('STALE','Keep the exported version beside each agreement.',409)
  const changes:BulkChanges={}
  for(const field of header.filter(f=>!['agreement_id','version'].includes(f))){
   const raw=row[field],baseline=wire(field,s.values[field],fields)
   // cell() adds quoting around an optional leading formula escape.
   const safe=/^[\s\u0000-\u001f]*[=+@-]/.test(baseline)||/^[\t\r\n]/.test(baseline)?"'"+baseline:baseline
   if(raw===safe)continue
   const value=raw.startsWith("'")&&/^[\s\u0000-\u001f]*[=+@-]/.test(raw.slice(1))?raw.slice(1):raw
   const kind=fields.find(f=>'custom:'+f.id===field)?.kind
   if(value===''){changes[field]=null;continue}
   if(field==='groups'){try{changes[field]=JSON.parse(value)}catch{fail('INVALID','Group identities must be a JSON list.')}continue}
   if(kind==='yes_no'||field==='restricted'){
    if(!['true','false'].includes(value))fail('INVALID',`${field} needs true or false.`)
    changes[field]=value==='true'
   }else if(kind==='number'){
    if(!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)||!Number.isFinite(Number(value)))fail('INVALID',`${field} needs a finite number.`)
    changes[field]=Number(value)
   }else changes[field]=value
  }
  result.set(item.agreement_id,changes)
 }
 return result
}
