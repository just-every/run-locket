import { ExecutionFollowups } from './execution-followups'
import { useState } from 'react'
import { fileToPayload, type LocketState, type Row } from './api'
import type { Locket } from './app'
import { Badge, Empty, EnvelopeId, Field, Form, Icon, value } from './controls'
import { SignatureSettings,signatureWorkspace } from './signature-settings'
import { SignaturePacketEditor } from './signature-packet-editor'
import { ExecutionComparison, ExecutionFieldEvidence } from './execution-comparison'
import { can, currentVersion, day, parse, personName, providerName, providers, versionsOf, when } from './format'


export function Signature({ state, a, locket }: { state: LocketState; a: Row; locket: Locket }) {
  const workspace=signatureWorkspace(state),packages=state.packages.filter(p=>p.agreement_id===a.id).sort((x,y)=>y.created_at-x.created_at)
  const allowed=workspace?workspace.canCoordinate.includes(a.id):can(state,'owner','approver')||state.actor.role==='requester'&&a.requester_id===state.actor.id
  const [provider,setProvider]=useState('docusign')
  return <div className="lk-tab-page">
    <SignatureSettings key={a.id} state={state} a={a} locket={locket} />
    <SignaturePacketEditor key={a.id+'packet'} state={state} a={a} locket={locket} />
    <section className="lk-panel"><h2>Prepare approved packet</h2>{a.status==='approved'&&allowed?<Form busy={locket.busy} submit="Prepare signature package" onSubmit={()=>void locket.run('package.prepare',{agreementId:a.id,version:a.version,provider,recipients:[]})}><Field label="Signing service"><select value={provider} onChange={e=>setProvider(e.target.value)}>{[...providers,...(providers.some(([id])=>id==='inkwell')?[]:[['inkwell','Inkwell']])].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field><p className="lk-muted">The exact approved main PDF and packet attachments travel together. Manual handoff remains available.</p></Form>:<p className="lk-muted">{a.status==='approved'?'Your role or coordinator group cannot prepare this packet.':'Approve the current packet before preparing it for signature.'}</p>}</section>
    <section className="lk-panel"><h2>Signature packages</h2>{packages.length===0?<Empty>No package prepared yet.</Empty>:packages.map(p=>{
      const manifest=parse(p.manifest),dispatch=workspace?.dispatches.find(d=>d.package_id===p.id),connection=workspace?.connections.find(c=>c.provider===p.provider)
      return <article className="lk-card" key={p.id}><div className="lk-finding-head"><strong>v{manifest.version.number} via {p.provider==='inkwell'?'Inkwell':providerName(p.provider)}</strong><Badge value={p.status} /></div>
        <p className="lk-file-links"><a href={`/api/locket/files/${p.pdf_artifact_id}`} download>Signature-ready PDF</a><a href={`/api/locket/files/${p.manifest_artifact_id}`} download>Routing manifest</a></p>
        {(manifest.documents??[]).map((d:any)=><p key={d.id} style={{overflowWrap:'anywhere'}}><a href={`/api/locket/files/${d.artifactId}`} download>{d.filename}</a> · {d.purpose==='reference'?'reference':'signable'}<br/><small>SHA-256 {d.sha256}</small></p>)}
        <ol>{manifest.recipients.map((r:any)=><li key={r.order}>{r.name} &lt;{r.email}&gt; · {r.action==='copy'?'CC':'signer'}{r.signingFor?` for ${r.signingFor}`:''}</li>)}</ol>
        {manifest.signerRule&&<p>Internal signer selected by {manifest.signerRule.fallback?'required fallback':'published rule'}.</p>}
        {(manifest.fields??[]).map((f:any)=><p key={f.documentId+f.id}>{f.kind} · {f.partyRole} · page {f.page}{f.anchor?` · template anchor ${f.anchor}`:` · ${f.x}, ${f.y} PDF points`}</p>)}
        <small>Prepared {when(p.created_at)} by {personName(state,p.created_by)}</small>
        {p.envelope_id&&<p>Envelope <EnvelopeId id={p.envelope_id} /> · {when(p.sent_at)}</p>}
        {dispatch&&<p role="status">Provider operation: {dispatch.status}{dispatch.envelope_id?` · ${dispatch.envelope_id}`:''}{dispatch.outcome_code?` · ${dispatch.outcome_code}`:''}{['sending','uncertain'].includes(dispatch.status)?' · Inspect the provider account; this operation will not be resent automatically.':''}{dispatch.status==='sent'?' · Provider accepted; signing, recipient delivery and reading remain unconfirmed.':''}{dispatch.status==='provider_prepared'?' · Draft only. Review and send it in Inkwell, then record the handoff here.':''}</p>}
        {p.void_reason&&<p>{p.void_reason}</p>}
        {allowed&&p.status==='prepared'&&a.status==='approved'&&<>
          {state.actor.role==='owner'&&connection&&!dispatch&&<Form busy={locket.busy} submit={p.provider==='inkwell'?'Prepare Inkwell draft':'Send approved packet'} onSubmit={async data=>{const bytes=new TextEncoder().encode(p.manifest),digest=await crypto.subtle.digest('SHA-256',bytes);await locket.run('package.send',{agreementId:a.id,version:a.version,packageId:p.id,connectionVersion:connection.version,manifestDigest:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''),consent:data.get('consent')==='on',mode:p.provider==='inkwell'?'prepare':'send'})}}><label className="lk-check"><input type="checkbox" name="consent" required /> I authorize this exact packet, recipients, fields and connection for this provider operation.</label></Form>}
          {!dispatch||!['queued','sending','uncertain'].includes(dispatch.status)?<Form busy={locket.busy} submit="Mark sent" className="lk-inline" onSubmit={data=>void locket.run('package.sent',{agreementId:a.id,version:a.version,packageId:p.id,envelopeId:value(data,'envelopeId')})}><input aria-label="Envelope ID" name="envelopeId" placeholder="Envelope ID from signing service" required /></Form>:null}
        </>}
        {allowed&&['prepared','sent'].includes(p.status)&&<button disabled={locket.busy} onClick={()=>{const reason=window.prompt('Why void this package?');if(reason)void locket.run('package.void',{agreementId:a.id,version:a.version,packageId:p.id,reason})}}>Void package</button>}
      </article>
    })}</section>
  </div>
}

export function Execution({ state, a, locket }: { state: LocketState; a: Row; locket: Locket }) {
  const { run, busy } = locket
  const sent = state.packages.find(p => p.agreement_id === a.id && p.status === 'sent')
  const signers = sent ? parse(sent.manifest).recipients.filter((r: any) => r.action === 'sign') : []
  const retrievals = (state.executionRetrievals ?? []).filter(r => r.agreement_id === a.id)
  const executions = state.executions.filter(e => e.agreement_id === a.id)
  const file = (id: string | null) => state.artifacts.find(f => f.id === id)
  return (
    <div className="lk-tab-page">
      <section className="lk-panel">
        <div className="lk-panel-head"><h2>Record the signed agreement</h2></div>
        {a.status !== 'out_for_signature' || !sent ? <p className="lk-muted">{a.status === 'executed' || a.status === 'imported' ? 'Executed evidence is recorded under Execution evidence.' : 'Record the signature handoff first.'}</p> : can(state, 'owner', 'approver', 'requester') ? (
          <Form busy={busy} submit="Record execution" onSubmit={async data => {
            const signed = data.get('signed') as File | null, certificate = data.get('certificate') as File | null
            if (!signed?.size) return locket.setError('Choose the signed PDF returned by the signing service.')
            const names = value(data, 'signers').split('\n').map(s => s.trim()).filter(Boolean).map(s => { const m = s.match(/^(.*?)\s*<([^>]+)>$/); return m ? { name: m[1], email: m[2] } : { name: s, email: s } })
            await run('execution.record', { agreementId: a.id, version: a.version, envelopeId: value(data, 'envelopeId'), executedOn: value(data, 'executedOn'), signers: names, documentConfirmed: data.get('documentConfirmed') === 'on', signed: await fileToPayload(signed), certificate: certificate?.size ? await fileToPayload(certificate) : undefined })
          }}>
            <Field label="Signed PDF"><input type="file" name="signed" accept=".pdf" required /></Field>
            <Field label="Certificate of completion (as issued by the provider)"><input type="file" name="certificate" accept=".pdf" /></Field>
            <Field label="Envelope ID"><input name="envelopeId" defaultValue={sent.envelope_id} required /></Field>
            <Field label="Signed by (Name <email>, one per line)"><textarea name="signers" rows={3} defaultValue={signers.map((s: any) => `${s.name} <${s.email}>`).join('\n')} /></Field>
            <Field label="Executed on"><input type="date" name="executedOn" required /></Field>
            <label className="lk-check"><input type="checkbox" name="documentConfirmed" /> I checked that this signed file is the packaged document.</label>
          </Form>
        ) : <p className="lk-muted">Your role cannot record execution.</p>}
      </section>
      <section className="lk-panel">
        <div className="lk-panel-head"><h2>Automatic retrieval</h2></div>
        <p className="lk-muted">Docusign, Acrobat Sign and Dropbox Sign returns are checked against the sent package. Changed documents stay unsigned for review. Retrieval stops when the authorizing owner session or provider connection changes.</p>
        {retrievals.map(r => <article className="lk-card" key={r.id}>
          <Badge value={r.status} /><p>{r.attempts} retrieval attempts{r.last_error ? ` · ${r.last_error.startsWith('provider_http_') ? 'Provider returned HTTP '+r.last_error.slice(14) : 'Retrieval could not finish. Review the connection and retry schedule.'}` : ''}</p>
          {['waiting','retrying','retrieving'].includes(r.status) && <p>Next check {when(r.next_attempt_at)}. Signed evidence appears below after reconciliation.</p>}
          {can(state,'owner') && ['waiting','retrying','retrieving'].includes(r.status) && <button type="button" disabled={busy} onClick={() => void run('execution.retrieval.cancel',{agreementId:a.id,version:a.version})}>Cancel retrieval</button>}
        </article>)}
        {can(state,'owner') && sent && ['docusign','adobe-acrobat-sign','dropbox-sign'].includes(sent.provider) && !retrievals.some(r=>r.package_id===sent.id && ['waiting','retrying','retrieving','reconciled','needs_review'].includes(r.status)) && <Form busy={busy} submit="Authorize retrieval" onSubmit={async data => { await run('execution.retrieval.authorize',{agreementId:a.id,version:a.version,packageId:sent.id,consent:data.get('consent')==='on',...(sent.provider==='dropbox-sign'?{signedName:value(data,'signedName'),certificateName:value(data,'certificateName')}:{})}) }}>
          {sent.provider==='dropbox-sign'&&<><p>Name the exact two PDFs in the provider ZIP. Locket preserves their bytes and never splits a merged PDF or creates an audit trail.</p><Field label="Signed PDF name in ZIP"><input name="signedName" required/></Field><Field label="Provider audit trail name in ZIP"><input name="certificateName" required/></Field></>}
          <label className="lk-check"><input type="checkbox" name="consent" required /> Retrieve and reconcile this exact sent package from the connected {providerName(sent.provider)} account.</label>
        </Form>}
      </section>
      <ExecutionFollowups state={state} a={a} locket={locket}/>
      <section className="lk-panel">
        <div className="lk-panel-head"><h2>Execution evidence</h2></div>
        {executions.length === 0 ? <Empty>Unsigned. No executed file is recorded.</Empty> : executions.map(e => (
          <article key={e.id} className="lk-card">
            <div className="lk-finding-head"><strong>{e.imported ? 'Imported from ' : 'Signed via '}{providerName(e.provider)}</strong><Badge value={e.status} /></div>
            <p>{e.status === 'needs_review' ? 'Returned with stated signing date' : 'Executed'} {day(e.executed_on)} · envelope {e.envelope_id ? <EnvelopeId id={e.envelope_id} /> : '—'}</p>
            <p className="lk-file-links">{file(e.signed_artifact_id) && <a href={`/api/locket/files/${e.signed_artifact_id}`} title={`sha256 ${file(e.signed_artifact_id)!.sha256}`} download><Icon name="file" /> Signed PDF</a>}{e.certificate_artifact_id && <a href={`/api/locket/files/${e.certificate_artifact_id}`} download><Icon name="file" /> Provider certificate</a>}</p>
            <ul className="lk-checks">{parse<any[]>(e.checks).map(c => <li key={c.check} className={c.ok ? 'lk-ok' : 'lk-missing'}><span>{c.ok ? '✓' : '!'}</span>{c.detail}</li>)}</ul>
            {parse<any[]>(e.checks).filter(c => c.comparison).map(c => <ExecutionComparison key={c.check} comparison={c.comparison} />)}
            {parse<any[]>(e.checks).filter(c => c.inspection).map(c => <ExecutionFieldEvidence key={c.check} inspection={c.inspection} />)}
            {e.resolution && <p className="lk-muted">Accepted by {personName(state, e.resolved_by)}: {e.resolution}</p>}
            {e.status === 'needs_review' && can(state, 'owner', 'counsel') && <button type="button" disabled={busy} onClick={() => { const reason = window.prompt('Why is this execution acceptable despite the mismatch?'); if (reason) void run('execution.resolve', { agreementId: a.id, version: a.version, executionId: e.id, reason }) }}>Accept with reason</button>}
          </article>
        ))}
      </section>
    </div>
  )
}
