// Agreement reads and the shared write helpers every agreement command uses.
import { canSee, grantsFor, visibleSql } from './access'
import type { Ctx } from './commands'
import { canonical, fail, integer, parse, sha256, sql, type Sql } from './model'

export interface AgreementRow {
  id: string
  reference: string
  title: string
  type: string
  party_id: string
  value_cents: number | null
  currency: string
  owner_id: string
  requester_id: string
  status: string
  restricted: number
  needed_by: string | null
  start_date: string | null
  timezone: string
  parent_id: string | null
  relation: string | null
  origin: string
  current_version_id: string | null
  created_at: number
  updated_at: number
  version: number
}
export interface VersionRow {
  id: string
  agreement_id: string
  number: number
  kind: string
  label: string
  template_version_id: string | null
  fields: string | null
  text: string | null
  text_source: string
  digest: string
  created_by: string
  created_at: number
}

/** Loads an agreement the actor may see; restricted ones look absent to others. */
export async function visibleAgreement(c: Ctx, id: unknown): Promise<AgreementRow> {
  if (typeof id !== 'string' || !id) fail('INVALID', 'agreementId is required.')
  const row = await c.db.prepare('SELECT * FROM lk_agreements WHERE id=?').bind(id).first<AgreementRow>()
  if (!row || !canSee(c.actor, row, await grantsFor(c.env, c.actor))) fail('NOT_FOUND', 'No agreement you can access has that identity.', 404)
  return row
}

/** Reads the client's expected agreement version and fences it in the batch. */
export function expectVersion(a: AgreementRow, payload: Record<string, unknown>): Sql[] {
  const expected = integer(payload, 'version', 1)
  if (expected !== a.version) fail('STALE', `${a.reference} changed since you loaded it. Reload and review it again.`, 409, { current: a.version })
  return [sql('(SELECT version FROM lk_agreements WHERE id=?)=?', a.id, a.version)]
}
/** Fence for commands that do not take a client version: the version we read. */
export const sameVersion = (a: AgreementRow): Sql => sql('(SELECT version FROM lk_agreements WHERE id=?)=?', a.id, a.version)

export function agreementGuards(c: Ctx, a: AgreementRow, payload?: Record<string, unknown>): Sql[] {
  return [visibleSql(c.actor, a.id), ...(payload ? expectVersion(a, payload) : [sameVersion(a)])]
}

export const bump = (c: Ctx, a: AgreementRow, set = '', ...params: unknown[]): Sql =>
  sql(`UPDATE lk_agreements SET version=version+1, updated_at=?${set ? ', ' + set : ''} WHERE id=?`, c.now, ...params, a.id)

export async function versionsOf(c: Ctx, agreementId: string): Promise<VersionRow[]> {
  return (await c.db.prepare('SELECT * FROM lk_versions WHERE agreement_id=? ORDER BY number').bind(agreementId).all<VersionRow>()).results
}
export async function currentVersion(c: Ctx, a: AgreementRow): Promise<VersionRow> {
  if (!a.current_version_id) fail('NO_VERSION', `${a.reference} has no document version yet.`, 409)
  const v = await c.db.prepare('SELECT * FROM lk_versions WHERE id=?').bind(a.current_version_id).first<VersionRow>()
  if (!v) fail('NO_VERSION', `${a.reference} has no document version yet.`, 409)
  return v
}

/** Identity of a version: its files' bytes, its text and its populated fields. */
export async function versionDigest(input: { agreementId: string; number: number; files: { role: string; sha256: string }[]; text: string | null; fields: unknown }): Promise<string> {
  const files = [...input.files].sort((a, b) => (a.role + a.sha256).localeCompare(b.role + b.sha256))
  return sha256(canonical({ agreement: input.agreementId, number: input.number, files, text: input.text === null ? null : await sha256(input.text), fields: input.fields ?? null }))
}

/** Every live approval stops counting when the document or decision context changes. */
export const invalidateApprovals = (c: Ctx, agreementId: string, reason: string): Sql =>
  sql('UPDATE lk_approvals SET invalidated_at=?, invalidated_reason=? WHERE agreement_id=? AND invalidated_at IS NULL', c.now, reason, agreementId)

/** After a document change an approved agreement returns to review. */
export function statusAfterChange(a: AgreementRow): string {
  if (a.status === 'approved') return 'in_review'
  return a.status
}

export function requireStatus(a: AgreementRow, allowed: string[], action: string): void {
  if (!allowed.includes(a.status)) fail('STATUS', `${a.reference} is ${a.status.replace(/_/g, ' ')}; it cannot ${action} now.`, 409)
}

export const parseJson = parse
