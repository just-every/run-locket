// Review the actual OOXML package; the plain PDF/browser rendition is never
// used to reconstruct a Word document.
import type { Bindings } from '../auth.server'
import { may, fullReaders, requireRole } from './access'
import { DOCX, readArtifactBytes, storeArtifact } from './artifacts'
import { recordReads } from './audit'
import type { Ctx, Handler } from './commands'
import { fail, integer, json, object, oneOf, sql, text, type Actor } from './model'
import { agreementGuards, bump, currentVersion, invalidateApprovals, requireStatus, statusAfterChange, versionDigest, visibleAgreement, type VersionRow } from './records'
import { requireFullFields } from './repository-access'
import { appendWordEdit, inspectWordReview, resolveWordReview, stripWordMetadata, writeWordComments } from './word-review-document'
import { importWordReview, wordCommentRows } from './word-review-records'
import { readWord, writeWord, type WordPart } from './word-template-document'

async function source(c:Ctx,a:{id:string},versionId:string) {
 const v=await c.db.prepare('SELECT * FROM lk_versions WHERE id=? AND agreement_id=?').bind(versionId,a.id).first<VersionRow>()
 const original=v&&await c.db.prepare("SELECT id,sha256 FROM lk_artifacts WHERE version_id=? AND role='original' AND media_type=?").bind(v.id,DOCX).first<{id:string;sha256:string}>()
 if(!v||!original)fail('DOCX','Choose a version with its original Word file.',409)
 return {v,original,parts:await readWord(await readArtifactBytes(c.db,original.id),'review')}
}

export async function wordReviewView(env:Bindings,actor:Actor,versionId:string){
 await requireFullFields(env.DB,actor)
 const c:Ctx={env,db:env.DB,actor,now:Date.now(),commandId:crypto.randomUUID()}
 const v=await c.db.prepare('SELECT agreement_id FROM lk_versions WHERE id=?').bind(versionId).first<{agreement_id:string}>()
 if(!v)fail('NOT_FOUND','No accessible Word version.',404)
 const a=await visibleAgreement(c,v.agreement_id),loaded=await source(c,a,versionId),model=inspectWordReview(loaded.parts)
 if(a.restricted)await recordReads(env,actor,[{action:'agreement.view',agreementId:a.id,summary:`Read Word revisions and comments on v${loaded.v.number}.`}])
 return {...model,versionId,sourceArtifactId:loaded.original.id,sourceDigest:loaded.original.sha256,baseVersionId:JSON.parse(loaded.v.fields??'{}').wordReview?.baseVersionId??null}
}

// Copy version-bound threads, keeping a source anchor where its words survive.
// Imported anchors follow the actual XML ranges after revision decisions.
export function anchoredComments(parts:WordPart[],base:VersionRow,rows:any[],externalOnly=false){
 const model=inspectWordReview(parts),mapped=JSON.parse(base.fields??'{}').wordReview?.comments??[]
 const selected=rows.filter(row=>!externalOnly||row.audience==='external'),numbers=new Map(selected.map((row,i)=>[row.id,String(i)]))
 return selected.map(row=>{
  const root=row.parent_id?rows.find(root=>root.id===row.parent_id):row
  const wordId=mapped.find((item:any)=>item.commentId===root?.id)?.wordId
  const original=model.comments.find(comment=>comment.id===wordId)
  const start=original?.start??(root?.quote?model.text.indexOf(root.quote):0)
  const end=original?.end??(start>=0?start+(root?.quote?.length??0):0)
  if(start<0)fail('COMMENT_ANCHOR','A comment passage was removed. Resolve or move the comment before exporting.',409)
  return {id:numbers.get(row.id)!,author:row.external_author_name??row.native_author??'Locket user',date:new Date(row.at).toISOString(),body:row.body,start,end,parentId:row.parent_id?numbers.get(row.parent_id)??null:null}
 })
}

const review:Handler=async(c,p)=>{
 requireRole(c.actor,may.intake,'review Word revisions')
 const a=await visibleAgreement(c,p.agreementId)
 requireStatus(a,['draft','in_review','approved','imported'],'review Word revisions')
 const base=await currentVersion(c,a)
 if(p.versionId!==base.id)fail('NOT_CURRENT','Review the current Word version.',409)
 const loaded=await source(c,a,base.id),decisions=object(p.decisions??{}),choices:Record<string,'accept'|'reject'>={}
 for(const [id,decision]of Object.entries(decisions))choices[id]=oneOf({decision},'decision',['accept','reject'] as const)
 if(!Object.keys(choices).length&&!p.edit)fail('UNCHANGED','Choose revisions or enter a tracked edit.',409)
 let parts=resolveWordReview(loaded.parts,choices)
 if(p.edit){const edit=object(p.edit);parts=appendWordEdit(parts,{start:integer(edit,'start',0),end:integer(edit,'end',0),replacement:typeof edit.replacement==='string'&&edit.replacement.length<=20000?edit.replacement:fail('INVALID','Enter replacement text.'),author:c.actor.name,date:new Date(c.now).toISOString()})}
 parts=stripWordMetadata(parts,true)
 const rows=await wordCommentRows(c,base.id),comments=anchoredComments(parts,base,rows)
 parts=writeWordComments(parts,comments)
 const id=crypto.randomUUID(),number=base.number+1,bytes=writeWord(parts),imported=await importWordReview(c,a.id,id,bytes,base.id)
 const fields={wordReview:{...imported.fields.wordReview,decisions:choices,decidedBy:c.actor.id,at:c.now}},artifact=await storeArtifact({filename:`${a.reference}-v${number}.docx`,mediaType:DOCX,bytes},{agreementId:a.id,versionId:id,role:'original',actorId:c.actor.id,at:c.now,provenance:{kind:'word_review',baseVersionId:base.id}})
 const digest=await versionDigest({agreementId:a.id,number,files:[{role:'original',sha256:artifact.sha256}],text:imported.text,fields})
 const audiences=comments.flatMap((comment,index)=>rows[index]?.audience==='external'?[sql("INSERT INTO lk_comment_audiences(comment_id,audience,revision,changed_by,changed_at) VALUES(?,'external',1,?,?)",imported.fields.wordReview.comments[index].commentId,c.actor.id,c.now)]:[])
 return {allowed:may.intake,result:{versionId:id,number,digest},checks:[...agreementGuards(c,a,p),sql('(SELECT digest FROM lk_versions WHERE id=?)=?',base.id,base.digest),sql('(SELECT COUNT(*) FROM lk_comments WHERE version_id=?)=?',base.id,rows.length),...rows.map(row=>sql('(SELECT revision FROM lk_comments WHERE id=?)=?',row.id,row.revision))],writes:[...artifact.writes,sql('INSERT INTO lk_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,a.id,number,'upload','Word review',null,json(fields),imported.text,'docx',digest,c.actor.id,c.now),...imported.writes,...audiences,bump(c,a,'current_version_id=?,status=?',id,statusAfterChange(a)),invalidateApprovals(c,a.id,`Word review v${number}`)],audit:[{action:'word.review',agreementId:a.id,summary:`Created Word v${number} from v${base.number}; ${Object.keys(choices).length} attributed revision decisions${p.edit?'; tracked edit by '+c.actor.name:''}; original preserved.`}]}
}

export async function externalWord(c:Ctx,versionId:string,clean:boolean){
 const v=await c.db.prepare('SELECT agreement_id FROM lk_versions WHERE id=?').bind(versionId).first<{agreement_id:string}>()
 if(!v)fail('NOT_FOUND','No such Word version.',404)
 const a=await visibleAgreement(c,v.agreement_id),loaded=await source(c,a,versionId)
 let parts=loaded.parts
 if(clean)parts=resolveWordReview(parts,Object.fromEntries(inspectWordReview(parts).changes.map(change=>[change.id,'accept' as const])))
 parts=stripWordMetadata(parts)
 parts=writeWordComments(parts,anchoredComments(parts,loaded.v,await wordCommentRows(c,versionId),true))
 return writeWord(parts)
}

const output:Handler=async(c,p)=>{
 requireRole(c.actor,fullReaders,'prepare outgoing Word files')
 const a=await visibleAgreement(c,p.agreementId),v=await currentVersion(c,a)
 if(p.versionId!==v.id)fail('NOT_CURRENT','Export the reviewed current version.',409)
 if(p.confirmCleanup!==true)fail('CONSENT','Internal comments and document metadata will be removed. Only explicitly external comments are included. Review tracked deletions and visible revision authors before sharing.')
 const kind=oneOf(p,'kind',['clean','redline'] as const),bytes=await externalWord(c,v.id,kind==='clean')
 const artifact=await storeArtifact({filename:`${a.reference}-v${v.number}-${kind}.docx`,mediaType:DOCX,bytes},{agreementId:a.id,versionId:v.id,role:'attachment',actorId:c.actor.id,at:c.now,provenance:{kind:'word_output',output:kind,external:true,metadataStripped:true}})
 return {allowed:fullReaders,result:{artifactId:artifact.id,digest:artifact.sha256},checks:agreementGuards(c,a,p),writes:artifact.writes,audit:[{action:'word.output',agreementId:a.id,summary:`Explicitly approved ${kind} Word output cleanup: internal comments and package metadata removed; styles and layout preserved.`}]}
}
export const wordReviewHandlers={'word.review':review,'word.output':output}
