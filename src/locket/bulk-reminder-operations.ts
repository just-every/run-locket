// A durable user operation advances one guarded batch at a time. The browser
// drives these requests sequentially and can resume the same operation later.
import type { Bindings } from '../auth.server'
import { canSee, grantsFor, may, requireRole } from './access'
import { bulkReminderHandlers } from './bulk-reminders'
import type { Ctx, Handler } from './commands'
import { fail, json, list, sql, text, type Actor } from './model'

export interface ReminderOperation {
  id: string; status: string; total: number; previewed: number; applied: number; processed: number; scheduled: number
  ownerId: string; offsets: number[]; expiresAt: number
  tracked: any[]; skipped: any[]
}
const summarize = (j: any, payload: any, previews: any[]) => ({ id:j.id, status:j.status, total:payload.ids.length, previewed:j.previewed, applied:j.applied, processed:previews.slice(0,j.applied).reduce((sum,p)=>sum+p.tracked.length+p.skipped.length,0), scheduled:previews.slice(0,j.applied).reduce((sum,p)=>sum+p.tracked.length,0), ownerId:payload.ownerId, offsets:payload.offsets, expiresAt:j.expires_at, tracked:previews.flatMap(p=>p.tracked), skipped:previews.flatMap(p=>p.skipped) })

const start: Handler = async(c,p)=>{
  requireRole(c.actor,may.renewalDecision,'schedule renewal reminders')
  const ids=list(p,'agreementIds',Number.MAX_SAFE_INTEGER).map(value=>text({value},'value',64))
  if(!ids.length || new Set(ids).size!==ids.length)fail('INVALID','Select different imported agreements.')
  const offsets=list(p,'offsets',12)
  const id=crypto.randomUUID()
  return {allowed:may.renewalDecision,result:{id,status:'previewing',total:ids.length},writes:[sql('INSERT INTO lk_bulk_reminder_operations VALUES(?,?,?,?,0,0,\'previewing\',?,?,1)',id,c.actor.id,json({ids:ids.sort(),ownerId:text(p,'ownerId',64),offsets}),json([]),c.now,c.now+30*60_000)],audit:[{action:'renewal.bulk.start',summary:`Started reviewed reminder scheduling for ${ids.length} selected agreements.`}]}
}

async function previewRows(db:D1Database, ids:string[]){
  if(!ids.length)return []
  const rows=(await db.prepare('SELECT * FROM lk_bulk_reminder_previews WHERE id IN (SELECT value FROM json_each(?))').bind(json(ids)).all<any>()).results
  return ids.map(id=>{
    const row=rows.find(r=>r.id===id)
    if(!row)fail('STALE','A reviewed batch is no longer available.',409)
    const snapshot=JSON.parse(row.snapshot)
    return {id:row.id,ownerId:row.owner_id,offsets:snapshot.offsets,tracked:snapshot.rows.filter((r:any)=>!r.reason),skipped:snapshot.rows.filter((r:any)=>r.reason)}
  })
}

async function operation(c:Ctx,id:unknown){
  const job=await c.db.prepare('SELECT * FROM lk_bulk_reminder_operations WHERE id=? AND actor_id=?').bind(text({id},'id',64),c.actor.id).first<any>()
  if(!job)fail('NOT_FOUND','No reminder operation you prepared has that identity.',404)
  if(job.expires_at<=c.now)fail('STALE','The review expired. Preview the selection again.',409)
  return job
}
const next:Handler=async(c,p)=>{
  requireRole(c.actor,may.renewalDecision,'schedule renewal reminders')
  const job=await operation(c,p.operationId), payload=JSON.parse(job.payload), previewIds=JSON.parse(job.previews)
  const previews=await previewRows(c.db,previewIds)
  let out, status=job.status, previewed=job.previewed, applied=job.applied
  if(status==='previewing'){
    out=await bulkReminderHandlers['renewal.bulk.preview'](c,{agreementIds:payload.ids.slice(previewed,previewed+100),ownerId:payload.ownerId,offsets:payload.offsets})
    previews.push(out.result as any);previewIds.push((out.result as any).id);previewed+=Math.min(100,payload.ids.length-previewed)
    if(previewed===payload.ids.length)status='reviewed'
  }else if((status==='reviewed'||status==='applying')&&p.apply===true){
    out=await bulkReminderHandlers['renewal.bulk.apply'](c,{previewId:previews[applied].id})
    applied++;status=applied===previews.length?'done':'applying'
  }else fail('STATUS','Review all deadlines before applying this operation.',409)
  const result=summarize({...job,status,previewed,applied},payload,previews)
  // Progress responses contain counts only; rows are read through current access.
  const {tracked,skipped,...progress}=result
  return { ...out, result:progress,
    checks:[...(out.checks??[]),sql('EXISTS(SELECT 1 FROM lk_bulk_reminder_operations WHERE id=? AND actor_id=? AND version=? AND expires_at>?)',job.id,c.actor.id,job.version,c.now)],
    writes:[...out.writes,sql('UPDATE lk_bulk_reminder_operations SET previews=?,previewed=?,applied=?,status=?,version=version+1 WHERE id=?',json(previewIds),previewed,applied,status,job.id)],
  }
}
export const bulkOperationHandlers:Record<string,Handler>={'renewal.bulk.start':start,'renewal.bulk.next':next}

export async function bulkReminderOperations(env:Bindings,actor:Actor):Promise<ReminderOperation[]>{
  if(!may.renewalDecision.includes(actor.role))return []
  const grants=await grantsFor(env,actor)
  const visible=new Set((await env.DB.prepare('SELECT * FROM lk_agreements').all<any>()).results.filter(a=>canSee(actor,a,grants)).map(a=>a.id))
  const jobs=(await env.DB.prepare('SELECT * FROM lk_bulk_reminder_operations WHERE actor_id=? AND expires_at>? ORDER BY created_at DESC,id').bind(actor.id,Date.now()).all<any>()).results
  const result:ReminderOperation[]=[]
  for(const job of jobs){
    const payload=JSON.parse(job.payload)
    if(!payload.ids.every((id:string)=>visible.has(id)))continue
    result.push(summarize(job,payload,await previewRows(env.DB,JSON.parse(job.previews))))
  }
  return result
}
