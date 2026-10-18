import type { ReactNode } from 'react'
import { Check, Cursor, Eyebrow, Glyph, Heading, Nw, Pill, Spark, dot } from '../parts'

type Finding = { section: string; rule: string; passage: ReactNode; extra: ReactNode }

const findings: Finding[] = [
  {
    section: '§9.2 Liability', rule: 'L-3',
    passage: <>“Each party's total liability is <del>unlimited</del><span className="to">→</span><ins>capped at 12 months' fees</ins>”</>,
    extra: <p className="finding-comment"><Glyph name="chat" /><span>External comment: We cap liability at 12 months' fees for every customer.</span><Cursor who="priya" style={{ left: '58%', top: 'calc(100% - 8px)' }} /></p>,
  },
  { section: '§6.1 Payment', rule: 'P-2', passage: <>Net <del>90</del><span className="to">→</span><ins>Net 30</ins></>, extra: <p><span className="pill pill-outline">Net 45 allowed</span></p> },
  { section: '§14.1 Governing law', rule: 'G-1', passage: <><del>Tennessee</del><span className="to">→</span><ins>North Carolina</ins></>, extra: <p><span className="pill pill-outline">Delaware allowed</span></p> },
]

/** 04, the review: Brightline's paper checked against Fieldstone's playbook v7, three cited findings. */
export function Review() {
  return (
    <section className="sec review" aria-labelledby="review-title">
      <div className="stage review-stage">
        <header className="sec-head review-head">
          <Eyebrow stage="Review" when="Tue Oct 6, 9:05 – 11:40 am" />
          <Heading id="review-title" top="Thirty rules," bottom="three redlines." />
          <p className="lede">Locket checked Brightline's paper against Fieldstone's own playbook. Each breach came with the passage, the rule and wording ready to send.</p>
        </header>

        <div className="card review-panel">
          <p className="review-title">Brightline MSA v1 (their paper)</p>
          <p className="review-meta">Customer MSA playbook v7{dot}30 rules{dot}27 met{dot}3 breached{dot}reviewed in 1 min 48 s</p>
          <svg className="review-dots" viewBox="0 0 656 16" role="img" aria-label="30 rules: 27 met, 3 breached">
            {Array.from({ length: 30 }, (_, i) => <circle key={i} cx={8 + i * 22.07} cy="8" r="7.2" className={i < 27 ? 'met' : 'breached'} />)}
          </svg>
          <ol className="review-findings">
            {findings.map(finding => (
              <li key={finding.rule} className="finding">
                <span className="finding-dot" aria-hidden="true" />
                <p className="finding-head"><b>{finding.section}</b>{dot}rule <Nw>{finding.rule}</Nw>{dot}breached</p>
                <p className="finding-passage">{finding.passage}</p>
                {finding.extra}
                <p><Pill>Accepted by Priya <Check /></Pill></p>
              </li>
            ))}
          </ol>
          <p className="review-foot"><Glyph name="lines" /><span>v2{dot}<Nw>Brightline_MSA_v2.docx</Nw>{dot}3 tracked changes by Priya Raman{dot}<span className="nw">2 internal notes stripped <Check /></span>{dot}emailed to Alicia Moreno 11:40 am</span></p>
          <Spark style={{ left: 738, top: 116 }} turn={60} />
        </div>
        <p className="card review-chip">Every finding cites playbook v7{dot}review record kept</p>
      </div>
    </section>
  )
}
