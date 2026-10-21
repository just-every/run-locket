import { agreementAccessSql } from './access'
// The same evaluator serves manager previews and real request launches.
import { roleSql } from './access'
import { fileInput, storeArtifact } from './artifacts'
import type { Ctx } from './commands'
import { evaluateForm, type FormDefinition } from './intake-form-definition'
import { launchPermission, permitted, validateFormReferences } from './intake-forms'
import { date, fail, json, money, object, parse, sql, text, type Sql } from './model'
import { defaultRequirements } from './us-defaults'

async function typedAnswers(c:Ctx,def:FormDefinition,input:unknown,value:string|null,preview:boolean) {
  const raw=object(input ?? {},'answers')
  const department=raw.department ? text(raw,'department',100) : ''
  const region=raw.region ? text(raw,'region',200) : ''
  const checks:Sql[]=[]
  if(department) {
    const check=sql(`EXISTS(SELECT 1 FROM lk_intake_audiences d WHERE d.id=? AND d.kind='department'${preview ? '' : ' AND EXISTS(SELECT 1 FROM lk_intake_members m WHERE m.audience_id=d.id AND m.operator_id=?)'})`,department,...(preview?[]:[c.actor.id]))
    if(!(await c.db.prepare(`SELECT ${check.sql} AS ok`).bind(...check.params).first<{ok:number}>())?.ok) fail('INVALID','Choose one of your current departments.')
    checks.push(check)
  }
  // Normalize sequentially, so hidden answers never influence later conditions.
  const normalized:Record<string,unknown>={department,region}
  for(const f of def.fields) {
    const visible=evaluateForm(def,normalized,value).fields.some(x=>x.key===f.key)
    if(!visible) continue
    const v=raw[f.key]
    if(v===undefined || v===null || v==='') {
      if(f.required && !preview) fail('FIELDS',`${f.label} is required.`,409)
      continue
    }
    if(f.kind==='file') {
      if(!preview) {fileInput(v);normalized[f.key]=v}
    } else if(f.kind==='money') {normalized[f.key]=(money({value:v},'value')! / 100).toFixed(2)}
    else if(f.kind==='number') {
      if(typeof v!=='string' || !/^-?\d+(\.\d+)?$/.test(v) || !Number.isFinite(Number(v))) fail('INVALID',`${f.label} must be a finite number.`)
      normalized[f.key]=String(Number(v))
    } else if(f.kind==='date') normalized[f.key]=date({value:v},'value')
    else {
      const s=text({value:v},'value',f.kind==='text'?4000:200)
      if(f.kind==='pick_list' && !f.options.includes(s)) fail('INVALID',`${f.label} must be a configured option.`)
      if(f.kind==='person' || f.kind==='counterparty') {
        const check=f.kind==='person' ? sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active')",s) : sql("EXISTS(SELECT 1 FROM lk_parties p WHERE p.id=? AND p.merged_into IS NULL AND (NOT EXISTS(SELECT 1 FROM lk_agreements a WHERE a.party_id=p.id) OR EXISTS(SELECT 1 FROM lk_agreements a WHERE a.party_id=p.id AND ("+agreementAccessSql(c.actor.id).sql+"))))",s,...agreementAccessSql(c.actor.id).params)
        if(!(await c.db.prepare(`SELECT ${check.sql} AS ok`).bind(...check.params).first<{ok:number}>())?.ok) fail('INVALID',`${f.label} must name a current accessible record.`)
        checks.push(check)
      }
      normalized[f.key]=s
    }
  }
  return {out:evaluateForm(def,normalized,value),checks}
}
export async function previewForm(c:Ctx,def:FormDefinition,input:unknown) {
  const raw=object(input ?? {},'answers'), cents=money(raw,'value')
  const {out}=await typedAnswers(c,def,raw,cents===null?null:(cents/100).toFixed(2),true)
  return {...out,requirements:[...new Set([...defaultRequirements[def.type],...out.requirements,...out.fields.filter(f=>f.kind==='file'&&f.required).map(f=>f.label)])]}
}
export async function launchForm(c:Ctx,p:Record<string,unknown>,type:string,valueCents:number|null) {
  const formVersionId=p.formVersionId
  if(!formVersionId) {
    const exists=await c.db.prepare('SELECT 1 FROM lk_intake_forms f JOIN lk_intake_form_versions v ON v.id=f.published_version_id WHERE json_extract(v.definition,\'$.type\')=? LIMIT 1').bind(type).first()
    if(exists) fail('FORM_REQUIRED','Choose a published request form for this agreement type.',403)
    return null
  }
  const v=await c.db.prepare('SELECT v.* FROM lk_intake_form_versions v JOIN lk_intake_forms f ON f.published_version_id=v.id WHERE v.id=?').bind(text(p,'formVersionId',100)).first<any>()
  if(!v) fail('NOT_FOUND','No launchable form has that version.',404)
  const def=parse<FormDefinition>(v.definition)
  if(!await permitted(c.db,c.actor,def)) fail('FORBIDDEN','You cannot launch this request form.',403)
  if(type!==def.type) fail('INVALID','The request type must match its published form.')
  const checked=await typedAnswers(c,def,p.formAnswers,valueCents===null?null:(valueCents/100).toFixed(2),false)
  const checks=[launchPermission(c.actor,def),sql('(SELECT published_version_id FROM lk_intake_forms WHERE id=?)=?',v.form_id,v.id),...checked.checks,...await validateFormReferences(c,def)]
  return {...checked.out,checks,versionId:v.id,number:v.number,name:def.name}
}
export async function formSnapshotWrites(c:Ctx,agreementId:string,form:NonNullable<Awaited<ReturnType<typeof launchForm>>>) {
  const writes:Sql[]=[],answers={...form.answers}
  for(const f of form.fields.filter(f=>f.kind==='file')) if(answers[f.key]) {
    const stored=await storeArtifact(fileInput(answers[f.key]),{agreementId,role:'attachment',provenance:{formVersionId:form.versionId,question:f.key},actorId:c.actor.id,at:c.now})
    writes.push(...stored.writes,sql('INSERT INTO lk_requirements VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),agreementId,f.label,stored.id,null,null,c.now))
    answers[f.key]={artifactId:stored.id,filename:fileInput(answers[f.key]).filename,sha256:stored.sha256}
  }
  writes.push(sql('INSERT INTO lk_request_forms VALUES(?,?,?,?,?,?,?)',agreementId,form.versionId,json(answers),json(form.route),form.matchedRule,form.route.reviewerId,form.route.approvalRole))
  return writes
}
