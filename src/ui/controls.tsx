import { cloneElement, useId, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { initials, statusLabel, when, words } from './format'

const tone: Record<string, string> = {
  draft: 'neutral', in_review: 'warn', approved: 'good', out_for_signature: 'info', executed: 'good', imported: 'neutral', cancelled: 'neutral',
  met: 'good', breached: 'bad', undetermined: 'warn', proposed: 'warn', confirmed: 'good', rejected: 'bad', superseded: 'neutral', done: 'neutral',
  pending: 'warn', prepared: 'info', sent: 'good', completed: 'good', voided: 'neutral', reconciled: 'good', needs_review: 'warn', accepted: 'good',
  previewed: 'info', applied: 'good', undone: 'neutral', import: 'good', skip: 'neutral', duplicate: 'warn', missing: 'bad',
}
export type Tone = 'good' | 'info' | 'warn' | 'bad' | 'neutral'
export function Badge({ value, label, tone: given }: { value: string; label?: string; tone?: Tone }) {
  return <span className={`lk-badge lk-${given ?? tone[value] ?? 'neutral'}`}>{label ?? statusLabel[value] ?? words(value)}</span>
}
export function Person({ name }: { name: string }) {
  return <span className="lk-person">{name}</span>
}
/** A person's initials disc, or Locket's mark for an agent. */
export function Avatar({ name, agent = false, large = false }: { name: string; agent?: boolean; large?: boolean }) {
  const size = large ? ' lk-avatar-large' : ''
  return agent ? <img className={`lk-avatar lk-avatar-agent${size}`} src="/brand/mark.svg" alt="" /> : <span className={`lk-avatar${size}`} aria-hidden="true">{initials(name)}</span>
}
/** A signing service's envelope ID; a long one (DocuSign's are 36 characters) shows its first eight, with the full ID in its title. */
export function EnvelopeId({ id }: { id: string }) {
  return <span className="lk-mono lk-nowrap" title={id}>{id.length > 16 ? `${id.slice(0, 8)}…` : id}</span>
}
/** A moment that never breaks across lines. */
export function When({ at }: { at: number | null | undefined }) {
  return <span className="lk-nowrap">{when(at)}</span>
}
export function Panel({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`lk-panel ${className}`}>
      {(title || actions) && <div className="lk-panel-head">{title && <h2>{title}</h2>}{actions}</div>}
      {children}
    </section>
  )
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="lk-empty">{children}</p>
}
/** A screen with nothing in it yet: the mascot, a short heading and what to do next. */
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="lk-empty-state">
      <img src="/brand/mark.svg" alt="" />
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  )
}
/** A labelled control: the label names it and the hint describes it. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactElement<any> }) {
  const id = useId()
  return (
    <div className="lk-field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  )
}
/** A form that hands its fields to `onSubmit` and stays put on failure. */
export function Form({ onSubmit, children, submit, busy, className = '' }: { onSubmit: (data: FormData, form: HTMLFormElement) => void | Promise<void>; children: ReactNode; submit: string; busy: boolean; className?: string }) {
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await onSubmit(new FormData(event.currentTarget), event.currentTarget)
  }
  return <form className={`lk-form ${className}`} onSubmit={handle}>{children}<div className="lk-form-actions"><button className="lk-primary" disabled={busy}>{submit}</button></div></form>
}
export const value = (data: FormData, name: string) => String(data.get(name) ?? '').trim()
const icons = {
  search: 'M11 11l3 3M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10z',
  upload: 'M8 11V2M4.5 5.5 8 2l3.5 3.5M2 11v3h12v-3',
  file: 'M4 1.5h5l3 3v10H4zM9 1.5v3h3',
  document: 'M3.5 1.5h5.5l3.5 3.5v9.5h-9zM9 1.5V5h3.5M5.75 8h4.5M5.75 10h4.5M5.75 12h3',
  documents: 'M5.5 1.5h5l3 3v8h-8zM10.5 1.5v3h3M2.5 4.5v10h7M7.5 7h4M7.5 9h4M7.5 11h2.5',
  certificate: 'M3 1.5h8l2 2v4.5M3 1.5v12h5M5 4.5h6M5 6.5h6M5 8.5h3M11.5 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM10.5 12.2l-.5 3.3 1.5-1 1.5 1-.5-3.3',
  calendar: 'M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3M5 9h.01M8 9h.01M11 9h.01M5 11.5h.01M8 11.5h.01M11 11.5h.01',
  people: 'M6 7a2.25 2.25 0 1 0 0-4.5A2.25 2.25 0 0 0 6 7zM1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M10.5 2.6a2.2 2.2 0 0 1 0 4.3M12 9.6c1.5.5 2.5 1.9 2.5 3.9',
  'person-doc': 'M3 1.5h5.5l2.5 2.5v3.5M3 1.5v12h4M5 5h3.5M5 7h4M5 9h2M11.5 11.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5zM8.5 15c0-1.7 1.3-2.7 3-2.7s3 1 3 2.7',
  export: 'M8 10.5v-9M5 4.5l3-3 3 3M5.5 7H3v7.5h10V7h-2.5',
  id: 'M1.5 3.5h13v9h-13zM4 6.5h3v3H4zM9 6.5h3.5M9 9h3.5',
  check: 'M3 8.5l3 3 7-7',
  warn: 'M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5v.5',
  ban: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13zM3.5 3.5l9 9',
  arrow: 'M6 3l5 5-5 5',
  forward: 'M2 8h11.5M9.5 4l4 4-4 4',
  back: 'M14 8H2.5M6.5 4l-4 4 4 4',
  book: 'M8 3.5C6.2 2.2 3.9 2 1.5 2.6v10.3c2.4-.6 4.7-.4 6.5.9 1.8-1.3 4.1-1.5 6.5-.9V2.6C12.1 2 9.8 2.2 8 3.5zM8 3.5v10.3',
  inbox: 'M1.5 9.5l2-6.5h9l2 6.5v4h-13zM1.5 9.5h4l1 1.75h3l1-1.75h4',
  pulse: 'M1.5 8.5h3l1.75-4.5 3 8.5 1.75-4h3.5',
  compare: 'M5.5 2v12M10.5 2v12M2 5h3.5M10.5 11H14M3.5 3.5 2 5l1.5 1.5M12.5 9.5 14 11l-1.5 1.5',
  restore: 'M5.5 3 2.5 6l3 3M2.5 6H10a3.5 3.5 0 0 1 0 7H8',
  folder: 'M1.5 3.5h5l1.5 1.5h6.5v8h-13z',
}
export type IconName = keyof typeof icons
export function Icon({ name }: { name: IconName }) {
  return <svg className="lk-icon" viewBox="0 0 16 16" aria-hidden="true"><path d={icons[name]} /></svg>
}
