import { useState } from 'react'
import type { LocketState } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { typeLabel, personName } from './format'

const usd = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 }).format(amount)
export function ModelSettings({ state, locket }: { state: LocketState; locket: Locket }) {
 const workspace = state.models
 const [agreementId, setAgreementId] = useState(''), [consent, setConsent] = useState(false)
 if (!workspace || state.actor.role !== 'owner') return <p>Only the owner can configure AI and OCR or inspect model records.</p>
 const { settings: s, usage, tasks, outputs } = workspace
 const agreement = state.agreements.find(a => a.id === agreementId)
 const blocked = !s.enabled || !!agreement && s.disabledTypes.includes(agreement.type)
 const request = async (task: string, simulated = false) => { await locket.run('model.run', { agreementId, task, simulated, consent }); setConsent(false) }
 return <div className="lk-tab-page" style={{ overflowWrap: 'anywhere' }}>
  <div className="lk-titlebar"><h1>Settings</h1></div>
  <section className="lk-panel" aria-label="AI and OCR settings"><h2>AI and OCR</h2>
   <p>Credentials stay in the installation secret store. Anthropic and OpenAI use the owner's API key. No task is available until its exact model and prompt pass a live evaluation.</p>
   <Form key={s.version} busy={locket.busy} submit="Save model settings" onSubmit={async d => {
    await locket.run('model.configure', { version: s.version, enabled: d.has('enabled'), provider: value(d, 'provider'), model: value(d, 'model'), disabledTypes: d.getAll('disabledTypes'), ocrProvider: value(d, 'ocrProvider'), noTrainingZeroRetention: d.has('policy'), inputUsdPerMillion: Number(value(d, 'inputRate')), outputUsdPerMillion: Number(value(d, 'outputRate')) })
   }}>
    <label><input type="checkbox" name="enabled" defaultChecked={s.enabled} />Enable AI for this installation</label>
    <Field label="Model provider"><select name="provider" defaultValue={s.provider}><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option><option value="workers-ai">Workers AI</option></select></Field>
    <Field label="Exact model"><input name="model" required maxLength={120} defaultValue={s.model} /></Field>
    <label><input type="checkbox" name="policy" defaultChecked={s.noTrainingZeroRetention} />My provider agreement prohibits training and retains no input or output</label>
    <fieldset style={{ minWidth: 0, display: 'grid', gap: 8 }}><legend>Switch AI off by agreement type</legend>{Object.entries(typeLabel).map(([id, label]) => <label key={id}><input type="checkbox" name="disabledTypes" value={id} defaultChecked={s.disabledTypes.includes(id)} />Disable AI for {label}</label>)}</fieldset>
    <Field label="OCR provider"><select name="ocrProvider" defaultValue={s.ocrProvider}><option value="none">Off</option><option value="textract">Amazon Textract</option><option value="document-ai">Google Document AI</option><option value="document-intelligence">Azure Document Intelligence</option></select></Field>
    <Field label="Input estimate (USD per million tokens)"><input name="inputRate" type="number" min="0" max="100000" step="0.000001" defaultValue={s.inputUsdPerMillion} required /></Field>
    <Field label="Output estimate (USD per million tokens)"><input name="outputRate" type="number" min="0" max="100000" step="0.000001" defaultValue={s.outputUsdPerMillion} required /></Field>
   </Form>
  </section>
  <section className="lk-panel" aria-label="Live model evaluations"><h2>Live evaluations</h2><p>{s.provider} · {s.model || 'No model selected'}</p>
   {tasks.map(t => <p key={t.task}><strong>{t.task}</strong>: {t.status}{t.latest ? ` · ${t.latest.receipt}` : ' · No passing REVIEW-006 live record'}</p>)}
   <p>OCR choice: {s.ocrProvider}. OCR remains unavailable until its chosen provider passes REVIEW-006.</p>
  </section>
  <section className="lk-panel" aria-label="Monthly model usage"><h2>Monthly usage · {usage.month} UTC</h2>
   <p>Live estimated cost: <strong>{usd(usage.estimatedUsd)} USD</strong></p>
   {workspace.simulationAvailable && <p>Simulated estimated cost: <strong>{usd(usage.simulatedEstimatedUsd)} USD</strong></p>}
   <p>{usage.inputTokens.toLocaleString()} input tokens · {usage.outputTokens.toLocaleString()} output tokens</p>
   {!!usage.unpriced && <p>{usage.unpriced} requests have unknown usage. These are excluded from the estimate.</p>}
  </section>
  <section className="lk-panel" aria-label="Model requests"><h2>Model requests</h2>
   <Field label="Agreement for model request"><select value={agreementId} onChange={e => { setAgreementId(e.target.value); setConsent(false) }}><option value="">Choose an agreement</option>{state.agreements.filter(a => a.current_version_id).map(a => <option value={a.id} key={a.id}>{a.title}</option>)}</select></Field>
   {blocked && <p>AI is switched off for this installation or agreement type.</p>}
   <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />I approve sending this version and its playbook for this request</label>
   <div className="lk-form-actions" style={{ flexWrap: 'wrap' }}>{['review', 'extraction', 'summaries'].map(task => <button key={task} type="button" disabled={locket.busy || !agreementId || !consent || blocked || !tasks.find(t => t.task === task)?.available} onClick={() => request(task)}>Run evaluated {task}</button>)}</div>
   {workspace.simulationAvailable && <><p>Provider simulations exercise records and estimates. They are never live evaluations and cannot activate a real task.</p><div className="lk-form-actions" style={{ flexWrap: 'wrap' }}>{['review', 'extraction', 'summaries'].map(task => <button key={task} type="button" disabled={locket.busy || !agreementId || !consent} onClick={() => request(task, true)}>Simulate {task}</button>)}</div></>}
  </section>
  <section className="lk-panel" aria-label="Model output records"><h2>Output records</h2>{!outputs.length && <p>No model outputs recorded.</p>}
   {outputs.map(r => <article key={r.id} aria-label={`${r.task} output record`} style={{ marginBlock: 24 }}><h3>{r.task} · {r.simulated ? 'Provider simulation' : 'Live provider'} · {r.status}</h3>
    <p>{state.agreements.find(a => a.id === r.agreement_id)?.title}</p>
    <dl><dt>Provider and model</dt><dd>{r.provider} · {r.model}</dd><dt>Prompt version (SHA-256)</dt><dd>{r.prompt_version}</dd><dt>Playbook version</dt><dd>{r.playbook_version}</dd><dt>Input document digests</dt><dd><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(JSON.parse(r.input_digests), null, 2)}</pre></dd><dt>Accepted by</dt><dd>{r.accepted_by ? personName(state, r.accepted_by) : 'Not accepted'}</dd><dt>Estimated cost</dt><dd>{r.estimated_usd_micros === null ? 'Unknown' : `${usd(r.estimated_usd_micros / 1000000)} USD`}</dd></dl>
    {r.content && JSON.parse(r.content).proposals.map((p: any, i: number) => <div key={i}><strong>{p.key}: {p.value}</strong><blockquote>{p.quote}</blockquote></div>)}
    {r.status === 'proposed' && <button type="button" disabled={locket.busy} onClick={() => locket.run('model.accept', { outputId: r.id })}>Accept {r.task} proposal record</button>}
    <p>Acceptance retains this proposal and its accepting person. Terms, findings and deadlines require their own reviewed native commands.</p>
   </article>)}
  </section>
 </div>
}
