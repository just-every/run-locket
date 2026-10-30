import { EnterpriseImport, EnterprisePreview, runImportOperation } from './enterprise-imports'
import { useState } from 'react'
import { fileToPayload, type LocketState } from './api'
import type { Locket } from './app'
import { Badge, Empty, EnvelopeId, Field, Form, value } from './controls'
import { can, day, parse, personName, plural, when } from './format'
import { EntitySelect } from './entities'
import { IroncladImport } from './ironclad-import'

/** Paths relative to the chosen archive folder: ENVELOPE_ID/file.pdf. */
function relativePath(file: File) {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
  const parts = path.split('/')
  return parts.length > 2 ? parts.slice(1).join('/') : path
}

export function Imports({ state, locket }: { state: LocketState; locket: Locket }) {
  const { run, busy } = locket
  const [kit,setKit]=useState('docusign-archive')
  const [selected, setSelected] = useState(state.imports[0]?.id ?? '')
  const batch = state.imports.find(b => b.id === selected) ?? state.imports[0]
  if (!can(state, 'owner')) return <p className="lk-empty">Only the owner moves archives into Locket.</p>
  const preview = batch ? parse(batch.preview) : null
  return (
    <div className="lk-imports">
      <div className="lk-titlebar"><div><h1>Imports</h1><p className="lk-muted">Move a completed contract repository in: dry run first, then apply exactly what you reviewed. Originals, certificates and the journal are kept; an unused batch can be undone.</p></div></div>
        <div className="lk-columns lk-import-start">
          <section className="lk-panel">
            <div className="lk-panel-head"><h2>New archive dry run</h2></div>
            <Field label="Move-in kit"><select value={kit} onChange={e=>setKit(e.target.value)}><option value="docusign-archive">DocuSign archive</option><option value="ironclad-records">Ironclad repository</option></select></Field>
            {kit==='ironclad-records'?<IroncladImport state={state} locket={locket} onPreview={setSelected}/>:<>
            <Form busy={busy} submit="Run dry run" onSubmit={async (data, form) => {
              const manifest = data.get('manifest') as File | null
              const files = (data.getAll('files') as File[]).filter(f => f.size && /\.pdf$/i.test(f.name))
              if (!manifest?.size) return locket.setError('Choose the envelope report CSV.')
              const payloadFiles = await Promise.all(files.map(async f => ({ path: relativePath(f), base64: (await fileToPayload(f)).base64 })))
              const result = await run('import.preview', { kit: 'docusign-archive', label: value(data, 'label'), ...(state.entities.length ? { entityId: value(data, 'entityId') } : {}), dateFormat: value(data, 'dateFormat'), manifest: await fileToPayload(manifest), files: payloadFiles })
              if (result) { setSelected(result.batchId); form.reset() }
            }}>
              {state.entities.length > 0 && <EntitySelect state={state} />}
              <Field label="Batch name"><input name="label" required placeholder="DocuSign archive to Sep 30, 2026" /></Field>
              <Field label="Envelope report (CSV)" hint="Reports → Envelope Report → Download CSV, with Envelope ID, Subject, Status, Completed On, Recipient Name and Recipient Email columns."><input type="file" name="manifest" accept=".csv" required /></Field>
              <Field label="Downloaded envelopes folder" hint="One folder per envelope ID holding its signed PDFs and Summary.pdf (Certificate of Completion)."><input type="file" name="files" multiple {...{ webkitdirectory: '' }} /></Field>
              <Field label="Dates in the report are"><select name="dateFormat" defaultValue="mdy"><option value="mdy">Month/Day/Year (US account)</option><option value="dmy">Day/Month/Year (account outside the US)</option><option value="iso">Year-Month-Day</option></select></Field>
            </Form></>}
          </section>
          <section className="lk-panel">
            <div className="lk-panel-head"><h2>Batches</h2></div>
            {state.imports.length === 0 ? <Empty>No move-in batches yet.</Empty> : (
              <ul className="lk-pick-list">{state.imports.map(b => <li key={b.id}><button type="button" className={b.id === batch?.id ? 'lk-selected' : undefined} onClick={() => setSelected(b.id)}><strong>{b.source_label}</strong><small>{when(b.created_at)} · {personName(state, b.created_by)}</small><Badge value={b.status} /></button></li>)}</ul>
            )}
          </section>
        </div>
        <EnterpriseImport state={state} locket={locket} selected={setSelected}/>
        {batch && preview && (
          <section className="lk-panel lk-wide-panel">
            <div className="lk-panel-head"><h2 title={`Report ${preview.manifest.filename}, sha256 ${preview.manifest.sha256}; dry-run fingerprint ${batch.fingerprint}; journal ${preview.jobId}`}>{batch.source_label}</h2><Badge value={batch.status} /></div>
            {['icertis','agiloft'].includes(batch.kit) ? <EnterprisePreview state={state} locket={locket} batch={batch} preview={preview} selected={setSelected}/> : <>
            {batch.kit==='ironclad-records'&&<details className="lk-disclosure" open><summary>Reviewed Ironclad mapping</summary><p>Our contracting entity: {state.entities.find(e=>e.id===preview.entityId)?.legal_name??'No entity recorded'}. Entity and custom field definitions are pinned to this review. Changing a mapping produces a new dry run.</p><div className="lk-columns"><div><h3>Record types</h3><dl>{Object.entries(preview.mapping.types).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl></div><div><h3>Properties</h3><dl>{Object.entries(preview.mapping.properties).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{String(v).startsWith('custom:')?state.customFields.find(f=>f.id===String(v).slice(7))?.name??'Custom field unavailable':String(v)}</dd></div>)}</dl></div></div><p>Imported executions retain their history; signature evidence needs human review. No new signature event or certificate is created.</p></details>}
            <div className="lk-dry-run">
              <div className="lk-stats">
                <div><strong>{preview.counts.rows}</strong><span>{batch.kit==='ironclad-records'?'Records in source':'Envelopes in report'}</span></div>
                <div><strong>{preview.counts.import}</strong><span>To import</span></div>
                <div><strong>{batch.kit==='ironclad-records'?preview.rows.filter((r:any)=>r.parentId&&r.outcome==='import').length:preview.counts.withoutCertificate}</strong><span>{batch.kit==='ironclad-records'?'Family links':'Missing certificates'}</span></div>
                <div><strong>{preview.counts.duplicate}</strong><span>Duplicates</span></div>
                <div><strong>{preview.counts.missing}</strong><span>Missing evidence</span></div>
                <div><strong>{preview.counts.skip}</strong><span>Not completed</span></div>
              </div>
            </div>
            {preview.orphans.length > 0 && <p className="lk-warning">Files not in the report (not imported): {preview.orphans.join(', ')}</p>}
            <div className="lk-table-wrap">
              <table className="lk-table">
                <thead><tr><th>{batch.kit==='ironclad-records'?'Source record':'Envelope'}</th><th>Subject</th><th>Counterparty</th><th>Completed</th><th>Files</th><th>Outcome</th></tr></thead>
                <tbody>{preview.rows.map((r: any) => (
                  <tr key={r.row}>
                    <td data-label="Source record">{r.envelopeId ? <EnvelopeId id={r.envelopeId} /> : `Row ${r.row}`}{r.workflowId&&<small>Workflow {r.workflowId}</small>}{r.parentId&&<small>{r.relation} {r.parentId}{r.parentReference&&` (existing ${r.parentReference})`}</small>}</td>
                    <td data-label="Subject">{r.subject}{r.proposedTerms?.length>0&&<details><summary>Proposed terms ({r.proposedTerms.length})</summary><dl>{r.proposedTerms.map((t:any)=><div key={t.key}><dt>{t.key.startsWith('custom:')?state.customFields.find(f=>f.id===t.key.slice(7))?.name??'Custom field':t.key.replaceAll('_',' ')}</dt><dd>{t.value||'Unlimited'}</dd></div>)}</dl></details>}</td>
                    <td data-label="Counterparty">{r.counterparty}{r.counterpartyInferred && <small>inferred</small>}</td>
                    <td data-label="Completed">{day(r.completedOn)}</td>
                    <td data-label="Files">{r.document ? (batch.kit==='ironclad-records'?r.document.path:'Signed PDF') : '—'}{r.certificate ? ' + certificate' : ''}{r.schedules.length ? ` + ${r.schedules.length} more` : ''}</td>
                    <td data-label="Outcome"><Badge value={r.outcome} />{r.notes.map((n: string) => <small key={n}>{n}</small>)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {batch.status === 'previewed' && <button type="button" className="lk-primary" disabled={busy || preview.counts.import === 0} onClick={() => void run('import.apply', { batchId: batch.id, version: batch.version, fingerprint: batch.fingerprint })}>{preview.progress?`Continue reviewed import (${preview.progress.checkpoint}/${preview.progress.total})`:`Apply this dry run (${plural(preview.counts.import, 'agreement')})`}</button>}
            </>}
            {batch.status === 'applied' && <p>Applied {when(batch.applied_at)} by {personName(state, batch.applied_by)}. <button type="button" disabled={busy} onClick={() => { const reason = window.prompt('Why undo this move-in? Agreements used since import keep it from being undone.'); if (reason) { if(batch.kit==='docusign-archive')void run('import.undo', { batchId: batch.id, version: batch.version, reason });else void runImportOperation(locket,'import.undo',batch,{reason}) } }}>{preview.undoing?'Continue undo':'Undo batch'}</button></p>}
            {batch.status === 'undone' && <p>Undone {when(batch.undone_at)} by {personName(state, batch.undone_by)}: {batch.undo_reason}. The journal and original files remain.</p>}
          </section>
        )}
        {!(batch && preview) && <section className="lk-panel"><p className="lk-empty">Run a dry run to see what each record would become before anything is written.</p></section>}
    </div>
  )
}
