import type { ReactNode } from 'react'
import { Icon, type IconName } from './controls'

/**
 * Locket's one engraved card: the real content printed like an intaglio certificate, with a guilloché border, a
 * hatched ground and, when named, a rosette medallion holding a line icon. The engraving is decoration; every word
 * inside stays real text. Used once per app screen and in every landing drawing (SPEC §2.4).
 */
export function Engraved({ medallion, className = '', label, children }: { medallion?: IconName; className?: string; label?: string; children: ReactNode }) {
  return (
    <div className={`lk-engraved${className ? ` ${className}` : ''}`} role={label ? 'group' : undefined} aria-label={label}>
      {medallion && <span className="lk-medallion" aria-hidden="true"><Icon name={medallion} /></span>}
      <div className="lk-engraved-body">{children}</div>
    </div>
  )
}
