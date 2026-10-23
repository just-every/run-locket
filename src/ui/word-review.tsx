import { useEffect, useState } from 'react'
import { fetchJson, type LocketState, type Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can } from './format'

type Review={text:string;sourceArtifactId:string;sourceDigest:string;baseVersionId:string|null;changes:{id:string;kind:string;author:string;date:string|null;start:number;end:number;before:string;after:string}[];comments:{id:string;author:string;body:string;start:number;end:number}[]}
export function WordReview({state,a,shown,locket}:{state:LocketState;a:Row;shown:Row;locket:Locket}){
 const [review,setReview]=useState<Review|null>(null),[error,setError]=useState(''),[decisions,setDecisions]=useState<Record<string,string>>({}),[outputs,setOutputs]=useState<{id:string;kind:string}[]>([])
 const original=state.artifacts.find(f=>f.version_id===shown.id&&f.role==='original'&&f.media_type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
 useEffect(()=>{setReview(null);setError('');setDecisions({});setOutputs([]);if(original)void fetchJson<Review>('/api/locket/word-review?versionId='+encodeURIComponent(shown.id)).then(setReview).catch(cause=>setError(cause.message))},[shown.id,original?.id])
 if(!original)return null
 const editable=shown.id===a.current_version_id&&can(state,'owner','counsel','approver','requester')&&['draft','in_review','approved','imported'].includes(a.status)
 const save=async(payload:object)=>{const result=await locket.run('word.review',{agreementId:a.id,version:a.version,versionId:shown.id,...payload});if(result)window.location.hash=`agreement/${a.id}/versions/${result.number}`}
 return <section className="lk-panel" aria-label="Word tracked changes">
  <div className="lk-panel-head"><h2>Word tracked changes</h2><a href={`/api/locket/files/${original.id}`} download>Download original Word</a></div>
  {error&&<p role="alert">{error}</p>}
  {review&&<>
   <p>{review.changes.length} Word revisions · {review.comments.length} embedded comments. Positions refer to the current text below. Original Word authors are attributed from the file; their identities are unverified.</p>
   {review.comments.length>0&&<details className="lk-disclosure"><summary>Word comment positions</summary><ul aria-label="Word comments">{review.comments.map(comment=><li key={comment.id} style={{overflowWrap:'anywhere'}}><strong>{comment.author}</strong> · Position {comment.start}–{comment.end}<p>{comment.body}</p></li>)}</ul></details>}
   {review.baseVersionId&&<p>Changes are pinned to the preceding document version. Review decisions create a new Word version and withdraw earlier approvals.</p>}
   <ol className="lk-log" aria-label="Word revisions">{review.changes.map(change=><li key={change.id} style={{display:'block',overflowWrap:'anywhere'}} data-word-change={change.id}>
    <strong>{change.kind} · {change.author}</strong><p>Position {change.start}–{change.end}{change.date?` · ${change.date}`:''}</p>
    <p>{change.before&&<del>{change.before}</del>} {change.after&&<ins>{change.after}</ins>}{change.kind==='formatting'&&<> Formatting revision</>}</p>
    {editable&&<Field label={`Decision for Word change ${change.id}`}><select value={decisions[change.id]??''} onChange={event=>setDecisions({...decisions,[change.id]:event.target.value})}><option value="">Keep pending</option><option value="accept">Accept</option><option value="reject">Reject</option></select></Field>}
   </li>)}</ol>
   {editable&&review.changes.length>0&&<button type="button" className="lk-primary" disabled={locket.busy||!Object.values(decisions).some(Boolean)} onClick={()=>void save({decisions:Object.fromEntries(Object.entries(decisions).filter(([,choice])=>choice))})}>Save Word decisions</button>}
   {editable&&<details className="lk-disclosure"><summary>Write an attributed Word edit</summary><Form busy={locket.busy} submit="Save tracked Word edit" onSubmit={data=>save({edit:{start:Number(value(data,'start')),end:Number(value(data,'end')),replacement:value(data,'replacement')}})}>
    <p>Select the exact character positions in one paragraph. The Word file keeps its existing formatting and records your deletion/insertion under your name.</p>
    <Field label="Word edit start"><input name="start" type="number" min="0" required/></Field><Field label="Word edit end"><input name="end" type="number" min="0" required/></Field><Field label="Word replacement"><textarea name="replacement" rows={2}/></Field>
   </Form></details>}
   {shown.id===a.current_version_id&&can(state,'owner','counsel')&&<details className="lk-disclosure"><summary>Prepare clean or redline Word</summary>
    <p role="note">Internal comments and document metadata will be removed. Only comments explicitly shared externally are included. Styles, tables, numbering, headers and footers are preserved. Review visible revision authors and deleted text before disclosure. These outputs are separate from the untouched original.</p>
    <Form busy={locket.busy} submit="Prepare outgoing Word" onSubmit={async data=>{const kind=value(data,'kind'),result=await locket.run('word.output',{agreementId:a.id,version:a.version,versionId:shown.id,kind,confirmCleanup:data.get('cleanup')==='on'});if(result)setOutputs([...outputs,{id:result.artifactId,kind}])}}>
     <Field label="Word output"><select name="kind"><option value="redline">Redline with pending changes</option><option value="clean">Clean (accept pending changes)</option></select></Field>
     <Field label="I approve removing internal comments and metadata from this Word output"><input name="cleanup" type="checkbox" required/></Field>
    </Form>{outputs.map(output=><p key={output.id}><a href={`/api/locket/files/${output.id}`} download>Download {output.kind} Word</a></p>)}
   </details>}
  </>}
 </section>
}
