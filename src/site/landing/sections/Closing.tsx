import { links } from '../../shell/links'
import { hero } from '../copy'
import { AT, Check, CheckDot, Connector, Cursor, Heading, Nw, Spark, dot } from '../parts'
import { MascotWithDate } from './Mascot'

const Arrow = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" /></svg>

/** 13, the closing: deadline day, already handled, with the actions and the mascot holding up Fri Nov 13. */
export function Closing() {
  return (
    <section className="sec closing" aria-labelledby="closing-title">
      <div className="stage closing-stage">
        <div className="closing-copy">
          <Heading id="closing-title" top="Deadline day," bottom="already handled." />
          <p className="lede">100% free and open source. MIT licensed.</p>
          <p className="closing-actions">
            <a className="btn-run" href={links.run}>{hero.run}<Arrow /></a>
            <a className="btn-ghost" href={links.docs}>{hero.docs}</a>
          </p>
        </div>

        <div className="card fwd fwd-bluebird">
          <p className="fwd-title">Tomorrow{dot}<Nw>Sat Nov 14</Nw></p>
          <p>Bluebird Facilities{dot}renewal brief to <span className="nw cursor-at">Kevin Walsh<Cursor who="priya" style={AT} /></span></p>
        </div>
        <div className="card fwd fwd-cobalt">
          <div><p className="fwd-title">Mon Feb 1, 2027</p><p>Cobalt Security{dot}new term begins{dot}renewed by Kevin Walsh</p></div>
          <CheckDot tone="soft" />
        </div>
        <div className="card fwd fwd-northwind">
          <div><p className="fwd-title">Mon Nov 13, 2028</p><p>Northwind's next notice deadline{dot}<span className="nw">on Priya's calendar <Check /></span></p></div>
          <CheckDot tone="soft" />
        </div>
        <Connector className="closing-l1" box="0 0 80 100" d="M2 2C40 10 66 40 74 96" />
        <Connector className="closing-l2" box="0 0 130 110" d="M128 4C70 8 30 40 10 104" />
        <Connector className="closing-l3" box="0 0 90 160" d="M4 156C-4 90 30 30 86 6" />
        <MascotWithDate />
        <span className="mascot-shadow mascot-shadow-closing" aria-hidden="true" />
        <Spark style={{ left: 64, top: 86 }} turn={-50} />
        <Spark style={{ left: 1428, top: 52 }} turn={30} />
        <Spark style={{ left: 96, top: 690 }} turn={-50} />
        <Spark style={{ left: 1428, top: 488 }} turn={30} />
      </div>
    </section>
  )
}
