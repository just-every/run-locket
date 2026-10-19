import { useEffect, useState } from 'react'
import { fetchJson, type LocketState, type Row } from './api'
import type { Locket } from './app'
import { Empty, Field, Form, Panel, value, When } from './controls'

export function Clickwrap({ state, locket }: { state: LocketState; locket: Locket }) {
  const editor = ['owner','counsel'].includes(state.actor.role)
  const [selected, setSelected] = useState(state.clickwrapTerms[0]?.id ?? '')
  const terms = state.clickwrapTerms.find(t => t.id === selected)
  const versions = state.clickwrapVersions.filter(v => v.terms_id === selected)
  return <div className="lk-stack lk-clickwrap">
    <div className="lk-titlebar"><div><h1>Published terms</h1><p className="lk-muted">Publish standard terms and keep evidence of each explicit acceptance.</p></div><a href="#library">Library</a></div>
    <div className="lk-library-grid">
      <Panel title="Terms for acceptance">
        {state.clickwrapTerms.length ? <Field label="Terms"><select value={selected} onChange={e => setSelected(e.target.value)}>{state.clickwrapTerms.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></Field> : <Empty>No terms published yet.</Empty>}
        {editor && <details className="lk-disclosure" open={!state.clickwrapTerms.length}><summary>Publish new terms</summary>
          <Form busy={locket.busy} submit="Publish version 1" onSubmit={async (data, form) => {
            const result = await locket.run('clickwrap.publish', {name:value(data,'name'),kind:value(data,'kind'),siteOrigin:value(data,'siteOrigin'),body:value(data,'body')})
            if (result) {setSelected(result.id);form.reset()}
          }}>
            <Field label="Terms name"><input name="name" required maxLength={120}/></Field>
            <Field label="Terms type"><select name="kind"><option value="tos">Terms of service</option><option value="dpa">Data processing addendum</option><option value="partner">Partner terms</option></select></Field>
            <Field label="Customer website origin" hint="HTTPS origin of the website whose server asserts its own users' identity."><input name="siteOrigin" type="url" placeholder="https://your-company.com" required/></Field>
            <Field label="Terms text"><textarea name="body" rows={10} required/></Field>
          </Form>
        </details>}
      </Panel>
      <Panel title={terms?.name ?? 'Published versions'}>
        {terms ? <>
          <p><a className="lk-button" target="_blank" rel="noreferrer" href={`/api/locket/clickwrap/terms/${terms.id}`}>Review and accept terms</a></p>
          <p className="lk-muted">Customer site: {terms.site_origin}. Published versions keep their exact wording and SHA-256 digest.</p>
          {versions.map(v => <article className="lk-card" key={v.id}><strong>Version {v.number}</strong> · <When at={v.published_at}/><p>{v.require_reacceptance ? 'Requires reacceptance' : 'Previous required acceptance remains current'}</p><details><summary>Read published version {v.number}</summary><pre className="lk-document">{v.body}</pre><p className="lk-clickwrap-digest">SHA-256 {v.digest}</p></details></article>)}
          {editor && <details className="lk-disclosure"><summary>Publish next version</summary><Form key={terms.current_version_id} busy={locket.busy} submit="Publish next version" onSubmit={async (data, form) => {if (await locket.run('clickwrap.publish',{termsId:terms.id,version:terms.version,body:value(data,'body'),requireReacceptance:data.has('reaccept')})) form.reset()}}>
            <Field label="New terms text"><textarea name="body" rows={10} defaultValue={versions[0]?.body} required/></Field>
            <label className="lk-check"><input name="reaccept" type="checkbox" defaultChecked/>Require everyone to accept this version again</label>
          </Form></details>}
          {editor && <details className="lk-disclosure"><summary>Website integration</summary><p>Use the embed script to open an explicit hosted review for your users. Your website server signs each user's account and email with the installation signing key. Identity is labelled site-asserted; it is never identity-proofed. The key stays on your server.</p><p>Script: <code>/api/locket/clickwrap/embed.js</code></p><pre className="lk-document">{`LocketClickwrap.mount(element, {\n  termsId: "${terms.id}",\n  identity: signedAssertionFromYourServer\n});`}</pre><p>Ask your installation operator to configure the optional Clickwrap signing key. The API documentation defines the short-lived signed assertion.</p></details>}
        </> : <Empty>Publish a terms version to offer an acceptance page.</Empty>}
      </Panel>
    </div>
    <AcceptanceBrowser state={state} locket={locket} editor={editor}/>
  </div>
}

function AcceptanceBrowser({state,locket,editor}:{state:LocketState;locket:Locket;editor:boolean}) {
  const [filters,setFilters] = useState('')
  const [rows,setRows] = useState<Row[]>([]), [error,setError] = useState(''), [loading,setLoading] = useState(true)
  useEffect(() => {let active=true;setLoading(true);setError('');fetchJson('/api/locket/clickwrap/acceptances?'+filters).then(data => {if(active)setRows(data.rows)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return ()=>{active=false}},[filters,state.now])
  return <Panel title={editor?'Acceptance evidence':'Your acceptance evidence'} className="lk-acceptance-browser">
    <Form busy={loading} submit="Search acceptances" className="lk-inline" onSubmit={data=>{const query = new URLSearchParams();for(const name of ['q','terms','party']) if(value(data,name))query.set(name,value(data,name));setFilters(query.toString())}}>
      <Field label="Search acceptances"><input name="q" type="search" placeholder="Email, account, terms, digest…"/></Field>
      <Field label="Terms filter"><select name="terms"><option value="">All terms</option>{state.clickwrapTerms.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
      {editor && <Field label="Counterparty filter"><select name="party"><option value="">All counterparties</option>{state.parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
    </Form>
    <p><a href={'/api/locket/clickwrap/acceptances?'+filters+(filters?'&':'')+'format=csv'}>Export acceptance CSV</a></p>
    {error && <p role="alert">{error}</p>}
    <div aria-busy={loading}>
      {!loading && !rows.length && <Empty>No acceptances match these filters.</Empty>}
      {rows.map(r=><article className="lk-card" key={r.id} data-acceptance-id={r.id}>
        <strong>{r.terms_name} · Version {r.terms_number}</strong><p>{r.email} · Account {r.account_id}<br/>{r.identity_kind==='site_asserted'?'Site-asserted identity (not identity-proofed)':'Base current session'} · <When at={r.accepted_at}/></p>
        <details><summary>Captured evidence</summary><p className="lk-clickwrap-digest">SHA-256 {r.digest}</p><p>IP: {r.ip || 'Not supplied by the transport'}<br/>User agent: {r.user_agent}<br/>Page shown: {r.page_shown}<br/>Site: {r.site_origin}<br/>Receipt: {r.id}</p></details>
        <p>Counterparty: {r.counterparty ?? 'Not linked'}</p>
        {editor && <Form busy={locket.busy} submit="Link counterparty" className="lk-inline" onSubmit={async data=>{await locket.run('clickwrap.link',{acceptanceId:r.id,currentPartyId:r.party_id,partyId:value(data,'partyId')})}}><Field label="Link to counterparty"><select name="partyId" required defaultValue={r.party_id??''}><option value="">Choose counterparty</option>{state.parties.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></Field></Form>}
      </article>)}
    </div>
  </Panel>
}
