import type { DocsTocEntry } from './types'

/** "On this page": the page's h2s. A page with fewer than two gets none. */
export function DocsToc({ toc, compact = false }: { toc: DocsTocEntry[]; compact?: boolean }) {
  const entries = toc.filter(entry => entry.depth === 2)
  if (entries.length < 2) return null
  const list = <ul>{entries.map(entry => <li key={entry.id}><a href={`#${entry.id}`}>{entry.text}</a></li>)}</ul>
  if (compact) return <details className="docs-toc-compact"><summary>On this page</summary>{list}</details>
  return <nav className="docs-toc" aria-labelledby="docs-toc-title"><p className="docs-toc-title" id="docs-toc-title">On this page</p>{list}</nav>
}
