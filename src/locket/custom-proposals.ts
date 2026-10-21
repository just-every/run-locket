import type { Ctx, Outcome } from './commands'
import { customFieldChecks, customFields, fieldApplies, fieldRoles } from './custom-fields'
import { customValueHandlers, normalizedValue } from './custom-values'
import { canonical, fail, integer, json, object, sql, text, type Sql } from './model'
import { citation as executedCitation } from './obligations'
import { currentVersion, visibleAgreement } from './records'

/** Native proposal door: external extraction may prepare; a human confirms. */
export async function prepareCustomFields(c: Ctx, payload: Record<string, unknown>) {
  const a = await visibleAgreement(c, payload.agreementId), v = await currentVersion(c, a)
  if (payload.versionId !== v.id) fail('NOT_CURRENT', 'Choose the current document version for this proposal.', 409)
  const cite = object(payload.citation, 'citation'), quote = text(cite, 'quote', 4000)
  if (!v.text) fail('CITATION', 'A custom-field proposal needs a readable document passage.')
  const start = integer(cite, 'start', 0, v.text.length), end = integer(cite, 'end', start + 1, v.text.length)
  if (v.text.slice(start, end) !== quote) fail('CITATION', 'The proposal passage does not match the selected version.')
  const verified = ['executed', 'imported'].includes(a.status) ? await executedCitation(c, a, cite) : null
  const fields = await customFields(c.db), values = object(payload.values, 'values'), checks: Sql[] = []
  if (!Object.keys(values).length) fail('INVALID', 'Propose at least one custom field.')
  const definitions = []
  for (const [id, value] of Object.entries(values)) {
    const f = fields.find(f => f.id === id && fieldApplies(f, a.type))
    if (!f) fail('INVALID', 'Choose a custom field for this agreement type.')
    await normalizedValue(c, f, value, checks)
    definitions.push({ id, version: f.version })
  }
  return { ...payload, agreementId: a.id, versionId: v.id, versionDigest: v.digest, expectedVersion: a.version, definitions, citation: { source: 'custom-field-passage', versionId: v.id, versionNumber: v.number, quote, start, end, ...(verified ? { executionCitation: verified } : {}) } }
}
export async function applyCustomFields(c: Ctx, payload: Record<string, unknown>, proposalId: string, preparedBy: string, corrections?: unknown): Promise<Outcome> {
  const a = await visibleAgreement(c, payload.agreementId), v = await currentVersion(c, a)
  if (v.id !== payload.versionId || v.digest !== payload.versionDigest) fail('NOT_CURRENT', 'The cited document changed. Prepare a new proposal.', 409)
  const fields = await customFields(c.db)
  for (const snapshot of payload.definitions as {id:string;version:number}[]) {
    if (!fields.some(f => f.id === snapshot.id && f.version === snapshot.version)) fail('STALE', 'A proposed field definition changed. Prepare a new proposal.', 409)
  }
  const proposed = object(payload.values, 'values'), values = corrections === undefined ? proposed : object(corrections, 'values')
  if (canonical(Object.keys(values).sort()) !== canonical(Object.keys(proposed).sort())) fail('INVALID', 'Corrections must name exactly the proposed fields.')
  const out = await customValueHandlers['field.values.set'](c, { agreementId: a.id, expectedVersion: payload.expectedVersion, values })
  const stored = out.writes.filter(w => w.sql.startsWith('INSERT INTO lk_custom_values'))
  const terms = stored.map(w => sql('INSERT INTO lk_terms VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', crypto.randomUUID(), a.id, `custom:${w.params[1]}`, w.params[2], json(payload.citation), 'confirmed', preparedBy, proposalId, c.actor.id, c.now, null, 'Human-confirmed custom metadata from cited proposal', c.now))
  return { ...out, writes: [...out.writes, ...terms], allowed: out.allowed.filter(r => fieldRoles.includes(r)), audit: [...out.audit, { action: 'field.confirm', agreementId: a.id, summary: 'Confirmed cited custom metadata; family governing choices remain explicit.' }] }
}

export async function customProposalAuthority(c: Ctx, payload: Record<string, unknown>) {
  const fields = await customFields(c.db), ids = Object.keys(object(payload.values, 'values'))
  const relevant = fields.filter(f => ids.includes(f.id))
  if (relevant.length !== ids.length) fail('STALE', 'A proposed field is unavailable.', 409)
  const allowed = fieldRoles.filter(role => relevant.every(f => (JSON.parse(f.edit_roles) as string[]).includes(role)))
  return { allowed, checks: customFieldChecks(fields) }
}
