import { AT, Check, Chip, Connector, Cursor, Eyebrow, Glyph, Heading, Nw, Spark, Sticky, dot } from '../parts'

const Box = ({ on }: { on?: boolean }) => <span className={`box${on ? ' box-on' : ''}`} aria-hidden="true">{on ? <Check /> : null}</span>

/** 09, the renewal brief: Northwind's terms against its bills and uptime, and the two findings that paid $3,360. */
export function Brief() {
  return (
    <section className="sec brief" aria-labelledby="brief-title">
      <div className="stage brief-stage">
        <header className="sec-head brief-head">
          <Eyebrow stage="Brief" when="Thu Oct 15" />
          <Heading id="brief-title" top="The renewal brief" bottom="found $3,360." />
          <p className="lede">Before Priya decided, the agent checked Northwind's invoices and uptime against the contract. It drafted both claims; Priya sent them.</p>
        </header>

        <div className="card brief-doc">
          <p className="brief-title">Renewal brief{dot}Northwind Hosting</p>
          <p className="quiet">prepared <Nw>Wed Oct 14</Nw></p>
          <ul className="brief-terms">
            <li>Current term 4{dot}<Nw>Jan 13, 2026</Nw>&nbsp;– <Nw>Jan 12, 2027</Nw></li>
            <li>$96,000/yr ($8,000 a month){dot}Amendment 2</li>
            <li>§5.2 fees fixed each term; increases only at renewal, capped at 3%</li>
            <li>§8.1 99.9% monthly availability</li>
            <li>Spend to date $82,560{dot}10 QuickBooks bills (<Nw>Jan 13</Nw>&nbsp;– <Nw>Oct 13</Nw>)</li>
          </ul>
          <p className="brief-options-title">Options by <Nw>Fri Nov 13</Nw></p>
          <ul className="brief-options">
            <li><Box />Renew</li>
            <li><Box on /><span className="cursor-at">Renegotiate<Cursor who="priya" style={AT} /></span></li>
            <li><Box />Terminate</li>
          </ul>
          <p className="brief-decision"><Check /><span><b>Decision: renegotiate</b>{dot}Priya Raman{dot}<Nw>Thu Oct 15, 10:05 am</Nw></span></p>
        </div>

        <div className="card finding-card finding-a">
          <p className="mini-label"><Spark turn={-30} />Agent finding</p>
          <p className="fc-title">Billed above the contract</p>
          <p><Nw>Jan 13</Nw>&nbsp;– <Nw>Jun 13</Nw>{dot}6 bills at $8,000 = $48,000</p>
          <p><Nw>Jul 13</Nw>&nbsp;– <Nw>Oct 13</Nw>{dot}4 bills at $8,640 (+8%) = $34,560</p>
          <p>§5.2: no mid-term increase</p>
          <p className="fc-sum">Overcharge 4 × $640 = $2,560</p>
          <p className="fc-chips"><Chip>NW-2607</Chip><Chip>NW-2608</Chip><Chip>NW-2609</Chip><Chip>NW-2610</Chip></p>
        </div>
        <Sticky className="brief-sticky">Found before<br />we decided!</Sticky>

        <div className="card finding-card finding-b">
          <p className="mini-label"><Spark turn={-30} />Agent finding</p>
          <p className="fc-title">Service credit owed</p>
          <p>September availability 99.62%{dot}164 min down{dot}from Uptime monitoring</p>
          <p>vs 99.9%{dot}§8.3 credit 10% of monthly fees</p>
          <p className="fc-sum">$800</p>
          <p className="quiet">claim window closes <Nw>Fri Oct 30</Nw></p>
        </div>

        <p className="card brief-claim"><Glyph name="lines" /><span>Drafted credit request{dot}$3,360.00{dot}approved by Priya Raman and Marcus Lee{dot}<Nw>Thu Oct 15, 2:30 pm</Nw>{dot}<span className="nw">sent 2:31 pm <Check /></span></span><Cursor who="marcus" style={{ left: 44, top: 46 }} /></p>
        <Connector className="brief-link" box="0 0 44 10" d="M2 5H40" tone="copper" />
        <p className="card brief-memo"><Glyph name="lines" /><span>Northwind credit memo <Nw>CM-1142</Nw>{dot}$3,360.00{dot}<Nw>Tue Oct 20</Nw>{dot}<span className="nw">in QuickBooks <Check /></span></span></p>
      </div>
    </section>
  )
}
