import type { ReactNode } from 'react'
import '../styles/site.css'
import '../styles/docs.css'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { DocsSidebar } from './DocsNav'

/** Every docs page: the site's header and footer around the section sidebar, the article and an optional side column. */
export function DocsFrame({ current, aside, children }: { current?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="site docs-page">
      <SiteHeader current="docs" />
      <div className={`docs-shell${aside ? '' : ' docs-shell-wide'}`}>
        <DocsSidebar current={current} />
        <main id="main" className="docs-main">{children}</main>
        {aside}
      </div>
      <SiteFooter />
    </div>
  )
}
