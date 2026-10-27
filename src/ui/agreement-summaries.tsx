import type { LocketState } from './api'
import { parse } from './format'

/** A retained proposal uses the existing agreement panels and version links. */
export function AgreementSummaries({ state, agreementId }: { state: LocketState; agreementId: string }) {
 const summaries = state.summaries.filter(s => s.agreement_id === agreementId)
 return <section className="lk-panel" aria-label="Agreement summaries">
  <h2>Agreement summaries</h2>
  {summaries.map(s => <article key={s.id} aria-label="Version-pinned summary" style={{ overflowWrap: 'anywhere' }}>
   <h3>Summary of v{s.version_number} · {s.stale ? 'Stale' : 'Current'}{s.simulated ? ' · Provider simulation' : ''}</h3>
   {s.stale && <p>The version or recorded terms changed. This summary has not been rewritten.</p>}
   {parse<any>(s.content).proposals.map((line: any) => <div key={line.key}>
    <p><strong>{line.key.replaceAll('_', ' ')} · {line.status}</strong>: {line.value}</p>
    <blockquote><a href={`#agreement/${agreementId}/versions/${s.version_number}/${line.start}/${line.end}`}>{line.quote}</a></blockquote>
   </div>)}
  </article>)}
  {!summaries.length && <p>No summary recorded. Summary generation requires a passing live evaluation in Settings.</p>}
 </section>
}
