import { Avatar, Check, Cursor, Eyebrow, Glyph, Heading, Nw, Spark, arrow, dot } from '../parts'

const decisions: [string, string, 'accepted' | 'rejected'][] = [
  [`§6.1 Net 30${arrow}Net 45`, 'playbook fallback', 'accepted'],
  [`§14.1 North Carolina${arrow}Delaware`, 'playbook fallback', 'accepted'],
  ['+ 7 drafting edits', '', 'accepted'],
  ["§9.2 'unlimited' restored", 'cap held', 'rejected'],
  ['§7.4 exclusivity added', '', 'rejected'],
  ['§15.2 assignment without consent', '', 'rejected'],
]

const Tool = ({ d }: { d: string }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={d} /></svg>

/** 05, the negotiation: Brightline's v3 open in Word with the Locket pane, nine kept, three rejected, saved as v4. */
export function Negotiate() {
  return (
    <section className="sec negotiate" aria-labelledby="negotiate-title">
      <div className="stage negotiate-stage">
        <header className="sec-head negotiate-head">
          <Eyebrow stage="Negotiate" when="Thu Oct 8 – Tue Oct 13" />
          <Heading id="negotiate-title" top="Their markup in Word." bottom="Their original, kept." />
          <p className="lede">Brightline's 12 tracked changes opened in Word beside the playbook. Priya kept nine, rejected three, and Locket saved v4 next to their file.</p>
        </header>

        <div className="card word">
          <p className="word-bar"><span className="word-lights" aria-hidden="true"><i /><i /><i /></span><Nw>Brightline_MSA_v3.docx</Nw></p>
          <div className="word-doc">
            <div className="word-tools" aria-hidden="true">
              <span className="word-style">Normal <Tool d="M6 8l4 4 4-4" /></span>
              <b>B</b><i>I</i><u>U</u>
              <Tool d="M3 5h14M3 9h9M3 13h14M3 17h9" /><Tool d="M3 5h14M6 9h8M3 13h14M6 17h8" /><Tool d="M3 5h14M8 9h9M3 13h14M8 17h9" />
              <Tool d="M7 5h10M7 10h10M7 15h10M3 5h.5M3 10h.5M3 15h.5" /><Tool d="M8 5h9M8 10h9M8 15h9M3 4v3M3 9.5h1.6L3 12h1.6M3 14h1.6v3H3" />
              <Tool d="M8.5 11.5l3-3M7 9l-2 2a2.8 2.8 0 0 0 4 4l2-2M13 11l2-2a2.8 2.8 0 0 0-4-4L9 7" /><Tool d="M3 4h14v12H3zM3 13l4-4 4 4 2-2 4 4" /><Tool d="M3 4h14v12H3zM3 8h14M3 12h14M8 4v12M13 4v12" />
            </div>
            <div className="word-page">
              <h3>§6.1 Payment</h3>
              <p>Customer shall pay each invoice within <del className="am">Net 30</del> <ins className="am">Net 45</ins>.</p>
              <Avatar initials="AM" tone="green" />
              <h3>§7.4 Exclusivity</h3>
              <p><ins className="gs">During the term, Fieldstone shall not provide the Platform to any other health system in Tennessee.</ins></p>
              <Avatar initials="GS" tone="purple" />
              <h3>§9.2 Liability</h3>
              <p>Each party's total liability is <del className="gs">capped at 12 months' fees</del> <ins className="gs">unlimited</ins>.</p>
            </div>
          </div>
          <div className="word-pane">
            <p className="word-pane-title">Locket</p>
            <p className="quiet">12 tracked changes{dot}4 comments</p>
            <ul className="word-rows">
              {decisions.map(([change, note, status]) => (
                <li key={change} className={`wrow wrow-${status}`}>
                  <span>{change}{note ? <>{dot}<span className="nw">{note}{status === 'accepted' ? <> <Check /></> : null}</span></> : null}</span>
                  <span className="wrow-pill">{status}</span>
                </li>
              ))}
            </ul>
            <p className="word-playbook">Playbook on v4: 30 of 30 met (2 by fallback) <Check /></p>
            <p className="word-saved">Saved as v4{dot}<Nw>Fri Oct 9, 11:25 am</Nw>{dot}emailed 11:32 am</p>
            <span className="word-save">Save as v4<Cursor who="priya" style={{ left: '76%', top: 12 }} /></span>
            <p className="word-original"><Glyph name="doc" /><span>v3{dot}their original{dot}<Nw>sha256 9f2c…41ab</Nw>{dot}<span className="nw">unchanged <Check /></span></span></p>
          </div>
        </div>

        <p className="card negotiate-reply"><Avatar initials="AM" tone="green" /><span><b>Alicia Moreno</b>{dot}<Nw>Tue Oct 13, 10:30 am CT</Nw>{dot}'v4 works for us.'</span></p>
        <Spark style={{ left: 420, top: 944 }} turn={-90} />
        <Spark style={{ left: 1080, top: 944 }} turn={90} />
      </div>
    </section>
  )
}
