// A repository answer is an immutable proposal scoped to one human and all of
// its input sources. Provider text cannot select authority or confirm a term.
import type { Bindings } from '../auth.server'
import { agreementAccessSql, canSee, grantsFor, requireRole, visibleSetSql } from './access'
import { auditInsert } from './audit'
import { integrationCommandChecks } from './scoped-tokens'
import { auditSql, commit, type Ctx, type Handler } from './commands'
import { bool, canonical, fail, json, list, object, parse, sha256, sql, text, integer, type Actor } from './model'
import { evaluation, modelPrompts, modelSettings, requestModel, settingsGuard, taskGate } from './model-settings'
import { fullFieldsCheck, hiddenFields, policyVersionCheck, repositoryPolicy, requireFullFields } from './repository-access'

const people = ['owner','counsel','approver','requester','viewer'] as const
interface QuestionTerm {id:string;key:string;value:string;status:string;quote:string}
interface Source {id:string;revision:number;title:string;reference:string;type:string;status:string;counterparty:string;versionId:string;versionNumber:number;digest:string;text:string;documents:string[];terms:QuestionTerm[]}
interface QuestionRow {id:string;requested_by:string;question:string;sources:string;input_digests:string;provider:string;model:string;prompt_version:string;settings_version:number;simulated:number;status:string;content:string|null;input_tokens:number|null;output_tokens:number|null;estimated_usd_micros:number|null;accepted_by:string|null;accepted_at:number|null;created_at:number}

async function sources(c: Ctx, disabledTypes: string[]) {
 const access = agreementAccessSql(c.actor.id)
 const rows = (await c.db.prepare(`SELECT a.id,a.version AS revision,a.title,a.reference,a.type,a.status,p.name AS counterparty,
  v.id AS versionId,v.number AS versionNumber,v.digest,v.text
  FROM lk_agreements a JOIN lk_versions v ON v.id=a.current_version_id JOIN lk_parties p ON p.id=a.party_id
  WHERE (${access.sql}) AND length(v.text)>0 AND a.type NOT IN (SELECT value FROM json_each(?)) ORDER BY a.id`)
  .bind(...access.params,json(disabledTypes)).all<Omit<Source,'documents'|'terms'>>()).results
 const result:Source[] = []
 for (const row of rows) {
  const terms = (await c.db.prepare("SELECT id,key,value,status,citation FROM lk_terms WHERE agreement_id=? AND status IN ('confirmed','proposed') ORDER BY id").bind(row.id).all<any>()).results
  const documents = (await c.db.prepare('SELECT sha256 FROM lk_artifacts WHERE version_id=? ORDER BY id').bind(row.versionId).all<{sha256:string}>()).results.map(r=>r.sha256)
  result.push({...row,documents,terms:terms.flatMap(t=>{
   const citation=parse<any>(t.citation)
   return citation.versionId===row.versionId && row.text.includes(citation.quote) ? [{id:t.id,key:t.key,value:t.value,status:t.status,quote:citation.quote}] : []
  })})
 }
 return result
}
type Sources = Awaited<ReturnType<typeof sources>>
// One compact JSON-bound guard checks the complete accessible source set, both
// additions and removals, and all agreement revisions inside the write batch.
function sourceCheck(c: Ctx, snapshot: Sources, disabledTypes: string[]) {
 const access=agreementAccessSql(c.actor.id)
 return sql(`(SELECT COUNT(*) FROM lk_agreements a JOIN lk_versions v ON v.id=a.current_version_id
  WHERE (${access.sql}) AND length(v.text)>0 AND a.type NOT IN (SELECT value FROM json_each(?)))=json_array_length(?)
  AND NOT EXISTS(SELECT 1 FROM json_each(?) saved LEFT JOIN lk_agreements a ON a.id=json_extract(saved.value,'$.id')
  LEFT JOIN lk_parties p ON p.id=a.party_id LEFT JOIN lk_versions v ON v.id=a.current_version_id WHERE a.id IS NULL OR a.version<>json_extract(saved.value,'$.revision')
  OR a.current_version_id<>json_extract(saved.value,'$.versionId') OR p.name<>json_extract(saved.value,'$.counterparty')
  OR v.digest<>json_extract(saved.value,'$.digest') OR v.text<>json_extract(saved.value,'$.text'))`,
  ...access.params,json(disabledTypes),json(snapshot),json(snapshot))
}
async function guards(c: Ctx, snapshot: Sources, settingsVersion: number, disabledTypes: string[], command='question.ask') {
 const policy=await repositoryPolicy(c.db)
 return [...await integrationCommandChecks(c,command),fullFieldsCheck(c.actor),policyVersionCheck(policy.version),settingsGuard(settingsVersion),visibleSetSql(c.actor,snapshot.map(s=>s.id)),sourceCheck(c,snapshot,disabledTypes)]
}
const ask: Handler = async (c,p) => {
 requireRole(c.actor,people,'ask the repository')
 const s=await modelSettings(c.db),simulated=bool(p,'simulated'),question=text(p,'question',2000)
 await taskGate(c,s,'questions','',simulated)
 if(!bool(p,'consent'))fail('CONSENT','Approve sending this question and your accessible, AI-enabled source documents for this request.',409)
 const snapshot=await sources(c,s.disabledTypes)
 if(!snapshot.length)fail('NO_SOURCES','No readable, AI-enabled agreements are available to you.',409)
 // Refuse an oversized repository explicitly; never silently answer a subset.
 if(snapshot.length>200 || new TextEncoder().encode(json(snapshot)).length>1500000)fail('QUESTION_LIMIT','This repository exceeds the current question context limit (200 agreements / 1.5 MB of source context). No request was made.',409)
 const id=crypto.randomUUID(),prompt=await sha256(modelPrompts.questions)
 const digests={sources:await sha256(canonical(snapshot)),question:await sha256(question),asOf:new Date(c.now).toISOString().slice(0,10),documents:snapshot.map(r=>({agreementId:r.id,versionId:r.versionId,digest:r.digest,documents:r.documents})),playbookVersions:[]}
 return {allowed:people,result:{id},checks:await guards(c,snapshot,s.version,s.disabledTypes),writes:[sql("INSERT INTO lk_repository_questions(id,requested_by,question,sources,input_digests,provider,model,prompt_version,settings_version,simulated,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'queued',?)",id,c.actor.id,question,json(snapshot),json(digests),s.provider,s.model,prompt,s.version,Number(simulated),c.now)],audit:[{action:'question.request',summary:'Person explicitly approved one repository question over their current accessible, AI-enabled sources.'}]}
}
function matches(raw: unknown, snapshot: Sources) {
 const rows=list(object(raw),'matches',200),seen=new Set<string>()
 return rows.map(value=>{
  const m=object(value),id=text(m,'agreementId',100),source=snapshot.find(s=>s.id===id)
  if(!source || seen.has(id))fail('MODEL_RESPONSE','An answer named an unavailable or duplicate source.',502)
  seen.add(id)
  const citations=list(m,'citations',20).map(value=>{
   const cite=object(value),quote=text(cite,'quote',20000),start=source.text.indexOf(quote)
   if(start<0)fail('CITATION','The answer quote is absent from its exact source version.',502)
   const term=cite.termId===undefined?null:source.terms.find(t=>t.id===cite.termId&&t.quote===quote)
   if(cite.termId!==undefined&&!term)fail('CITATION','The answer term does not match its cited record.',502)
   return {versionId:source.versionId,versionNumber:source.versionNumber,quote,start,end:start+quote.length,termId:term?.id??null,key:term?.key??null,value:term?.value??null,status:term?.status??'proposed'}
  })
  if(!citations.length)fail('CITATION','Every answer match needs a source passage.',502)
  return {agreementId:id,title:source.title,reference:source.reference,value:text(m,'value',4000),status:'proposed',reliesOnProposed:citations.some(c=>c.status!=='confirmed'),citations}
 })
}
async function ownRow(c: Ctx,id: string) {
 requireRole(c.actor,people,'read repository answers')
 await requireFullFields(c.db,c.actor)
 const row=await c.db.prepare('SELECT * FROM lk_repository_questions WHERE id=? AND requested_by=?').bind(id,c.actor.id).first<QuestionRow>()
 if(!row)fail('NOT_FOUND','No repository answer you can access has that identity.',404)
 const snapshot=parse<Sources>(row.sources),grants=await grantsFor(c.env,c.actor)
 const available=(await c.db.prepare('SELECT * FROM lk_agreements').all<any>()).results
 if(!snapshot.length || snapshot.some(s=>!available.some(a=>a.id===s.id&&canSee(c.actor,a,grants))))fail('NOT_FOUND','This answer includes sources you can no longer access. Ask a new question.',404)
 return row
}
export async function completeQuestionCommand(c: Ctx,type: string,result: any) {
 if(!type.startsWith('question.'))return result
 let row=await ownRow(c,result.id)
 if(type!=='question.ask'||row.status!=='queued')return {id:row.id,status:row.status}
 const s=await modelSettings(c.db),snapshot=parse<Sources>(row.sources)
 await taskGate(c,s,'questions','',row.simulated===1)
 const digest=parse<any>(row.input_digests).sources
 if(s.version!==row.settings_version || digest!==await sha256(canonical(await sources(c,s.disabledTypes))))fail('STALE','Question sources or settings changed before dispatch. Ask a new question.',409)
 const checks=[...await guards(c,snapshot,s.version,s.disabledTypes),sql('EXISTS(SELECT 1 FROM lk_repository_questions WHERE id=? AND sources=? AND question=?)',row.id,row.sources,row.question)]
 try {
  await commit(c,people,[...checks,sql("EXISTS(SELECT 1 FROM lk_repository_questions WHERE id=? AND status='queued')",row.id)],[sql("UPDATE lk_repository_questions SET status='uncertain' WHERE id=?",row.id),sql('INSERT INTO lk_model_usage VALUES(?,?,?,?,NULL,NULL,NULL,?)',row.id,s.provider,s.model,row.simulated,row.created_at)])
 } catch(error) {
  row=await ownRow(c,row.id)
  if(row.status!=='queued')return {id:row.id,status:row.status}
  throw error
 }
 try {
  const response=await requestModel(c.env,s,modelPrompts.questions,{question:row.question,asOf:parse<any>(row.input_digests).asOf,sources:snapshot})
  if(!response.ok)throw Error('provider refused')
  const envelope:any=await response.json(),body=envelope.result??envelope
  // Re-evaluate complete context before retaining even usage after egress.
  if(digest!==await sha256(canonical(await sources(c,s.disabledTypes))))throw Error('source changed')
  const input=integer({n:body.usage?.prompt_tokens??body.usage?.input_tokens},'n',0,10000000),output=integer({n:body.usage?.completion_tokens??body.usage?.output_tokens},'n',0,10000000),micros=Math.round(input*s.inputUsdPerMillion+output*s.outputUsdPerMillion)
  await commit(c,people,checks,['lk_repository_questions','lk_model_usage'].map(table=>sql(`UPDATE ${table} SET input_tokens=?,output_tokens=?,estimated_usd_micros=? WHERE id=?`,input,output,micros,row.id)))
  const raw=body.choices?.[0]?.message?.content??body.content?.[0]?.text??body.response
  const content=matches(typeof raw==='string'?JSON.parse(raw):raw,snapshot)
  await commit(c,people,checks,[sql("UPDATE lk_repository_questions SET content=?,status='proposed' WHERE id=?",json({matches:content}),row.id),auditSql(c,{action:'question.output',summary:'Retained a cited repository answer proposal; no terms, deadlines or agreements changed.'})])
 } catch {
  // A claimed provider request is never automatically resent. Invalid, stale or
  // interrupted replies retain an honest unknown outcome without answer text.
 }
 // Never return content or identifiers from a source whose access ended midflight.
 row=await ownRow(c,row.id)
 return {id:row.id,status:row.status}
}
async function guardRead(c: Ctx,row: QuestionRow,audit=false) {
 const snapshot=parse<Sources>(row.sources),policy=await repositoryPolicy(c.db)
 await commit(c,people,[fullFieldsCheck(c.actor),policyVersionCheck(policy.version),visibleSetSql(c.actor,snapshot.map(s=>s.id)),sql('EXISTS(SELECT 1 FROM lk_repository_questions WHERE id=? AND requested_by=? AND sources=? AND question=? AND content IS ?)',row.id,c.actor.id,row.sources,row.question,row.content)],audit?[auditInsert(c,snapshot.map(source=>({action:'question.read',agreementId:source.id,summary:'Read an own cited repository answer.'})))]:[])
}
export async function readRepositoryQuestion(env: Bindings,actor: Actor,id: string) {
 const c:Ctx={env,db:env.DB,actor,now:Date.now(),commandId:crypto.randomUUID()},row=await ownRow(c,id),s=await modelSettings(env.DB)
 const stale=parse<any>(row.input_digests).sources!==await sha256(canonical(await sources(c,s.disabledTypes)))
 await guardRead(c,row,true)
 const {sources:_,...record}=row
 return {...record,stale,content:row.content?parse<{matches:ReturnType<typeof matches>}>(row.content):null,playbookVersion:null}
}
const accept: Handler=async(c,p)=>{
 const row=await ownRow(c,text(p,'id',100)),s=await modelSettings(c.db),snapshot=parse<Sources>(row.sources)
 if(row.status!=='proposed'||parse<any>(row.input_digests).sources!==await sha256(canonical(await sources(c,s.disabledTypes))))fail('STALE','Only a current, unaccepted answer can be accepted.',409)
 return {allowed:people,result:{id:row.id},checks:[...await guards(c,snapshot,s.version,s.disabledTypes,'question.accept'),sql("EXISTS(SELECT 1 FROM lk_repository_questions WHERE id=? AND status='proposed')",row.id)],writes:[sql("UPDATE lk_repository_questions SET status='accepted',accepted_by=?,accepted_at=? WHERE id=?",c.actor.id,c.now,row.id)],audit:[{action:'question.accept',summary:'Person accepted an own repository answer record; cited values keep their existing confirmation status.'}]}
}
export async function questionWorkspace(env: Bindings,actor: Actor) {
 if(!people.includes(actor.role as any)||(await hiddenFields(env.DB,actor)).length)return {available:false,simulationAvailable:false,reason:'Document access is required to ask repository questions.',records:[] as any[]}
 const s=await modelSettings(env.DB),record=await evaluation(s,'questions'),available=s.enabled&&!!s.model&&(s.provider==='workers-ai'||s.noTrainingZeroRetention)&&record?.status==='passed'
 const c:Ctx={env,db:env.DB,actor,now:Date.now(),commandId:crypto.randomUUID()},rows=(await env.DB.prepare('SELECT id,question,status,created_at,simulated FROM lk_repository_questions WHERE requested_by=? ORDER BY created_at DESC,id').bind(actor.id).all<any>()).results,records=[]
 for(const r of rows){try{const row=await ownRow(c,r.id);await guardRead(c,row);records.push({id:row.id,question:row.question,status:row.status,created_at:row.created_at,simulated:row.simulated})}catch{ /* Withdraw the complete record after loss of any input source. */ }}
 return {available,simulationAvailable:s.enabled&&!!s.model&&(s.provider==='workers-ai'||s.noTrainingZeroRetention)&&env.LOCKET_MODEL_SIMULATION==='true',reason:!s.enabled?'AI is switched off for this installation.':!s.model?'The owner must choose a model in Settings.':s.provider!=='workers-ai'&&!s.noTrainingZeroRetention?'The owner must confirm the provider data policy in Settings.':available?'':'Questions are not evaluated: a passing REVIEW-006 live record is required.',records}
}
export const questionHandlers:Record<string,Handler>={'question.ask':ask,'question.accept':accept}
