// Calendar-date arithmetic for notice windows. A notice deadline is the last
// moment (23:59:59) of the deadline date in the agreement's own time zone.

export function addDays(date: string, days: number): string {
  const t = Date.parse(date + 'T00:00:00Z') + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

function offsetMs(utc: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utc))
      .filter(p => p.type !== 'literal')
      .map(p => [p.type, Number(p.value)]),
  )
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - utc
}

/** UTC instant of a wall-clock time in a time zone. */
export function zonedInstant(date: string, time: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number), [h, mi, s] = time.split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, h, mi, s)
  let utc = wall - offsetMs(wall, timeZone)
  utc = wall - offsetMs(utc, timeZone)
  return utc
}

export function noticeDeadline(endDate: string, noticeDays: number, timeZone: string): { date: string; at: number } {
  const date = addDays(endDate, -noticeDays)
  return { date, at: zonedInstant(date, '23:59:59', timeZone) }
}
