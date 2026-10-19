// The version tools around the workspace page: the version chips and Compare
// in the top bar, adding the next version (upload, template or signing PDF),
// the required attachments and submitting for review, and the comment box.
import { ClauseLibrary } from './clause-library'
import { useState } from 'react'
import { fileToPayload, type LocketState, type Row } from './api'
import type { Locket } from './app'
import { Field, Form, Icon, value } from './controls'
import { brief, can, currentVersion, personName, stamp, versionName, versionsOf } from './format'
import { TemplateFields } from './intake'

export const versionHref = (a: Row, number: number) => `#agreement/${a.id}/versions/${number}`

export function VersionChips({ state, a, shown, base, onBase, adding, onAdding }: { state: LocketState; a: Row; shown: Row | null; base: Row | null; onBase: (number: number | null) => void; adding: boolean; onAdding: (open: boolean) => void }) {
  const versions = versionsOf(state, a.id)
  const [comparing, setComparing] = useState(false)
  const addable = can(state, 'owner', 'counsel', 'approver', 'requester') && ['draft', 'in_review', 'approved', 'imported'].includes(a.status)
  return (
    <div className="lk-version-bar">
      <nav className="lk-chips" aria-label="Versions">
        {versions.map(v => (
          <a key={v.id} className={v.id === shown?.id ? 'lk-chip lk-chip-active' : 'lk-chip'} href={versionHref(a, v.number)} aria-current={v.id === shown?.id ? 'page' : undefined} title={`v${v.number} ${versionName(state, v)} · version identity ${v.digest}`}>
            <span><b>v{v.number}</b> {brief(versionName(state, v))}</span>
            <small>{stamp(v.created_at, { zone: a.timezone })}</small>
          </a>
        ))}
      </nav>
      {versions.length > 1 && (
        <div className="lk-compare">
          <button type="button" className="lk-tool" aria-expanded={comparing} onClick={() => setComparing(!comparing)}><Icon name="compare" />Compare</button>
          {comparing && (
            <div className="lk-popover">
              <label>Earlier version<select value={base?.number ?? ''} onChange={e => onBase(e.target.value ? Number(e.target.value) : null)}><option value="">None (clean text)</option>{versions.filter(v => v.number < (shown?.number ?? 0)).map(v => <option key={v.id} value={v.number}>v{v.number} {versionName(state, v)}</option>)}</select></label>
              <label>Later version<select value={shown?.number ?? ''} onChange={e => { window.location.hash = versionHref(a, Number(e.target.value)).slice(1) }}>{versions.map(v => <option key={v.id} value={v.number}>v{v.number} {versionName(state, v)}</option>)}</select></label>
            </div>
          )}
        </div>
      )}
      {addable && <button type="button" className="lk-gradient" aria-expanded={adding} onClick={() => onAdding(!adding)}>Add v{versions.length + 1}</button>}
    </div>
  )
}

export function AddVersion({ state, a, locket, onDone }: { state: LocketState; a: Row; locket: Locket; onDone: () => void }) {
  const { run, busy } = locket
  const v = currentVersion(state, a)
  const files = (versionId: string) => state.artifacts.filter(f => f.version_id === versionId)
  const next = versionsOf(state, a.id).length + 1
  return (
    <section className="lk-panel lk-add-version" aria-label={`Add v${next}`}>
      <div className="lk-panel-head"><h2>Add v{next}</h2><span className="lk-muted">Originals are kept untouched; each version keeps its own file and digest.</span></div>
      {v && <ClauseLibrary state={state} agreement={a} locket={locket} onInserted={onDone} />}
      <div className="lk-add-grid">
        <Form busy={busy} submit="Add version" onSubmit={async (data, form) => {
          const file = data.get('file') as File | null
          if (!file?.size) return locket.setError('Choose the PDF or DOCX for this version.')
          const ok = await run('version.upload', { agreementId: a.id, version: a.version, kind: value(data, 'kind'), label: value(data, 'label') || undefined, text: value(data, 'text') || undefined, file: await fileToPayload(file) })
          if (ok) { form.reset(); onDone() }
        }}>
          <h3>Upload new version</h3>
          <Field label="Document (PDF or DOCX)"><input type="file" name="file" accept=".pdf,.docx" required /></Field>
          <Field label="Whose version"><select name="kind"><option value="upload">Our revision</option><option value="counterparty">Counterparty markup</option></select></Field>
          <Field label="Label"><input name="label" placeholder="e.g. Theirs, with Alicia's markup" /></Field>
          <Field label="Text (optional for PDF)" hint="DOCX text is read automatically. For a PDF, paste its text to allow comparison and cited review."><textarea name="text" rows={3} /></Field>
        </Form>
        <div className="lk-stack">
          {state.templateVersions.some(t => t.status === 'approved') && (
            <details className="lk-disclosure">
              <summary>Generate from an approved template</summary>
              <TemplateVersionForm state={state} busy={busy} onSubmit={payload => run('version.generate', { agreementId: a.id, version: a.version, ...payload })} />
            </details>
          )}
          {v && ['draft', 'in_review', 'approved'].includes(a.status) && !files(v.id).some(f => f.role === 'rendition' || f.media_type === 'application/pdf') && v.kind !== 'template' && (
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
        </div>
      </div>
    </section>
  )
}

/** What must be attached before review, and the way into review once it is. */
export function Attachments({ state, a, locket }: { state: LocketState; a: Row; locket: Locket }) {
  const { run, busy } = locket
  const editor = can(state, 'owner', 'counsel', 'approver', 'requester')
  const open = ['draft', 'in_review', 'approved', 'imported'].includes(a.status)
  const requirements = state.requirements.filter(r => r.agreement_id === a.id)
  return (
    <section className="lk-panel lk-attachments">
      <div className="lk-panel-head"><h2>Required attachments</h2>{a.status === 'draft' && editor && <button type="button" className="lk-primary" disabled={busy} onClick={() => void run('agreement.submit', { agreementId: a.id, version: a.version })}>Submit for review</button>}</div>
      {requirements.length === 0 ? <p className="lk-muted">None required for this request type.</p> : (
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
    </section>
  )
}

/** Comments on the shown version: the ones without a quoted passage, and the box to add one. */
export function Comments({ state, a, shown, locket }: { state: LocketState; a: Row; shown: Row; locket: Locket }) {
  const { run, busy } = locket
  const loose = state.comments.filter(c => c.version_id === shown.id && (!c.quote || !shown.text?.includes(c.quote)))
  return (
    <section className="lk-panel lk-comments-card">
      <div className="lk-panel-head"><h2>Comments</h2><span className="lk-muted">Internal: the counterparty never sees them. A comment that quotes a passage sits beside it.</span></div>
      {loose.length > 0 && <ul className="lk-comments">{loose.map(c => <li key={c.id}><strong>{personName(state, c.author_id)}</strong> on v{shown.number}<small>{stamp(c.at, { zone: a.timezone })}</small>{c.quote && <q>{c.quote}</q>}<p>{c.body}</p></li>)}</ul>}
      {can(state, 'owner', 'counsel', 'approver', 'requester') && (
        <Form busy={busy} submit="Comment" onSubmit={async (data, form) => { if (await run('comment.add', { agreementId: a.id, versionId: shown.id, body: value(data, 'body'), quote: value(data, 'quote') || undefined })) form.reset() }}>
          <Field label="Quoted passage (optional)"><input name="quote" /></Field>
          <Field label={`Comment on v${shown.number}`}><textarea name="body" rows={2} required /></Field>
        </Form>
      )}
    </section>
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
