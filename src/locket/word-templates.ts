import { pricingDefinition, pricingInventory, renderPricing, validatePricing } from './word-pricing'
import { may, requireRole } from './access'
import { DOCX, fileInput, isDocx, readArtifactBytes, storeArtifact } from './artifacts'
import type { Ctx, Handler } from './commands'
import { agreementTypes } from './agreements'
import { requireEntitiesExist } from './entities'
import { fail, integer, json, list, object, oneOf, optionalText, sql, text } from './model'
import { readWord, renderWord, validateMarks, wordModel, type WordMark } from './word-template-document'

const upload:Handler=async(c,p)=>{
 requireRole(c.actor,may.library,'author Word templates')
 const file=fileInput(p.file)
 if(!isDocx(file))fail('FILE_TYPE','Upload a DOCX Word template.',415)
 const parts=await readWord(file.bytes),model=wordModel(parts),inventory=pricingInventory(parts),templateId=typeof p.templateId==='string'?p.templateId:crypto.randomUUID()
 const prior=p.templateId?await c.db.prepare('SELECT * FROM lk_templates WHERE id=?').bind(templateId).first<any>():null
 if(p.templateId&&!prior)fail('NOT_FOUND','No such template.',404)
 const entityId=prior?.entity_id??optionalText(p,'entityId',100)
 await requireEntitiesExist(c,[entityId])
 const name=prior?.name??text(p,'name',120),type=prior?.type??oneOf(p,'type',agreementTypes)
 const last=await c.db.prepare('SELECT COALESCE(MAX(number),0) AS n FROM lk_template_versions WHERE template_id=?').bind(templateId).first<{n:number}>(),number=(last?.n??0)+1,id=crypto.randomUUID()
 const artifact=await storeArtifact({...file,mediaType:DOCX},{agreementId:null,role:'original',actorId:c.actor.id,at:c.now,provenance:{kind:'word_template_source',templateVersionId:id}})
 return {allowed:may.library,result:{id:templateId,versionId:id,revision:1},checks:[sql('(SELECT COALESCE(MAX(number),0) FROM lk_template_versions WHERE template_id=?)=?',templateId,number-1)],writes:[...(prior?[]:[sql('INSERT INTO lk_templates VALUES(?,?,?,?,?,?)',templateId,name,type,c.actor.id,c.now,entityId)]),...artifact.writes,sql('INSERT INTO lk_template_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,templateId,number,model.text,'[]','[]','draft',c.actor.id,c.now,null,null),sql('INSERT INTO lk_word_templates(id,source_artifact_id,source_text,marks,revision,preview_revision,preview_artifact_id,table_inventory,pricing) VALUES(?,?,?,?,1,NULL,NULL,?,NULL)',id,artifact.id,model.text,'[]',json(inventory))],audit:[{action:'template.word.upload',summary:`Uploaded original Word template ${name} v${number}; source bytes retained.`}]}
}
async function draft(c:Ctx,p:Record<string,unknown>){
 const id=text(p,'versionId',100),row=await c.db.prepare('SELECT w.*,v.status FROM lk_word_templates w JOIN lk_template_versions v ON v.id=w.id WHERE w.id=?').bind(id).first<any>()
 if(!row)fail('NOT_FOUND','No such Word template version.',404)
 if(row.status!=='draft')fail('STATUS','Approved and retired Word templates are immutable. Upload a new version.',409)
 if(integer(p,'revision',1)!==row.revision)fail('STALE','Template markings changed. Reload and review the source.',409)
 return row
}
const mark:Handler=async(c,p)=>{
 requireRole(c.actor,may.library,'mark Word template fields')
 const row=await draft(c,p),parts=await readWord(await readArtifactBytes(c.db,row.source_artifact_id)),model=wordModel(parts)
 const marks=list(p,'marks',120).map(value=>{const m=object(value);return {name:text(m,'name',40),label:text(m,'label',120),kind:oneOf(m,'kind',['field','optional'] as const),start:integer(m,'start',0),end:integer(m,'end',1),quote:typeof m.quote==='string'&&m.quote.length>0&&m.quote.length<=20000?m.quote:fail('CITATION','Select source text.'),required:m.required!==false}})
 validateMarks(model,marks)
 if(row.pricing)validatePricing(parts,JSON.parse(row.pricing),marks)
 const fields=marks.filter(m=>m.kind==='field').map(m=>({name:m.name,label:m.label,required:m.required})),clauses=marks.filter(m=>m.kind==='optional').map(m=>({key:m.name,title:m.label,variants:[{id:'include',label:'Include',text:m.quote},{id:'omit',label:'Omit',text:''}]}))
 // Body is a readable source rendition; Word population always uses exact marks.
 return {allowed:may.library,result:{versionId:row.id,revision:row.revision+1},checks:[sql("EXISTS(SELECT 1 FROM lk_word_templates w JOIN lk_template_versions v ON v.id=w.id WHERE w.id=? AND w.revision=? AND v.status='draft')",row.id,row.revision)],writes:[sql('UPDATE lk_word_templates SET marks=?,revision=revision+1,preview_revision=NULL,preview_artifact_id=NULL WHERE id=?',json(marks),row.id),sql('UPDATE lk_template_versions SET fields=?,clauses=? WHERE id=?',json(fields),json(clauses),row.id)],audit:[{action:'template.word.mark',summary:`Marked ${fields.length} fields and ${clauses.length} optional clauses on a Word template source.`}]}
}
const preview:Handler=async(c,p)=>{
 requireRole(c.actor,may.library,'preview a Word template')
 const row=await draft(c,p),marks=JSON.parse(row.marks) as WordMark[]
 if(!marks.some(m=>m.kind==='field'))fail('FIELDS','Mark at least one field before previewing and approving the template.',409)
 const out=await filledWord(c,row,object(p.fields??{}),object(p.clauseChoices??{}),p.lineItems)
 const artifact=await storeArtifact({filename:'template-preview.docx',mediaType:DOCX,bytes:out.bytes},{agreementId:null,role:'attachment',actorId:c.actor.id,at:c.now,provenance:{kind:'word_template_preview',templateVersionId:row.id,revision:row.revision}})
 return {allowed:may.library,result:{versionId:row.id,artifactId:artifact.id,sha256:artifact.sha256,text:out.text},checks:[sql("EXISTS(SELECT 1 FROM lk_word_templates w JOIN lk_template_versions v ON v.id=w.id WHERE w.id=? AND w.revision=? AND v.status='draft')",row.id,row.revision)],writes:[...artifact.writes,sql('UPDATE lk_word_templates SET preview_revision=revision,preview_artifact_id=? WHERE id=?',artifact.id,row.id)],audit:[{action:'template.word.preview',summary:'Previewed the exact Word template markings with explicit sample answers; formatting stays in the OOXML package.'}]}
}
async function filledWord(c:Ctx,row:any,fields:Record<string,unknown>,choices:Record<string,unknown>,lineItems:unknown) {
 const parts=await readWord(await readArtifactBytes(c.db,row.source_artifact_id)),marks=JSON.parse(row.marks)
 if(row.pricing)validatePricing(parts,JSON.parse(row.pricing),marks)
 const filled=renderWord(parts,marks,fields,choices)
 if(!row.pricing)return filled
 const priced=renderPricing(await readWord(filled.bytes),JSON.parse(row.pricing),lineItems)
 return {...filled,bytes:priced.bytes,text:priced.text,fields:{...filled.fields,pricing:priced.pricing}}
}
const pricing:Handler=async(c,p)=>{
 requireRole(c.actor,may.library,'mark a repeating Word pricing table')
 const row=await draft(c,p),definition=pricingDefinition(p),parts=await readWord(await readArtifactBytes(c.db,row.source_artifact_id))
 validatePricing(parts,definition,JSON.parse(row.marks))
 return {allowed:may.library,result:{versionId:row.id,revision:row.revision+1},checks:[sql("EXISTS(SELECT 1 FROM lk_word_templates w JOIN lk_template_versions v ON v.id=w.id WHERE w.id=? AND w.revision=? AND v.status='draft')",row.id,row.revision)],writes:[sql('UPDATE lk_word_templates SET pricing=?,revision=revision+1,preview_revision=NULL,preview_artifact_id=NULL WHERE id=?',json(definition),row.id)],audit:[{action:'template.word.pricing',summary:'Selected a prototype pricing row and total row; future population repeats rows and calculates USD totals from supplied line items.'}]}
}
export async function populateWord(c:Ctx,id:string,fields:Record<string,unknown>,choices:Record<string,unknown>,lineItems?:unknown) {
 const row=await c.db.prepare('SELECT * FROM lk_word_templates WHERE id=?').bind(id).first<any>()
 return row?filledWord(c,row,fields,choices,lineItems):null
}
export const wordTemplateHandlers={'template.word.upload':upload,'template.word.mark':mark,'template.word.preview':preview,'template.word.pricing':pricing}
