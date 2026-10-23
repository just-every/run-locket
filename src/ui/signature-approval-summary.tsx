import type { LocketState,Row } from './api'
import { currentVersion,parse } from './format'

type Packet={documents?:any[];recipients?:any[];fields?:any[];mainBlocks?:any[];providerRenditions?:any[]}
export function PacketApprovalDetails({packet}:{packet:Packet|null|undefined}){
 if(!packet)return null
 return <section aria-label="Signing packet covered by approval"><h3>Signing packet covered by this approval</h3>
  <p>The current main version and these exact attachments, recipients and fields are approved together. Changes withdraw approval.</p>
  <ul>{packet.documents?.map(d=><li key={d.id} style={{overflowWrap:'anywhere'}}><a href={`/api/locket/files/${d.artifactId}`} download>{d.filename}</a> · {d.purpose==='reference'?'Reference':'Signable'}<br/><small>SHA-256 {d.sha256}</small></li>)}</ul>
  <ol>{packet.recipients?.map((r,i)=><li key={i}>{r.name} &lt;{r.email}&gt; · {r.action==='copy'?'CC':'Signer'} · {r.partyRole}</li>)}</ol>
  <details><summary>Review signature fields and template blocks</summary><ul>{packet.fields?.map(f=><li key={f.documentId+f.id}>{f.kind} · {f.partyRole} · {f.documentId} · page {f.page} · {f.x}, {f.y} PDF points</li>)}{packet.mainBlocks?.map(f=><li key={f.id}>{f.kind} · {f.partyRole} · main template anchor {f.anchor}</li>)}{packet.documents?.flatMap(d=>(d.blocks??[]).map((f:any)=><li key={d.id+f.id}>{f.kind} · {f.partyRole} · {d.filename} anchor {f.anchor}</li>))}</ul></details>
  {packet.providerRenditions?.map(r=><details key={r.provider}><summary>Review {r.provider} exact tagged PDFs</summary>{parse<any>(r.definition).documents.map((d:any)=><p key={d.id} style={{overflowWrap:'anywhere'}}><a href={`/api/locket/files/${d.artifactId}`} download>{d.filename}</a><br/><small>SHA-256 {d.sha256}</small></p>)}</details>)}
 </section>
}
export function SignatureApprovalSummary({state,a}:{state:LocketState;a:Row}){
 const w=state.signature,row=w?.packets.find(p=>p.agreement_id===a.id),v=currentVersion(state,a)
 if(!row)return null
 return <PacketApprovalDetails packet={{documents:parse(row.documents),recipients:parse(row.recipients),fields:parse(row.fields),mainBlocks:parse(w.blocks.find(b=>b.template_version_id===v?.template_version_id)?.definition??'[]'),providerRenditions:w.renditions.filter(r=>r.agreement_id===a.id&&r.version_id===v?.id)}} />
}
