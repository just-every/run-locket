// ENTITY-001: the business's own contracting entities. The owner records them;
// every agreement names one once any exists, and templates, clause wordings and
// playbook rules may be limited to one. Locket records counsel's choices; it
// never certifies a signatory's authority.
import { may, requireRole } from './access'
import type { Ctx, Handler } from './commands'
import { fail, integer, list, object, oneOf, optionalText, parse, sql, text, timezone } from './model'
import { agreementGuards, bump, invalidateApprovals, requireStatus, statusAfterChange, visibleAgreement, type AgreementRow } from './records'

export interface Signatory { name: string; email: string; title: string }
export interface EntityRow {
  id: string; legal_name: string; entity_type: string; formation: string; tax_id_kind: 'ein' | 'foreign' | null; tax_id: string | null
  registered_address: string; notice_address: string; currency: string; timezone: string; signatories: string; version: number
}

const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ein = /^\d{2}-\d{7}$/

export async function entityById(c: Pick<Ctx, 'db'>, id: string | null): Promise<EntityRow | null> {
  return id ? c.db.prepare('SELECT * FROM lk_entities WHERE id=?').bind(id).first<EntityRow>() : null
}
export const signatoriesOf = (e: EntityRow) => parse<Signatory[]>(e.signatories)

/** Once the owner has recorded any entity, a new agreement must name one. */
export async function entityForNewAgreement(c: Ctx, p: Record<string, unknown>): Promise<EntityRow | null> {
  if (typeof p.entityId === 'string' && p.entityId) {
    const e = await entityById(c, p.entityId)
    if (!e) fail('INVALID', 'Choose one of our recorded contracting entities.', 400, { field: 'entityId' })
    return e
  }
  if (await c.db.prepare('SELECT 1 AS x FROM lk_entities LIMIT 1').first()) fail('ENTITY_REQUIRED', 'Name which of our entities is contracting.', 400, { field: 'entityId' })
  return null
}

/** Template placeholders our entity fills: {{our_entity}}, {{our_notice_address}}, {{our_signatory}}. */
export const entityFields = ['our_entity', 'our_notice_address', 'our_signatory'] as const
export function entityValues(e: EntityRow | null, body: string): Record<string, string> {
  const used = entityFields.filter(f => body.includes(`{{${f}}}`))
  if (!used.length) return {}
  if (!e) fail('ENTITY_REQUIRED', 'This template fills in our entity’s details. Name the contracting entity first.', 409)
  const first = signatoriesOf(e)[0]
  if (used.includes('our_signatory') && !first) fail('NO_SIGNATORY', `${e.legal_name} has no authorized signatory recorded.`, 409)
  return { our_entity: e.legal_name, our_notice_address: e.notice_address, our_signatory: first ? `${first.name}, ${first.title}` : '' }
}

/** A template, clause wording or rule limited to an entity serves only that entity's agreements. */
export function requireEntityScope(scope: string | null | undefined, a: { entity_id: string | null }, what: string): void {
  if (scope && scope !== a.entity_id) fail('ENTITY_SCOPE', `${what} is limited to another of our entities.`, 409)
}
export async function requireEntitiesExist(c: Ctx, ids: (string | null | undefined)[]): Promise<void> {
  for (const id of new Set(ids.filter((x): x is string => Boolean(x))))
    if (!(await entityById(c, id))) fail('INVALID', 'An entity limit must name one of our recorded entities.', 400, { field: 'entityId' })
}

function entityInput(p: Record<string, unknown>) {
  const taxKind = p.taxIdKind === undefined || p.taxIdKind === null || p.taxIdKind === '' ? null : oneOf(p, 'taxIdKind', ['ein', 'foreign'] as const)
  const taxId = taxKind ? text(p, 'taxId', 40) : null
  if (taxKind === 'ein' && !ein.test(taxId!)) fail('INVALID', 'An EIN is nine digits written 12-3456789.', 400, { field: 'taxId' })
  const currency = text(p, 'currency', 3).toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) fail('INVALID', 'Currency is a three-letter ISO code such as USD or GBP.', 400, { field: 'currency' })
  const signatories = list(p, 'signatories', 20).map((value, i) => {
    const s = object(value, `signatories[${i}]`)
    const address = text(s, 'email', 200).toLowerCase()
    if (!email.test(address)) fail('INVALID', `${address} is not an email address.`, 400, { field: 'signatories' })
    return { name: text(s, 'name', 200), email: address, title: text(s, 'title', 120) }
  })
  if (new Set(signatories.map(s => s.email)).size !== signatories.length) fail('INVALID', 'Each signatory appears once.', 400, { field: 'signatories' })
  return {
    legalName: text(p, 'legalName', 200), entityType: text(p, 'entityType', 120), formation: text(p, 'formation', 120),
    taxKind, taxId, registered: text(p, 'registeredAddress', 1000), notice: text(p, 'noticeAddress', 1000),
    currency, zone: timezone(p, 'timezone'), signatories,
  }
}

const saveEntity: Handler = async (c, p) => {
  requireRole(c.actor, may.manageRoles, 'record our contracting entities')
  const e = entityInput(p)
  const clash = await c.db.prepare('SELECT id FROM lk_entities WHERE lower(legal_name)=lower(?)').bind(e.legalName).first<{ id: string }>()
  const values = [e.legalName, e.entityType, e.formation, e.taxKind, e.taxId, e.registered, e.notice, e.currency, e.zone, JSON.stringify(e.signatories)]
  if (p.id !== undefined) {
    const id = text(p, 'id', 100), version = integer(p, 'version', 1)
    const row = await entityById(c, id)
    if (!row) fail('NOT_FOUND', 'No such entity.', 404)
    if (row.version !== version) fail('STALE', `${row.legal_name} changed since you loaded it. Reload before editing.`, 409)
    if (clash && clash.id !== id) fail('DUPLICATE', `${e.legalName} is already recorded.`, 409)
    return {
      allowed: may.manageRoles, result: { id, version: version + 1 },
      writes: [sql('UPDATE lk_entities SET legal_name=?, entity_type=?, formation=?, tax_id_kind=?, tax_id=?, registered_address=?, notice_address=?, currency=?, timezone=?, signatories=?, updated_at=?, version=version+1 WHERE id=?', ...values, c.now, id)],
      checks: [sql('(SELECT version FROM lk_entities WHERE id=?)=?', id, version)],
      audit: [{ action: 'entity.save', summary: `Updated our entity ${e.legalName}` }],
    }
  }
  if (clash) fail('DUPLICATE', `${e.legalName} is already recorded.`, 409)
  const id = crypto.randomUUID()
  return {
    allowed: may.manageRoles, result: { id, version: 1 },
    writes: [sql('INSERT INTO lk_entities VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)', id, ...values, c.actor.id, c.now, c.now)],
    audit: [{ action: 'entity.save', summary: `Recorded our entity ${e.legalName} (${e.formation})` }],
  }
}

/** Names or corrects the contracting entity on an existing agreement. */
const assignEntity: Handler = async (c, p) => {
  requireRole(c.actor, may.grantAccess, 'change the contracting entity')
  const a: AgreementRow = await visibleAgreement(c, p.agreementId)
  requireStatus(a, ['draft', 'in_review', 'approved', 'executed', 'imported'], 'change its contracting entity')
  const e = await entityById(c, text(p, 'entityId', 100))
  if (!e) fail('INVALID', 'Choose one of our recorded contracting entities.', 400, { field: 'entityId' })
  if (e.id === a.entity_id) fail('UNCHANGED', `${a.reference} already names ${e.legal_name}.`, 409)
  const negotiating = ['draft', 'in_review', 'approved'].includes(a.status)
  const writes = [bump(c, a, 'entity_id=?, status=?', e.id, negotiating ? statusAfterChange(a) : a.status)]
  if (negotiating) writes.push(invalidateApprovals(c, a.id, 'Contracting entity changed'))
  return {
    allowed: may.grantAccess, result: { id: a.id, entityId: e.id },
    writes, checks: [...agreementGuards(c, a, p), sql('EXISTS(SELECT 1 FROM lk_entities WHERE id=?)', e.id)],
    audit: [{ action: 'agreement.entity', agreementId: a.id, summary: `Contracting entity set to ${e.legal_name}${negotiating ? '; earlier approvals no longer count' : ''}` }],
  }
}

export const entityHandlers: Record<string, Handler> = {
  'entity.save': saveEntity,
  'agreement.entity': assignEntity,
}
