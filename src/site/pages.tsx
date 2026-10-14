import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { runPageHtml, siteNotFoundHtml, type SiteBuild, type SiteContext } from '../base/run-site'
import { identity } from '../identity'
import { DocsArticle } from './docs/DocsArticle'
import { DocsIndex } from './docs/DocsIndex'
import { docsLead, docsPages } from './docs/pages'
import { meta } from './landing/copy'
import { Landing } from './landing/Landing'
import { run } from './run'

/**
 * The run site (run-locket.com), written by `rer build --site`: the homepage at `/`, whose Run Locket opens the Run page
 * at `/run`; the docs at `/docs` and `/docs/<slug>`, rendered from docs/site.json and docs/*.md; and the not-found page.
 * Every page is static, works without script and links to no instance-only route.
 */
/** Base's shared pages wear Locket's site header: one more same-origin stylesheet after their own style. */
const withSiteHeader = (html: string) => html.replace(/<\/head\s*>/i, '<link rel="stylesheet" href="/brand/run.css"></head>')

export function sitePages({ styles }: SiteContext): SiteBuild {
  const document = (title: string, description: string, body: ReactElement) => '<!doctype html>' + renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="theme-color" content="#FBFAF4" />
        <link rel="icon" type="image/svg+xml" href="/brand/mark.svg" />
        <link rel="preload" href="/fonts/libre-franklin/libre-franklin-latin-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/brygada1918/brygada1918-latin-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="stylesheet" href="/fonts/fonts.css" />
        <link rel="stylesheet" href="/rer-theme.css" />
        {styles.map(href => <link key={href} rel="stylesheet" href={href} />)}
      </head>
      <body>{body}</body>
    </html>,
  )
  return {
    pages: [
      { path: '/', html: document(meta.title, meta.description, <Landing />) },
      { path: '/run', html: withSiteHeader(runPageHtml(identity, run)) },
      { path: '/docs', html: document('Docs · Locket', docsLead, <DocsIndex />) },
      ...docsPages.map(page => ({ path: `/docs/${page.slug}`, html: document(`${page.title} · Locket docs`, page.summary, <DocsArticle slug={page.slug} />) })),
      { path: '/404', html: withSiteHeader(siteNotFoundHtml(identity, run)) },
    ],
    assets: ['rer-theme.css', 'fonts', 'brand'],
  }
}
