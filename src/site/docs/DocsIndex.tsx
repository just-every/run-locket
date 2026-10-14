import { Icon } from '../../ui/controls'
import { DocsFrame } from './DocsFrame'
import { DocsMenu } from './DocsNav'
import { docsLead, docsSections } from './pages'

/** The docs home at /docs: every page in reading order, grouped by section, with its one-line summary. */
export function DocsIndex() {
  return (
    <DocsFrame>
      <DocsMenu label="All docs" />
      <article className="docs-article" aria-labelledby="docs-title">
        <h1 id="docs-title" className="docs-title"><img src="/brand/rosette.svg" alt="" />Docs</h1>
        <p className="docs-summary">{docsLead}</p>
        {docsSections.map((section, index) => (
          <section className="docs-index-section" key={section.title} aria-labelledby={`docs-section-${index}`}>
            <h2 className="ld-eyebrow" id={`docs-section-${index}`}>{section.title}</h2>
            <ul>
              {section.pages.map(page => (
                <li key={page.slug}><a href={`/docs/${page.slug}`}><strong>{page.title}<Icon name="forward" /></strong><span>{page.summary}</span></a></li>
              ))}
            </ul>
          </section>
        ))}
      </article>
    </DocsFrame>
  )
}
