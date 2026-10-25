import { observeOperation } from './connection-observations'
import type { Bindings } from '../auth.server'
import { addDays,zonedInstant } from './dates'
import { fail,sha256 } from './model'

// Primary contract: run-uptime docs/metrics.md and domain/metrics/snapshot.server.ts.
import { uptimeDenominatorPolicy } from './service-level-policy'
export { uptimeDenominatorPolicy } from './service-level-policy'
export interface UptimeEvidenceMetrics {
 monitorId:string;generatedAt:number;denominatorPolicy:string;providerDisplayPercent:number
 windowMs:number;observedMs:number;upMs:number;notPassingMs:number;unknownMs:number;pausedMs:number;maintenanceMs:number
}
export function uptimeOrigin(value:unknown):string {
 let u:URL
 try{u=new URL(String(value))}catch{fail('UPTIME_CONFIG','Configure a complete HTTPS Uptime installation origin.',409)}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||! /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(u.hostname)||/^(?:\d+\.)+\d+$/.test(u.hostname)||/\.(local|localhost)$/i.test(u.hostname))fail('UPTIME_CONFIG','Use the exact public HTTPS Uptime origin without credentials, path, port or query.',409)
 return u.origin
}
export function serviceMonth(month:unknown,zone:string,claimDays:number) {
 if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('INVALID','month must be YYYY-MM.')
 const [year,m]=month.split('-').map(Number)
 if(year<1970||year>9998)fail('INVALID','Choose a supported service month.')
 const first=month+'-01',next=new Date(Date.UTC(year,m,1)).toISOString().slice(0,10),last=addDays(next,-1)
 const from=zonedInstant(first,'00:00:00',zone),to=zonedInstant(next,'00:00:00',zone),deadlineDate=addDays(last,claimDays),deadlineAt=zonedInstant(deadlineDate,'23:59:59',zone)
 if(!Number.isSafeInteger(from)||to<=from||to-from>90*86400000)fail('INVALID','The confirmed service-month bounds are invalid.')
 return {month,from,to,deadlineDate,deadlineAt,last}
}
async function boundedBytes(response:Response):Promise<Uint8Array> {
 if(Number(response.headers.get('content-length')??0)>2*1024*1024)fail('UPTIME_DATA','Uptime response exceeds 2 MiB; no partial evidence used.',502)
 if(!response.body)fail('UPTIME_DATA','Uptime returned no evidence.',502)
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0
 try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>2*1024*1024){await reader.cancel();fail('UPTIME_DATA','Uptime response exceeds 2 MiB; no partial evidence used.',502)}parts.push(next.value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length}return bytes
}
async function readUptimeEvidence(env:Bindings,origin:string,monitorId:string,period:{from:number;to:number},now:number) {
 if(!env.UPTIME_METRICS_KEY||uptimeOrigin(env.UPTIME_ORIGIN)!==origin)fail('UPTIME_UNAVAILABLE','The server-only Uptime metrics connection is missing or changed. Reauthorize the exact installation.',409)
 const url=new URL('/api/v1/metrics',origin)
 url.search=new URLSearchParams({format:'json',monitor:monitorId,period:'custom',from:new Date(period.from).toISOString(),to:new Date(period.to).toISOString(),timeZone:'UTC'}).toString()
 let response:Response,bytes:Uint8Array
 try{response=await fetch(url,{headers:{Authorization:`Bearer ${env.UPTIME_METRICS_KEY}`,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(15000)});if(response.status>=300&&response.status<400)fail('UPTIME_UNAVAILABLE','Uptime redirected the read. No credential or evidence followed the redirect.',502);if(!response.ok)fail('UPTIME_UNAVAILABLE','Uptime refused the metrics read. Reconnect or narrow the selection; availability is unavailable.',502);bytes=await boundedBytes(response)}catch(error){if((error as {code?:string}).code)throw error;fail('UPTIME_UNAVAILABLE','Uptime could not be read within the evidence bounds. Availability is unavailable.',502)}
 let raw:any
 try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{fail('UPTIME_DATA','Uptime returned invalid UTF-8 JSON.',502)}
 if(raw?.schemaVersion!==1||raw.source!=='uptime'||!Number.isSafeInteger(raw.generatedAt)||raw.generatedAt<now-300000||raw.generatedAt>now+300000||raw.generatedAt<period.to||raw.period?.period!=='custom'||raw.period.from!==period.from||raw.period.to!==period.to||raw.period.timeZone!=='UTC'||raw.period.slaTargetPercent!==null||raw.denominatorPolicy!==uptimeDenominatorPolicy||!Array.isArray(raw.monitors)||raw.monitors.length!==1||raw.monitors[0]?.id!==monitorId)fail('UPTIME_DATA','Uptime identity, period, freshness, schema or denominator policy does not match the authorized read.',502)
 const a=raw.monitors[0].availability,keys=['windowMs','observedMs','upMs','notPassingMs','unknownMs','pausedMs','maintenanceMs']
 if(!a||keys.some(k=>!Number.isSafeInteger(a[k])||a[k]<0)||a.windowMs!==period.to-period.from||a.upMs+a.notPassingMs!==a.observedMs||a.observedMs+a.unknownMs+a.pausedMs+a.maintenanceMs!==a.windowMs)fail('UPTIME_DATA','Uptime durations do not reconcile to the complete requested service window.',502)
 if(a.observedMs===0){if(a.uptimePercent!==null)fail('UPTIME_DATA','A zero observed denominator must be unavailable.',502);fail('UPTIME_UNDEFINED','Uptime has no observed scheduled time. No availability, breach or credit is inferred.',409)}
 if(typeof a.uptimePercent!=='number'||!Number.isFinite(a.uptimePercent)||a.uptimePercent<0||a.uptimePercent>100)fail('UPTIME_DATA','Uptime returned an invalid displayed availability.',502)
 const metrics:UptimeEvidenceMetrics={monitorId,generatedAt:raw.generatedAt,denominatorPolicy:raw.denominatorPolicy,windowMs:a.windowMs,observedMs:a.observedMs,upMs:a.upMs,notPassingMs:a.notPassingMs,unknownMs:a.unknownMs,pausedMs:a.pausedMs,maintenanceMs:a.maintenanceMs,providerDisplayPercent:a.uptimePercent}
 return {bytes,sha256:await sha256(bytes),metrics}
}

export async function readUptime(env:Bindings,origin:string,monitorId:string,period:{from:number;to:number},now:number){
 try{const evidence=await readUptimeEvidence(env,origin,monitorId,period,now);await observeOperation(env,'uptime',origin,true,'metrics_read_succeeded');return evidence}
 catch(error){await observeOperation(env,'uptime',origin,false,'metrics_read_failed');throw error}
}
