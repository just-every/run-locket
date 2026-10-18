import { Mark } from '../landing/parts'
import { links } from './links'

/** The footer, set in type: the mark and name, the one-line description, Docs, Source and the licence. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-row">
        <a className="site-brand site-brand-small" href={links.home}><Mark height={40} /><span>Locket</span></a>
        <p>Free, open source contract management</p>
        <nav aria-label="Footer">
          <a href={links.docs}>Docs</a>
          <a href={links.source}>Source</a>
          <a href={links.licence}>MIT licensed</a>
        </nav>
      </div>
    </footer>
  )
}
