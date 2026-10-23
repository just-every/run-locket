import { fail } from './model'
import { addDays, zonedInstant } from './dates'

export type OutcomeMetric = 'deadlinesMissed'|'deadlinesLate'|'renewedWithoutDecision'|'overdueOurs'|'overdueSupplier'|'overdueUnclassified'|'overchargesFound'|'creditsFound'|'creditsRecovered'|'pastEndSpend'
export type OutcomeEvidence = { id:string; agreementId:string; recordId:string; kind:string; label:string; href:string; cents:number|null; details:Record<string,unknown> }
export interface OutcomeFigure { count:number|null; cents:number|null; evidence:OutcomeEvidence[]; unavailable:string[] }
export interface OutcomeMonth { month:string; figures:Record<OutcomeMetric,OutcomeFigure> }
export interface OutcomeReport { month:string; timezone:string; generatedAt:number; months:OutcomeMonth[]; basis:string[] }
export const outcomeLabels:Record<OutcomeMetric,string>={deadlinesMissed:'Deadlines missed',deadlinesLate:'Deadlines met late',renewedWithoutDecision:'Renewed without a recorded decision',overdueOurs:'Our overdue obligations',overdueSupplier:'Supplier overdue obligations',overdueUnclassified:'Overdue obligations with side unclassified',overchargesFound:'Potential overcharges found',creditsFound:'Service credits found',creditsRecovered:'Credits recovered',pastEndSpend:'USD bills after agreement end'}
export function outcomeMonth(value:string){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)||Number(value.slice(0,4))<1900)fail('INVALID','Choose a calendar month in YYYY-MM format.')
 return value
}
export function shiftMonth(month:string,delta:number){const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+delta);return d.toISOString().slice(0,7)}
export function monthBounds(month:string,zone:string){const start=month+'-01',next=shiftMonth(month,1)+'-01';return {start,end:addDays(next,-1),from:zonedInstant(start,'00:00:00',zone),to:zonedInstant(next,'00:00:00',zone)}}
export function emptyMonth(month:string):OutcomeMonth{return {month,figures:Object.fromEntries(Object.keys(outcomeLabels).map(key=>[key,{count:key==='creditsRecovered'?null:0,cents:['overchargesFound','creditsFound','pastEndSpend'].includes(key)?0:null,evidence:[],unavailable:key==='creditsRecovered'?['Recovery is unconfirmed: approvals, requests, provider acceptance and bill balances do not prove money recovered.']:[]}])) as unknown as Record<OutcomeMetric,OutcomeFigure>}}
export function evidence(agreementId:string,recordId:string,kind:string,label:string,cents:number|null,details:Record<string,unknown>={}):OutcomeEvidence{return {id:`${kind}:${recordId}`,agreementId,recordId,kind,label,cents,href:`/app#agreement/${encodeURIComponent(agreementId)}/terms`,details}}
export function addFigure(month:OutcomeMonth,key:OutcomeMetric,record:OutcomeEvidence){const f=month.figures[key];f.count=(f.count??0)+1;f.evidence.push(record);if(f.cents!==null&&record.cents!==null){f.cents+=record.cents;if(!Number.isSafeInteger(f.cents))fail('REPORT_RANGE','Report total exceeds the exact USD range.',409)}}
