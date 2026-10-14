// Shared types, errors and input validation for Locket's server modules.

export type Role = 'owner' | 'counsel' | 'approver' | 'requester' | 'viewer' | 'agent'
export const roles: Role[] = ['owner', 'counsel', 'approver', 'requester', 'viewer', 'agent']

export interface Actor {
  id: string
  name: string
  email: string
  role: Role
  sessionId: string
  operatorVersion: number
}

export interface Sql {
  sql: string
  params: unknown[]
}
export const sql = (text: string, ...params: unknown[]): Sql => ({ sql: text, params })

export class Problem extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details: unknown = null,
  ) {
    super(message)
  }
}
export function fail(code: string, message: string, status = 400, details: unknown = null): never {
  throw new Problem(code, message, status, details)
}

type Input = Record<string, unknown>
export function object(value: unknown, name = 'payload'): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID', `${name} must be an object.`)
  return value as Input
}
export function text(p: Input, key: string, max = 2000): string {
  const value = p[key]
  if (typeof value !== 'string' || !value.trim()) fail('INVALID', `${key} is required.`, 400, { field: key })
  if (value.length > max) fail('INVALID', `${key} is longer than ${max} characters.`, 400, { field: key })
  return value.trim()
}
export function optionalText(p: Input, key: string, max = 2000): string | null {
  const value = p[key]
  if (value === undefined || value === null || value === '') return null
  return text(p, key, max)
}
export function oneOf<T extends string>(p: Input, key: string, allowed: readonly T[]): T {
  const value = p[key]
  if (typeof value !== 'string' || !allowed.includes(value as T))
    fail('INVALID', `${key} must be one of: ${allowed.join(', ')}.`, 400, { field: key })
  return value as T
}
export function integer(p: Input, key: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const value = p[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    fail('INVALID', `${key} must be a whole number from ${min} to ${max}.`, 400, { field: key })
  return value
}
export function bool(p: Input, key: string): boolean {
  const value = p[key] ?? false
  if (typeof value !== 'boolean') fail('INVALID', `${key} must be true or false.`, 400, { field: key })
  return value
}
const isoDate = /^\d{4}-\d{2}-\d{2}$/
export function date(p: Input, key: string): string {
  const value = text(p, key, 10)
  if (!isoDate.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value)
    fail('INVALID', `${key} must be a calendar date (YYYY-MM-DD).`, 400, { field: key })
  return value
}
export function optionalDate(p: Input, key: string): string | null {
  return p[key] === undefined || p[key] === null || p[key] === '' ? null : date(p, key)
}
/** Exact AUD amounts as decimal strings with at most two fractional digits. */
export function money(p: Input, key: string): number | null {
  const value = p[key]
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{1,12}(\.\d{1,2})?$/.test(value))
    fail('INVALID', `${key} must be an amount such as 48000 or 48000.50.`, 400, { field: key })
  const [whole, cents = ''] = value.split('.')
  return Number(whole) * 100 + Number(cents.padEnd(2, '0'))
}
export function list(p: Input, key: string, max = 100): unknown[] {
  const value = p[key] ?? []
  if (!Array.isArray(value)) fail('INVALID', `${key} must be a list.`, 400, { field: key })
  if (value.length > max) fail('INVALID', `${key} has more than ${max} entries.`, 400, { field: key })
  return value
}
export function timezone(p: Input, key: string): string {
  const value = text(p, key, 64)
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: value })
  } catch {
    fail('INVALID', `${key} must be an IANA time zone such as Australia/Sydney.`, 400, { field: key })
  }
  return value
}

export const json = (value: unknown) => JSON.stringify(value)
export const parse = <T = any>(value: unknown): T => (typeof value === 'string' ? JSON.parse(value) : (value as T))

export async function sha256(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
/** Stable JSON with sorted keys, so equal content always digests equally. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${canonical((value as any)[k])}`).join(',')}}`
  return JSON.stringify(value)
}
