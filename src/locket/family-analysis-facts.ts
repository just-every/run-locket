import { readArtifactBytes } from './artifacts'
import type { Ctx } from './commands'
import { readablePages } from './execution-comparison'
import { canonical, fail, sha256 } from './model'
import { agreementGuards, visibleAgreement } from './records'

export type FamilyFact = { id:string; parentId:string|null; relation:string|null; status:string; versionId:string|null; timezone:string }
export type TermFact = { id:string; agreementId:string; key:string; value:string }
export type FamilyFacts = { members:FamilyFact[]; terms:TermFact[] }
export type FamilySource = { agreementId:string; versionId:string; title:string; relation:string|null; pages:{page:number|null;text:string}[]; terms:TermFact[] }
export const factOf = (a:any):FamilyFact => ({id:a.id,parentId:a.parent_id,relation:a.relation,status:a.status,versionId:a.current_version_id,timezone:a.timezone})
export const termFact = (t:any):TermFact => ({id:t.id,agreementId:t.agreement_id,key:t.key,value:t.value})
export function factsMatch(facts:FamilyFacts, agreements:any[], terms:any[]) {
 const ids=new Set([facts.members.find(m=>m.parentId===null)?.id ?? facts.members[0]?.id])
 let size=-1
 while(size!==ids.size){size=ids.size;for(const a of agreements)if(ids.has(a.parent_id))ids.add(a.id)}
 const members=agreements.filter(a=>ids.has(a.id)).map(factOf).sort((a,b)=>a.id.localeCompare(b.id))
 const current=terms.filter(t=>ids.has(t.agreement_id)&&t.status==='confirmed').map(termFact).sort((a,b)=>a.id.localeCompare(b.id))
 return canonical({members,terms:current})===canonical(facts)
}
export async function familyFacts(c:Ctx, id:unknown, includeText=false) {
 const root=await visibleAgreement(c,id)
 if(root.parent_id)fail('FAMILY','Analyze the parent agreement for this family.',409)
 const all=(await c.db.prepare('SELECT * FROM lk_agreements').all<any>()).results
 const ids=new Set([root.id]);let size=-1
 while(size!==ids.size){size=ids.size;for(const a of all)if(ids.has(a.parent_id))ids.add(a.id)}
 const members=await Promise.all(all.filter(a=>ids.has(a.id)).map(a=>visibleAgreement(c,a.id)))
 const terms=(await c.db.prepare("SELECT * FROM lk_terms WHERE status='confirmed'").all<any>()).results.filter(t=>ids.has(t.agreement_id))
 const facts:FamilyFacts={members:members.map(factOf).sort((a,b)=>a.id.localeCompare(b.id)),terms:terms.map(termFact).sort((a,b)=>a.id.localeCompare(b.id))}
 const sources:FamilySource[]=[]
 if(includeText)for(const a of members.filter(a=>['executed','imported'].includes(a.status))){
  if(!a.current_version_id)fail('NO_TEXT',`${a.reference} needs its executed text before family analysis.`,409)
  const execution=await c.db.prepare("SELECT signed_artifact_id FROM lk_executions WHERE agreement_id=? AND imported=0 AND status IN ('reconciled','accepted') ORDER BY recorded_at DESC LIMIT 1").bind(a.id).first<any>()
  let pages:{page:number|null;text:string}[]
  if(execution){
   const parsed=await readablePages(await readArtifactBytes(c.db,execution.signed_artifact_id))
   if(!parsed)fail('NO_TEXT',`${a.reference} has an unreadable signed page; obtain an accessible text rendition before analyzing.`,409)
   pages=parsed.map((text,index)=>({page:index+1,text}))
  }else{
   const v=await c.db.prepare('SELECT text FROM lk_versions WHERE id=?').bind(a.current_version_id).first<any>()
   if(!v?.text?.trim())fail('NO_TEXT',`${a.reference} needs its executed text rendition before family analysis.`,409)
   pages=[{page:null,text:v.text}]
  }
  sources.push({agreementId:a.id,versionId:a.current_version_id,title:a.title,relation:a.relation,pages,terms:facts.terms.filter(t=>t.agreementId===a.id)})
 }
 if(includeText&&(sources.length<2||canonical(sources).length>250000))fail('ANALYSIS_SCOPE','Select a family with at least two readable executed documents and at most 250,000 characters. Nothing was sent.',409)
 return {root,members,facts,sources,digest:await sha256(canonical({facts,sources})),checks:members.flatMap(a=>agreementGuards(c,a))}
}
