import { installationSettings } from './installation'
import { reportInstant, localMinute } from './report-schedule'
import type { Bindings } from '../auth.server'
import { requireRole } from './access'
import type { Handler } from './commands'
import { fail, integer, json, list, oneOf, sql, text, type Actor, type Role } from './model'
import { savedViews, type ViewDefinition } from './saved-views'
import { repositoryFields } from './repository-fields'
import { reportOutput } from './report-output'

export const reportHumans: Role[] = ['owner','counsel','approver','requester','viewer']
export interface ReportRow { id:string; name:string; definition:string; group_field:string; frequency:'weekly'|'monthly'; format:'csv'|'pdf'; recipients:string; first_at:number; first_local:string; timezone:string; next_at:number; enabled:number; created_by:string; version:number; created_at:number }
export async function reports(env:Bindings, actor:Actor) {
  return (await env.DB.prepare('SELECT * FROM lk_reports WHERE created_by=? ORDER BY created_at DESC').bind(actor.id).all<ReportRow>()).results
}
export async function ownReport(env:Bindings, actor:Actor, id:string) {
  const r=(await reports(env,actor)).find(r=>r.id===id)
  if(!r)fail('NOT_FOUND','No report you own has that identity.',404)
  return r
}
export const reportDefinition = (r:ReportRow) => ({name:r.name,group_field:r.group_field,definition:JSON.parse(r.definition) as ViewDefinition})
export const reportHandlers:Record<string,Handler>={
  'report.create':async(c,p)=>{
    requireRole(c.actor,reportHumans,'schedule reports')
    const view=(await savedViews(c.env,c.actor)).find(v=>v.id===text(p,'viewId',100))
    if(!view)fail('NOT_FOUND','Choose a saved view you can read.',404)
    const group=text(p,'groupField',100)
    if(!repositoryFields.some(f=>f.id===group))fail('INVALID','Choose a grouping field.')
    const recipients=list(p,'recipients',Number.MAX_SAFE_INTEGER).map(x=>text({id:x},'id',100))
    if(!recipients.length||new Set(recipients).size!==recipients.length)fail('INVALID','Choose distinct recipients.')
    const checks=[]
    for(const id of recipients){
      const check=sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active')",id)
      if(!(await c.db.prepare(`SELECT ${check.sql} AS ok`).bind(...check.params).first<{ok:number}>())?.ok)fail('INVALID','Choose active recipients.')
      checks.push(check)
    }
    const name=text(p,'name',160), frequency=oneOf(p,'frequency',['weekly','monthly'] as const), format=oneOf(p,'format',['csv','pdf'] as const)
    const firstLocal=text(p,'firstAt',16), settings=await installationSettings(c.db)
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(firstLocal)||!Number.isFinite(Date.parse(firstLocal+'Z'))||new Date(firstLocal+'Z').toISOString().slice(0,16)!==firstLocal)fail('INVALID','Choose a valid calendar date and time.')
    const first=reportInstant(firstLocal,settings.timezone)
    if(first<=c.now||localMinute(first,settings.timezone)!==firstLocal)fail('INVALID','First occurrence must be a future local time that exists in the installation zone.')
    checks.push(settings.version?sql("(SELECT version FROM lk_installation_settings WHERE id='installation')=?",settings.version):sql("NOT EXISTS(SELECT 1 FROM lk_installation_settings WHERE id='installation')"))
    const id=crypto.randomUUID()
    checks.push(sql('(SELECT version FROM lk_saved_views WHERE id=?)=?',view.id,view.version))
    return{allowed:reportHumans,result:{id},checks,writes:[sql('INSERT INTO lk_reports(id,name,definition,group_field,frequency,format,recipients,first_at,first_local,timezone,next_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,name,json(view.definition),group,frequency,format,json(recipients),first,firstLocal,settings.timezone,first,c.actor.id,c.now)],audit:[{action:'report.create',summary:'Scheduled a personal report from a saved-view snapshot.'}]}
  },
  'report.stop':async(c,p)=>{
    requireRole(c.actor,reportHumans,'stop reports')
    const r=await ownReport(c.env,c.actor,text(p,'id',100)), version=integer(p,'version',1)
    if(version!==r.version)fail('STALE','This report changed. Reload.',409)
    return{allowed:reportHumans,result:{id:r.id},checks:[sql('EXISTS(SELECT 1 FROM lk_reports WHERE id=? AND created_by=? AND version=?)',r.id,c.actor.id,version)],writes:[sql('UPDATE lk_reports SET enabled=0,version=version+1 WHERE id=?',r.id)],audit:[{action:'report.stop',summary:'Stopped a personal report schedule.'}]}
  },
}
export async function previewReport(env:Bindings,actor:Actor,id:string){return reportOutput(env,actor,reportDefinition(await ownReport(env,actor,id)))}
