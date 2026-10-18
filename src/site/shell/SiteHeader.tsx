import { Mark } from '../landing/parts'
import { links } from './links'

/** The run site's header: the mark and the Locket wordmark, then Docs, Contract and Source. No Sign in on the run site. */
export function SiteHeader({ current }: { current?: 'docs' }) {
  return (
    <header className="site-header">
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="site-header-row">
        <a className="site-brand" href={links.home}><Mark height={64} /><span>Locket</span></a>
        <nav aria-label="Locket">
          <a href={links.docs} aria-current={current === 'docs' ? 'page' : undefined}>Docs</a>
          <a href={links.contract}>Contract</a>
          <a href={links.source}>Source</a>
        </nav>
      </div>
    </header>
  )
}
