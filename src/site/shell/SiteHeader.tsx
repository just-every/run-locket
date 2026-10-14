import { repository } from '../repository'

/** The run site's header: the mark and name, then Docs and Source. No Sign in on the run site. */
export function SiteHeader({ current }: { current?: 'docs' }) {
  return (
    <header className="ld-header">
      <a className="ld-brand" href="/"><img src="/brand/mark.svg" alt="" width="40" height="40" />Locket</a>
      <nav aria-label="Locket">
        <a href="/docs" aria-current={current === 'docs' ? 'page' : undefined}>Docs</a>
        <a href={repository}>Source</a>
      </nav>
    </header>
  )
}
