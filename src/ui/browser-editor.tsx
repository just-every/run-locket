import type { Locket } from './app'
import type { Row } from './api'
import { Field, Form } from './controls'

export function BrowserEditor({ a, version, locket, onDone }: { a: Row; version: Row; locket: Locket; onDone: () => void }) {
  if (version.text === null) return null
  return <details className="lk-disclosure"><summary>Edit document text in the browser</summary>
    <p className="lk-muted">Save a new text PDF with attributed tracked changes. The original document and its formatting remain in the earlier version. Review the new PDF before signing.</p>
    <Form key={version.id} busy={locket.busy} submit="Save browser revision" onSubmit={async data => {
      const saved = await locket.run('version.edit', { agreementId: a.id, version: a.version, versionId: version.id, text: String(data.get('documentText') ?? '') })
      if (saved) { window.location.hash = `agreement/${a.id}/versions/${saved.number}`; onDone() }
    }}>
      <Field label={`Edit v${version.number} text`}><textarea name="documentText" defaultValue={version.text} rows={12} required /></Field>
    </Form>
  </details>
}
