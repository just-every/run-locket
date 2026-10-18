import { Check, Connector, Cursor, Eyebrow, HandNote, Heading, Nw, Pill, Spark, Sticky, dot } from '../parts'

/** 07, the renewal: Northwind's notice deadline, the bounced 30-day reminder (the page's one failure) and the resend. */
export function Renewal() {
  return (
    <section className="sec renewal" aria-labelledby="renewal-title">
      <div className="stage renewal-stage">
        <header className="sec-head renewal-head">
          <Eyebrow stage="Renewal" when="Wed Oct 14, 9:00 – 9:04 am" />
          <Heading id="renewal-title" top="The Nov 13 deadline," bottom="on Priya's calendar." />
          <p className="lede">Sam Ortiz had left Fieldstone, so Northwind's 30-day reminder bounced. Locket sent it to Priya four minutes later and put the deadline on her calendar.</p>
        </header>

        <div className="card renewal-record">
          <p className="rr-head"><span><b>Northwind Hosting</b><span className="quiet">supplier MSA</span></span><b className="rr-value">$96,000/yr</b></p>
          <dl className="kv rr-rows">
            <div><dt>Term</dt><dd>4{dot}<Nw>Jan 13, 2026</Nw>&nbsp;– <Nw>Jan 12, 2027</Nw></dd></div>
            <div><dt>Auto-renews</dt><dd><Nw>Wed Jan 13, 2027</Nw></dd></div>
            <div><dt>Notice</dt><dd>60 days, §11.2</dd></div>
            <div className="rr-deadline"><dt>Notice deadline</dt><dd><Nw>Fri Nov 13, 11:59 pm ET</Nw></dd></div>
          </dl>
        </div>

        <div className="card renewal-cal">
          <p className="cal-date" aria-hidden="true"><span>Nov</span><b>13</b></p>
          <div>
            <p className="cal-title"><b>Northwind Hosting</b>{dot}notice deadline</p>
            <p className="quiet">Fri Nov 13{dot}11:59 pm</p>
            <p><Pill className="cal-pill">Added to Priya's Google Calendar 9:04 am <Check /><Cursor who="priya" style={{ left: '58%', top: 30 }} /></Pill></p>
          </div>
        </div>
        <Sticky className="renewal-sticky">Glad this<br />one found<br />me!<span className="ul" /></Sticky>

        <div className="card ladder">
          <p className="ladder-title"><b>Reminder ladder</b>{dot}<span>Northwind</span></p>
          <ol>
            <li className="rung rung-done"><b>60 days</b>{dot}<Nw>Mon Sep 14, 9:00 am</Nw>{dot}to Sam Ortiz{dot}<span className="nw">delivered <Check /></span></li>
            <li className="rung rung-bounce">
              <p><b>30 days</b>{dot}<Nw>Wed Oct 14, 9:00 am</Nw>{dot}to <Nw>sam.ortiz@fieldstone.example</Nw></p>
              <p className="bounce"><span className="bounce-dot" aria-hidden="true" />bounced: 550 mailbox unavailable{dot}message ID kept</p>
            </li>
            <li className="rung"><b>9:00 am</b>{dot}no decision at 30 days{dot}escalated to Marcus Lee and Priya Raman</li>
            <li className="rung rung-done"><b>9:04 am</b>{dot}resent to Priya Raman{dot}<span className="nw">delivered <Check /></span></li>
            <li className="rung rung-later"><b>7 days</b>{dot}<Nw>Fri Nov 6</Nw>{dot}scheduled</li>
          </ol>
        </div>
        <HandNote className="note-lastday" path="M30 4C24 18 14 26 2 28M2 28l10-8M2 28l12 3" box="0 0 32 32" style={{ left: 1404, top: 150 }}>Fri Oct 9 ·<br />Sam's last day</HandNote>
        <Connector className="renewal-link" box="0 0 70 160" d="M66 4C20 20 0 70 6 156" />
        <Spark style={{ left: 1452, top: 50 }} turn={20} />
        <Spark style={{ left: 1316, top: 668 }} turn={20} />
      </div>
    </section>
  )
}
