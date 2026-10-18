import type { ReactNode } from 'react'
import { Check, Chip, Connector, Cursor, Eyebrow, Heading, Nw, Pill, Spark, Sticky, dot } from '../parts'
import { Signature } from './Hero'

type Version = { key: string; label: string; title: ReactNode; meta: ReactNode; digest: string; pill?: ReactNode; thumb: ReactNode }

const bars = (widths: number[]) => <span className="th-bars">{widths.map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</span>
const plain = (label: string, widths: number[]) => <div className="th-sec"><p className="th-label">{label}</p>{bars(widths)}</div>

const versions: Version[] = [
  {
    key: 'v1', label: 'Their paper', title: <>v1{dot}<Nw>Brightline_MSA.docx</Nw></>, meta: <>24 pages{dot}<Nw>Mon Oct 5</Nw></>, digest: '3a71…c08e',
    thumb: <>{plain('§6.1 Payment', [92, 86, 60])}{plain('§9.2 Liability', [90, 94, 72])}{plain('§14.1 Governing law', [94, 88, 54])}</>,
  },
  {
    key: 'v2', label: 'Our redlines', title: <>v2{dot}3 cited redlines</>, meta: <><Nw>Tue Oct 6</Nw>{dot}11:40 am</>, digest: 'b46d…e2f9',
    thumb: <>
      <div className="th-sec"><p className="th-label">§6.1 Payment</p><p className="th-red"><del>Net 90</del> <ins>Net 30</ins></p>{bars([82])}</div>
      <div className="th-sec"><p className="th-label">§9.2 Liability</p><p className="th-red"><del>unlimited</del> <ins>capped at 12 months' fees</ins></p>{bars([86])}</div>
      <div className="th-sec"><p className="th-label">§14.1 Governing law</p><p className="th-red"><del>Tennessee</del> <ins>North Carolina</ins></p>{bars([80])}</div>
    </>,
  },
  {
    key: 'v3', label: 'Their markup', title: <>v3{dot}12 tracked changes</>, meta: <><Nw>Thu Oct 8</Nw>{dot}4:40 pm CT</>, digest: '9f2c…41ab', pill: <Pill>original kept <Check /></Pill>,
    thumb: <>
      <div className="th-sec"><p className="th-label">§6.1 Payment</p><span className="th-bars th-tracked"><i className="am" style={{ width: '64%' }} /><i className="gs" style={{ width: '44%' }} /><i style={{ width: '50%' }} /></span><span className="th-badge am">AM</span></div>
      <div className="th-sec"><p className="th-label">§9.2 Liability</p><span className="th-bars th-tracked"><i className="gs" style={{ width: '40%' }} /><i className="am" style={{ width: '72%' }} /><i className="gs" style={{ width: '30%' }} /></span><span className="th-badge gs">GS</span></div>
      <div className="th-sec"><p className="th-label">§14.1 Governing law</p><span className="th-bars th-tracked"><i className="am" style={{ width: '30%' }} /><i className="gs" style={{ width: '58%' }} /><i style={{ width: '44%' }} /></span></div>
    </>,
  },
  {
    key: 'v4', label: 'Agreed', title: <>v4{dot}9 accepted{dot}3 rejected</>, meta: <><Nw>Fri Oct 9</Nw>{dot}11:25 am</>, digest: '5e18…7c3d', pill: <Pill>approved by Marcus Lee, CFO <Check /></Pill>,
    thumb: <>
      <div className="th-sec"><p className="th-label">§6.1 Payment <Check /></p>{bars([94, 76])}</div>
      <div className="th-sec"><p className="th-label">§9.2 Liability <Check /></p>{bars([90, 70])}</div>
      <div className="th-sec"><p className="th-label">§14.1 Governing law <Check /></p>{bars([92, 64])}</div>
    </>,
  },
  {
    key: 'signed', label: 'Signed', title: 'Signed PDF + certificate', meta: <>26 pages{dot}<Nw>Thu Oct 15</Nw>{dot}11:48 am</>, digest: 'd0a4…96b1', pill: <Pill>filed to Drive <Check /></Pill>,
    thumb: <>
      {bars([84, 92, 60])}
      <dl className="th-sign">
        <div><dt>By:</dt><dd><Signature className="th-sig" /></dd></div>
        <div><dt>Name:</dt><dd>Tom Brooks</dd></div>
        <div><dt>Title:</dt><dd>VP Finance</dd></div>
        <div><dt>Date:</dt><dd>Oct 15, 2026</dd></div>
      </dl>
    </>,
  },
]

/** 02, Brightline's version stack: five fanned pages from their paper to the signed copy, each with its digest. */
export function Versions() {
  return (
    <section className="sec versions" aria-labelledby="versions-title">
      <div className="stage versions-stage">
        <header className="sec-head versions-head">
          <Eyebrow stage="Brightline Health" when="Mon Oct 5 – Thu Oct 15" />
          <Heading id="versions-title" top="Four versions." bottom="One signed copy." />
          <p className="lede">Brightline's paper came in Mon Oct 5 and went out signed Thu Oct 15. Every version stayed, each with its own file and digest.</p>
        </header>
        <ol className="versions-fan">
          {versions.map(version => (
            <li key={version.key} className={`card vcard vcard-${version.key}`}>
              <div className="vthumb" aria-hidden="true"><p className="th-title">Master Services Agreement</p>{version.thumb}</div>
              <p className="vlabel">{version.label}</p>
              <p className="vtitle">{version.title}</p>
              <p className="vmeta">{version.meta}</p>
              <p className="vchips"><Chip>sha256 {version.digest}</Chip>{version.pill}</p>
            </li>
          ))}
        </ol>
        <span className="vpeek" aria-hidden="true" />
        <Connector className="versions-arrow" box="0 0 1060 60" d="M2 6C200 40 520 50 760 42S1000 22 1058 14" />
        <span className="versions-start" aria-hidden="true" />
        <Cursor who="priya" style={{ left: 494, top: 878 }} />
        <Cursor who="marcus" style={{ left: 986, top: 888 }} />
        <Cursor who="jenna" style={{ left: 1244, top: 896 }} />
        <Sticky className="versions-sticky">Signed<br />by Friday <Check /><span className="ul" /></Sticky>
        <Spark style={{ left: 1436, top: 356 }} turn={10} />
        <Spark style={{ left: 1474, top: 772 }} turn={10} />
      </div>
    </section>
  )
}
