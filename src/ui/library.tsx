import { useState } from 'react'
import { ClauseLibrary } from './clause-library'
import type { LocketState } from './api'
import type { Locket } from './app'
import { Badge, Empty, Field, Form, value } from './controls'
import { can, parse, personName, typeLabel, when } from './format'

/** "name | Label" per line; a trailing "| optional" makes a field optional. */
function fieldsFrom(textValue: string) {
  return textValue.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [name, label, flag] = l.split('|').map(s => s.trim())
    return { name, label: label || name, required: flag !== 'optional' }
  })
}
/** Blocks separated by a blank line: "key | Title", then "variant | Label | wording" lines. */
function clausesFrom(textValue: string) {
  return textValue.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).map(block => {
    const [head, ...lines] = block.split('\n')
    const [key, title] = head.split('|').map(s => s.trim())
    const notes = lines.find(l => l.startsWith('Notes:'))?.slice(6).trim() ?? ''
    const ruleKey = lines.find(l => l.startsWith('Rule:'))?.slice(5).trim() || key
    return { key, title: title || key, notes, ruleKey, variants: lines.filter(l => !/^(Notes:|Rule:|Notes\[)/.test(l)).map(l => { const [id, label, ...rest] = l.split('|').map(s => s.trim()); return { id, label, text: rest.join(' | '), notes: lines.find(n => n.startsWith(`Notes[${id}]:`))?.split(']:').slice(1).join(']:').trim() ?? '' } }) }
  })
}
/** Blocks: "key | Title | counsel or approver", "Preferred: …", "Alternative: …", "Guidance: …". */
function rulesFrom(textValue: string) {
  return textValue.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).map(block => {
    const [head, ...lines] = block.split('\n').map(s => s.trim())
    const [key, title, authority] = head.split('|').map(s => s.trim())
    const pick = (prefix: string) => lines.filter(l => l.toLowerCase().startsWith(prefix)).map(l => l.slice(prefix.length).trim())
    return { key, title: title || key, authority: authority || 'counsel', preferred: pick('preferred:')[0] ?? '', alternatives: pick('alternative:'), guidance: pick('guidance:').join(' ') }
  })
}

export function Library({ state, locket }: { state: LocketState; locket: Locket }) {
  const { run, busy } = locket
  const [selected, setSelected] = useState(state.templates[0]?.id ?? '')
  const editor = can(state, 'owner', 'counsel')
  const template = state.templates.find(t => t.id === selected)
  const versions = state.templateVersions.filter(v => v.template_id === selected).sort((a, b) => b.number - a.number)
  const playbooks = [...state.playbooks].sort((a, b) => b.number - a.number)
  const active = playbooks.find(p => p.status === 'active')
  const save = (data: FormData, extra: object) => ({ body: value(data, 'body'), fields: fieldsFrom(value(data, 'fields')), clauses: clausesFrom(value(data, 'clauses')), ...extra })
  return (
    <div className="lk-library">
      <div className="lk-titlebar"><div><h1>Library</h1><p><a href="#clickwrap">Published terms and clickwrap acceptance</a></p><p className="lk-muted">Owner- and counsel-approved templates and the clause playbook reviews are measured against.</p></div></div>
      <ClauseLibrary state={state} />
      <div className="lk-library-grid">
        <div className="lk-stack">
        <section className="lk-panel">
          <div className="lk-panel-head"><h2>Agreement templates</h2></div>
          {state.templates.length === 0 ? <Empty>No templates yet.</Empty> : (
            <ul className="lk-shelf">{state.templates.map(t => {
              const latest = state.templateVersions.filter(v => v.template_id === t.id).sort((a, b) => b.number - a.number)[0]
              return <li key={t.id}><button type="button" className={t.id === selected ? 'lk-selected' : undefined} aria-pressed={t.id === selected} onClick={() => setSelected(t.id)}><span className="lk-shelf-page" aria-hidden="true">{(latest?.body ?? '').split('\n').slice(0, 6).map((l: string, i: number) => <span key={i} style={{ width: `${Math.min(100, 28 + l.length)}%` }} />)}</span><strong>{t.name}</strong><small>{typeLabel[t.type]} · v{latest?.number}</small>{latest && <Badge value={latest.status} />}</button></li>
            })}</ul>
          )}
          {editor && (
            <details className="lk-disclosure" open={state.templates.length === 0}>
              <summary>New template</summary>
              <Form busy={busy} submit="Save draft v1" onSubmit={async (data, form) => { const r = await run('template.create', save(data, { name: value(data, 'name'), type: value(data, 'type') })); if (r) { setSelected(r.id); form.reset() } }}>
                <Field label="Name"><input name="name" required /></Field>
                <Field label="Type"><select name="type">{Object.entries(typeLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                <TemplateInputs />
              </Form>
            </details>
          )}
        </section>
        <section className="lk-panel">
          {!template ? <Empty>Choose a template.</Empty> : (
            <>
              <div className="lk-panel-head"><h2>{template.name}</h2><span className="lk-muted">{typeLabel[template.type]}</span></div>
              {versions.map(v => (
                <article key={v.id} className="lk-card">
                  <div className="lk-finding-head"><strong>v{v.number}</strong><Badge value={v.status} /><small>{v.approved_by ? `Approved by ${personName(state, v.approved_by)} ${when(v.approved_at)}` : `Drafted by ${personName(state, v.created_by)} ${when(v.created_at)}`}</small></div>
                  <details><summary>Body and fields</summary>
                    <pre className="lk-document">{v.body}</pre>
                    <p className="lk-muted">Fields: {parse<any[]>(v.fields).map(f => f.label).join(', ') || 'none'}</p>
                    <ul className="lk-rules">{parse<any[]>(v.clauses).map(c => <li key={c.key}><strong>{c.title}</strong>{c.variants.map((x: any) => <p key={x.id}><em>{x.label}:</em> {x.text}</p>)}</li>)}</ul>
                  </details>
                  {editor && v.status === 'draft' && <button type="button" className="lk-primary lk-small" disabled={busy} onClick={() => void run('template.decide', { versionId: v.id, decision: 'approve' })}>Approve v{v.number} for use</button>}
                  {editor && v.status === 'approved' && <button type="button" className="lk-small" disabled={busy} onClick={() => void run('template.decide', { versionId: v.id, decision: 'retire' })}>Retire</button>}
                </article>
              ))}
              {editor && (
                <details className="lk-disclosure">
                  <summary>Draft a new version</summary>
                  <Form busy={busy} submit="Save draft" onSubmit={async (data, form) => { if (await run('template.revise', save(data, { templateId: template.id }))) form.reset() }}>
                    <TemplateInputs from={versions[0]} />
                  </Form>
                </details>
              )}
            </>
          )}
        </section>
        </div>
        <section className="lk-panel lk-playbook-page">
          <div className="lk-panel-head"><h2>Clause playbook</h2>{active && <Badge value="approved" label={`v${active.number} active`} />}</div>
          {active ? <ol className="lk-rules lk-playbook">{parse<any[]>(active.rules).map(r => <li key={r.key}><span className="lk-rule-key">{r.key}</span><div><strong>{r.title}</strong><p>{r.preferred}</p>{r.alternatives.length > 0 && <small>Alternatives: {r.alternatives.join(' / ')}</small>}<small>Review authority: {r.authority}</small></div></li>)}</ol> : <Empty>No active playbook. Reviews need one.</Empty>}
          {playbooks.filter(p => p.status === 'draft').map(p => (
            <article key={p.id} className="lk-card"><div className="lk-finding-head"><strong>Draft v{p.number}</strong><Badge value="draft" /></div><p className="lk-muted">{parse<any[]>(p.rules).map(r => r.title).join(', ')}</p>{editor && <button type="button" className="lk-primary lk-small" disabled={busy} onClick={() => void run('playbook.activate', { id: p.id })}>Activate v{p.number}</button>}</article>
          ))}
          {editor && (
            <details className="lk-disclosure">
              <summary>Draft a playbook version</summary>
              <Form busy={busy} submit="Save playbook draft" onSubmit={async (data, form) => { if (await run('playbook.draft', { rules: rulesFrom(value(data, 'rules')) })) form.reset() }}>
                <Field label="Rules" hint="One block per clause: “key | Title | counsel” then Preferred:, Alternative: and Guidance: lines.">
                  <textarea name="rules" rows={10} required defaultValue={active ? parse<any[]>(active.rules).map(r => [`${r.key} | ${r.title} | ${r.authority}`, `Preferred: ${r.preferred}`, ...r.alternatives.map((x: string) => `Alternative: ${x}`), r.guidance ? `Guidance: ${r.guidance}` : ''].filter(Boolean).join('\n')).join('\n\n') : ''} />
                </Field>
              </Form>
            </details>
          )}
        </section>
      </div>
    </div>
  )
}

function TemplateInputs({ from }: { from?: any }) {
  const fields = from ? parse<any[]>(from.fields).map(f => `${f.name} | ${f.label}${f.required ? '' : ' | optional'}`).join('\n') : ''
  const clauses = from ? parse<any[]>(from.clauses).map(c => [`${c.key} | ${c.title}`, c.notes ? `Notes: ${c.notes}` : '', c.ruleKey ? `Rule: ${c.ruleKey}` : '', ...c.variants.flatMap((v: any) => [`${v.id} | ${v.label} | ${v.text}`, v.notes ? `Notes[${v.id}]: ${v.notes}` : ''])].filter(Boolean).join('\n')).join('\n\n') : ''
  return (
    <>
      <Field label="Body" hint="Use {{field}} for filled values, {{counterparty}} and {{title}} are filled for you, and [[clause:key]] to place a clause."><textarea name="body" rows={8} required defaultValue={from?.body ?? ''} /></Field>
      <Field label="Fields" hint="One per line: name | Label (add | optional when not required)."><textarea name="fields" rows={3} defaultValue={fields} /></Field>
      <Field label="Clauses" hint="Blank line between clauses: key | Title, then variant | Label | wording. Use preferred, fallback1, fallback2 and walk-away identities. Add Notes: usage guidance, Rule: playbook key, or Notes[variant]: wording guidance."><textarea name="clauses" rows={5} defaultValue={clauses} /></Field>
    </>
  )
}
