import { Arrow } from './Arrow'
import { DocsFrame } from './DocsFrame'
import { DocsMenu } from './DocsNav'
import { docsLead, docsSections } from './pages'

/** The docs home at /docs: every page in reading order, grouped by section, with its one-line summary. */
export function DocsIndex() {
  return (
    <DocsFrame>
      <DocsMenu label="All docs" />
      <article className="docs-article" aria-labelledby="docs-title">
        <p className="docs-crumbs">Locket</p>
        <h1 id="docs-title" className="docs-title">Docs</h1>
        <p className="docs-summary">{docsLead}</p>
        <p className="docs-summary"><a href="/docs/hosting">Put Locket online</a> with the hosting guide.</p>
        {docsSections.map((section, index) => (
          <section className="docs-index-section" key={section.title} aria-labelledby={`docs-section-${index}`}>
            <h2 className="docs-section-label" id={`docs-section-${index}`}>{section.title}</h2>
            <ul>
              {section.pages.map(page => (
                <li key={page.slug}><a className="docs-card" href={`/docs/${page.slug}`}><strong>{page.title}<Arrow /></strong><span>{page.summary}</span></a></li>
              ))}
            </ul>
          </section>
        ))}
      </article>
    </DocsFrame>
  )
}
