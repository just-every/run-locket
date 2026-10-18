import type { CSSProperties, ReactNode } from 'react'

// The homepage's shared drawing parts: headings, eyebrows, cards, pills, chips, cursors, stickies, sparks and
// connectors. Every string is real text; every drawing is CSS or inline SVG (styles in ../styles/parts.css).

/** Separators and arrows bind to the word before them, so no wrapped line starts with one. */
export const dot = ' · '
export const arrow = ' → '
export const join = (...parts: ReactNode[]) => parts.flatMap((part, index) => index ? [dot, part] : [part])

/** An ID, date, file name or command fragment that never breaks inside. */
export function Nw({ children }: { children: ReactNode }) {
  return <span className="nw">{children}</span>
}

/** A section heading: the first line solid ink, the second line the claret-to-copper gradient. */
export function Heading({ id, top, bottom, className }: { id: string; top: ReactNode; bottom: ReactNode; className?: string }) {
  return (
    <h2 id={id} className={`hd${className ? ` ${className}` : ''}`}>
      <span className="hd-1">{top}</span>{' '}
      <span className="hd-2"><span>{bottom}</span></span>
    </h2>
  )
}

/** The stage-and-date line over a section heading. Each side of a range stays whole: "Mon Oct 5 – Thu Oct 15". */
export function Eyebrow({ stage, when }: { stage: string; when: string }) {
  const [from, to] = when.split(' – ')
  return <p className="eyebrow"><span className="nw">{stage}</span>{dot}<span className="nw">{from}</span>{to ? <>{'\u00a0– '}<span className="nw">{to}</span></> : null}</p>
}

export function Check({ className = 'ck' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.6 6.4 12 13 4.5" /></svg>
}

/** A check in a round tint, as the checked rows and cards draw it. */
export function CheckDot({ tone = 'done' }: { tone?: 'done' | 'soft' }) {
  return <span className={`ckdot ckdot-${tone}`} aria-hidden="true"><Check /></span>
}

export function Pill({ tone = 'done', children, className }: { tone?: 'done' | 'fail' | 'amber' | 'claret' | 'grey' | 'outline'; children: ReactNode; className?: string }) {
  return <span className={`pill pill-${tone}${className ? ` ${className}` : ''}`}>{children}</span>
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`chip${className ? ` ${className}` : ''}`}>{children}</span>
}

export function Avatar({ initials, tone = 'blue' }: { initials: string; tone?: 'blue' | 'green' | 'purple' | 'grey' | 'claret' | 'lilac' }) {
  return <span className={`av av-${tone}`} aria-hidden="true">{initials}</span>
}

type Who = 'priya' | 'marcus' | 'jenna'
const names: Record<Who, string> = { priya: 'Priya', marcus: 'Marcus', jenna: 'Jenna' }

/** A collaborator's cursor: the filled arrow and the name pill. Inside a `.cursor-at` span, AT places the arrow's tip
 * just past the span's last character, so it rests beside the words it points at however they wrap. */
export const AT: CSSProperties = { left: 'calc(100% + 5px)', top: '45%' }
export function Cursor({ who, style, pill = 'right' }: { who: Who; style?: CSSProperties; pill?: 'right' | 'left' }) {
  return (
    <span className={`cursor cursor-${who} cursor-pill-${pill}`} style={style} aria-hidden="true">
      <svg viewBox="0 0 24 26"><path d="M3 2.5 21 12.2l-7.6 2.3-3.9 7.6Z" /></svg>
      <span>{names[who]}</span>
    </span>
  )
}

/** A pale yellow handwritten sticky. */
export function Sticky({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <p className={`sticky${className ? ` ${className}` : ''}`} style={style}>{children}</p>
}

/** Three copper strokes: the page's little spark doodle. `turn` rotates it in degrees. */
export function Spark({ style, turn = 0 }: { style?: CSSProperties; turn?: number }) {
  return (
    <svg className="spark" viewBox="0 0 40 40" style={{ ...style, rotate: `${turn}deg` }} aria-hidden="true">
      <path d="M8 22 4 10M17 18 19 5M23 25 34 18" />
    </svg>
  )
}

/** A hand note in Kalam with its drawn arrow; the arrow is a path in the note's own box. */
export function HandNote({ children, className, style, path, box }: { children: ReactNode; className?: string; style?: CSSProperties; path: string; box: string }) {
  return (
    <span className={`hand${className ? ` ${className}` : ''}`} style={style}>
      <span className="hand-text">{children}</span>
      <svg className="hand-arrow" viewBox={box} aria-hidden="true"><path d={path} /></svg>
    </span>
  )
}

/** A dotted claret connector drawn in its own box (positions in the parent's CSS). */
export function Connector({ className, box, d, head = true, tone = 'claret' }: { className: string; box: string; d: string; head?: boolean; tone?: 'claret' | 'copper' }) {
  return (
    <svg className={`conn conn-${tone} ${className}`} viewBox={box} aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <marker id={`h-${className}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M1 1 7 5 1 9" />
        </marker>
      </defs>
      <path d={d} markerEnd={head ? `url(#h-${className})` : undefined} />
    </svg>
  )
}

/** A plain line icon (document, folder, calendar, pen, chat, sliders, alert) for cards that carry one. */
export function Glyph({ name }: { name: 'doc' | 'folder' | 'calendar' | 'pen' | 'chat' | 'sliders' | 'lines' }) {
  const paths: Record<typeof name, ReactNode> = {
    doc: <><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v5h5" /></>,
    lines: <><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v5h5M9.5 12.5h6M9.5 15.5h6M9.5 18h4" /></>,
    folder: <path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v8.3A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z" />,
    calendar: <><rect x="4" y="5.5" width="16" height="14.5" rx="2" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>,
    pen: <><path d="m15.5 4.5 4 4L9 19l-5 1 1-5Z" /><path d="m13.5 6.5 4 4" /></>,
    chat: <path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16h-8l-4.5 3.5V16H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5Z" />,
    sliders: <path d="M4 7h16M4 12h16M4 17h16M9 5v4M15 10v4M7 15v4" />,
  }
  return <svg className={`glyph glyph-${name}`} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

/** The approved Locket mark (public/brand/mark.svg). Its box is 664 by 766. */
export function Mark({ height, className }: { height: number; className?: string }) {
  return <img className={className} src="/brand/mark.svg" alt="" width={Math.round(height * 664 / 766)} height={height} />
}
