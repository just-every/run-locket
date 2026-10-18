import { hero } from '../copy'
import { links } from '../../shell/links'
import { AT, Check, Cursor, Glyph, HandNote, Nw, Spark, Sticky, arrow, dot } from '../parts'

const Arrow = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" /></svg>

/** A hand-drawn signature stroke for the signed pages. */
export const Signature = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 160 46" aria-hidden="true">
    <path d="M4 38c10-9 18-22 22-30 3-6 5-3 3 4-2 9-6 20-4 22 3 2 9-15 13-17s1 13 5 13 9-12 13-12-1 11 3 11c5 0 9-7 14-8 7-1 12 2 22 1 12-1 28-4 50-6" />
  </svg>
)

/** 01, the hero: the promise, the actions, and Brightline's MSA blown up with the cards around it. */
export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="stage hero-stage">
        <div className="hero-copy">
          <h1 id="hero-title" className="hero-title"><span className="hd-1">{hero.headline[0]}</span> <span className="hd-2"><span>{hero.headline[1]}</span></span></h1>
          <p className="hero-sub">{hero.subhead}</p>
          <p className="hero-alt">100% free, open source alternative to <b>{hero.alternatives[0]}</b>, <b>{hero.alternatives[1]}</b> and <b>{hero.alternatives[2]}</b></p>
          <div className="hero-actions">
            <a className="btn-run" href={links.run}>{hero.run}<Arrow /></a>
            <a className="text-link" href={links.demo}>{hero.demo}</a>
            <a className="text-link" href={links.docs}>{hero.docs}</a>
          </div>
        </div>

        <div className="card hero-deal">
          <p className="hero-deal-head"><span className="hero-tile" aria-hidden="true" />HubSpot deal{arrow}Locket</p>
          <p className="hero-deal-title">Brightline Health{dot}MSA + Order Form{dot}<b>$186,000</b>{dot}<Nw>Mon Oct 5</Nw></p>
          <p className="hero-deal-lines"><span>Platform{dot}$54,000/yr × 3 = $162,000</span><span>Onboarding{dot}$24,000</span></p>
        </div>

        <article className="hero-doc" aria-label="Brightline_MSA_v3.docx, section 9.2 Liability">
          <p className="doc-file"><span className="doc-w" aria-hidden="true">W</span>Brightline_MSA_v3.docx</p>
          <p className="doc-meta">Master Services Agreement<br />Brightline Health, Inc. and Fieldstone Software, Inc.</p>
          <h3 className="doc-h">§9.2 Liability</h3>
          <p className="doc-p">Except for a party's indemnification obligations, neither party is liable for indirect, incidental, special or consequential damages. Each party's total liability is <del>unlimited</del> <ins>capped at 12 months' fees</ins>.<Cursor who="priya" style={{ left: 150, top: '100%' }} /></p>
          <aside className="doc-comment" aria-label="Margin comment">
            <p><span className="dot" aria-hidden="true" /><b>Playbook <Nw>L-3</Nw></b></p>
            <p>cap liability at 12&nbsp;months' fees</p>
          </aside>
          <svg className="doc-comment-lead" viewBox="0 0 60 90" aria-hidden="true"><path d="M50 2c-2 30-14 52-44 80" /><circle cx="6" cy="82" r="4.5" /></svg>
          <dl className="doc-sign">
            <div><dt>By:</dt><dd><Signature className="doc-sig" /></dd></div>
            <div><dt>Name:</dt><dd>Tom Brooks</dd></div>
            <div><dt>Title:</dt><dd>VP Finance</dd></div>
            <div><dt>Date:</dt><dd>Oct 15, 2026</dd></div>
          </dl>
          <p className="doc-foot">12 tracked changes{dot}9 accepted{dot}3 rejected{dot}<span className="nw">original kept <Check /></span></p>
        </article>

        <div className="card hero-approve">
          <span className="hero-approve-icon" aria-hidden="true"><Check /></span>
          <div>
            <p className="hero-approve-title">v4 approved</p>
            <p>Marcus Lee, CFO{dot}over $100,000</p>
            <p className="quiet">from Slack{dot}<span className="nw cursor-at">Tue Oct 13, 4:02 pm <Check /><Cursor who="marcus" pill="left" style={AT} /></span></p>
          </div>
        </div>

        <div className="card hero-sign">
          <Glyph name="pen" />
          <div>
            <p className="hero-card-title">Docusign{dot}MSA + Order Form</p>
            <p className="quiet">signer reassigned to Tom Brooks, VP Finance{dot}no void</p>
            <p><span className="pill pill-done">signed <Nw>Thu Oct 15, 11:48 am</Nw> <Check /></span></p>
          </div>
        </div>

        <div className="card hero-filed">
          <Glyph name="folder" />
          <div>
            <p>Signed PDF + certificate filed to Drive / Customers / Brightline Health</p>
            <p>HubSpot deal: Executed <Check /></p>
          </div>
        </div>

        <div className="card hero-renew">
          <div className="hero-renew-head">
            <Glyph name="doc" />
            <div>
              <p><b>Northwind Hosting</b>{dot}<span className="quiet">supplier</span></p>
              <p>$96,000/yr{dot}auto-renews <Nw>Wed Jan 13, 2027</Nw></p>
              <p>60-day notice{dot}deadline <Nw>Fri Nov 13</Nw></p>
            </div>
          </div>
          <ol className="hero-steps">
            <li className="step-fail"><span className="step-icon" aria-hidden="true">!</span><p>30-day reminder{dot}<Nw>Wed Oct 14, 9:00 am</Nw>{dot}to Sam Ortiz{dot}bounced: left Fieldstone</p></li>
            <li className="step-done"><span className="ckdot ckdot-done" aria-hidden="true"><Check /></span><p>Resent to Priya Raman{dot}<span className="nw">9:04 am <Check /></span>{dot}on her Google Calendar <Check /></p></li>
            <li className="step-next"><Glyph name="lines" /><p><b>Decision: renegotiate</b>{dot}<Nw>Thu Oct 15</Nw>{dot}renewal brief ready</p></li>
          </ol>
        </div>

        <Sticky className="hero-sticky">Brightline<br />signed by<br />Friday!<span className="ul" /></Sticky>

        <HandNote className="note-cap" path="M14 6C2 40 10 78 52 104M52 104l-16-1M52 104l-3-15" box="0 0 60 110" style={{ left: 638, top: -12 }}>liability cap<br />redlined</HandNote>
        <HandNote className="note-cfo" path="M44 4C22 10 8 26 6 54M6 54 1 40M6 54l11-10" box="0 0 50 60" style={{ left: 1088, top: -10 }}>CFO approved</HandNote>
        <HandNote className="note-signed" path="M24 30C14 24 6 12 4 2M4 2 3 15M4 2l11 7" box="0 0 30 34" style={{ left: 1000, top: 525 }}>signed</HandNote>
        <HandNote className="note-filed" path="M4 14c26-10 44-4 52 22M56 36 44 29M56 36l2-13" box="0 0 64 40" style={{ left: 895, top: 702 }}>filed</HandNote>
        <svg className="hero-loop" viewBox="0 0 90 110" aria-hidden="true"><path d="M78 104C84 60 60 18 12 6M12 6l14-4M12 6l10 11" /></svg>
        <Spark style={{ left: 1462, top: 6 }} turn={8} />
        <Spark style={{ left: 662, top: 540 }} turn={-30} />
        <Spark style={{ left: 1056, top: 730 }} turn={20} />
      </div>
    </section>
  )
}
