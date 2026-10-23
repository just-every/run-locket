import { fail } from './model'

export type PerformanceMetric='response'|'resolution'|'delivery'
export interface PerformanceRecord {recordId:string;createdAt:string|null;firstPublicResponseAt:string|null;resolvedAt:string|null;dueAt:string|null;deliveredAt:string|null}
export interface PerformanceConfig {clock:'wall';aggregation:'worst_record_once';thresholdMinutes:number;tiers:{minimumLateMinutes:number;creditBps:number}[];eligibleFeeCents:number;allocation:string;capCents:number;timeZone:string;claimDays:number;interpretation:string}
export const performanceColumns=['record_id','created_at','first_public_response_at','resolved_at','due_at','delivered_at'] as const
export function performanceInstant(value:unknown):number|null {
 if(value===null||value==='')return null
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))fail('REPORT_DATA','Report timestamps must be complete UTC ISO instants or empty. Offsets and local/business clocks are not inferred.')
 const n=Date.parse(value)
 if(!Number.isSafeInteger(n)||new Date(n).toISOString()!==value.replace(/Z$/,value.includes('.')?'Z':'.000Z'))fail('REPORT_DATA','A report timestamp is not a valid UTC instant.')
 return n
}
/** Exact documented CSV grammar, including quoted commas/newlines and escaped quotes. */
export function performanceCsv(bytes:Uint8Array):PerformanceRecord[] {
 if(bytes.length>2*1024*1024)fail('REPORT_DATA','Supplier report exceeds the 2 MiB evidence bound.')
 let body:string
 try{body=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{fail('REPORT_DATA','Supplier report must be UTF-8 CSV.')}
 if(body.includes('\0'))fail('REPORT_DATA','CSV contains a null character.')
 const rows:string[][]=[],row:string[]=[];let field='',quoted=false,closed=false
 for(let i=0;i<body.length;i++){
  const ch=body[i]
  if(quoted){if(ch==='"'){if(body[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=ch;continue}
  if(ch==='"'){if(field||closed)fail('REPORT_DATA','Invalid CSV quote.');quoted=true;continue}
  if(ch===','||ch==='\n'||ch==='\r'){
   row.push(field);field='';closed=false
   if(ch!==','){if(ch==='\r'&&body[i+1]==='\n')i++;rows.push(row.splice(0));if(rows.length>5001)fail('REPORT_DATA','Supplier report exceeds 5000 records.')}
  }else{if(closed)fail('REPORT_DATA','Unexpected text after a CSV quote.');field+=ch}
 }
 if(quoted)fail('REPORT_DATA','Unclosed CSV quote.')
 if(field||row.length||closed){row.push(field);rows.push(row)}
 if(rows.length<2||rows[0].join(',')!==performanceColumns.join(','))fail('REPORT_DATA','Use the documented six-column supplier report header and at least one record.')
 const seen=new Set<string>()
 return rows.slice(1).map(values=>{
  if(values.length!==6||!values[0].trim()||values[0].length>200||/[\x00-\x1f\x7f]/.test(values[0])||seen.has(values[0]))fail('REPORT_DATA','Every report row needs a distinct record_id and exactly six fields.')
  seen.add(values[0]);for(const value of values.slice(1))performanceInstant(value)
  return {recordId:values[0],createdAt:values[1]||null,firstPublicResponseAt:values[2]||null,resolvedAt:values[3]||null,dueAt:values[4]||null,deliveredAt:values[5]||null}
 })
}
export function comparePerformance(records:PerformanceRecord[],metric:PerformanceMetric,config:PerformanceConfig,period:{from:number;to:number},now:number,warnings:string[]=[]) {
 if(!records.length||records.length>5000)fail('REPORT_DATA','Evidence must contain between one and 5000 records.')
 const seen=new Set<string>(),results=records.map(r=>{
  if(!r.recordId||seen.has(r.recordId))fail('REPORT_DATA','Duplicate or missing evidence record identity.')
  seen.add(r.recordId)
  const created=performanceInstant(r.createdAt),actual=performanceInstant(metric==='response'?r.firstPublicResponseAt:metric==='resolution'?r.resolvedAt:r.deliveredAt),anchor=metric==='delivery'?performanceInstant(r.dueAt):created
  for(const value of [r.createdAt,r.firstPublicResponseAt,r.resolvedAt,r.deliveredAt]){const instant=performanceInstant(value);if(instant!==null&&instant>now)fail('REPORT_DATA','A reported event is in the future; no performance is inferred.')}
  if(anchor!==null&&(anchor<period.from||anchor>=period.to))fail('REPORT_WINDOW','Every report anchor must fall inside the selected service month.')
  if(actual!==null&&created!==null&&actual<created)fail('REPORT_DATA','A completion or response precedes record creation.')
  if(anchor===null||actual===null)return {recordId:r.recordId,status:'unknown' as const,elapsedMs:null,lateMs:null,reason:anchor===null?'The required start or due instant is missing.':'The required public response, resolution or delivery instant is missing. Closure is not proof of fulfillment.'}
  const elapsedMs=actual-anchor,lateMs=Math.max(0,elapsedMs-config.thresholdMinutes*60000)
  return {recordId:r.recordId,status:lateMs>0?'breached' as const:'met' as const,elapsedMs,lateMs,reason:lateMs>0?'Observed wall-clock performance exceeded the confirmed commitment.':'Observed wall-clock performance met the confirmed commitment.'}
 })
 return {records:results,metCount:results.filter(r=>r.status==='met').length,breachedCount:results.filter(r=>r.status==='breached').length,unknownCount:results.filter(r=>r.status==='unknown').length,worstLateMs:Math.max(0,...results.map(r=>r.lateMs??0)),warnings}
}
