import { AT, Avatar, Check, CheckDot, Cursor, Eyebrow, Glyph, Heading, Nw, Pill, Spark, dot } from '../parts'

// The mandate scale runs $91,200 to $96,000; each marker sits at its true share of that range.
const LOW = 91200, HIGH = 96000
const at = (value: number) => `${((value - LOW) / (HIGH - LOW)) * 100}%`
const markers = [
  { value: 91200, label: 'our first offer', kind: 'offer' },
  { value: 92160, label: 'agreed', kind: 'agreed' },
  { value: 94080, label: 'walk-away', kind: 'walk' },
  { value: 94560, label: 'their counter', kind: 'counter' },
]

/** 10, the renegotiation: the agent bargains inside Priya's mandate and Northwind signs Amendment 3 two weeks early. */
export function Renegotiate() {
  return (
    <section className="sec reneg" aria-labelledby="reneg-title">
      <div className="stage reneg-stage">
        <header className="sec-head reneg-head">
          <Eyebrow stage="Renegotiate" when="Fri Oct 16 – Fri Oct 30" />
          <Heading id="reneg-title" top="$3,840 a year off," bottom="signed two weeks early." />
        </header>
        <p className="lede reneg-lede">The agent negotiated inside Priya's mandate; she approved each round, and Northwind signed in Inkwell on Fri Oct 30.</p>

        <div className="card thread">
          <p className="thread-title"><Glyph name="chat" /><span>Northwind Hosting renewal{dot}thread</span></p>
          <ol>
            <li><p className="quiet"><Nw>Fri Oct 16</Nw>{dot}10:20 am</p><p className="t-main">Proposal 1{dot}$91,200/yr for 2 years</p><p className="quiet">drafted by the agent{dot}<span className="nw">approved and sent by Priya <Check /></span></p></li>
            <li><p className="quiet"><Nw>Wed Oct 21</Nw>{dot}3:10 pm</p><p className="t-main t-who"><Avatar initials="LC" tone="lilac" /><span>Laura Chen, VP Sales, Northwind{dot}<b>counter $94,560/yr</b></span></p><p className="t-pills"><Pill tone="amber">outside the mandate</Pill><Pill tone="grey">Sent to Priya, not answered</Pill></p></li>
            <li><p className="quiet"><Nw>Thu Oct 22</Nw>{dot}9:42 am</p><p className="t-main">Proposal 2{dot}$92,160/yr (−4%){dot}within mandate</p><p className="quiet"><span className="nw">approved and sent by Priya <Check /></span></p></li>
            <li><p className="quiet"><Nw>Tue Oct 27</Nw>{dot}11:15 am</p><p className="t-main t-who"><Avatar initials="LC" tone="lilac" /><span>Northwind accepts $92,160/yr for 2 years <Check /></span></p></li>
          </ol>
        </div>

        <div className="card mandate">
          <p className="mandate-title"><Glyph name="sliders" /><span>Mandate{dot}Priya Raman{dot}<Nw>Thu Oct 15</Nw></span></p>
          <p className="quiet mandate-terms">2-year term{dot}target $91,200/yr (−5%){dot}walk-away $94,080/yr (−2%){dot}keep §5.2 and the 99.9% SLA</p>
          <div className="scale" role="img" aria-label="Mandate scale from $91,200 to $96,000: our first offer $91,200, agreed $92,160, walk-away $94,080, their counter $94,560">
            <span className="scale-end scale-low">$91,200</span><span className="scale-end scale-high">$96,000</span>
            <span className="scale-line" />
            {markers.map(marker => (
              <span key={marker.kind} className={`mk mk-${marker.kind}`} style={{ left: at(marker.value) }}>
                <i>{marker.kind === 'agreed' ? <Check /> : null}</i>
                <span><b>${marker.value.toLocaleString('en-US')}</b>{marker.label}</span>
              </span>
            ))}
          </div>
          <ul className="scale-legend" aria-hidden="true">
            {markers.map(marker => <li key={marker.kind} className={`mk-${marker.kind}`}><i /><b>${marker.value.toLocaleString('en-US')}</b>{marker.label}</li>)}
          </ul>
        </div>

        <div className="card amendment">
          <p className="amend-title"><Glyph name="doc" /><span><b>Amendment 3</b><span className="quiet">from template Supplier <span className="nw cursor-at">amendment v2<Cursor who="marcus" style={AT} /></span></span></span></p>
          <p className="amend-terms">Term 5{dot}<Nw>Jan 13, 2027</Nw>&nbsp;– <Nw>Jan 12, 2029</Nw><br />$92,160/yr{dot}total $184,320</p>
          <ul className="amend-steps">
            <li><CheckDot /><span>Approved by Marcus Lee, CFO{dot}Slack{dot}<span className="nw">Wed Oct 28, 10:05 am <Check /></span></span></li>
            <li><CheckDot /><span>Inkwell{dot}Laura Chen signed 1:20 pm{dot}Marcus Lee signed 2:05 pm{dot}<span className="nw">Fri Oct 30 <Check /></span></span></li>
            <li><CheckDot /><span>Filed to Drive / Suppliers / Northwind Hosting <Check /></span></li>
          </ul>
        </div>

        <p className="reneg-pill"><CheckDot tone="done" /><span>Governing price $92,160/yr from Amendment 3{dot}next notice deadline <Nw>Mon Nov 13, 2028</Nw>{dot}<span className="nw">calendar moved <Check /></span>{dot}saved $7,680 over 2 years&nbsp;+ $3,360 credits = $11,040</span></p>
        <Spark style={{ left: 1452, top: 876 }} turn={60} />
      </div>
    </section>
  )
}
