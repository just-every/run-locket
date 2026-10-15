import { Icon } from '../../ui/controls'
import { hero } from './copy'

/** Run Locket, Read the docs and the licence line: under the hero and again in the closing band. */
export function Actions({ demo = false }: { demo?: boolean }) {
  return (
    <>
      <div className="ld-actions">
        <a className="ld-pill" href="/run">{hero.run}<Icon name="forward" /></a>
        {demo && <a className="ld-pill" href="https://demo.run-locket.com/">Try the demo<Icon name="forward" /></a>}
        <a className="ld-link" href="/docs">{hero.docs}</a>
      </div>
      <p className="ld-small">{hero.small}</p>
    </>
  )
}
