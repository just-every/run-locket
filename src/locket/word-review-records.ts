// Word comments enter the same internal-by-default, version-pinned threads as
// browser comments. The OOXML identity remains separate from the database ID.
import { readWord } from './word-template-document'
import { inspectWordReview } from './word-review-document'
import type { Ctx } from './commands'
import { json, sql, type Sql } from './model'

export async function importWordReview(c:Ctx,agreementId:string,versionId:string,bytes:Uint8Array,baseVersionId:string|null=null) {
 const model=inspectWordReview(await readWord(bytes,'review'))
 const ids=new Map(model.comments.map(comment=>[comment.id,crypto.randomUUID()])),writes:Sql[]=[]
 for(const comment of model.comments){
  const at=comment.date?Date.parse(comment.date):c.now
  writes.push(sql('INSERT INTO lk_comments(id,agreement_id,version_id,author_id,body,quote,at,parent_id,external_author_name) VALUES(?,?,?,?,?,?,?,?,?)',ids.get(comment.id),agreementId,versionId,c.actor.id,comment.body,comment.quote||null,Number.isFinite(at)?at:c.now,comment.parentId?ids.get(comment.parentId)??null:null,comment.author))
 }
 return {text:model.text,fields:{wordReview:{baseVersionId,comments:model.comments.map(comment=>({wordId:comment.id,commentId:ids.get(comment.id),start:comment.start,end:comment.end}))}},writes}
}

export async function wordCommentRows(c:Ctx,versionId:string) {
 return (await c.db.prepare("SELECT c.*,o.display_name AS native_author,COALESCE(side.audience,'internal') audience FROM lk_comments c LEFT JOIN oa_operators o ON o.id=c.author_id LEFT JOIN lk_comment_audiences side ON side.comment_id=c.id WHERE c.version_id=? ORDER BY c.at,c.id").bind(versionId).all<any>()).results
}

export function commentSnapshot(rows:any[]) {
 return json(rows.map(row=>({id:row.id,body:row.body,quote:row.quote,parent_id:row.parent_id,revision:row.revision,resolved_at:row.resolved_at,audience:row.audience})))
}
