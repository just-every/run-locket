import { Mark } from '../parts'

/** The mascot is the logo itself: the approved mark, with an arm and the flag it plants drawn in the mark's outline. */
export function MascotWithFlag() {
  return (
    <span className="mascot mascot-flag" aria-hidden="true">
      <svg className="mascot-gear" viewBox="-70 0 190 460">
        <path className="flag" d="M61 8-58 50 61 94Z" />
        <path className="pole" d="M61 2V458" />
        <path className="arm" d="M112 250C94 252 78 238 66 216" />
        <circle className="paw" cx="64" cy="214" r="12" />
      </svg>
      <Mark height={330} className="mascot-mark" />
    </span>
  )
}

/** The mascot holding up its tear-off date card. */
export function MascotWithDate() {
  return (
    <span className="mascot mascot-date" aria-hidden="true">
      <svg className="mascot-gear" viewBox="0 0 120 200">
        <path className="arm" d="M10 136C44 132 70 96 80 34" />
        <circle className="paw" cx="80" cy="30" r="12" />
      </svg>
      <Mark height={300} className="mascot-mark" />
      <span className="tearoff"><i /><i /><b>FRI<br />NOV 13</b></span>
    </span>
  )
}
