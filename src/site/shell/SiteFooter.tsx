import { footerLine } from '../landing/copy'
import { repository } from '../repository'

export function SiteFooter() {
  return (
    <footer className="ld-footer">
      <a className="ld-brand ld-brand-small" href="/"><img src="/brand/mark.svg" alt="" width="28" height="28" />Locket</a>
      <p>{footerLine}</p>
      <nav aria-label="Footer">
        <a href="/docs">Docs</a>
        <a href={repository}>Source</a>
        <a href={`${repository}/blob/main/LICENSE`}>MIT licensed</a>
      </nav>
    </footer>
  )
}
