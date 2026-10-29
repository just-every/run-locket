import { docsSections } from './pages'

/** The sections and their pages, the current one marked. `idPrefix` keeps the sidebar's and the phone menu's ids apart. */
function DocsNavList({ current, idPrefix }: { current?: string; idPrefix: string }) {
  return (
    <>
      <div className="docs-nav-group"><a href="/docs/hosting">Hosting</a></div>
      {docsSections.map((section, index) => (
        <div className="docs-nav-group" key={section.title}>
          <p className="docs-nav-section" id={`${idPrefix}-${index}`}>{section.title}</p>
          <ul aria-labelledby={`${idPrefix}-${index}`}>
            {section.pages.map(page => <li key={page.slug}><a href={`/docs/${page.slug}`} aria-current={page.slug === current ? 'page' : undefined}>{page.title}</a></li>)}
          </ul>
        </div>
      ))}
    </>
  )
}

/** The section navigation beside the article on wide screens. */
export function DocsSidebar({ current }: { current?: string }) {
  return <nav className="docs-sidebar" aria-label="Docs"><DocsNavList current={current} idPrefix="docs-sidebar" /></nav>
}

/** The same navigation on phones: one pill that opens the whole list, without script. */
export function DocsMenu({ current, label }: { current?: string; label: string }) {
  return (
    <nav className="docs-menu" aria-label="Docs menu">
      <details>
        <summary><span>Contents</span><span className="docs-menu-current">{label}</span></summary>
        <div className="docs-menu-list"><DocsNavList current={current} idPrefix="docs-menu" /></div>
      </details>
    </nav>
  )
}
