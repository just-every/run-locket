import { Avatar, Check, CheckDot, Chip, Connector, Cursor, Eyebrow, Glyph, Heading, Nw, dot } from '../parts'

const read: [string, string, string?][] = [
  ['Agreement type', 'Customer MSA', 'p.1'],
  ['Counterparty', 'Brightline Health, Inc., a Delaware corporation', 'p.1'],
  ['Our entity', 'Fieldstone Software, Inc.', 'p.1'],
  ['Term', '36 months', '§10.1'],
  ['Governing law', 'Tennessee', '§14.1'],
  ['Playbook', 'Customer MSA v7'],
]

/** 03, the request: Jenna's HubSpot deal becomes LKT-2291, and Brightline's own paper is read on arrival. */
export function Request() {
  return (
    <section className="sec request" aria-labelledby="request-title">
      <div className="stage request-stage">
        <header className="sec-head request-head">
          <Eyebrow stage="Request" when="Mon Oct 5" />
          <Heading id="request-title" top="Their paper," bottom="read on arrival." />
          <p className="lede">Jenna started the contract from her HubSpot deal. Locket filled the order form from its line items and read Brightline's MSA before Priya opened it.</p>
        </header>

        <p className="card request-file"><Glyph name="doc" /><span><Nw>Brightline_MSA.docx</Nw>{dot}24 pages{dot}v1 (their paper)</span></p>
        <Connector className="request-drop" box="0 0 10 64" d="M5 2V62" head={false} />
        <Connector className="request-join" box="0 0 272 10" d="M2 5H268" />

        <div className="card request-deal">
          <p className="mini-label">HubSpot deal</p>
          <p className="request-deal-title">Brightline Health{dot}MSA&nbsp;+ Order Form</p>
          <p className="request-amount">$186,000</p>
          <p className="request-facts">Close date{dot}<Nw>Fri Oct 16</Nw><br />Owner{dot}Jenna Hart</p>
          <p className="mini-label request-lines-label">Line items</p>
          <dl className="request-lines">
            <div><dt>Platform{dot}$54,000/yr × 3</dt><dd>$162,000</dd></div>
            <div><dt>Onboarding</dt><dd>$24,000</dd></div>
          </dl>
          <span className="request-start">Start contract<Cursor who="jenna" style={{ left: 236, top: 30 }} /></span>
        </div>

        <div className="card request-lkt">
          <p className="request-lkt-title"><Nw>LKT-2291</Nw>{dot}Customer MSA&nbsp;+ Order Form</p>
          <p className="quiet">Created <Nw>Mon Oct 5</Nw>, 10:12 am</p>
          <dl className="kv request-mapped">
            <div><dt>Account</dt><dd>Brightline Health</dd></div>
            <div><dt>Contact</dt><dd>Alicia Moreno, Associate General Counsel</dd></div>
            <div><dt>Amount</dt><dd>$186,000</dd></div>
            <div><dt>Close date</dt><dd><Nw>Fri Oct 16</Nw></dd></div>
          </dl>
          <p className="request-order"><Glyph name="lines" /><span>Order Form v1{dot}from template Order Form v5{dot}pricing table 2 lines{dot}<span className="nw">total $186,000 <Check /></span>{dot}parent: Brightline MSA</span></p>
          <p className="request-read">Read from their paper</p>
          <dl className="kv request-cited">
            {read.map(([key, value, cite]) => <div key={key}><dt>{key}</dt><dd>{value}</dd>{cite ? <Chip>{cite}</Chip> : <span />}</div>)}
          </dl>
          <p className="request-confirmed"><CheckDot /><span>6 of 6 confirmed by Jenna Hart{dot}<span className="nw">10:14 am <Check /></span></span></p>
        </div>

        <p className="card request-assigned"><Avatar initials="PR" tone="grey" /><span>Assigned to Priya Raman{dot}first turn due <Nw>Wed Oct 7</Nw> (2 business days){dot}<span className="nw">sent Tue Oct 6 <Check /></span></span></p>
      </div>
    </section>
  )
}
