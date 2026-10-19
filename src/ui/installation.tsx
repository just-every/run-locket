// US-001: the installation's defaults. Values are in US dollars; the owner picks
// the US time zone new agreements inherit and whether notice deadlines on a
// weekend or US federal holiday roll back to the previous business day.
import type { LocketState } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can } from './format'
import { zones } from './preferences'

export const zoneLabel = (id: string) => { const z = zones.find(x => x[0] === id); return z ? `${z[1]} (${id})` : id }

export function InstallationDefaults({ state, locket }: { state: LocketState; locket: Locket }) {
  const s = state.settings
  return (
    <section className="lk-panel" aria-labelledby="lk-installation">
      <div className="lk-panel-head"><h2 id="lk-installation">Installation defaults</h2></div>
      <dl className="lk-obligation-facts">
        <div><dt>Currency</dt><dd>US dollars (USD)</dd></div>
        <div><dt>Time zone</dt><dd>{zoneLabel(s.timezone)}</dd></div>
        <div><dt>Notice deadlines</dt><dd>{s.rollNoticeDeadlines ? 'Roll back to the previous US business day' : 'Stay on their calendar date'}</dd></div>
      </dl>
      {can(state, 'owner') && (
        <details className="lk-disclosure">
          <summary>Change installation defaults</summary>
          <Form key={s.version} busy={locket.busy} submit="Save defaults" onSubmit={data => void locket.run('installation.settings', { timezone: value(data, 'timezone'), rollNoticeDeadlines: data.get('roll') === 'on', version: s.version })}>
            <Field label="Installation time zone" hint="New agreements take it unless the contracting entity or the request names another."><select name="timezone" defaultValue={s.timezone}>{zones.map(([id, label]) => <option key={id} value={id}>{label} ({id})</option>)}</select></Field>
            <label className="lk-check"><input type="checkbox" name="roll" defaultChecked={s.rollNoticeDeadlines} /> Roll a notice deadline on a weekend or US federal holiday back to the previous business day</label>
          </Form>
        </details>
      )}
    </section>
  )
}
