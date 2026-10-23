import { useState } from 'react'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { currentVersion, parse, personName } from './format'

export function ReviewRedlines({state,a,locket}:{state:LocketState;a:Row;locket:Locket}) {
 const v=currentVersion(state,a),[edits,setEdits]=useState<Record<string,{selected:boolean;wording:string;reason:string;external:boolean}>>({})
 const findings=state.deviations.filter(d=>d.version_id===v?.id&&d.proposed_wording&&state.proposals.some(p=>p.id===d.proposal_id&&p.status==='approved'))
 const saved=v?parse<any>(v.fields??'{}').reviewRedlines:null
 const editable=['owner','counsel'].includes(state.actor.role)&&['draft','in_review','approved'].includes(a.status)
 const entry=(d:Row)=>edits[d.id]??{selected:false,wording:d.proposed_wording,reason:d.explanation,external:false}
 const update=(d:Row,patch:Partial<ReturnType<typeof entry>>)=>setEdits({...edits,[d.id]:{...entry(d),...patch}})
 return <section className="lk-panel" aria-label="Accepted finding redlines" style={{overflowWrap:"anywhere",minWidth:0}}>
  <h2>Reviewed redlines</h2>
  <p>Choose accepted findings, review each wording and reason, then save one attributed browser and Word version. Reasons stay internal unless you explicitly share them. Saving does not send the document.</p>
  {saved&&<><p>{saved.changes.length} changes saved by {personName(state,saved.reviewerId)}. Earlier approvals were withdrawn.</p><ul className="lk-log">{saved.changes.map((r:any)=><li key={r.findingId}><div><strong>{r.wording}</strong><p>{r.reason} — {r.external?'External reason':'Internal reason'}</p><small>Accepted agent proposal {r.provenance.proposalId}; input digest {r.provenance.inputDigest}. {r.provenance.declaredModel?`Declared model provenance: ${JSON.stringify(r.provenance.declaredModel)}`:'Model metadata was not supplied by the external preparer.'}</small></div></li>)}</ul><a href={`#agreement/${a.id}/versions`}>Review browser redlines</a></>}
  {editable&&findings.length>0&&<form className="lk-form" onSubmit={event=>{event.preventDefault();void locket.run('review.redlines',{agreementId:a.id,version:a.version,versionId:v!.id,changes:findings.filter(d=>entry(d).selected).map(d=>({findingId:d.id,...entry(d)}))})}}>
   {findings.map(d=>{const e=entry(d);return <fieldset className="lk-fieldset" key={d.id}><legend>{d.clause_key}</legend><blockquote>{d.quote}</blockquote><label><input type="checkbox" checked={e.selected} onChange={event=>update(d,{selected:event.target.checked})}/> Apply {d.clause_key}</label><label className="lk-field">Wording for {d.clause_key}<textarea value={e.wording} required onChange={event=>update(d,{wording:event.target.value})}/></label><label className="lk-field">Reason for {d.clause_key}<textarea value={e.reason} required onChange={event=>update(d,{reason:event.target.value})}/></label><label><input type="checkbox" checked={e.external} onChange={event=>update(d,{external:event.target.checked})}/> Share {d.clause_key} reason externally</label></fieldset>})}
   <button className="lk-primary" disabled={locket.busy||!findings.some(d=>entry(d).selected)}>Save reviewed redlines</button>
  </form>}
  {!saved&&!findings.length&&<p>No accepted current findings with proposed wording.</p>}
 </section>
}
