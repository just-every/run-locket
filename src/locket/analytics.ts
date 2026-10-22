// All source records have already passed current agreement/field access checks.
import { fail } from './model'
type Row = { id: string; [key: string]: any }
type Workspace = {
  requestQueue: {cancellations:Row[];work:Row[]}; now: number; agreements: Row[]; workflowHistory: Row[]; packages: Row[]
  workflowStages: Row[]; workflowServiceLevels: Row[]
  approvalReminders: { pending: { agreementId: string; approverId: string; requestedAt: number; escalateAt?:number;ruleStepId?:string }[] }
}
const statuses = ['draft', 'in_review', 'approved', 'out_for_signature']
const stages = ['intake','drafting','negotiation','approval','signature']
const dayMs = 86_400_000

function bound(params: URLSearchParams, key: string, end: boolean) {
  const value = params.get(key)
  if (!value) return end ? Infinity : -Infinity
  const at = Date.parse(value + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== value) fail('INVALID', `${key} must be a calendar date.`)
  return at + (end ? dayMs - 1 : 0)
}
function timing(stage: string, values: number[]) {
  values.sort((a,b)=>a-b)
  const n=values.length
  return {stage,count:n,medianMs:n?(values[Math.floor((n-1)/2)]+values[Math.ceil((n-1)/2)])/2:null,p90Ms:n?values[Math.ceil(n*.9)-1]:null}
}
function visits(agreements:Row[], history:Row[], names:string[], field:string, inside:(at:number)=>boolean) {
  const samples=new Map(names.map(s=>[s,[] as number[]])), current=new Set<string>()
  for(const a of agreements){
    let previous:Row|undefined
    for(const event of history.filter(e=>e.agreement_id===a.id)){
      if(previous && previous['to_'+field]===event['from_'+field] && event.at>=previous.at && inside(event.at))samples.get(previous['to_'+field])?.push(event.at-previous.at)
      previous=event
    }
    if(previous)current.add(a.id)
  }
  return {timings:names.map(s=>timing(s,samples.get(s)!)),current}
}

export function workflowAnalytics(state: Workspace, params = new URLSearchParams()) {
  const start = bound(params, 'from', false), end = bound(params, 'to', true)
  if (start > end) fail('INVALID', 'The period ends before it starts.')
  const inside = (at: number) => at >= start && at <= end && at <= state.now
  const work = new Map(state.requestQueue.work.map(w=>[w.agreement_id,w]))
  const agreements = state.agreements.filter(a => a.origin === 'intake' && (!params.get('type') || a.type === params.get('type')) && (!params.get('entity') || a.entity_id === params.get('entity')) && (!params.get('team') || work.get(a.id)?.team_id===params.get('team')))
  const ids = new Set(agreements.map(a => a.id))
  const scoped = (rows:Row[])=>rows.filter(e=>ids.has(e.agreement_id)&&e.at<=state.now)
  const history = scoped(state.workflowHistory)
  const completed = new Map<string, number>()
  for(const e of history)if(e.to_status==='executed'&&!completed.has(e.agreement_id))completed.set(e.agreement_id,e.at)
  const observed=visits(agreements,history,statuses,'status',inside)
  const measured=visits(agreements,scoped(state.workflowStages),stages,'stage',inside)
  type Group={type:string;entityId:string|null;teamId:string|null;opened:number;completed:number;openedIds:string[];completedIds:string[]}
  const groups=new Map<string,Group>()
  for(const a of agreements){
    const teamId=work.get(a.id)?.team_id??null,key=JSON.stringify([a.type,a.entity_id??null,teamId])
    const group:Group=groups.get(key)??{type:a.type,entityId:a.entity_id??null,teamId,opened:0,completed:0,openedIds:[],completedIds:[]}
    if(inside(a.created_at)){group.opened++;group.openedIds.push(a.id)}
    if(completed.has(a.id)&&inside(completed.get(a.id)!)){group.completed++;group.completedIds.push(a.id)}
    if(group.opened||group.completed)groups.set(key,group)
  }
  const approvalWaits = state.approvalReminders.pending.filter(p => ids.has(p.agreementId) && inside(p.requestedAt)).map(p => ({ ...p, elapsedMs: Math.max(0, state.now - p.requestedAt),slaBreached:p.escalateAt!==undefined&&state.now>=p.escalateAt })).sort((a, b) => b.elapsedMs - a.elapsedMs || a.approverId.localeCompare(b.approverId) || a.agreementId.localeCompare(b.agreementId))
  const approvers=[...new Set(approvalWaits.map(p=>p.approverId))].map(approverId=>{
    const waits=approvalWaits.filter(p=>p.approverId===approverId)
    return {approverId,pending:waits.length,longestWaitMs:waits[0].elapsedMs,slaBreaches:waits.filter(p=>p.slaBreached).length,agreementIds:[...new Set(waits.map(p=>p.agreementId))]}
  }).sort((a,b)=>b.longestWaitMs-a.longestWaitMs||a.approverId.localeCompare(b.approverId))
  const signatureWaits = agreements.filter(a => a.status === 'out_for_signature').flatMap(a => {
    const pkg = state.packages.filter(p => p.agreement_id === a.id && p.status === 'sent').sort((x, y) => y.sent_at - x.sent_at)[0]
    return pkg && inside(pkg.sent_at) ? [{ agreementId: a.id, partyId: a.party_id, since: pkg.sent_at, elapsedMs: Math.max(0, state.now - pkg.sent_at) }] : []
  }).sort((a, b) => b.elapsedMs - a.elapsedMs || a.agreementId.localeCompare(b.agreementId))
  // Each opening/reopening is a durable interval. A late close remains a breach;
  // canceled work stops its clock. No scheduler run is needed to see a breach.
  const serviceLevels=state.workflowServiceLevels.filter(s=>ids.has(s.agreement_id)&&s.started_at<=state.now&&inside(s.closed_at??state.now)).map(s=>({agreementId:s.agreement_id,generation:s.generation,teamId:s.team_id,startedAt:s.started_at,dueAt:s.due_at,closedAt:s.closed_at,outcome:s.outcome,breached:(s.closed_at??state.now)>=s.due_at,elapsedMs:Math.max(0,(s.closed_at??state.now)-s.started_at)}))
  const canceled=state.requestQueue.cancellations.filter(c=>ids.has(c.agreement_id)&&inside(c.canceled_at)).map(c=>({agreementId:c.agreement_id,reason:c.reason,stage:c.stage,canceledAt:c.canceled_at,reopenedAt:c.reopened_at}))
  const cancellationGroups=[...new Set(canceled.map(c=>JSON.stringify([c.reason,c.stage])))].map(key=>{
    const [reason,stage]=JSON.parse(key),rows=canceled.filter(c=>c.reason===reason&&c.stage===stage)
    return {reason,stage,count:rows.length,agreementIds:[...new Set(rows.map(c=>c.agreementId))]}
  }).sort((a,b)=>a.reason.localeCompare(b.reason)||a.stage.localeCompare(b.stage))
  return {
    canceled,cancellationGroups,evaluatedAt:state.now,
    groups:[...groups.values()].sort((a,b)=>a.type.localeCompare(b.type)||(a.entityId??'').localeCompare(b.entityId??'')||(a.teamId??'').localeCompare(b.teamId??'')),
    stages:measured.timings,observedStatuses:observed.timings,approvalWaits,approvers,signatureWaits,
    serviceLevels:{count:serviceLevels.length,breaches:serviceLevels.filter(s=>s.breached).length,met:serviceLevels.filter(s=>s.closedAt!==null&&!s.breached).length,open:serviceLevels.filter(s=>s.closedAt===null).length,intervals:serviceLevels},
    unknownStageStarts:agreements.filter(a=>statuses.includes(a.status)&&!measured.current.has(a.id)).length,
    unknownServiceLevels:agreements.filter(a=>!state.workflowServiceLevels.some(s=>s.agreement_id===a.id)).length,
  }
}
