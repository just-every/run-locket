import { bodies, sections } from 'virtual:locket-docs'
import type { DocsPage, DocsPageMeta, DocsSection } from './types'

// The published docs, parsed from docs/site.json and rendered at build time (build/plugin.ts), and lookups over them.

export const docsSections: DocsSection[] = sections
export const docsPages: DocsPageMeta[] = sections.flatMap(section => section.pages)
export const docsLead = 'Run Locket on your own computer, move your signed agreements in, and keep every contract and renewal in order.'

export function getDocsPage(slug: string): DocsPage {
  const meta = docsPages.find(page => page.slug === slug)
  if (!meta || !Object.hasOwn(bodies, slug)) throw new Error(`docs/site.json has no page "${slug}"`)
  return { ...meta, ...bodies[slug] }
}

/** The pages before and after `slug` in reading order, across sections. */
export function docsNeighbours(slug: string): { previous?: DocsPageMeta; next?: DocsPageMeta } {
  const index = docsPages.findIndex(page => page.slug === slug)
  return { previous: docsPages[index - 1], next: docsPages[index + 1] }
}
