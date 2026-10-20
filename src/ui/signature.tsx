import { useState } from 'react'
import { fileToPayload, type LocketState, type Row } from './api'
import type { Locket } from './app'
import { Badge, Empty, EnvelopeId, Field, Form, Icon, value } from './controls'
import { signatories } from './entities'
import { ExecutionComparison } from './execution-comparison'
import { can, currentVersion, day, parse, personName, providerName, providers, versionsOf, when } from './format'


export function Signature({ state, a, locket }: { state: LocketState; a: Row; locket: Locket }) {
  const { run, busy } = locket
  const [recipients, setRecipients] = useState([{ name: '', email: '', action: 'sign', signingFor: '' }])
  const v = currentVersion(state, a)
  const packages = state.packages.filter(p => p.agreement_id === a.id).sort((x, y) => y.created_at - x.created_at)
  const versions = versionsOf(state, a.id)
  const may = can(state, 'owner', 'approver', 'requester')
  const entity = state.entities.find(e => e.id === a.entity_id)
  return (
    <div className="lk-tab-page">
      <section className="lk-panel">
        <div className="lk-panel-head"><h2>Send for signature</h2></div>
        {a.status !== 'approved' ? <p className="lk-muted">{a.status === 'out_for_signature' ? 'Out for signature. Record the signed file under Execution when it comes back.' : 'Only an approved version can be packaged for signature.'}</p> : may ? (
          <Form busy={busy} submit="Prepare signature package" onSubmit={data => void run('package.prepare', { agreementId: a.id, version: a.version, provider: value(data, 'provider'), recipients: recipients.map(r => ({ ...r, signingFor: r.signingFor || undefined })), ...(entity ? { signatoryEmail: value(data, 'signatoryEmail') } : {}) })}>
            <p className="lk-muted">Locket packages the exact approved v{v?.number} PDF and a routing manifest. You send it through your existing signing service; Locket does not sign.</p>
            {entity && <Field label={`Signs for ${entity.legal_name} *`} hint="Added to the routing as our signer."><select name="signatoryEmail">{signatories(entity).map(s => <option key={s.email} value={s.email}>{s.name}, {s.title}</option>)}</select></Field>}
            <Field label="Signing service"><select name="provider">{providers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
            <fieldset className="lk-recipients">
              <legend>Recipients, in signing order</legend>
              {recipients.map((r, i) => (
                <div key={i} className="lk-recipient">
                  <span>{i + 1}</span>
                  <input aria-label={`Recipient ${i + 1} name`} placeholder="Name" value={r.name} onChange={e => setRecipients(recipients.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} required />
                  <input aria-label={`Recipient ${i + 1} email`} type="email" placeholder="Email" value={r.email} onChange={e => setRecipients(recipients.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} required />
                  <select aria-label={`Recipient ${i + 1} role`} value={r.action} onChange={e => setRecipients(recipients.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)))}><option value="sign">Signer</option><option value="copy">Receives a copy</option></select>
                  {recipients.length > 1 && <button type="button" className="lk-small" onClick={() => setRecipients(recipients.filter((_, j) => j !== i))}>Remove</button>}
                </div>
              ))}
              <button type="button" className="lk-small" onClick={() => setRecipients([...recipients, { name: '', email: '', action: 'sign', signingFor: '' }])}>Add recipient</button>
            </fieldset>
          </Form>
        ) : <p className="lk-muted">Your role cannot send for signature.</p>}
      </section>
      <section className="lk-panel">
        <div className="lk-panel-head"><h2>Signature packages</h2></div>
        {packages.length === 0 ? <Empty>No package prepared yet.</Empty> : packages.map(p => {
          const manifest = parse(p.manifest)
          return (
            <article key={p.id} className="lk-card">
              <div className="lk-finding-head"><strong>v{versions.find(x => x.id === p.version_id)?.number} via {providerName(p.provider)}</strong><Badge value={p.status} /></div>
              <p className="lk-file-links"><a href={`/api/locket/files/${p.pdf_artifact_id}`} download><Icon name="file" /> Signature-ready PDF</a><a href={`/api/locket/files/${p.manifest_artifact_id}`} download><Icon name="file" /> Routing manifest</a></p>
              <ol className="lk-recipient-list">{manifest.recipients.map((r: any) => <li key={r.order}>{r.name} &lt;{r.email}&gt; · {r.action === 'sign' ? 'signer' : 'copy'}{r.signingFor ? ` for ${r.signingFor}` : ''}</li>)}</ol>
              <small title={`PDF sha256 ${manifest.document.sha256}`}>Prepared {when(p.created_at)} by {personName(state, p.created_by)}</small>
              {p.envelope_id && <p>Envelope <EnvelopeId id={p.envelope_id} />, handed off {when(p.sent_at)} by {personName(state, p.sent_by)}</p>}
              {p.void_reason && <p className="lk-muted">Voided: {p.void_reason}</p>}
              {may && p.status === 'prepared' && a.status === 'approved' && (
                <Form busy={busy} submit="Mark sent" className="lk-inline" onSubmit={data => void run('package.sent', { agreementId: a.id, version: a.version, packageId: p.id, envelopeId: value(data, 'envelopeId') })}>
                  <input name="envelopeId" placeholder="Envelope ID from the signing service" aria-label="Envelope ID" required />
                </Form>
              )}
              {may && ['prepared', 'sent'].includes(p.status) && <button type="button" className="lk-small" disabled={busy} onClick={() => { const reason = window.prompt('Why void this package?'); if (reason) void run('package.void', { agreementId: a.id, version: a.version, packageId: p.id, reason }) }}>Void package</button>}
            </article>
          )
        })}
      </section>
    </div>
  )
}

export function Execution({ state, a, locket }: { state: LocketState; a: Row; locket: Locket }) {
  const { run, busy } = locket
  const sent = state.packages.find(p => p.agreement_id === a.id && p.status === 'sent')
  const signers = sent ? parse(sent.manifest).recipients.filter((r: any) => r.action === 'sign') : []
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
        <div className="lk-panel-head"><h2>Execution evidence</h2></div>
        {executions.length === 0 ? <Empty>Unsigned. No executed file is recorded.</Empty> : executions.map(e => (
          <article key={e.id} className="lk-card">
            <div className="lk-finding-head"><strong>{e.imported ? 'Imported from ' : 'Signed via '}{providerName(e.provider)}</strong><Badge value={e.status} /></div>
            <p>Executed {day(e.executed_on)} · envelope {e.envelope_id ? <EnvelopeId id={e.envelope_id} /> : '—'}</p>
            <p className="lk-file-links">{file(e.signed_artifact_id) && <a href={`/api/locket/files/${e.signed_artifact_id}`} title={`sha256 ${file(e.signed_artifact_id)!.sha256}`} download><Icon name="file" /> Signed PDF</a>}{e.certificate_artifact_id && <a href={`/api/locket/files/${e.certificate_artifact_id}`} download><Icon name="file" /> Provider certificate</a>}</p>
            <ul className="lk-checks">{parse<any[]>(e.checks).map(c => <li key={c.check} className={c.ok ? 'lk-ok' : 'lk-missing'}><span>{c.ok ? '✓' : '!'}</span>{c.detail}</li>)}</ul>
            {parse<any[]>(e.checks).filter(c => c.comparison).map(c => <ExecutionComparison key={c.check} comparison={c.comparison} />)}
            {e.resolution && <p className="lk-muted">Accepted by {personName(state, e.resolved_by)}: {e.resolution}</p>}
            {e.status === 'needs_review' && can(state, 'owner', 'counsel') && <button type="button" disabled={busy} onClick={() => { const reason = window.prompt('Why is this execution acceptable despite the mismatch?'); if (reason) void run('execution.resolve', { agreementId: a.id, version: a.version, executionId: e.id, reason }) }}>Accept with reason</button>}
          </article>
        ))}
      </section>
    </div>
  )
}
