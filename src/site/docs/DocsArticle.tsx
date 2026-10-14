import { Icon } from '../../ui/controls'
import { DocsFrame } from './DocsFrame'
import { DocsMenu } from './DocsNav'
import { DocsToc } from './DocsToc'
import { docsNeighbours, getDocsPage } from './pages'

/** One docs page, rendered from its Markdown at build time; previous and next close the article. */
export function DocsArticle({ slug }: { slug: string }) {
  const page = getDocsPage(slug)
  const { previous, next } = docsNeighbours(slug)
  return (
    <DocsFrame current={slug} aside={<DocsToc toc={page.toc} />}>
      <DocsMenu current={slug} label={page.title} />
      <article className="docs-article" aria-labelledby="docs-title">
        <p className="docs-crumbs"><a href="/docs">Docs</a><span aria-hidden="true">/</span>{page.section}</p>
        <h1 id="docs-title" className="docs-title"><img src="/brand/rosette.svg" alt="" />{page.title}</h1>
        <p className="docs-summary">{page.summary}</p>
        <DocsToc toc={page.toc} compact />
        <div className="docs-prose" dangerouslySetInnerHTML={{ __html: page.html }} />
      </article>
      <nav className="docs-pager" aria-label="Previous and next pages">
        {previous ? <a href={`/docs/${previous.slug}`} rel="prev"><Icon name="back" />Previous: {previous.title}</a> : <span />}
        {next && <a href={`/docs/${next.slug}`} rel="next">Next: {next.title}<Icon name="forward" /></a>}
      </nav>
    </DocsFrame>
  )
}
