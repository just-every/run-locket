// REPO-010: counterparty records. People who take requests record a
// counterparty's legal details, notice address and method, contacts and
// authorized signatories (Locket records them; it never validates authority).
// Owner or counsel merge a duplicate into the record they keep: its agreements
// and clickwrap acceptances move over in one guarded write, agreements still in
// negotiation lose their approvals, and the duplicate stays as merged history.
import { agreementAccessSql, may, requireRole } from './access'
import type { Ctx, Handler } from './commands'
import { fail, integer, list, object, oneOf, optionalText, sql, text, type Sql } from './model'
import { invalidateApprovals } from './records'

export const partyKinds = ['customer', 'supplier', 'partner', 'other'] as const
export const noticeMethods = ['email', 'post', 'courier', 'hand'] as const
const ein = /^\d{2}-\d{7}$/
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** US-001: a counterparty's EIN (12-3456789), or a foreign tax ID recorded as given. */
function taxId(p: Record<string, unknown>) {
  const kind = p.taxIdKind === undefined || p.taxIdKind === null || p.taxIdKind === '' ? null : oneOf(p, 'taxIdKind', ['ein', 'foreign'] as const)
  const id = kind ? text(p, 'taxId', 40) : null
  if (kind === 'ein' && !ein.test(id!)) fail('INVALID', 'An EIN is nine digits written 12-3456789.', 400, { field: 'taxId' })
  return { kind, id }
}
function people(p: Record<string, unknown>, key: 'contacts' | 'signatories') {
  const rows = list(p, key, 50).map((value, i) => {
    const r = object(value, `${key}[${i}]`)
    const address = text(r, 'email', 200).toLowerCase()
    if (!email.test(address)) fail('INVALID', `${address} is not an email address.`, 400, { field: key })
    return { name: text(r, 'name', 200), email: address, title: key === 'signatories' ? text(r, 'title', 120) : optionalText(r, 'title', 120) }
  })
  if (new Set(rows.map(r => r.email)).size !== rows.length) fail('INVALID', `Each of the ${key} appears once.`, 400, { field: key })
  return JSON.stringify(rows)
}
function details(p: Record<string, unknown>) {
  const tax = taxId(p)
  const contact = optionalText(p, 'email', 200)
  if (contact && !email.test(contact)) fail('INVALID', `${contact} is not an email address.`, 400, { field: 'email' })
  return {
    kind: oneOf(p, 'kind', partyKinds), taxKind: tax.kind, taxId: tax.id, email: contact,
    entityType: optionalText(p, 'entityType', 120), formation: optionalText(p, 'formation', 120), registered: optionalText(p, 'registeredAddress', 1000),
    notice: optionalText(p, 'noticeAddress', 1000), method: p.noticeMethod ? oneOf(p, 'noticeMethod', noticeMethods) : null,
    contacts: people(p, 'contacts'), signatories: people(p, 'signatories'),
  }
}

/** A new counterparty from intake or the counterparty form. */
export function partyInsert(id: string, name: string, p: Record<string, unknown>, c: Ctx): Sql {
  const d = details(p)
  return sql('INSERT INTO lk_parties(id,name,kind,tax_id,tax_id_kind,email,entity_type,formation,registered_address,notice_address,notice_method,contacts,signatories,created_by,created_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)',
    id, name, d.kind, d.taxId, d.taxKind, d.email, d.entityType, d.formation, d.registered, d.notice, d.method, d.contacts, d.signatories, c.actor.id, c.now)
}

/** The record a counterparty resolves to: a merged duplicate resolves to the record it was merged into. */
export async function livePartyId(c: Pick<Ctx, 'db'>, id: string): Promise<string> {
  const row = await c.db.prepare('SELECT merged_into FROM lk_parties WHERE id=?').bind(id).first<{ merged_into: string | null }>()
  return row?.merged_into ?? id
}

const party = async (c: Ctx, id: string) => c.db.prepare('SELECT * FROM lk_parties WHERE id=?').bind(id).first<any>()

/** Workspace visibility of a counterparty: hidden when every agreement naming it is
 * hidden from this person. Lookup, reuse and edits read through it, and `check`
 * repeats it inside the guarded write. */
export async function visibleParty(c: Ctx, id: string): Promise<{ row: any; check: Sql } | null> {
  const access = agreementAccessSql(c.actor.id, 'linked')
  const check = sql(`EXISTS(SELECT 1 FROM lk_parties party WHERE party.id=? AND (NOT EXISTS(SELECT 1 FROM lk_agreements linked WHERE linked.party_id=party.id) OR EXISTS(SELECT 1 FROM lk_agreements linked WHERE linked.party_id=party.id AND ${access.sql})))`, id, ...access.params)
  const row = await c.db.prepare(`SELECT * FROM lk_parties WHERE id=? AND ${check.sql}`).bind(id, ...check.params).first<any>()
  return row ? { row, check } : null
}

const saveParty: Handler = async (c, p) => {
  requireRole(c.actor, may.intake, 'maintain counterparties')
  const name = text(p, 'name', 200)
  if (typeof p.id === 'string') {
    const visible = await visibleParty(c, p.id)
    if (!visible) fail('NOT_FOUND', 'No such counterparty.', 404)
    const row = visible.row
    if (row.merged_into) fail('MERGED', `${row.name} was merged into another counterparty; edit that one.`, 409)
    if (p.version !== undefined && integer(p, 'version', 1) !== row.version) fail('STALE', `${row.name} changed since you loaded it. Reload before editing.`, 409)
    const d = details(p)
    return {
      allowed: may.intake, result: { id: p.id, version: row.version + 1 },
      writes: [sql('UPDATE lk_parties SET name=?, kind=?, tax_id=?, tax_id_kind=?, email=?, entity_type=?, formation=?, registered_address=?, notice_address=?, notice_method=?, contacts=?, signatories=?, version=version+1 WHERE id=?',
        name, d.kind, d.taxId, d.taxKind, d.email, d.entityType, d.formation, d.registered, d.notice, d.method, d.contacts, d.signatories, p.id)],
      checks: [sql('(SELECT version FROM lk_parties WHERE id=?)=? AND (SELECT merged_into FROM lk_parties WHERE id=?) IS NULL', p.id, row.version, p.id), visible.check],
      audit: [{ action: 'party.save', summary: `Updated counterparty ${name}` }],
    }
  }
  const id = crypto.randomUUID()
  return { allowed: may.intake, result: { id, version: 1 }, writes: [partyInsert(id, name, p, c)], audit: [{ action: 'party.save', summary: `Added counterparty ${name}` }] }
}

const mergeParty: Handler = async (c, p) => {
  requireRole(c.actor, may.grantAccess, 'merge counterparties')
  const keep = await party(c, text(p, 'keepId', 100)), duplicate = await party(c, text(p, 'duplicateId', 100))
  if (!keep || !duplicate) fail('NOT_FOUND', 'Choose two recorded counterparties.', 404)
  if (keep.id === duplicate.id) fail('INVALID', 'Choose a different counterparty to merge.', 400, { field: 'duplicateId' })
  if (keep.merged_into || duplicate.merged_into) fail('MERGED', 'One of these counterparties was already merged.', 409)
  const reason = text(p, 'reason', 500)
  if (integer(p, 'keepVersion', 1) !== keep.version || integer(p, 'duplicateVersion', 1) !== duplicate.version) fail('STALE', 'A counterparty changed since you loaded it. Reload before merging.', 409)
  const moved = (await c.db.prepare('SELECT id, status, version FROM lk_agreements WHERE party_id=?').bind(duplicate.id).all<{ id: string; status: string; version: number }>()).results
  const negotiating = moved.filter(a => ['draft', 'in_review', 'approved'].includes(a.status))
  const writes: Sql[] = [
    ...moved.map(a => sql("UPDATE lk_agreements SET party_id=?, status=CASE WHEN status='approved' THEN 'in_review' ELSE status END, version=version+1, updated_at=? WHERE id=? AND version=?", keep.id, c.now, a.id, a.version)),
    ...negotiating.map(a => invalidateApprovals(c, a.id, 'Counterparty merged')),
    sql('UPDATE lk_clickwrap_acceptances SET party_id=? WHERE party_id=?', keep.id, duplicate.id),
    sql('UPDATE lk_parties SET merged_into=?, merged_by=?, merged_at=?, merge_reason=?, version=version+1 WHERE id=?', keep.id, c.actor.id, c.now, reason, duplicate.id),
    sql('UPDATE lk_parties SET version=version+1 WHERE id=?', keep.id),
  ]
  return {
    allowed: may.grantAccess,
    result: { keepId: keep.id, duplicateId: duplicate.id, agreements: moved.length },
    writes,
    checks: [
      sql('(SELECT version FROM lk_parties WHERE id=?)=? AND (SELECT version FROM lk_parties WHERE id=?)=?', keep.id, keep.version, duplicate.id, duplicate.version),
      sql('(SELECT COUNT(*) FROM lk_agreements WHERE party_id=?)=?', duplicate.id, moved.length),
      ...moved.map(a => sql('(SELECT version FROM lk_agreements WHERE id=?)=?', a.id, a.version)),
    ],
    audit: [
      { action: 'party.merge', summary: `Merged counterparty ${duplicate.name} into ${keep.name}: ${reason}` },
      ...moved.map(a => ({ action: 'party.merge', agreementId: a.id, summary: `Counterparty ${duplicate.name} merged into ${keep.name}${negotiating.some(n => n.id === a.id) ? '; earlier approvals no longer count' : ''}` })),
    ],
  }
}

export const counterpartyHandlers: Record<string, Handler> = { 'party.save': saveParty, 'party.merge': mergeParty }
