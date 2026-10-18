import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { contractPageHtml } from '../base/contract-page'
import { runPageHtml, siteNotFoundHtml, type SiteBuild, type SiteContext } from '../base/run-site'
import { identity } from '../identity'
import { DocsArticle } from './docs/DocsArticle'
import { DocsIndex } from './docs/DocsIndex'
import { docsLead, docsPages } from './docs/pages'
import { meta } from './landing/copy'
import { Landing } from './landing/Landing'
import { run } from './run'
import { bindTokens } from './text'

/**
 * The run site (run-locket.com), written by `rer build --site`: the homepage at `/`, whose Run Locket opens the Run page
 * at `/run`; the docs at `/docs` and `/docs/<slug>`, rendered from docs/site.json and docs/*.md; /contract from
 * CONTRACT.md; and the not-found page. Every page is static, works without script and links to no instance-only route.
 */
const ICONS = '<link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/favicon-32.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">'
const SHARE_IMAGE = `${identity.runSite}/site/share.jpg`
// Code cards get their Copy button only when script runs; without it the command is still there to select.
const COPY = "document.querySelectorAll('.docs-copy').forEach(b=>{b.hidden=false;b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.closest('.docs-code').querySelector('code').textContent);b.textContent='Copied';setTimeout(()=>{b.textContent='Copy'},1600)}catch{}})})"

/** Base's shared pages (Run, Contract, not found): the small-size icons instead of the full mark as the tab icon,
 * Locket's site header, and US spelling ("license") in Base's licence line. */
const asLocket = (html: string) => bindTokens(html)
  .replace(`<link rel="icon" href="${identity.mark}">`, ICONS)
  .replace(/<\/head\s*>/i, '<link rel="stylesheet" href="/brand/run.css"></head>')
  .replaceAll(`${run.licence} licence<`, `${run.licence} license<`)

export function sitePages({ styles, contract }: SiteContext): SiteBuild {
  const document = (title: string, description: string, body: ReactElement, script = '') => '<!doctype html>' + bindTokens(renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="theme-color" content="#FFFFFF" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Locket" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={SHARE_IMAGE} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" type="image/svg+xml" href="/favicon-32.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="preload" href="/fonts/inter/inter-variable-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="stylesheet" href="/fonts/fonts.css" />
        <link rel="stylesheet" href="/rer-theme.css" />
        {styles.map(href => <link key={href} rel="stylesheet" href={href} />)}
      </head>
      <body>{body}{script ? <script dangerouslySetInnerHTML={{ __html: script }} /> : null}</body>
    </html>,
  ))
  return {
    pages: [
      { path: '/', html: document(meta.title, meta.description, <Landing />) },
      { path: '/run', html: asLocket(runPageHtml(identity, run, contract)) },
      ...(contract ? [{ path: '/contract', html: asLocket(contractPageHtml(identity, run, contract)) }] : []),
      { path: '/docs', html: document('Docs · Locket', docsLead, <DocsIndex />) },
      ...docsPages.map(page => ({ path: `/docs/${page.slug}`, html: document(`${page.title} · Locket docs`, page.summary, <DocsArticle slug={page.slug} />, COPY) })),
      { path: '/404', html: asLocket(siteNotFoundHtml(identity, run, contract)) },
    ],
    assets: ['rer-theme.css', 'fonts', 'brand', 'site', 'favicon.ico', 'favicon-32.svg', 'favicon-16.svg', 'apple-touch-icon.png'],
  }
}
