import type { ReactNode } from 'react'
import { Check, Pill, Spark } from '../parts'
import { MascotWithFlag } from './Mascot'

// The band is a true calendar: Oct 1, 2026 to Jan 31, 2027 at equal days, every pin at its own date.
const LEFT = 68, RIGHT = 1468, PIN_Y = 589
const START = Date.UTC(2026, 9, 1), DAYS = (Date.UTC(2027, 0, 31) - START) / 864e5
const x = (month: number, day: number, year = 2026) => LEFT + ((Date.UTC(year, month, day) - START) / 864e5) * (RIGHT - LEFT) / DAYS

const months = [{ label: 'Oct 2026', at: x(9, 1) }, { label: 'Nov', at: x(10, 1) }, { label: 'Dec', at: x(11, 1) }, { label: 'Jan 2027', at: x(0, 1, 2027) }]
const weeks = Array.from({ length: 18 }, (_, i) => x(9, 5 + i * 7))

type Pin = { key: string; date: string; at: number; above: boolean; title: string; body: ReactNode; edge?: boolean; card: [number, number] }
const pins: Pin[] = [
  { key: 'cobalt', date: 'Mon Nov 2', at: x(10, 2), above: true, title: 'Cobalt Security', body: <><span>decided: renew</span><span>Kevin Walsh</span><Pill>Thu Oct 29 <Check /></Pill></>, card: [395, 470] },
  { key: 'northwind', date: 'Fri Nov 13', at: x(10, 13), above: false, title: 'Northwind Hosting', body: <><span>notice deadline</span><Pill>Amendment 3 signed Fri Oct 30 <Check /></Pill></>, edge: true, card: [561, 680] },
  { key: 'bluebird', date: 'Mon Dec 14', at: x(11, 14), above: true, title: 'Bluebird Facilities', body: <><span>notice deadline</span><span className="small">reminders to Kevin Walsh</span></>, card: [948, 444] },
  { key: 'brightline', date: 'Fri Dec 18', at: x(11, 18), above: false, title: 'Brightline Health', body: <><span>onboarding due</span><span>Dev Patel</span></>, card: [963, 680] },
  { key: 'harbor', date: 'Wed Dec 30', at: x(11, 30), above: true, title: 'Harbor Data', body: <><span>notice deadline</span><Pill>confirmed <Check /></Pill></>, card: [1222, 448] },
  { key: 'term5', date: 'Wed Jan 13', at: x(0, 13, 2027), above: false, title: 'Northwind term 5 begins', body: <span>$92,160/yr</span>, card: [1261, 690] },
]

/** 11, the interlude: the mascot plants its flag on Fri Nov 13 over a quarter of kept deadlines. */
export function Interlude() {
  return (
    <section className="sec interlude" aria-label="The quarter ahead: six dates, every one handled">
      <div className="stage interlude-stage">
        <MascotWithFlag />
        <span className="mascot-shadow" aria-hidden="true" />
        <svg className="band" viewBox="0 0 1536 914" aria-hidden="true">
          <rect className="band-card" x="45" y="533" width="1445" height="84" rx="16" />
          {months.map(month => <g key={month.label}><text x={month.at - 2} y="562">{month.label.toUpperCase()}</text><path className="tick-month" d={`M${month.at} 572V598`} /></g>)}
          {weeks.filter(at => !months.some(month => Math.abs(month.at - at) < 30)).map(at => <path key={at} className="tick" d={`M${at} 581V597`} />)}
          {pins.map(pin => <path key={`l-${pin.key}`} className="pin-line" d={pin.above ? `M${pin.card[0]} ${pin.card[1]}C${pin.card[0]} ${pin.card[1] + 60} ${pin.at} ${PIN_Y - 60} ${pin.at} ${PIN_Y - 10}` : `M${pin.at} ${PIN_Y + 10}V${pin.card[1]}`} />)}
          {pins.map(pin => <circle key={`p-${pin.key}`} className="pin" cx={pin.at} cy={PIN_Y} r="9.5" />)}
        </svg>
        <ol className="pins">
          {pins.map(pin => (
            <li key={pin.key} className={`card pin-card pin-${pin.key}${pin.edge ? ' pin-edge' : ''}`}>
              <p className="pin-date">{pin.date}</p>
              <p className="pin-title">{pin.title}</p>
              <p className="pin-body">{pin.body}</p>
            </li>
          ))}
        </ol>
        <Spark style={{ left: 594, top: 66 }} turn={-20} />
        <Spark style={{ left: 858, top: 140 }} turn={30} />
        <Spark style={{ left: 410, top: 228 }} turn={-60} />
      </div>
    </section>
  )
}
