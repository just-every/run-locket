import { may, requireRole, roleSql } from './access'
import type { Ctx, Handler } from './commands'
import { formDefinition, type FormDefinition } from './intake-form-definition'
import { previewForm } from './intake-form-launch'
import { fail, integer, json, parse, sql, text, type Actor, type Sql } from './model'

export interface IntakeFormRow { id:string;name:string;type:string;definition:string;version:number;published_version_id:string|null }
export const launchPermission = (actor: Pick<Actor,'id'>, def: FormDefinition): Sql => sql(`(${roleSql} IN (SELECT value FROM json_each(?)) OR EXISTS(SELECT 1 FROM lk_intake_members m JOIN oa_operators o ON o.id=m.operator_id WHERE m.operator_id=? AND o.status='active' AND m.audience_id IN (SELECT value FROM json_each(?))))`,actor.id,json(def.launch.roles),actor.id,json(def.launch.audienceIds))
export async function permitted(db:D1Database,actor:Actor,def:FormDefinition) {
  if (!may.intake.includes(actor.role)) return false
  const s=launchPermission(actor,def)
  return !!(await db.prepare(`SELECT CASE WHEN ${s.sql} THEN 1 ELSE 0 END AS ok`).bind(...s.params).first<{ok:number}>())?.ok
}
export async function intakeForms(db:D1Database,actor:Actor) {
  const rows=(await db.prepare('SELECT * FROM lk_intake_forms ORDER BY name').all<IntakeFormRow>()).results
  const out=[]
  for(const f of rows) {
    const v=f.published_version_id ? await db.prepare('SELECT * FROM lk_intake_form_versions WHERE id=?').bind(f.published_version_id).first<any>() : null
    const manager=['owner','counsel'].includes(actor.role), definition=parse<FormDefinition>(f.definition)
    const published=v ? {...v,definition:parse<FormDefinition>(v.definition)} : null
    const canLaunch=published ? await permitted(db,actor,published.definition) : false
    if(manager || canLaunch) out.push({...f,definition:manager ? definition : published!.definition,published,canLaunch,...(!manager ? {name:published!.definition.name,type:published!.definition.type} : {})})
  }
  return out
}
export async function validateFormReferences(c:Ctx,def:FormDefinition):Promise<Sql[]> {
  const checks:Sql[]=[]
  for(const r of [def.defaultRoute,...def.rules.map(r=>r.route)]) for(const id of [r.ownerId,r.reviewerId]) {
    const check=sql(`EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND ${roleSql} IN ('owner','counsel','approver','requester'))`,id,id)
    if(!(await c.db.prepare(`SELECT ${check.sql} AS ok`).bind(...check.params).first<{ok:number}>())?.ok) fail('INVALID','Routing people must be active human members who can handle requests.')
    checks.push(check)
  }
  for(const id of def.launch.audienceIds) {
    if(!await c.db.prepare('SELECT id FROM lk_intake_audiences WHERE id=?').bind(id).first()) fail('INVALID','Choose an existing group or department.')
    checks.push(sql('EXISTS(SELECT 1 FROM lk_intake_audiences WHERE id=?)',id))
  }
  for(const cond of [...def.fields.flatMap(f=>f.when ?? []),...def.rules.flatMap(r=>r.when)]) if(cond.field==='department') {
    if(!await c.db.prepare("SELECT id FROM lk_intake_audiences WHERE id=? AND kind='department'").bind(cond.value).first()) fail('INVALID','Department conditions must name an existing department.')
  }
  return checks
}
async function draft(c:Ctx,p:Record<string,unknown>) {
  const row=await c.db.prepare('SELECT * FROM lk_intake_forms WHERE id=?').bind(text(p,'id',100)).first<IntakeFormRow>()
  if(!row) fail('NOT_FOUND','That form does not exist.',404)
  if(integer(p,'version',1)!==row.version) fail('STALE','The form changed. Reload before saving or publishing.',409)
  return row
}
const save:Handler=async(c,p)=>{
  requireRole(c.actor,may.library,'design request forms')
  const def=formDefinition(p.definition), checks=await validateFormReferences(c,def)
  const prior=p.id ? await draft(c,p) : null, id=prior?.id ?? crypto.randomUUID(), version=(prior?.version ?? 0)+1
  if(prior) checks.push(sql('(SELECT version FROM lk_intake_forms WHERE id=?)=?',id,prior.version))
  return {allowed:may.library,result:{id,version},checks,writes:[prior ? sql('UPDATE lk_intake_forms SET name=?,type=?,definition=?,version=?,updated_at=? WHERE id=?',def.name,def.type,json(def),version,c.now,id) : sql('INSERT INTO lk_intake_forms VALUES(?,?,?,?,?,NULL,?,?)',id,def.name,def.type,json(def),version,c.actor.id,c.now)],audit:[{action:'form.save',summary:`Saved a request form draft, revision ${version}`} ]}
}
const publish:Handler=async(c,p)=>{
  requireRole(c.actor,may.library,'publish request forms')
  const f=await draft(c,p),def=formDefinition(parse(f.definition)),checks=await validateFormReferences(c,def)
  const number=((await c.db.prepare('SELECT MAX(number) AS n FROM lk_intake_form_versions WHERE form_id=?').bind(f.id).first<{n:number|null}>())?.n ?? 0)+1
  const id=crypto.randomUUID()
  return {allowed:may.library,result:{id:f.id,version:f.version+1,versionId:id,number},checks:[...checks,sql('(SELECT version FROM lk_intake_forms WHERE id=?)=?',f.id,f.version)],writes:[sql('INSERT INTO lk_intake_form_versions VALUES(?,?,?,?,?,?)',id,f.id,number,json(def),c.actor.id,c.now),sql('UPDATE lk_intake_forms SET published_version_id=?,version=version+1,updated_at=? WHERE id=?',id,c.now,f.id)],audit:[{action:'form.publish',summary:`Published a request form v${number}; existing requests retain their route`} ]}
}
const preview:Handler=async(c,p)=>{
  requireRole(c.actor,may.library,'preview request forms')
  const f=await draft(c,p),def=formDefinition(parse(f.definition)),out=await previewForm(c,def,p.answers)
  return {allowed:may.library,result:out,writes:[],checks:[sql('(SELECT version FROM lk_intake_forms WHERE id=?)=?',f.id,f.version)],audit:[{action:'form.preview',summary:`Previewed a request form draft revision ${f.version}`} ]}
}
export const intakeFormHandlers:Record<string,Handler>={'form.save':save,'form.publish':publish,'form.preview':preview}
