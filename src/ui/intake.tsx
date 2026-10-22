import { blankLine, PricingLines, type PricingLine } from './pricing-lines'
import { evaluateForm } from '../locket/intake-form-definition'
import { IntakeFormFields, formVisibleFields, readIntakeFormAnswers, type IntakeAnswers } from './intake-form-fields'
import { useState } from 'react'
import { fileToPayload, type LocketState, type Row } from './api'
import type { Locket } from './app'
import { Field, Form, Icon, value } from './controls'
import { can, parse, typeLabel } from './format'
import { EntitySelect } from './entities'
import { CustomFieldInputs, customFieldsFor, readCustomValues } from './custom-field-values'
import { zones } from './preferences'
import { defaultRequirements as defaults } from '../locket/us-defaults'

export function TemplateFields({ template, entityId = null }: { template: Row; entityId?: string | null }) {
  const fields = parse<{ name: string; label: string; required: boolean }[]>(template.fields)
  const clauses = parse<{ key: string; title: string; variants: { id: string; label: string; entityId?: string | null }[] }[]>(template.clauses).map(c => ({ ...c, variants: c.variants.filter(v => !v.entityId || v.entityId === entityId) }))
  return (
    <>
      {fields.map(f => <Field key={f.name} label={`${f.label}${f.required ? ' *' : ''}`}><input name={`field.${f.name}`} required={f.required} /></Field>)}
      {clauses.map(c => <Field key={c.key} label={`${c.title} wording`}><select name={`clause.${c.key}`}>{c.variants.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select></Field>)}
    </>
  )
}

function PartyField({ state }: { state: LocketState }) {
  const [mode, setMode] = useState(state.parties.length ? 'existing' : 'new')
  return (
    <fieldset className="lk-fieldset">
      <legend>Counterparty</legend>
      <div className="lk-segmented">
        <label><input type="radio" name="partyMode" value="existing" checked={mode === 'existing'} disabled={!state.parties.length} onChange={() => setMode('existing')} /> Existing</label>
        <label><input type="radio" name="partyMode" value="new" checked={mode === 'new'} onChange={() => setMode('new')} /> New</label>
      </div>
      {mode === 'existing' ? (
        <Field label="Counterparty"><select name="partyId">{state.parties.filter(p => !p.merged_into).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      ) : (
        <div className="lk-grid2">
          <Field label="Name"><input name="partyName" required /></Field>
          <Field label="Kind"><select name="partyKind"><option value="customer">Customer</option><option value="supplier">Supplier</option><option value="partner">Partner</option><option value="other">Other</option></select></Field>
          <Field label="EIN" hint="Nine digits written 12-3456789; leave blank if not supplied."><input name="partyEin" inputMode="numeric" pattern="\d{2}-\d{7}" /></Field>
        </div>
      )}
    </fieldset>
  )
}
const party = (data: FormData) => (value(data, 'partyMode') === 'existing' ? { partyId: value(data, 'partyId') } : { party: { name: value(data, 'partyName'), kind: value(data, 'partyKind'), ...(value(data, 'partyEin') ? { taxIdKind: 'ein', taxId: value(data, 'partyEin') } : {}) } })

export function Intake({ state, locket }: { state: LocketState; locket: Locket }) {
  const { run, busy } = locket
  const [type, setType] = useState('customer')
  const [source, setSource] = useState('template')
  const [lineItems,setLineItems]=useState<PricingLine[]>([blankLine()])
  const [formId, setFormId] = useState('')
  const [answers, setAnswers] = useState<IntakeAnswers>({})
  const [requestValue, setRequestValue] = useState('')
  const [usdRate, setUsdRate] = useState('')
  const forms = state.intakeForms.filter(f=>f.published && f.canLaunch)
  const form = forms.find(f=>f.id===formId)?.published
  const [entityId, setEntityId] = useState(state.entities[0]?.id ?? '')
  const [currency, setCurrency] = useState('USD')
  const dollarValue = currency === 'USD' ? requestValue : requestValue && usdRate ? (Number(requestValue)*Number(usdRate)).toFixed(2) : ''
  const formAnswers = {...answers,value:dollarValue}
  const visibleFields = form ? formVisibleFields(form.definition, formAnswers) : []
  const route = form ? evaluateForm(form.definition, formAnswers, dollarValue || null) : null
  const availableTypes = Object.entries(typeLabel).filter(([key])=> form ? key===form.definition.type : !state.intakeFormTypes.includes(key))
  const requestType = form?.definition.type ?? (availableTypes.some(([key])=>key===type) ? type : availableTypes[0]?.[0] ?? '')
  // US-001: the entity's zone, else the installation's; the request may name another.
  const inherited = state.entities.find(e => e.id === entityId)?.timezone ?? state.settings.timezone
  const [chosenZone, setZone] = useState<string | null>(null)
  const zone = chosenZone ?? inherited
  const zoneOptions = zones.some(z => z[0] === inherited) ? zones : [...zones, [inherited, inherited] as [string, string]]
  // Templates limited to another of our entities are not offered (ENTITY-001).
  const approved = state.templateVersions.filter(t => t.status === 'approved' && [null, undefined, entityId].includes(state.templates.find(x => x.id === t.template_id)?.entity_id))
  const [chosenTemplate, setTemplateId] = useState(approved[0]?.id ?? '')
  const templateId = approved.some(t => t.id === chosenTemplate) ? chosenTemplate : approved[0]?.id ?? ''
  const template = approved.find(t => t.id === templateId)
  const word=state.wordTemplates.find(w=>w.id===templateId)
  const people = state.operators.filter(o => o.status === 'active')
  if (!can(state, 'owner', 'counsel', 'approver', 'requester')) return <p className="lk-empty">Your role cannot create requests.</p>
  return (
    <div className="lk-intake">
      <a className="lk-back" href="#agreements"><Icon name="back" />Back to agreements</a>
      <div className="lk-titlebar"><div><h1>New agreement request</h1><p className="lk-muted">Capture the deal, choose an approved template or attach the draft, and list what must be attached before review.</p></div></div>
      {forms.length>0 && <section className="lk-panel"><Field label="Request form"><select value={formId} onChange={e=>{setFormId(e.target.value);setAnswers({});setCurrency('USD')}}><option value="">Standard request</option>{forms.map(f=><option key={f.id} value={f.id}>{f.published!.definition.name} · v{f.published!.number}</option>)}</select></Field></section>}
      {!requestType ? <p className="lk-empty">No request forms are available to your current role or memberships.</p> : <Form busy={busy} submit="Create request" className="lk-intake-form" onSubmit={async data => {
        const file = data.get('file') as File | null
        const fields: Record<string, string> = {}, clauseChoices: Record<string, string> = {}
        for (const [k, v] of data.entries()) {
          if (k.startsWith('field.')) fields[k.slice(6)] = String(v)
          if (k.startsWith('clause.')) clauseChoices[k.slice(7)] = String(v)
        }
        const result = await run('request.create', {
          title: value(data, 'title'), type: requestType, ...(form ? {formVersionId:form.id,formAnswers:await readIntakeFormAnswers(formAnswers,visibleFields)} : {}), customValues: readCustomValues(data, customFieldsFor(state, requestType)), ...party(data), ...(entityId ? { entityId } : {}), value: value(data, 'value') || undefined, currency, ...(currency !== 'USD' ? { usdRate: value(data, 'usdRate') } : {}), timezone: zone, ownerId: value(data, 'ownerId'),
          neededBy: value(data, 'neededBy') || undefined, startDate: value(data, 'startDate') || undefined, restricted: data.get('restricted') === 'on',
          parentId: value(data, 'parentId') || undefined, requirements: value(data, 'requirements').split('\n').map(s => s.trim()).filter(Boolean),
          ...(source === 'template' && template ? { templateVersionId: template.id, fields, clauseChoices,...(word?.pricing?{lineItems}:{}) } : {}),
          ...(source === 'file' && file?.size ? { file: await fileToPayload(file), text: value(data, 'text') || undefined } : {}),
        })
        if (result) window.location.hash = `agreement/${result.id}`
      }}>
        <div className="lk-intake-grid">
          <section className="lk-panel">
            <div className="lk-panel-head"><h2>Request details</h2></div>
            <Field label="Agreement title *"><input name="title" required /></Field>
            <div className="lk-grid2">
              <Field label="Request type *"><select value={requestType} disabled={!!form} onChange={e => setType(e.target.value)}>{availableTypes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Currency" hint="Values are in US dollars unless the agreement is in another currency."><input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} maxLength={3} pattern="[A-Za-z]{3}" required /></Field>
              <Field label={`Agreement value (${currency})`} hint="Total contract value, excluding sales tax."><input name="value" inputMode="decimal" placeholder="48000" value={requestValue} onChange={e=>setRequestValue(e.target.value)} /></Field>
              {currency !== 'USD' && currency.length === 3 && <Field label={`US dollars per 1 ${currency} *`} hint="The rate you record; Locket shows the USD equivalent at this rate and fetches none."><input name="usdRate" inputMode="decimal" placeholder="1.27" value={usdRate} onChange={e=>setUsdRate(e.target.value)} required /></Field>}
              <Field label="Time zone" hint="Notice deadlines fall at 11:59 pm in this zone."><select value={zone} onChange={e => setZone(e.target.value)}>{zoneOptions.map(([id, label]) => <option key={id} value={id}>{label} ({id})</option>)}</select></Field>
              <Field label="Responsible person *"><select name="ownerId" value={route?.route.ownerId} disabled={!!form} defaultValue={form ? undefined : state.actor.id}>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Needed by"><input type="date" name="neededBy" /></Field>
              <Field label="Proposed start date"><input type="date" name="startDate" /></Field>
              {['amendment', 'order_form'].includes(requestType) && <Field label="Belongs to agreement *"><select name="parentId" required>{state.agreements.map(x => <option key={x.id} value={x.id}>{x.reference} {x.title}</option>)}</select></Field>}
            </div>
            {state.entities.length > 0 && <EntitySelect state={state} value={entityId} onChange={id => { setEntityId(id); setZone(null) }} />}
            <PartyField state={state} />
            <CustomFieldInputs state={state} fields={customFieldsFor(state, requestType)} stage="draft" />
            {form && <fieldset className="lk-fieldset"><legend>{form.definition.name} questions</legend>
              <div className="lk-grid2">
                <Field label="Request department"><select value={String(answers.department ?? '')} onChange={e=>setAnswers(a=>({...a,department:e.target.value}))}><option value="">No department</option>{state.intakeAudiences.filter(a=>a.kind==='department' && a.memberIds.includes(state.actor.id)).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                <Field label="Request region"><input value={String(answers.region ?? '')} onChange={e=>setAnswers(a=>({...a,region:e.target.value}))} /></Field>
              </div>
              <IntakeFormFields state={state} fields={visibleFields} answers={formAnswers} onChange={(key,answer)=>setAnswers(a=>({...a,[key]:answer}))} />
              {route && <p role="status">{route.matchedRule ?? 'Default route'} · Reviewer: {people.find(p=>p.id===route.route.reviewerId)?.name} · {route.route.approvalRole === 'counsel' ? 'Counsel' : 'Commercial'} approval</p>}
            </fieldset>}
            <label className="lk-check"><input type="checkbox" name="restricted" /> Restricted agreement (visible to owner, counsel, you, the responsible person and people granted access)</label>
          </section>
          <section className="lk-panel">
            <div className="lk-panel-head"><h2>Document</h2></div>
            <div className="lk-segmented">
              <label><input type="radio" checked={source === 'template'} disabled={!approved.length} onChange={() => setSource('template')} /> Approved template</label>
              <label><input type="radio" checked={source === 'file'} onChange={() => setSource('file')} /> Attach draft</label>
              <label><input type="radio" checked={source === 'later'} onChange={() => setSource('later')} /> Add later</label>
            </div>
            {source === 'template' && (approved.length ? (
              <>
                <Field label="Template version"><select value={templateId} onChange={e => setTemplateId(e.target.value)}>{approved.map(t => <option key={t.id} value={t.id}>{state.templates.find(x => x.id === t.template_id)?.name} v{t.number}</option>)}</select></Field>
                {template && <TemplateFields key={template.id + entityId} template={template} entityId={entityId || null} />}
                {word?.pricing&&<PricingLines items={lineItems} onChange={setLineItems}/>}
              </>
            ) : <p className="lk-muted">No approved template yet. Owner or counsel approve templates in the Library.</p>)}
            {source === 'file' && (
              <>
                <Field label="Draft (PDF or DOCX)"><input type="file" name="file" accept=".pdf,.docx" required /></Field>
                <Field label="Text (optional for PDF)"><textarea name="text" rows={3} /></Field>
              </>
            )}
            <div className="lk-panel-head"><h2>Required attachments</h2></div>
            <ul className="lk-checklist">{[...new Set([...defaults[requestType],...(route?.requirements ?? [])])].map(l => <li key={l}><span className="lk-missing">!</span><span>{l}<small>Required for {typeLabel[requestType].toLowerCase()} requests; attach before review</small></span></li>)}</ul>
            <Field label="Also require (one per line)"><textarea name="requirements" rows={2} placeholder="e.g. Pricing schedule" /></Field>
          </section>
        </div>
      </Form>}
    </div>
  )
}

export function LegacyImport({ state, locket }: { state: LocketState; locket: Locket }) {
  const { run, busy } = locket
  const [type, setType] = useState('customer')
  const people = state.operators.filter(o => o.status === 'active')
  return (
    <div className="lk-intake">
      <a className="lk-back" href="#agreements"><Icon name="back" />Back to agreements</a>
      <div className="lk-titlebar"><div><h1>Import a signed or legacy file</h1><p className="lk-muted">Locket keeps the exact file, where it came from and its source ID. It does not re-sign or invent signature evidence.</p></div></div>
      <Form busy={busy} submit="Import file" onSubmit={async data => {
        const file = data.get('file') as File | null
        if (!file?.size) return locket.setError('Choose the PDF or DOCX to import.')
        const result = await run('legacy.import', { title: value(data, 'title'), type, customValues: readCustomValues(data, customFieldsFor(state, type)), ...party(data), ...(state.entities.length ? { entityId: value(data, 'entityId') } : {}), ownerId: value(data, 'ownerId'), sourceSystem: value(data, 'sourceSystem'), sourceId: value(data, 'sourceId'), signed: data.get('signed') === 'on', text: value(data, 'text') || undefined, restricted: data.get('restricted') === 'on', file: await fileToPayload(file) })
        if (result) window.location.hash = `agreement/${result.id}`
      }}>
        <div className="lk-intake-grid">
          <section className="lk-panel">
            <Field label="File (PDF or DOCX) *"><input type="file" name="file" accept=".pdf,.docx" required /></Field>
            <Field label="Agreement title *"><input name="title" required /></Field>
            <Field label="Type"><select name="type" value={type} onChange={event => setType(event.target.value)}>{Object.entries(typeLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Responsible person"><select name="ownerId" defaultValue={state.actor.id}>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            {state.entities.length > 0 && <EntitySelect state={state} />}
            <PartyField state={state} />
            <CustomFieldInputs state={state} fields={customFieldsFor(state, type)} stage="imported" />
          </section>
          <section className="lk-panel">
            <Field label="Where it came from *" hint="e.g. Shared drive, Adobe Acrobat Sign, Dropbox Sign"><input name="sourceSystem" required /></Field>
            <Field label="Source ID *" hint="The file path, envelope or document ID in that system."><input name="sourceId" required /></Field>
            <label className="lk-check"><input type="checkbox" name="signed" /> The importer states this copy is signed</label>
            <Field label="Text (optional for PDF)"><textarea name="text" rows={4} /></Field>
            <label className="lk-check"><input type="checkbox" name="restricted" /> Restricted agreement</label>
          </section>
        </div>
      </Form>
    </div>
  )
}
