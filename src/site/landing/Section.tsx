import type { ReactNode } from 'react'

/** One landing section: eyebrow with its hairline, a two-line serif heading, a line or two, and one engraved drawing. */
export function Section({ id, eyebrow, title, children, drawing, flip = false }: { id: string; eyebrow: string; title: ReactNode; children?: ReactNode; drawing: ReactNode; flip?: boolean }) {
  return (
    <section className={`ld-section${flip ? ' ld-flip' : ''}`} id={id} aria-labelledby={`${id}-title`}>
      <div className="ld-section-copy">
        <p className="ld-eyebrow">{eyebrow}</p>
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
      </div>
      <div className="ld-section-drawing">{drawing}</div>
    </section>
  )
}
