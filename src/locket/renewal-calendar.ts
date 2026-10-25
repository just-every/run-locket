// Real provider adapters. Tokens never join permission-scoped state; responses
// are retained only after the provider acknowledges the exact current event.
import { observeOperation } from './connection-observations'
import type { Bindings } from '../auth.server'
import { agreementAccessSql, may, requireRole } from './access'
import { guardSql, type Ctx, type Handler } from './commands'
import { familyClear } from './family-analysis-guard'
import { installationSettings } from './installation'
import { lifecycle, endInstant } from './lifecycle'
import { fail, oneOf, sha256, sql, text, type Actor } from './model'
import { notificationBatch, notificationCheck } from './notifications'
import { hiddenFields } from './repository-access'
type Row={id:string;[key:string]:any}
const rows=async(db:D1Database,query:string,...args:unknown[])=>(await db.prepare(query).bind(...args).all<Row>()).results
const connect:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'approve a deadline calendar connection')
 if(p.consent!==true||p.scope!=='all_accessible')fail('CONSENT','Approve this exact provider and calendar for all agreements you can access.')
 const provider=oneOf(p,'provider',['google','outlook'] as const),calendar=text(p,'calendarId',1000),token=text(p,'accessToken',8000)
 const prior=await c.db.prepare('SELECT id FROM lk_calendar_connections WHERE operator_id=? AND provider=? AND calendar_id=?').bind(c.actor.id,provider,calendar).first<{id:string}>(),id=prior?.id??crypto.randomUUID()
 return {allowed:['owner'],result:{id,provider,calendarId:calendar,status:'connected_not_synchronized'},writes:[sql('INSERT INTO lk_calendar_connections(id,operator_id,provider,calendar_id,token,last_error,created_at) VALUES(?,?,?,?,?,NULL,?) ON CONFLICT(operator_id,provider,calendar_id) DO UPDATE SET token=excluded.token,last_error=NULL,version=version+1',id,c.actor.id,provider,calendar,token,c.now),sql('DELETE FROM lk_connection_health WHERE id=?','calendar:'+id)],audit:[{action:'calendar.connect',summary:`Approved ${provider} calendar ${calendar} for deadlines from all agreements the owner can currently access.`}]}
}
export const renewalCalendarHandlers:Record<string,Handler>={'calendar.connect':connect}
export async function renewalCalendarState(db:D1Database,actor:Actor,ids:Set<string>) {
 const connections=await rows(db,'SELECT id,provider,calendar_id,last_error,created_at,token IS NOT NULL AS configured FROM lk_calendar_connections WHERE operator_id=?',actor.id)
 const events=(await rows(db,'SELECT e.* FROM lk_calendar_events e JOIN lk_calendar_connections c ON c.id=e.connection_id WHERE c.operator_id=?',actor.id)).filter(e=>ids.has(e.agreement_id))
 return {calendarConnections:connections,calendarEvents:events}
}
interface Event {key:string;agreementId:string;at:number;zone:string;kind:string}
export function currentCalendarEvents(a:Row,terms:Row[],renewals:Row[],notices:Row[],now:number,roll:boolean):Event[] {
 const c=lifecycle(a,terms,renewals,notices,now,roll)
 if(['expired','terminated','not_executed','terms_unconfirmed'].includes(c.status))return []
 const events:Event[]=[]
 if(c.deadline)events.push({key:`${a.id}:notice`,agreementId:a.id,at:c.deadline.at,zone:a.timezone,kind:'Notice deadline'})
 if(c.end)events.push({key:`${a.id}:end`,agreementId:a.id,at:endInstant(c.end,a.timezone),zone:a.timezone,kind:'Agreement end'})
 if(c.review)events.push({key:`${a.id}:review`,agreementId:a.id,at:c.review.dueAt,zone:a.timezone,kind:'Evergreen review'})
 return events
}
function base(c:Row) {
 return c.provider==='google' ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.calendar_id)}/events` : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(c.calendar_id)}/events`
}
async function providerRequest(c:Row,path:string,method:string,body?:unknown) {
 const response=await fetch(base(c)+path,{method,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${c.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
 if(!response.ok&&!(method==='DELETE'&&response.status===404))throw new Error(`Calendar provider returned ${response.status}`)
 return response.status===204||method==='DELETE'?null:response.json() as Promise<any>
}
export async function runRenewalCalendars(env:Bindings,now:number) {
 const db=env.DB,setting=await installationSettings(db)
 for(const connection of await rows(db,'SELECT * FROM lk_calendar_connections')) {
  const person=await db.prepare("SELECT o.id,o.display_name AS name,o.email,o.version,CASE WHEN o.role='owner' THEN 'owner' ELSE COALESCE(r.role,'viewer') END AS role FROM oa_operators o LEFT JOIN lk_roles r ON r.operator_id=o.id WHERE o.id=? AND o.status='active'").bind(connection.operator_id).first<any>()
  if(!person||person.role!=='owner'||!connection.token||connection.last_error?.startsWith('Uncertain'))continue
  const actor:Actor={...person,sessionId:'',operatorVersion:person.version}
  if((await hiddenFields(db,actor)).length)continue
  const access=agreementAccessSql(actor.id)
  const agreements=await rows(db,`SELECT a.* FROM lk_agreements a WHERE (${access.sql})`,...access.params)
  const desired:Event[]=[]
  for(const a of agreements) {
   if(!await notificationCheck(db,[familyClear(a.id)]))continue
   const terms=await rows(db,"SELECT * FROM lk_terms WHERE agreement_id=? AND status='confirmed'",a.id),renewals=await rows(db,'SELECT * FROM lk_renewals WHERE agreement_id=?',a.id),notices=await rows(db,'SELECT * FROM lk_notices WHERE agreement_id=?',a.id)
   desired.push(...currentCalendarEvents(a,terms,renewals,notices,now,setting.rollNoticeDeadlines))
  }
  let creating=false,synchronized=false
  try {
   const existing=await rows(db,'SELECT * FROM lk_calendar_events WHERE connection_id=?',connection.id)
   // Replacing a moved deadline updates the same event, retaining provider custody.
   for(const event of desired) {
    const old=existing.find(e=>e.event_key===event.key)
    if(old?.deadline_at===event.at)continue
    const a=agreements.find(a=>a.id===event.agreementId)!,checks=[sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active' AND version=?)",person.id,person.version),sql('(SELECT version FROM lk_agreements WHERE id=?)=?',a.id,a.version),familyClear(a.id),sql('EXISTS(SELECT 1 FROM lk_calendar_connections WHERE id=? AND token=?)',connection.id,connection.token)]
    if(!await notificationCheck(db,checks))continue
    const providerId=(await sha256(connection.id+':'+event.key)).slice(0,32),link=new URL('/app#agreement/'+a.id+'/terms',env.AUTH_ORIGIN).toString(),iso=new Date(event.at).toISOString()
    const payload=connection.provider==='google'?{...(!old?{id:providerId}:{}),summary:event.kind,description:link,start:{dateTime:iso,timeZone:event.zone},end:{dateTime:new Date(event.at+60000).toISOString(),timeZone:event.zone}}:{...(!old?{transactionId:providerId}:{}),subject:event.kind,body:{contentType:'text',content:link},start:{dateTime:iso.replace('Z',''),timeZone:'UTC'},end:{dateTime:new Date(event.at+60000).toISOString().replace('Z',''),timeZone:'UTC'}}
    if(!old) {
     const claim=crypto.randomUUID()
     try { await notificationBatch(db,[guardSql(claim,[...checks,sql("EXISTS(SELECT 1 FROM lk_calendar_connections WHERE id=? AND (last_error IS NULL OR last_error NOT LIKE 'Uncertain%'))",connection.id)]),sql("UPDATE lk_calendar_connections SET last_error='Uncertain calendar creation; reconnect with explicit approval after checking the provider calendar.' WHERE id=?",connection.id),sql('DELETE FROM lk_guard WHERE id=?',claim)]) }
     catch(error){if(/LOCKET_GUARD|CHECK constraint/.test(String(error)))continue;throw error}
    }
    creating=!old
    const response=await providerRequest(connection,old?'/'+encodeURIComponent(old.provider_event_id):'',old?'PATCH':'POST',payload)
    if(typeof response?.id!=='string'||response.id.length>1000||!response.id.length)throw new Error('Calendar response lacks an event identity')
    const guard=crypto.randomUUID()
    await notificationBatch(db,[guardSql(guard,checks),sql('INSERT INTO lk_calendar_events VALUES(?,?,?,?,?,?,?) ON CONFLICT(connection_id,event_key) DO UPDATE SET provider_event_id=excluded.provider_event_id,deadline_at=excluded.deadline_at,synchronized_at=excluded.synchronized_at',old?.id??crypto.randomUUID(),connection.id,a.id,event.key,response.id,event.at,now),sql('UPDATE lk_calendar_connections SET last_error=NULL WHERE id=?',connection.id),sql('DELETE FROM lk_guard WHERE id=?',guard)])
    creating=false;synchronized=true
   }
   for(const old of existing.filter(e=>!desired.some(d=>d.key===e.event_key))) {
    await providerRequest(connection,'/'+encodeURIComponent(old.provider_event_id),'DELETE')
    await db.prepare('DELETE FROM lk_calendar_events WHERE id=?').bind(old.id).run();synchronized=true
   }
   if(synchronized)await observeOperation(env,'calendar:'+connection.id,connection.provider+' calendar '+connection.calendar_id,true,'calendar_sync_succeeded',sql('(SELECT version FROM lk_calendar_connections WHERE id=?)=?',connection.id,connection.version))
  } catch(error) { const detail=String(error instanceof Error?error.message:'Calendar synchronization failed').replaceAll(connection.token,'[redacted]').slice(0,300);await db.prepare('UPDATE lk_calendar_connections SET last_error=? WHERE id=?').bind(creating?`Uncertain calendar creation: ${detail}. Reconnect with explicit approval after checking the provider calendar.`:detail,connection.id).run();await observeOperation(env,'calendar:'+connection.id,connection.provider+' calendar '+connection.calendar_id,false,'calendar_sync_failed',sql('(SELECT version FROM lk_calendar_connections WHERE id=?)=?',connection.id,connection.version)) }
 }
}
