import type { ReactNode } from 'react'
import { Avatar, Check, CheckDot, Chip, Connector, Cursor, Eyebrow, Glyph, Heading, Nw, Spark, dot } from '../parts'

const obligations: { text: ReactNode; cite: string; who: string; initials: string }[] = [
  { text: <>Onboarding complete by <Nw>Fri Dec 18</Nw></>, cite: 'Order Form §3', who: 'Dev Patel', initials: 'DP' },
  { text: 'Brightline pays Net 45', cite: '§6.1', who: 'Jenna Hart', initials: 'JH' },
  { text: <>SOC 2 Type II report every Feb 1{dot}first <Nw>Mon Feb 1, 2027</Nw></>, cite: '§8.4', who: 'Kevin Walsh', initials: 'KW' },
]

/** 06, approval, signing and filing: Marcus approves from Slack, the signer changes without a void, the copy files itself. */
export function Sign() {
  return (
    <section className="sec sign" aria-labelledby="sign-title">
      <div className="stage sign-stage">
        <header className="sec-head sign-head">
          <Eyebrow stage="Approve, sign, file" when="Tue Oct 13 – Thu Oct 15" />
          <Heading id="sign-title" top="New signer," bottom="same envelope." />
          <p className="lede">Marcus approved v4 from Slack. When Brightline's CFO handed signing to her VP Finance, the envelope kept going, and the signed copy filed itself.</p>
        </header>

        <div className="card sign-slack">
          <span className="sign-tile" aria-hidden="true" />
          <div>
            <p className="sign-app">Locket</p>
            <p className="mini-label">Approval needed</p>
            <p className="sign-ask">Brightline Health{dot}MSA v4&nbsp;+ Order Form v1{dot}$186,000</p>
            <p className="sign-rule">rule: customer agreements over $100,000&nbsp;→ CFO</p>
            <p className="sign-buttons"><span className="sb sb-go">Approve<Cursor who="marcus" pill="left" style={{ left: -2, top: 16 }} /></span><span className="sb">Hold</span><span className="sb">Open</span></p>
            <p className="sign-approved">Approved by Marcus Lee, CFO{dot}from Slack{dot}<span className="nw">Tue Oct 13, 4:02 pm <Check /></span>{dot}pinned to v4</p>
          </div>
        </div>
        <Connector className="sign-link" box="0 0 70 100" d="M6 2C-4 40 20 80 66 96" />

        <div className="card sign-envelope">
          <p className="sign-env-title">Docusign{dot}MSA&nbsp;+ Order Form</p>
          <p className="quiet">2 documents pinned by digest{dot}sent <Nw>Tue Oct 13, 4:10 pm</Nw>{dot}envelope ID unchanged</p>
          <ol className="signers">
            <li><Avatar initials="RK" tone="blue" /><span>Rachel Kim, CFO, Brightline</span></li>
            <li className="signer-down" aria-hidden="true">↓</li>
            <li className="signer-swap"><Avatar initials="TB" tone="blue" /><span><b>Tom Brooks, VP Finance</b>{dot}reassigned by Priya{dot}<Nw>Wed Oct 14, 10:20 am</Nw>{dot}no void</span><Cursor who="priya" style={{ left: 640, top: 22 }} /></li>
            <li><Avatar initials="TB" tone="blue" /><span><b>Tom Brooks</b>{dot}signed <Nw>Thu Oct 15, 9:36 am CT</Nw></span><Check className="ck big" /></li>
            <li><Avatar initials="ML" tone="blue" /><span><b>Marcus Lee, CFO, Fieldstone</b>{dot}signed 11:48 am</span><Check className="ck big" /></li>
          </ol>
          <p className="quiet sign-fields">MSA fields placed by Priya on p.22{dot}order form fields from the template's signature blocks</p>
        </div>

        <p className="card sign-toast"><Glyph name="folder" /><CheckDot /><span>11:49 am{dot}Signed PDF&nbsp;+ certificate filed to Drive / Customers / Brightline Health{dot}<span className="nw">reconciled: envelope, signers, 26 pages <Check /></span>{dot}<span className="nw">HubSpot deal: Executed <Check /></span></span></p>

        <div className="sign-obligations">
          <p className="mini-label">3 obligations confirmed by Priya{dot}1 duplicate rejected</p>
          <ul>
            {obligations.map(item => (
              <li key={item.cite} className="card ob">
                <CheckDot />
                <div><p>{item.text}</p><p><Chip>{item.cite}</Chip></p><p className="ob-who"><Avatar initials={item.initials} tone="lilac" />{item.who}</p></div>
              </li>
            ))}
          </ul>
        </div>
        <div className="sign-term">
          <p className="mini-label">Renewal term{dot}tracked</p>
          <div className="card ob ob-term">
            <Glyph name="calendar" />
            <div><p>Auto-renews <Nw>Thu Nov 1, 2029</Nw>{dot}90 days' notice{dot}deadline <Nw>Thu Aug 2, 2029</Nw></p><p><Chip>§10.2</Chip></p><p className="ob-who"><Avatar initials="PR" tone="lilac" />Priya Raman</p></div>
          </div>
        </div>
        <Spark style={{ left: 1392, top: 50 }} turn={30} />
        <Spark style={{ left: 1438, top: 806 }} turn={30} />
      </div>
    </section>
  )
}
