// Applying accepted, cited wording is deterministic: this door makes no model
// request and never represents an unevaluated model as evaluated.
import { may, requireRole } from './access'
import { DOCX, readArtifactBytes, storeArtifact } from './artifacts'
import { retainedClauseUses } from './clause-provenance'
import type { Handler } from './commands'
import { diffLines } from './diff'
import { externalDocx } from './exchange-document'
import { fail, json, list, object, parse, sql, text } from './model'
import { agreementGuards, bump, currentVersion, invalidateApprovals, requireStatus, statusAfterChange, versionDigest, visibleAgreement } from './records'
import { anchoredComments } from './word-review'
import { appendWordEdit, inspectWordReview, writeWordComments } from './word-review-document'
import { importWordReview, wordCommentRows } from './word-review-records'
import { readWord, writeWord } from './word-template-document'

const create:Handler=async(c,p)=>{
 requireRole(c.actor,['owner','counsel'],'turn accepted findings into reviewed redlines')
 const a=await visibleAgreement(c,p.agreementId)
 requireStatus(a,['draft','in_review','approved'],'save review redlines')
 const base=await currentVersion(c,a)
 if(p.versionId!==base.id)fail('NOT_CURRENT','Review findings on the current version before saving redlines.',409)
 if(base.text===null)fail('NO_TEXT','The source version needs readable text.',409)
 const items=list(p,'changes',30)
 if(!items.length)fail('INVALID','Choose at least one accepted finding.')
 const changes=[]
 for(const raw of items){
  const item=object(raw),findingId=text(item,'findingId',100)
  const d=await c.db.prepare('SELECT * FROM lk_deviations WHERE id=? AND agreement_id=? AND version_id=?').bind(findingId,a.id,base.id).first<any>()
  if(!d||!d.proposed_wording)fail('FINDING','Choose an accepted current finding with proposed wording.',409)
  const proposal=d.proposal_id?await c.db.prepare("SELECT * FROM lk_proposals WHERE id=? AND status='approved' AND kind='review'").bind(d.proposal_id).first<any>():null
  if(!proposal)fail('FINDING','Accept the finding’s review proposal before applying its wording.',409)
  if(base.text.slice(d.start_offset,d.end_offset)!==d.quote)fail('CITATION','The finding no longer matches its source passage.',409)
  const wording=item.wording===undefined?d.proposed_wording:text(item,'wording',20000),reason=item.reason===undefined?d.explanation:text(item,'reason',4000)
  if(wording===d.quote)fail('UNCHANGED','The proposed redline must change the cited passage.',409)
  if(item.external!==undefined&&typeof item.external!=='boolean')fail('INVALID','Choose whether to share this reason externally.')
  const payload=parse<any>(proposal.payload)
  const provenance={kind:'accepted_agent_proposal',proposalId:proposal.id,preparedBy:proposal.prepared_by,acceptedBy:proposal.decided_by,acceptedAt:proposal.decided_at,declaredModel:payload.provenance??null,playbookVersionId:d.playbook_version_id,inputVersionId:base.id,inputDigest:base.digest}
  changes.push({findingId,start:d.start_offset as number,end:d.end_offset as number,quote:d.quote as string,wording,reason,external:item.external===true,provenance})
 }
 changes.sort((a,b)=>a.start-b.start)
 if(new Set(changes.map(x=>x.findingId)).size!==changes.length||changes.some((x,i)=>i>0&&x.start<changes[i-1].end))fail('OVERLAP','Choose each finding once, with non-overlapping cited passages.',409)
 const original=await c.db.prepare("SELECT id,sha256 FROM lk_artifacts WHERE version_id=? AND role='original' AND media_type=?").bind(base.id,DOCX).first<{id:string;sha256:string}>()
 let parts=await readWord(original?await readArtifactBytes(c.db,original.id):externalDocx(base.text,[]),'review')
 if(inspectWordReview(parts).text!==base.text)fail('DOCX_RENDITION','The original Word text differs from the reviewed rendition. Reconcile the source before redlining.',409)
 for(const change of [...changes].reverse())parts=appendWordEdit(parts,{start:change.start,end:change.end,replacement:change.wording,author:c.actor.name,date:new Date(c.now).toISOString()})
 const rows=await wordCommentRows(c,base.id),comments=anchoredComments(parts,base,rows)
 let shift=0
 const records=changes.map((change,i)=>{
  const start=change.start+shift,end=start+change.wording.length;shift+=change.wording.length-(change.end-change.start)
  return {...change,start,end,sourceStart:change.start,sourceEnd:change.end,wordCommentId:String(comments.length+i),reviewerId:c.actor.id,at:c.now}
 })
 parts=writeWordComments(parts,[...comments,...records.map(r=>({id:r.wordCommentId,author:c.actor.name,date:new Date(c.now).toISOString(),body:r.reason,start:r.start,end:r.end}))])
 const id=crypto.randomUUID(),number=base.number+1,bytes=writeWord(parts),imported=await importWordReview(c,a.id,id,bytes,base.id)
 const fields={...parse<any>(base.fields??'{}'),clauseLibrary:retainedClauseUses(base.fields,imported.text),...imported.fields,reviewRedlines:{baseVersionId:base.id,reviewerId:c.actor.id,at:c.now,changes:records},browserEdits:{baseVersionId:base.id,actorId:c.actor.id,at:c.now,lines:diffLines(base.text,imported.text)}}
 const artifact=await storeArtifact({filename:`${a.reference}-v${number}-review.docx`,mediaType:DOCX,bytes},{agreementId:a.id,versionId:id,role:'original',actorId:c.actor.id,at:c.now,provenance:{kind:'accepted_review_redlines',baseVersionId:base.id}})
 const digest=await versionDigest({agreementId:a.id,number,files:[{role:'original',sha256:artifact.sha256}],text:imported.text,fields})
 const externalIds=[...rows.filter(row=>row.audience==='external').map(row=>comments[rows.indexOf(row)]?.id),...records.filter(r=>r.external).map(r=>r.wordCommentId)]
 const audiences=imported.fields.wordReview.comments.filter(comment=>externalIds.includes(comment.wordId)).map(comment=>sql("INSERT INTO lk_comment_audiences(comment_id,audience,revision,changed_by,changed_at) VALUES(?,'external',1,?,?)",comment.commentId,c.actor.id,c.now))
 return {allowed:['owner','counsel'],result:{versionId:id,number,digest,changes:records.length},checks:[...agreementGuards(c,a,p),sql('(SELECT digest FROM lk_versions WHERE id=?)=?',base.id,base.digest),...changes.map(r=>sql("EXISTS(SELECT 1 FROM lk_proposals WHERE id=? AND status='approved')",r.provenance.proposalId)),sql('(SELECT COUNT(*) FROM lk_comments WHERE version_id=?)=?',base.id,rows.length),...rows.map(row=>sql('(SELECT revision FROM lk_comments WHERE id=?)=?',row.id,row.revision))],writes:[...artifact.writes,sql('INSERT INTO lk_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,a.id,number,'upload','Accepted review redlines',null,json(fields),imported.text,'docx',digest,c.actor.id,c.now),...imported.writes,...audiences,bump(c,a,'current_version_id=?,status=?',id,statusAfterChange(a)),invalidateApprovals(c,a.id,`Reviewed redlines v${number}`)],audit:[{action:'review.redlines',agreementId:a.id,summary:`Reviewer saved ${records.length} accepted finding redlines in browser and Word, with retained proposal/model provenance and internal reasons unless explicitly shared. No document or message was sent.`}]}
}
export const reviewRedlineHandlers={'review.redlines':create}
