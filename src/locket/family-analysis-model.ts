import { familyAnalysisPrompt } from './family-analysis-prompt'
import { familyEvaluationApproved } from './family-evaluations'
import { aiConfig, createAiClient, AiError } from '../modules/ai/index.mjs'
import type { Ctx } from './commands'
import { fail, integer, list, object, oneOf, text } from './model'
import type { FamilySource } from './family-analysis-facts'

export const analysisKeys=['effective_date','end_date','notice_days','auto_renew','renewal_term_months','payment_terms','governing_law','price','notice_rights','precedence'] as const
export type AnalysisKey=typeof analysisKeys[number]
export interface AnalysisCandidate { agreementId:string; versionId:string; value:string; quote:string; page:number|null }
export interface AnalysisConflict { key:AnalysisKey; summary:string; recommended:number; reasoning:string; candidates:AnalysisCandidate[] }
const candidateSchema={type:'object',additionalProperties:false,required:['agreementId','value','quote','page'],properties:{agreementId:{type:'string'},value:{type:'string'},quote:{type:'string'},page:{type:['integer','null']}}}
const schema={type:'object',additionalProperties:false,required:['conflicts'],properties:{conflicts:{type:'array',items:{type:'object',additionalProperties:false,required:['key','summary','recommended','reasoning','candidates'],properties:{key:{type:'string',enum:analysisKeys},summary:{type:'string'},recommended:{type:'integer'},reasoning:{type:'string'},candidates:{type:'array',items:candidateSchema}}}}}}
export function validateAnalysis(raw:unknown,sources:FamilySource[]):AnalysisConflict[] {
 const conflicts=list(object(raw,'analysis'),'conflicts',30).map((value)=>{
  const row=object(value,'conflict'),key=oneOf(row,'key',analysisKeys)
  const candidates=list(row,'candidates',100).map(v=>{
   const candidate=object(v,'candidate'),agreementId=text(candidate,'agreementId',100),source=sources.find(s=>s.agreementId===agreementId)
   const quote=text(candidate,'quote',4000),value=text(candidate,'value',2000)
   const page=candidate.page===null?null:integer(candidate,'page',1,5000)
   if(!source||!source.pages.some(p=>(page===null||p.page===page)&&p.text.includes(quote)))fail('ANALYSIS_CITATION','The model returned a passage outside the approved source text. No result was saved.',502)
   if(['notice_days','renewal_term_months'].includes(key)&&(!/^\d+$/.test(value)||Number(value)>(key==='notice_days'?730:120)||(key==='renewal_term_months'&&Number(value)<1)))fail('ANALYSIS_VALUE','The model returned an unsupported normalized interval.',502)
   if(['effective_date','end_date'].includes(key)&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value))fail('ANALYSIS_VALUE','The model returned an invalid normalized date.',502)
   if(key==='auto_renew'&&!['yes','no'].includes(value))fail('ANALYSIS_VALUE','The model returned an invalid renewal flag.',502)
   return {agreementId,versionId:source.versionId,value,quote,page}
  })
  if(candidates.length<2||new Set(candidates.map(c=>c.value)).size<2)fail('ANALYSIS_VALUE','A conflict needs distinct supported candidate values.',502)
  return {key,summary:text(row,'summary',4000),reasoning:text(row,'reasoning',4000),recommended:integer(row,'recommended',0,candidates.length-1),candidates}
 })
 if(new Set(conflicts.map(c=>c.key)).size!==conflicts.length)fail('ANALYSIS_VALUE','Each term may have one conflict group.',502)
 // A provider cannot silently omit a conflict among the confirmed input values.
 const keys=new Set(sources.flatMap(s=>s.terms.map(t=>t.key)))
 for(const key of keys){
  const terms=sources.flatMap(s=>s.terms.filter(t=>t.key===key))
  if(analysisKeys.includes(key as AnalysisKey)&&new Set(terms.map(t=>t.value)).size>1){
   const conflict=conflicts.find(c=>c.key===key)
   if(!conflict||terms.some(t=>!conflict.candidates.some(c=>c.agreementId===t.agreementId&&c.value===t.value)))fail('ANALYSIS_VALUE','The model omitted a differing confirmed source value. Review the source terms before trying a new analysis.',502)
  }
 }
 return conflicts
}
export async function analyzeFamily(c:Ctx,sources:FamilySource[]) {
 if(c.env.AI_TRAINING_PROHIBITED!=='true')fail('PROVIDER_POLICY','The owner must configure a provider contract that prohibits training on these texts before any family model request.',409)
 if(!await familyEvaluationApproved(c.env))fail('EVALUATION_REQUIRED','REVIEW-006 requires a passing live evaluation for this exact provider, model and prompt. No model request was made.',409)
 const config=aiConfig(c.env as unknown as Record<string,unknown>)
 if(!config.enabled||!config.model)fail('MODEL_UNAVAILABLE','An enabled model connection with an exact model must be configured before analyzing a family.',409)
 let response:Response
 try {
  response=await createAiClient(config).chat({model:config.model,store:false,messages:[
   {role:'system',content:familyAnalysisPrompt},
   {role:'user',content:JSON.stringify({sources})},
  ],response_format:{type:'json_schema',json_schema:{name:'family_conflicts',strict:true,schema}},max_completion_tokens:12000},{feature:'family-analysis',signal:AbortSignal.timeout(90000)})
 }catch(error){if(error instanceof AiError)fail('MODEL_UNAVAILABLE',error.message,error.status);fail('MODEL_UNAVAILABLE','The configured model did not answer. Nothing was applied.',502)}
 if(!response.ok)fail('MODEL_UNAVAILABLE','The configured model refused this analysis. Nothing was applied.',502)
 const body:any=await response.json().catch(()=>null)
 const message=body?.choices?.[0]?.message
 if(message?.refusal||typeof message?.content!=='string'||message.content.length>200000)fail('ANALYSIS_RESPONSE','The model returned no supported structured analysis.',502)
 let raw:unknown
 try{raw=JSON.parse(message.content)}catch{fail('ANALYSIS_RESPONSE','The model returned invalid analysis JSON.',502)}
 return validateAnalysis(raw,sources)
}
