import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Badge, Empty, Field, Form, value } from './controls'
import { can, parse, personName, typeLabel } from './format'

/** A source-led counsel workbench using the shared Library controls. */
export function PlaybookDrafting({ state, locket }: { state: LocketState; locket: Locket }) {
 const workspace = state.playbookDrafting
 if (!can(state, 'counsel') || !workspace) return null
 const approved = state.templateVersions.filter(t => t.status === 'approved')
 return <section className="lk-panel lk-drafting" aria-label="Playbooks from templates and history">
  <div className="lk-panel-head"><h2>Playbooks from templates and history</h2><Badge value="draft" label="Counsel review" /></div>
  <p>Draft preferred positions from approved templates and fallbacks from signed deals. Review each proposal, then approve a new playbook for the future scope you choose.</p>
  <p className="lk-muted">{workspace.provider} · {workspace.model || 'No model configured'} · Playbook drafting: {workspace.evaluated ? 'live evaluation passed' : 'not evaluated'}. {workspace.enabled ? '' : 'AI is switched off.'}</p>
  <details className="lk-disclosure"><summary>Choose sources and draft rules</summary>
   <Form busy={locket.busy || !workspace.enabled || !workspace.evaluated && !workspace.simulationAvailable} submit={workspace.evaluated ? 'Draft evaluated playbook rules' : 'Draft simulated playbook rules'} onSubmit={async data => {
    await locket.run('playbook.generate', { templateVersionIds: data.getAll('templateVersionIds'), agreementIds: data.getAll('agreementIds'), scope: { agreementTypes: data.getAll('draftAgreementTypes'), entityIds: data.getAll('draftEntityIds').filter(Boolean) }, consent: data.get('consent') === 'on', simulated: !workspace.evaluated })
   }}>
    <fieldset className="lk-fieldset"><legend>Approved template versions</legend>
     {approved.length ? approved.map(v => <label className="lk-check" key={v.id}><input type="checkbox" name="templateVersionIds" value={v.id} /> {state.templates.find(t => t.id === v.template_id)?.name} · v{v.number}</label>) : <Empty>Approve a template in the Library first.</Empty>}
    </fieldset>
    <fieldset className="lk-fieldset"><legend>Executed agreement sources (up to 40)</legend>
     {state.agreements.filter(a => a.status === 'executed').map(a => <label className="lk-check" key={a.id}><input type="checkbox" name="agreementIds" value={a.id} /> {a.title}</label>)}
     <small>Only the retained signed pages of the current exact executed version are sent. Unreadable pages require a readable signed original.</small>
    </fieldset>
    <fieldset className="lk-fieldset"><legend>Agreement types for future playbook use</legend>{Object.entries(typeLabel).map(([key, label]) => <label className="lk-check" key={key}><input type="checkbox" name="draftAgreementTypes" value={key} /> {label}</label>)}</fieldset>
    <Field label="Entities for future playbook use" hint="Explicitly choose every entity, or select named entities. Sources must belong to this scope."><select name="draftEntityIds" multiple defaultValue={['']}><option value="">Every entity</option>{state.entities.map(e => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</select></Field>
    <label className="lk-check"><input type="checkbox" name="consent" required /> I approve sending these selected templates and signed pages to the displayed model for this request.</label>
    {!workspace.evaluated && <p>Live drafting is unavailable until this exact provider, model and prompt pass REVIEW-006. {workspace.simulationAvailable ? 'This installation permits labelled network-edge simulations for local proof.' : 'Ask the owner to configure an evaluated model in Settings.'}</p>}
    {(!workspace.enabled || !workspace.evaluated && !workspace.simulationAvailable) && <p role="note">Drafting is unavailable under the current model settings.</p>}
   </Form>
  </details>
  {workspace.drafts.length === 0 && <Empty>No drafted playbooks yet.</Empty>}
  {workspace.drafts.map(d => <Draft key={d.id} draft={d} state={state} locket={locket} />)}
 </section>
}
function Draft({ draft: d, state, locket }: { draft: Row; state: LocketState; locket: Locket }) {
 const rules = parse<any[]>(d.proposals), sources = parse<any[]>(d.sources), scope = parse<any>(d.scope)
 const counts = (decision: string) => rules.filter(r => r.decision === decision).length
 return <article className="lk-card" aria-label={`Drafted playbook ${d.id}`}>
  <div className="lk-finding-head"><h3>Drafted rules</h3><Badge value={d.status} label={d.status} /></div>
  <p>{d.simulated ? 'Provider simulation' : 'Evaluated live provider'} · {d.provider} · {d.model}</p>
  <p>{sources.filter(s => s.kind === 'template').length} approved templates · {sources.filter(s => s.kind === 'agreement').length} executed agreements</p>
  <p>Future scope: {scope.agreementTypes.map((t: string) => typeLabel[t]).join(', ')} · {scope.entityIds.length ? scope.entityIds.map((id: string) => state.entities.find(e => e.id === id)?.legal_name ?? id).join(', ') : 'Every entity'}.</p>
  <p className="lk-muted">Signed history shows wording used in executed deals. Counterparty negotiation outcomes, later issues and cycle-time savings remain unknown unless separately recorded. Earlier findings, approvals and signed originals retain their versions.</p>
  <details><summary>Source custody and model record</summary><p>Prompt SHA-256: <code>{d.prompt_version}</code></p><p>Input SHA-256: <code>{d.source_digest}</code></p><p>Source playbook: {d.source_playbook_id ?? 'None'}. Requested by {personName(state, d.requested_by)}.</p>
   <ul className="lk-rules">{sources.map(s => <li key={s.id}><strong>{s.title} · v{s.number}</strong><p>{s.kind} · digest <code>{s.digest}</code></p>{s.facts.artifactId && <a href={`/api/locket/files/${s.facts.artifactId}`} target="_blank" rel="noreferrer">{s.kind === 'agreement' ? 'Open retained signed original' : 'Open approved Word source'}</a>}</li>)}</ul>
  </details>
  {d.status === 'uncertain' && <p role="status">Provider outcome is uncertain. This request will never be sent again automatically. Review the source record before authorizing a separate request.</p>}
  {d.status === 'failed' && <p role="alert">Drafting failed ({d.failure}). No rules were applied. Correct the source or provider problem before making a separate request.</p>}
  {rules.length > 0 && <p aria-label="Rule decision totals">{counts('accept')} accepted · {counts('edit')} edited · {counts('reject')} rejected · {counts('pending')} pending</p>}
  {rules.map(r => <Rule key={r.proposed.key} rule={r} draft={d} locket={locket} />)}
  {d.status === 'proposed' && <Form busy={locket.busy} submit="Approve new scoped playbook version" onSubmit={async data => { await locket.run('playbook.generation.approve', { draftId: d.id, revision: d.revision, scope, reason: value(data, 'approvalReason'), consent: data.get('publishConsent') === 'on' }) }}>
   <label className="lk-check"><input type="checkbox" name="publishConsent" required /> I reviewed every rule and its evidence, and approve publishing the accepted and edited wording to the shared playbook for this exact future scope.</label>
   <Field label="Playbook approval reason"><textarea name="approvalReason" required /></Field>
   <p>Approval activates a new immutable version. All rules need a decision first; rejected rules are excluded.</p>
  </Form>}
  {d.status === 'approved' && <p>Approved by {personName(state, d.approved_by)} as playbook v{state.playbooks.find(p => p.id === d.new_playbook_id)?.number}. {d.reason}</p>}
 </article>
}
function Rule({ rule: r, draft: d, locket }: { rule: any; draft: Row; locket: Locket }) {
 const effective = r.effective ?? r.proposed
 return <article className="lk-card" aria-label={`Proposed rule ${r.proposed.key}`}>
  <div className="lk-finding-head"><h4>{r.proposed.title}</h4><Badge value={r.decision} label={r.decision} /></div>
  <p><strong>Preferred:</strong> {effective.preferred}</p>
  <p><strong>Fallbacks:</strong> {effective.alternatives.join(' / ') || 'None supported'}</p>
  <p>Suggested exception authority: {effective.authority}. {effective.guidance}</p>
  {r.decision === 'edit' && <details><summary>Original model proposal</summary><p>{r.proposed.preferred}</p><p>{r.proposed.alternatives.join(' / ')}</p><p>{r.proposed.authority} · {r.proposed.guidance}</p></details>}
  <details><summary>Exact source citations ({r.citations.length})</summary>
   {r.citations.map((c: any, i: number) => <div key={i}><strong>{c.title} · v{c.version}{c.page ? ` · signed page ${c.page}` : ' · approved template'}</strong><p>{c.position}{c.alternativeIndex !== null ? ` ${c.alternativeIndex + 1}` : ''} · characters {c.start}–{c.end}</p><blockquote>{c.quote}</blockquote>{c.artifactId && <a href={`/api/locket/files/${c.artifactId}`} target="_blank" rel="noreferrer">{c.kind === 'agreement' ? 'Open cited signed original' : 'Open cited Word source'}</a>}<p>Exact source digest: <code>{c.artifactDigest ?? c.digest}</code></p></div>)}
   <p>Citations retain the original model evidence. Counsel edits are attributed changes, not new observations of signed wording.</p>
  </details>
  {d.status === 'proposed' && <details><summary>Review {r.proposed.title}</summary>
   <Form busy={locket.busy} submit={`Save ${r.proposed.title} decision`} onSubmit={async data => { await locket.run('playbook.generation.decide', { draftId: d.id, revision: d.revision, ruleKey: r.proposed.key, decision: value(data, 'decision'), reason: value(data, 'reason'), rule: { ...r.proposed, title: value(data, 'title'), preferred: value(data, 'preferred'), alternatives: value(data, 'alternatives').split('\n').map(s => s.trim()).filter(Boolean), authority: value(data, 'authority'), guidance: value(data, 'guidance') } }) }}>
    <Field label="Rule decision"><select name="decision" defaultValue={r.decision === 'pending' ? 'accept' : r.decision}><option value="accept">Accept original model proposal</option><option value="edit">Accept with counsel edits below</option><option value="reject">Reject this rule</option></select></Field>
    <Field label="Rule title"><input name="title" defaultValue={effective.title} required /></Field>
    <Field label="Preferred position"><textarea name="preferred" defaultValue={effective.preferred} required /></Field>
    <Field label="Fallback positions" hint="One per line. Edits are counsel wording; retained citations show the original signed evidence."><textarea name="alternatives" defaultValue={effective.alternatives.join('\n')} /></Field>
    <Field label="Exception authority"><select name="authority" defaultValue={effective.authority}><option value="counsel">Counsel</option><option value="approver">Approver</option></select></Field>
    <Field label="Guidance"><textarea name="guidance" defaultValue={effective.guidance} /></Field>
    <Field label="Rule decision reason"><textarea name="reason" defaultValue={r.reason ?? ''} required /></Field>
   </Form>
  </details>}
  {r.history?.length > 1 && <details><summary>Rule decision history</summary>{r.history.map((h: any, i: number) => <p key={i}>{h.decision} · {h.reason}{h.effective ? ` · ${h.effective.preferred}` : ''}</p>)}</details>}
  {r.decidedBy && <p>Decision retained: {r.decision}. {r.reason}</p>}
 </article>
}
