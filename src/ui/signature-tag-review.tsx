import type { LocketState,Row } from './api'
import type { Locket } from './app'
import { parse } from './format'
import { signatureWorkspace } from './signature-settings'

export function SignatureTagReview({state,a,locket}:{state:LocketState;a:Row;locket:Locket}){
 const rows=signatureWorkspace(state)?.renditions.filter(r=>r.agreement_id===a.id&&r.version_id===a.current_version_id)??[]
 return <details><summary>Review provider-tagged PDFs before approval</summary>
  <p>Acrobat Sign and Dropbox Sign need native text tags. Prepare a separate retained PDF with these placements, review its exact bytes, then approve the packet again. Originals stay unchanged. The provider determines the final field rendering.</p>
  {(['adobe-acrobat-sign','dropbox-sign'] as const).map(provider=>{
   const row=rows.find(r=>r.provider===provider),definition=row?parse<any>(row.definition):null
   return <section key={provider}><h3>{provider==='adobe-acrobat-sign'?'Acrobat Sign':'Dropbox Sign'}</h3>
    <button disabled={locket.busy} onClick={()=>void locket.run('package.tags.prepare',{agreementId:a.id,version:a.version,provider})}>Prepare {provider==='adobe-acrobat-sign'?'Acrobat Sign':'Dropbox Sign'} review PDFs</button>
    {definition&&<><ul>{definition.derivations.flatMap((d:any)=>d.fields.map((f:any)=><li key={d.documentId+f.id}>{f.id} · document {d.documentId} · page {f.page} · {f.x}, {f.y} · {f.width} × {f.height} PDF points</li>))}</ul><p>These exact renditions join the approval context. Saving the packet again requires fresh preparation.</p>{definition.documents.map((d:any)=><p key={d.id} style={{overflowWrap:'anywhere'}}><a href={`/api/locket/files/${d.artifactId}`} download>Review {d.filename}</a><br/><small>SHA-256 {d.sha256}</small></p>)}</>}
   </section>
  })}
 </details>
}
