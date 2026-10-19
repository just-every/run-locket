// US business days (APPROVE-004): Monday to Friday in a person's US time zone,
// skipping the observed US federal holidays. A holiday on a Saturday is observed
// on the Friday before and one on a Sunday on the Monday after.
import { addDays, noticeDeadline, zonedInstant } from './dates'

export const usZones = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'] as const
export type UsZone = (typeof usZones)[number]
export const defaultZone: UsZone = 'America/New_York'

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
const weekday = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay()
/** The nth (1-based) weekday of a month, or the last one when n is 0. */
function nth(y: number, m: number, day: number, n: number) {
  if (n === 0) {
    const last = new Date(Date.UTC(y, m, 0))
    return iso(y, m, last.getUTCDate() - ((last.getUTCDay() - day + 7) % 7))
  }
  return iso(y, m, 1 + ((day - new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 7) % 7) + (n - 1) * 7)
}
function observed(date: string) {
  const w = weekday(date)
  return w === 6 ? addDays(date, -1) : w === 0 ? addDays(date, 1) : date
}

const holidayCache = new Map<number, Set<string>>()
/** Observed federal holiday dates that fall in a calendar year (including next year's New Year's Day observed on Dec 31). */
export function federalHolidays(y: number): Set<string> {
  let set = holidayCache.get(y)
  if (set) return set
  const days = [
    observed(iso(y, 1, 1)), nth(y, 1, 1, 3), nth(y, 2, 1, 3), nth(y, 5, 1, 0), observed(iso(y, 6, 19)), observed(iso(y, 7, 4)),
    nth(y, 9, 1, 1), nth(y, 10, 1, 2), observed(iso(y, 11, 11)), nth(y, 11, 4, 4), observed(iso(y, 12, 25)), observed(iso(y + 1, 1, 1)),
  ]
  set = new Set(days.filter(d => d.startsWith(`${y}-`)))
  holidayCache.set(y, set)
  return set
}

export function isBusinessDay(date: string) {
  const w = weekday(date)
  return w !== 0 && w !== 6 && !federalHolidays(Number(date.slice(0, 4))).has(date)
}

function wallClock(at: number, zone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at)).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` }
}

/** The same local wall-clock time on the nth business day after a moment's local date. */
export function addBusinessDays(at: number, days: number, zone: string): number {
  const start = wallClock(at, zone)
  let date = start.date
  for (let counted = 0; counted < days; ) {
    date = addDays(date, 1)
    if (isBusinessDay(date)) counted++
  }
  return zonedInstant(date, start.time, zone) + (at % 1000)
}

/** US-001: the date itself when it is a business day, else the closest business day before it. */
export function previousBusinessDay(date: string): string {
  while (!isBusinessDay(date)) date = addDays(date, -1)
  return date
}
/** A notice deadline, rolled back to the previous US business day when the installation's option is on. */
export function noticeDeadlineFor(endDate: string, noticeDays: number, timeZone: string, roll: boolean): { date: string; at: number } {
  const plain = noticeDeadline(endDate, noticeDays, timeZone)
  if (!roll) return plain
  const date = previousBusinessDay(plain.date)
  return { date, at: zonedInstant(date, '23:59:59', timeZone) }
}
