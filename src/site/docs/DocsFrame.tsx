import type { ReactNode } from 'react'
import '../../ui/style/tokens.css'
import '../../ui/style/controls.css'
import '../landing/landing.css'
import '../landing/landing-responsive.css'
import './docs.css'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { DocsSidebar } from './DocsNav'

/** Every docs page: the site's header and footer around the section sidebar, the article and an optional side column. */
export function DocsFrame({ current, aside, children }: { current?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="ld-page docs-page">
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
