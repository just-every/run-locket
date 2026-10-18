import { Avatar, Check, Chip, Cursor, Eyebrow, Heading, Nw, Pill, Spark, arrow, dot } from '../parts'

type Row = { name: string; value: string; renews: string; notice: string; cite: string; deadline: string; owner: string; proposed?: boolean }

const rows: Row[] = [
  { name: 'Northwind Hosting', value: '$96,000/yr', renews: 'Wed Jan 13, 2027', notice: '60 days', cite: '§11.2', deadline: 'Fri Nov 13', owner: 'Sam Ortiz' },
  { name: 'Cobalt Security', value: '$42,000/yr', renews: 'Mon Feb 1, 2027', notice: '90 days', cite: '§9.1', deadline: 'Mon Nov 2', owner: 'Sam Ortiz' },
  { name: 'Bluebird Facilities', value: '$36,000/yr', renews: 'Mon Mar 15, 2027', notice: '90 days', cite: '§12.3', deadline: 'Mon Dec 14', owner: 'Sam Ortiz' },
  { name: 'Harbor Data', value: '$28,800/yr', renews: 'Mon Mar 1, 2027', notice: '60 days', cite: '§10.2', deadline: 'Wed Dec 30', owner: 'Kevin Walsh', proposed: true },
]

/** 08, the question: one plain question over the clauses finds four renewals and the one unconfirmed term. */
export function Ask() {
  return (
    <section className="sec ask" aria-labelledby="ask-title">
      <div className="stage ask-stage">
        <header className="sec-head ask-head">
          <Eyebrow stage="Ask" when="Wed Oct 14, 9:10 – 9:20 am" />
          <Heading id="ask-title" top="One question," bottom="four renewals found." />
        </header>
        <p className="lede ask-lede">Priya asked what else was waiting on Sam. Locket answered with the clauses and flagged the one notice period nobody had confirmed.</p>

        <div className="card answer">
          <p className="ask-q"><Avatar initials="PR" tone="claret" /><span>Which supplier agreements auto-renew next quarter with 60+ days' notice?</span></p>
          <p className="ask-total"><span>4 agreements{dot}clauses cited</span><span className="ask-sum"><span className="ask-dot">{dot}</span>$202,800/yr</span></p>
          <div className="ask-table" role="table" aria-label="Supplier agreements that auto-renew next quarter">
            <div className="ask-tr ask-th" role="row">
              {['Agreement', 'Value', 'Auto-renews', 'Notice', 'Deadline', 'Owner'].map(head => <span key={head} role="columnheader">{head}</span>)}
            </div>
            {rows.map(row => (
              <div key={row.name} className={`ask-tr${row.proposed ? ' ask-proposed' : ''}`} role="row">
                <span role="cell" className="ask-name">{row.name}</span>
                <span role="cell" className="ask-value">{row.value}</span>
                <span role="cell"><span className="ask-k">Auto-renews{dot}</span><Nw>{row.renews}</Nw></span>
                <span role="cell" className="ask-notice">
                  <span><span className="ask-k">Notice{dot}</span>{row.notice}</span> <Chip>{row.cite}</Chip>
                  {row.proposed ? <><Pill tone="amber">proposed, not confirmed</Pill><Pill className="ask-confirmed">Confirmed by Priya{dot}<span className="nw">9:12 am <Check /></span>{dot}deadline now tracked<Cursor who="priya" style={{ left: 104, top: 26 }} /></Pill></> : null}
                </span>
                <span role="cell"><span className="ask-k">Deadline{dot}</span><Nw>{row.deadline}</Nw></span>
                <span role="cell"><span className="ask-k">Owner{dot}</span>{row.owner}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card ask-bulk">
          <p className="ask-bulk-title">Reassign Sam Ortiz{arrow}Kevin Walsh</p>
          <p className="quiet">26 agreements{dot}41 reminders and obligations{dot}9:20 am</p>
          <p className="ask-bulk-pills"><Pill>26 changed, 0 skipped <Check /></Pill><Pill tone="outline">revertible</Pill></p>
          <p className="quiet">Northwind decision stays with Priya</p>
        </div>
        <Spark style={{ left: 1458, top: 744 }} turn={40} />
      </div>
    </section>
  )
}
