import type { SearchPassage } from '../locket/search-passages'
export function PassageLinks({ agreementId, matches }: { agreementId: string; matches: SearchPassage[] }) {
  return <ul className="lk-list" aria-label="Matching passages">{matches.map(hit => <li key={`${hit.versionId}-${hit.start}`}><a href={`#agreement/${agreementId}/versions/${hit.version}/${hit.start}/${hit.end}`}>v{hit.version}: …{hit.excerpt}…</a></li>)}</ul>
}
