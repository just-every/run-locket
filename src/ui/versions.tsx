import { useEffect, useState } from 'react'
import { fetchJson, fileToPayload, type LocketState, type Row } from './api'
import type { Locket } from './app'
import { Badge, Empty, Field, Form, Icon, value } from './controls'
import { can, currentVersion, personName, versionsOf, when } from './format'
import { TemplateFields } from './intake'

type Line = { op: 'same' | 'del' | 'add'; text: string }
const fileLabel: Record<string, string> = { rendition: 'Signing PDF', package: 'Signature-ready PDF', manifest: 'Routing manifest' }

export function Versions({ state, a, locket }: { state: LocketState; a: Row; locket: Locket }) {
  const { run, busy } = locket
  const versions = versionsOf(state, a.id), v = currentVersion(state, a)
  const [from, setFrom] = useState(versions.at(-2)?.id ?? '')
  const [to, setTo] = useState(v?.id ?? '')
  const [lines, setLines] = useState<Line[] | null>(null)
  const [compareError, setCompareError] = useState('')
  useEffect(() => {
    setLines(null); setCompareError('')
    if (!from || !to || from === to) return
    fetchJson<{ lines: Line[] }>(`/api/locket/compare?from=${from}&to=${to}`).then(r => setLines(r.lines)).catch(e => setCompareError(e.message))
  }, [from, to])
  const editor = can(state, 'owner', 'counsel', 'approver', 'requester')
  const open = ['draft', 'in_review', 'approved', 'imported'].includes(a.status)
  const requirements = state.requirements.filter(r => r.agreement_id === a.id)
  const files = (versionId: string) => state.artifacts.filter(f => f.version_id === versionId)
  const comments = state.comments.filter(c => c.agreement_id === a.id)
  const shown = to ? versions.find(x => x.id === to) : v
  return (
    <div className="lk-workspace">
      <section className="lk-panel lk-versions">
        <div className="lk-panel-head"><h2>Versions</h2></div>
        {versions.length === 0 && <Empty>No document yet.</Empty>}
        <ol className="lk-version-stack">
          {[...versions].reverse().map(x => (
            <li key={x.id} className={x.id === v?.id ? 'lk-current' : undefined}>
              <strong>v{x.number}</strong>
              <span title={`Version identity ${x.digest}`}>{x.label}<small>{when(x.created_at)} · {personName(state, x.created_by)}</small></span>
              {x.id === v?.id && <Badge value="current" label="Current" />}
              <span className="lk-file-links">{files(x.id).map(f => <a key={f.id} href={`/api/locket/files/${f.id}`} title={f.filename} download>{fileLabel[f.role] ?? f.filename}</a>)}</span>
            </li>
          ))}
        </ol>
        {editor && open && (
          <details className="lk-disclosure" open={versions.length === 0}>
            <summary><Icon name="upload" /> Upload new version</summary>
            <Form busy={busy} submit="Add version" onSubmit={async (data, form) => {
              const file = (data.get('file') as File | null)
              if (!file?.size) return locket.setError('Choose the PDF or DOCX for this version.')
              const ok = await run('version.upload', { agreementId: a.id, version: a.version, kind: value(data, 'kind'), label: value(data, 'label') || undefined, text: value(data, 'text') || undefined, file: await fileToPayload(file) })
              if (ok) form.reset()
            }}>
              <Field label="Document (PDF or DOCX)"><input type="file" name="file" accept=".pdf,.docx" required /></Field>
              <Field label="Whose version"><select name="kind"><option value="upload">Our revision</option><option value="counterparty">Counterparty markup</option></select></Field>
              <Field label="Label"><input name="label" placeholder="e.g. Harbour & Co markup 2" /></Field>
              <Field label="Text (optional for PDF)" hint="DOCX text is read automatically. For a PDF, paste its text to allow comparison and cited review."><textarea name="text" rows={3} /></Field>
            </Form>
          </details>
        )}
        {editor && open && state.templateVersions.some(t => t.status === 'approved') && (
          <details className="lk-disclosure">
            <summary>Generate from an approved template</summary>
            <TemplateVersionForm state={state} busy={busy} onSubmit={payload => run('version.generate', { agreementId: a.id, version: a.version, ...payload })} />
          </details>
        )}
        {editor && v && ['draft', 'in_review', 'approved'].includes(a.status) && !files(v.id).some(f => f.role === 'rendition') && !files(v.id).some(f => f.media_type === 'application/pdf') && v.kind !== 'template' && (
          <details className="lk-disclosure">
            <summary>Attach signing PDF for v{v.number}</summary>
            <Form busy={busy} submit="Attach PDF" onSubmit={async data => {
              const file = data.get('file') as File | null
              if (!file?.size) return locket.setError('Choose the PDF this version will be signed as.')
              await run('version.rendition', { agreementId: a.id, version: a.version, versionId: v.id, file: await fileToPayload(file) })
            }}>
              <p className="lk-muted">A DOCX is signed as a PDF you produce from it, so no formatting is lost in a conversion. Attaching it becomes part of the version and needs approval.</p>
              <Field label="PDF"><input type="file" name="file" accept=".pdf" required /></Field>
            </Form>
          </details>
        )}
      </section>
      <section className="lk-panel lk-compare">
        <div className="lk-panel-head">
          <h2>Compare versions</h2>
          {versions.length > 1 && (
            <div className="lk-compare-pick">
              <select aria-label="Earlier version" value={from} onChange={e => setFrom(e.target.value)}>{versions.map(x => <option key={x.id} value={x.id}>v{x.number}</option>)}</select>
              <span aria-hidden="true">⇄</span>
              <select aria-label="Later version" value={to} onChange={e => setTo(e.target.value)}>{versions.map(x => <option key={x.id} value={x.id}>v{x.number}</option>)}</select>
            </div>
          )}
        </div>
        {compareError && <p className="lk-warning">{compareError}</p>}
        {lines ? (
          <>
            <p className="lk-muted">{lines.filter(l => l.op === 'add').length} insertions · {lines.filter(l => l.op === 'del').length} deletions. Originals are kept untouched.</p>
            <div className="lk-diff">{lines.map((l, i) => <p key={i} className={`lk-diff-${l.op}`}>{l.op === 'add' ? '+ ' : l.op === 'del' ? '− ' : '  '}{l.text || ' '}</p>)}</div>
          </>
        ) : shown?.text ? (
          <div className="lk-document">{shown.text.split('\n').map((p: string, i: number) => <p key={i}>{p || ' '}</p>)}</div>
        ) : <Empty>{versions.length ? 'This version has no text. Supply text or a DOCX to compare and cite passages.' : 'Add a version to see its text.'}</Empty>}
      </section>
      <section className="lk-panel lk-sidecol">
        <div className="lk-panel-head"><h2>Required attachments</h2></div>
        {requirements.length === 0 ? <Empty>None required for this request type.</Empty> : (
          <ul className="lk-checklist">
            {requirements.map(r => (
              <li key={r.id}>
                <span className={r.artifact_id || r.waived_reason ? 'lk-ok' : 'lk-missing'}>{r.artifact_id || r.waived_reason ? '✓' : '!'}</span>
                <span>{r.label}<small>{r.artifact_id ? 'Attached' : r.waived_reason ? `Waived: ${r.waived_reason}` : 'Missing'}</small></span>
                {editor && !r.artifact_id && open && (
                  <label className="lk-button lk-small">Attach<input className="lk-visually-hidden" type="file" onChange={async e => {
                    const file = e.target.files?.[0]
                    if (file) await run('requirement.attach', { agreementId: a.id, requirementId: r.id, file: await fileToPayload(file) })
                  }} /></label>
                )}
                {can(state, 'owner', 'counsel') && !r.artifact_id && !r.waived_reason && open && <button type="button" className="lk-small" disabled={busy} onClick={() => { const reason = window.prompt(`Why can ${r.label} be waived?`); if (reason) void run('requirement.waive', { agreementId: a.id, requirementId: r.id, reason }) }}>Waive</button>}
              </li>
            ))}
          </ul>
        )}
        {editor && open && (
          <Form busy={busy} submit="Add requirement" className="lk-inline" onSubmit={async (data, form) => { if (await run('requirement.add', { agreementId: a.id, label: value(data, 'label') })) form.reset() }}>
            <Field label="Another required attachment"><input name="label" required placeholder="e.g. Pricing schedule" /></Field>
          </Form>
        )}
        {editor && a.status === 'draft' && <button type="button" className="lk-primary lk-wide" disabled={busy} onClick={() => void run('agreement.submit', { agreementId: a.id, version: a.version })}>Submit for review</button>}
        <div className="lk-panel-head"><h2>Comments</h2></div>
        <ul className="lk-comments">{comments.map(c => <li key={c.id}><strong>{personName(state, c.author_id)}</strong> on v{versions.find(x => x.id === c.version_id)?.number}<small>{when(c.at)}</small>{c.quote && <q>{c.quote}</q>}<p>{c.body}</p></li>)}</ul>
        {can(state, 'owner', 'counsel', 'approver', 'requester') && v && (
          <Form busy={busy} submit="Comment" onSubmit={async (data, form) => { if (await run('comment.add', { agreementId: a.id, versionId: to || v.id, body: value(data, 'body'), quote: value(data, 'quote') || undefined })) form.reset() }}>
            <Field label="Quoted passage (optional)"><input name="quote" /></Field>
            <Field label={`Comment on v${(versions.find(x => x.id === to) ?? v).number}`}><textarea name="body" rows={2} required /></Field>
          </Form>
        )}
      </section>
    </div>
  )
}

export function TemplateVersionForm({ state, busy, onSubmit }: { state: LocketState; busy: boolean; onSubmit: (payload: { templateVersionId: string; fields: Record<string, string>; clauseChoices: Record<string, string> }) => Promise<unknown> }) {
  const approved = state.templateVersions.filter(t => t.status === 'approved')
  const [chosen, setChosen] = useState(approved[0]?.id ?? '')
  const template = approved.find(t => t.id === chosen)
  return (
    <Form busy={busy} submit="Generate version" onSubmit={async data => {
      if (!template) return
      const fields: Record<string, string> = {}, clauseChoices: Record<string, string> = {}
      for (const [k, v] of data.entries()) {
        if (k.startsWith('field.')) fields[k.slice(6)] = String(v)
        if (k.startsWith('clause.')) clauseChoices[k.slice(7)] = String(v)
      }
      await onSubmit({ templateVersionId: template.id, fields, clauseChoices })
    }}>
      <Field label="Approved template version"><select value={chosen} onChange={e => setChosen(e.target.value)}>{approved.map(t => <option key={t.id} value={t.id}>{state.templates.find(x => x.id === t.template_id)?.name} v{t.number}</option>)}</select></Field>
      {template && <TemplateFields template={template} />}
    </Form>
  )
}
