// Intake, parties, required attachments, versions, comments, family links,
// access grants and legacy file import (clauses 1, 2, 3 and 5).
import { retainedClauseUses, templateClauseUses } from './clause-provenance'
import { may, requireRole } from './access'
import { fileInput, isDocx, isPdf, PDF, storeArtifact, type FileInput } from './artifacts'
import type { Ctx, Handler, Outcome } from './commands'
import { docxText } from './docx'
import { agreementReference, bool, fail, json, list, money, object, oneOf, optionalDate, optionalText, parse, sha256, sql, text, timezone, type Sql } from './model'
import { agreementGuards, bump, invalidateApprovals, requireStatus, statusAfterChange, versionDigest, versionsOf, visibleAgreement, type AgreementRow } from './records'

export const agreementTypes = ['customer', 'supplier', 'nda', 'amendment', 'order_form', 'other'] as const
export const partyKinds = ['customer', 'supplier', 'partner', 'other'] as const
export const relations = ['amends', 'order_under', 'schedule_to', 'renews'] as const

/** Decided default: attachments each request type must carry before review. */
export const defaultRequirements: Record<string, string[]> = {
  customer: ['Statement of work or schedule'],
  supplier: ['Certificate of insurance'],
  amendment: ['Signed parent agreement'],
  order_form: [],
  nda: [],
  other: [],
}
const needsParent = new Set(['amendment', 'order_form'])

async function operatorExists(c: Ctx, id: string): Promise<void> {
  const row = await c.db.prepare("SELECT 1 AS ok FROM oa_operators WHERE id=? AND status='active'").bind(id).first()
  if (!row) fail('INVALID', 'The responsible person must be an active member of this installation.', 400, { field: 'ownerId' })
}

async function partyFor(c: Ctx, p: Record<string, unknown>): Promise<{ id: string; name: string; writes: Sql[] }> {
  if (typeof p.partyId === 'string' && p.partyId) {
    const party = await c.db.prepare('SELECT id, name FROM lk_parties WHERE id=?').bind(p.partyId).first<{ id: string; name: string }>()
    if (!party) fail('INVALID', 'Choose an existing counterparty or enter a new one.', 400, { field: 'partyId' })
    return { ...party, writes: [] }
  }
  const input = object(p.party, 'party')
  const name = text(input, 'name', 200)
  const existing = await c.db.prepare('SELECT id, name FROM lk_parties WHERE lower(name)=lower(?)').bind(name).first<{ id: string; name: string }>()
  if (existing) return { ...existing, writes: [] }
  const id = crypto.randomUUID()
  return { id, name, writes: [sql('INSERT INTO lk_parties VALUES(?,?,?,?,?,?,?,1)', id, name, oneOf(input, 'kind', partyKinds), optionalText(input, 'abn', 20), optionalText(input, 'email', 200), c.actor.id, c.now)] }
}

/** Fills a template version's fields and chosen clause variants. */
export function populate(template: { body: string; fields: string; clauses: string }, values: Record<string, unknown>, choices: Record<string, unknown>) {
  const fields = parse<{ name: string; label: string; required: boolean }[]>(template.fields)
  const clauses = parse<{ key: string; title: string; variants: { id: string; label: string; text: string }[] }[]>(template.clauses)
  const missing = fields.filter(f => f.required && (typeof values[f.name] !== 'string' || !(values[f.name] as string).trim())).map(f => f.label)
  if (missing.length) fail('FIELDS', `Fill in: ${missing.join(', ')}.`, 400, { missing })
  const chosen: Record<string, string> = {}
  let body = template.body.replace(/\[\[clause:([a-z0-9_-]+)\]\]/g, (_, key: string) => {
    const clause = clauses.find(x => x.key === key)
    if (!clause) fail('TEMPLATE', `The template refers to an undefined clause ${key}.`)
    const variant = clause.variants.find(v => v.id === choices[key]) ?? clause.variants[0]
    if (choices[key] !== undefined && variant.id !== choices[key]) fail('INVALID', `Clause ${clause.title} has no variant ${String(choices[key])}.`)
    chosen[key] = variant.id
    return variant.text
  })
  body = body.replace(/\{\{([a-z0-9_]+)\}\}/gi, (_, name: string) => String(values[name] ?? '').trim())
  const filled = Object.fromEntries(fields.map(f => [f.name, String(values[f.name] ?? '').trim()]))
  return { text: body, fields: { values: filled, clauses: chosen } }
}

async function approvedTemplate(c: Ctx, id: unknown) {
  if (typeof id !== 'string') fail('INVALID', 'templateVersionId is required.')
  const t = await c.db.prepare('SELECT v.*, t.name FROM lk_template_versions v JOIN lk_templates t ON t.id=v.template_id WHERE v.id=?').bind(id).first<any>()
  if (!t) fail('INVALID', 'That template version does not exist.')
  if (t.status !== 'approved') fail('TEMPLATE_NOT_APPROVED', `${t.name} v${t.number} is ${t.status}; only an approved template version can be used.`, 409)
  return t
}

interface NewVersion {
  id: string
  writes: Sql[]
  digest: string
  number: number
}
/** Builds a version from an uploaded file, keeping its exact bytes. */
async function uploadedVersion(c: Ctx, agreementId: string, number: number, kind: string, label: string, file: FileInput, suppliedText: string | null, priorFields: string | null = null): Promise<NewVersion> {
  if (!isPdf(file) && !isDocx(file)) fail('FILE_TYPE', 'A contract version must be a PDF or DOCX file.', 415)
  const id = crypto.randomUUID()
  let body = suppliedText, source = suppliedText ? 'person' : 'none'
  if (isDocx(file) && !suppliedText) {
    body = await docxText(file.bytes)
    source = 'docx'
  }
  const artifact = await storeArtifact(file, { agreementId, versionId: id, role: 'original', provenance: { uploadedAs: kind, label }, actorId: c.actor.id, at: c.now })
  const uses = retainedClauseUses(priorFields, body)
  const fields = uses.length ? { clauseLibrary: uses } : null
  const digest = await versionDigest({ agreementId, number, files: [{ role: 'original', sha256: artifact.sha256 }], text: body, fields })
  return {
    id,
    number,
    digest,
    writes: [...artifact.writes, sql('INSERT INTO lk_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, agreementId, number, kind, label, null, fields ? json(fields) : null, body, source, digest, c.actor.id, c.now)],
  }
}
async function templateVersion(c: Ctx, agreementId: string, number: number, p: Record<string, unknown>, extra: Record<string, string>, priorFields: string | null = null): Promise<NewVersion> {
  const template = await approvedTemplate(c, p.templateVersionId)
  const values = { ...extra, ...object(p.fields ?? {}, 'fields') }
  const filled = populate(template, values, object(p.clauseChoices ?? {}, 'clauseChoices'))
  const id = crypto.randomUUID()
  const uses = retainedClauseUses(priorFields, filled.text)
  const selectedFields = { template: template.id, ...filled.fields }
  const playbook = await c.db.prepare("SELECT id, rules FROM lk_playbook_versions WHERE status='active'").first<any>()
  const selected = templateClauseUses(template, json(selectedFields), c.actor.id, c.now, playbook, values)
  const recorded = [...new Map([...uses, ...selected].map(use => [JSON.stringify([use.libraryVersionId, use.clauseKey, use.variantId]), use])).values()]
  const fields = { ...selectedFields, clauseLibrary: recorded }
  const digest = await versionDigest({ agreementId, number, files: [], text: filled.text, fields })
  return {
    id,
    number,
    digest,
    writes: [sql('INSERT INTO lk_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, agreementId, number, 'template', `${template.name} v${template.number}`, template.id, json(fields), filled.text, 'template', digest, c.actor.id, c.now)],
  }
}

const createRequest: Handler = async (c, p) => {
  requireRole(c.actor, may.intake, 'create requests')
  const title = text(p, 'title', 200), type = oneOf(p, 'type', agreementTypes)
  const party = await partyFor(c, p)
  const ownerId = typeof p.ownerId === 'string' && p.ownerId ? p.ownerId : c.actor.id
  await operatorExists(c, ownerId)
  const valueCents = money(p, 'value')
  const parentId = typeof p.parentId === 'string' && p.parentId ? p.parentId : null
  if (needsParent.has(type) && !parentId) fail('PARENT_REQUIRED', 'An amendment or order form must name the agreement it belongs to.', 400, { field: 'parentId' })
  const checks: Sql[] = []
  if (parentId) {
    await visibleAgreement(c, parentId)
    checks.push(sql('EXISTS(SELECT 1 FROM lk_agreements WHERE id=?)', parentId))
  }
  const id = crypto.randomUUID(), reference = agreementReference(id)
  const zone = p.timezone ? timezone(p, 'timezone') : 'America/New_York'
  const relation = parentId ? (type === 'amendment' ? 'amends' : type === 'order_form' ? 'order_under' : oneOf(p, 'relation', relations)) : null
  const writes: Sql[] = [...party.writes]
  let version: NewVersion | null = null
  if (p.templateVersionId) version = await templateVersion(c, id, 1, p, { counterparty: party.name, title })
  else if (p.file) version = await uploadedVersion(c, id, 1, 'upload', 'Initial draft', fileInput(p.file), optionalText(p, 'text', 400_000))
  writes.push(
    sql(
      'INSERT INTO lk_agreements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)',
      id, reference, title, type, party.id, valueCents, 'USD', ownerId, c.actor.id, 'draft', bool(p, 'restricted') ? 1 : 0,
      optionalDate(p, 'neededBy'), optionalDate(p, 'startDate'), zone, parentId, relation, 'intake', version?.id ?? null, c.now, c.now,
    ),
  )
  if (version) writes.push(...version.writes)
  const labels = [...defaultRequirements[type], ...list(p, 'requirements', 20).map(x => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 200) : fail('INVALID', 'Requirement labels must be text.')))]
  for (const label of [...new Set(labels)]) writes.push(sql('INSERT INTO lk_requirements VALUES(?,?,?,?,?,?,?)', crypto.randomUUID(), id, label, null, null, null, c.now))
  return {
    allowed: may.intake,
    result: { id, reference, versionId: version?.id ?? null },
    writes,
    checks,
    audit: [{ action: 'request.create', agreementId: id, summary: `Requested ${title} with ${party.name}` }],
  }
}

const updateRequest: Handler = async (c, p) => {
  requireRole(c.actor, may.intake, 'edit requests')
  const a = await visibleAgreement(c, p.agreementId)
  requireStatus(a, ['draft', 'in_review', 'approved'], 'change its request details')
  const title = p.title === undefined ? a.title : text(p, 'title', 200)
  const value = p.value === undefined ? a.value_cents : money(p, 'value')
  const ownerId = typeof p.ownerId === 'string' && p.ownerId ? p.ownerId : a.owner_id
  if (ownerId !== a.owner_id) await operatorExists(c, ownerId)
  const neededBy = p.neededBy === undefined ? a.needed_by : optionalDate(p, 'neededBy')
  const restricted = p.restricted === undefined ? a.restricted : bool(p, 'restricted') ? 1 : 0
  const contextChanged = value !== a.value_cents
  const writes = [bump(c, a, 'title=?, value_cents=?, owner_id=?, needed_by=?, restricted=?, status=?', title, value, ownerId, neededBy, restricted, contextChanged ? statusAfterChange(a) : a.status)]
  if (contextChanged) writes.push(invalidateApprovals(c, a.id, 'Contract value changed'))
  return { allowed: may.intake, result: { id: a.id }, writes, checks: agreementGuards(c, a, p), audit: [{ action: 'request.update', agreementId: a.id, summary: contextChanged ? 'Changed request details and value; earlier approvals no longer count' : 'Changed request details' }] }
}

const addRequirement: Handler = async (c, p) => {
  requireRole(c.actor, may.intake, 'change required attachments')
  const a = await visibleAgreement(c, p.agreementId)
  const label = text(p, 'label', 200)
  return { allowed: may.intake, result: { agreementId: a.id }, writes: [sql('INSERT INTO lk_requirements VALUES(?,?,?,?,?,?,?)', crypto.randomUUID(), a.id, label, null, null, null, c.now), bump(c, a)], checks: agreementGuards(c, a), audit: [{ action: 'requirement.add', agreementId: a.id, summary: `Required attachment: ${label}` }] }
}

async function requirement(c: Ctx, a: AgreementRow, id: unknown) {
  const r = await c.db.prepare('SELECT * FROM lk_requirements WHERE id=? AND agreement_id=?').bind(id, a.id).first<any>()
  if (!r) fail('NOT_FOUND', 'That required attachment is not on this agreement.', 404)
  return r
}
const attachRequirement: Handler = async (c, p) => {
  requireRole(c.actor, may.intake, 'attach files')
  const a = await visibleAgreement(c, p.agreementId)
  const r = await requirement(c, a, p.requirementId)
  const artifact = await storeArtifact(fileInput(p.file), { agreementId: a.id, role: 'attachment', provenance: { requirement: r.label }, actorId: c.actor.id, at: c.now })
  return { allowed: may.intake, result: { artifactId: artifact.id }, writes: [...artifact.writes, sql('UPDATE lk_requirements SET artifact_id=?, waived_reason=NULL, waived_by=NULL WHERE id=?', artifact.id, r.id), bump(c, a)], checks: agreementGuards(c, a), audit: [{ action: 'requirement.attach', agreementId: a.id, summary: `Attached ${r.label}` }] }
}
const waiveRequirement: Handler = async (c, p) => {
  requireRole(c.actor, ['owner', 'counsel'], 'waive a required attachment')
  const a = await visibleAgreement(c, p.agreementId)
  const r = await requirement(c, a, p.requirementId)
  const reason = text(p, 'reason', 500)
  return { allowed: ['owner', 'counsel'], result: { requirementId: r.id }, writes: [sql('UPDATE lk_requirements SET waived_reason=?, waived_by=? WHERE id=?', reason, c.actor.id, r.id), bump(c, a)], checks: agreementGuards(c, a), audit: [{ action: 'requirement.waive', agreementId: a.id, summary: `Waived ${r.label}: ${reason}` }] }
}

const submit: Handler = async (c, p) => {
  requireRole(c.actor, may.intake, 'submit requests for review')
  const a = await visibleAgreement(c, p.agreementId)
  requireStatus(a, ['draft'], 'be submitted')
  if (!a.current_version_id) fail('NO_VERSION', 'Add a document version before submitting for review.', 409)
  const open = (await c.db.prepare('SELECT label FROM lk_requirements WHERE agreement_id=? AND artifact_id IS NULL AND waived_reason IS NULL').bind(a.id).all<{ label: string }>()).results
  if (open.length) fail('MISSING_ATTACHMENTS', `Missing required attachments: ${open.map(r => r.label).join(', ')}.`, 409, { missing: open.map(r => r.label) })
  return {
    allowed: may.intake,
    result: { id: a.id, status: 'in_review' },
    writes: [bump(c, a, "status='in_review'")],
    // Nothing may be detached between our read and this write.
    checks: [...agreementGuards(c, a, p), sql('NOT EXISTS(SELECT 1 FROM lk_requirements WHERE agreement_id=? AND artifact_id IS NULL AND waived_reason IS NULL)', a.id)],
    audit: [{ action: 'agreement.submit', agreementId: a.id, summary: 'Submitted for review' }],
  }
}

async function nextVersion(c: Ctx, a: AgreementRow): Promise<number> {
  const versions = await versionsOf(c, a.id)
  return (versions.at(-1)?.number ?? 0) + 1
}
function versionOutcome(c: Ctx, a: AgreementRow, p: Record<string, unknown>, v: NewVersion, summary: string): Outcome {
  requireStatus(a, ['draft', 'in_review', 'approved', 'imported'], 'take a new version (void the signature package first)')
  const status = a.status === 'imported' ? 'draft' : statusAfterChange(a)
  return {
    allowed: may.intake,
    result: { versionId: v.id, number: v.number, digest: v.digest },
    writes: [...v.writes, bump(c, a, 'current_version_id=?, status=?', v.id, status), invalidateApprovals(c, a.id, `Version ${v.number} replaced the approved document`)],
    checks: agreementGuards(c, a, p),
    audit: [{ action: 'version.add', agreementId: a.id, summary }],
  }
}
const uploadVersion: Handler = async (c, p) => {
  requireRole(c.actor, may.intake, 'add versions')
  const a = await visibleAgreement(c, p.agreementId)
  const number = await nextVersion(c, a)
  const kind = oneOf(p, 'kind', ['upload', 'counterparty'] as const)
  const prior = await c.db.prepare('SELECT fields FROM lk_versions WHERE id=?').bind(a.current_version_id).first<{ fields: string | null }>()
  const v = await uploadedVersion(c, a.id, number, kind, optionalText(p, 'label', 200) ?? (kind === 'counterparty' ? 'Counterparty markup' : 'Our revision'), fileInput(p.file), optionalText(p, 'text', 400_000), prior?.fields ?? null)
  return versionOutcome(c, a, p, v, `Added version ${number} (${kind})`)
}
const generateVersion: Handler = async (c, p) => {
  requireRole(c.actor, may.intake, 'add versions')
  const a = await visibleAgreement(c, p.agreementId)
  const party = await c.db.prepare('SELECT name FROM lk_parties WHERE id=?').bind(a.party_id).first<{ name: string }>()
  const number = await nextVersion(c, a)
  const prior = await c.db.prepare('SELECT fields FROM lk_versions WHERE id=?').bind(a.current_version_id).first<{ fields: string | null }>()
  const v = await templateVersion(c, a.id, number, p, { counterparty: party?.name ?? '', title: a.title }, prior?.fields ?? null)
  return versionOutcome(c, a, p, v, `Generated version ${number} from an approved template`)
}
/** Attaches the PDF a DOCX or template version will be signed as; it becomes part of the version's identity. */
const attachRendition: Handler = async (c, p) => {
  requireRole(c.actor, may.intake, 'attach a signing PDF')
  const a = await visibleAgreement(c, p.agreementId)
  requireStatus(a, ['draft', 'in_review', 'approved'], 'take a signing PDF')
  const v = await c.db.prepare('SELECT * FROM lk_versions WHERE id=? AND agreement_id=?').bind(p.versionId, a.id).first<any>()
  if (!v || v.id !== a.current_version_id) fail('NOT_CURRENT', 'Attach the signing PDF to the current version.', 409)
  const file = fileInput(p.file)
  if (!isPdf(file)) fail('FILE_TYPE', 'The signing rendition must be a PDF.', 415)
  const existing = (await c.db.prepare("SELECT role, sha256 FROM lk_artifacts WHERE version_id=? AND role IN ('original','rendition')").bind(v.id).all<{ role: string; sha256: string }>()).results
  if (existing.some(x => x.role === 'rendition')) fail('RENDITION_EXISTS', 'This version already has a signing PDF; add a new version instead.', 409)
  const artifact = await storeArtifact(file, { agreementId: a.id, versionId: v.id, role: 'rendition', provenance: { renditionOf: v.id }, actorId: c.actor.id, at: c.now })
  const digest = await versionDigest({ agreementId: a.id, number: v.number, files: [...existing, { role: 'rendition', sha256: artifact.sha256 }], text: v.text, fields: v.fields ? JSON.parse(v.fields) : null })
  return {
    allowed: may.intake,
    result: { versionId: v.id, digest },
    writes: [...artifact.writes, sql('UPDATE lk_versions SET digest=? WHERE id=?', digest, v.id), bump(c, a, 'status=?', statusAfterChange(a)), invalidateApprovals(c, a.id, 'Signing PDF added to the version')],
    checks: agreementGuards(c, a, p),
    audit: [{ action: 'version.rendition', agreementId: a.id, summary: `Attached signing PDF to version ${v.number}` }],
  }
}

const addComment: Handler = async (c, p) => {
  requireRole(c.actor, may.review, 'comment')
  const a = await visibleAgreement(c, p.agreementId)
  const v = await c.db.prepare('SELECT id, number FROM lk_versions WHERE id=? AND agreement_id=?').bind(p.versionId, a.id).first<any>()
  if (!v) fail('NOT_FOUND', 'That version is not on this agreement.', 404)
  return { allowed: may.review, result: { agreementId: a.id }, writes: [sql('INSERT INTO lk_comments VALUES(?,?,?,?,?,?,?)', crypto.randomUUID(), a.id, v.id, c.actor.id, text(p, 'body', 4000), optionalText(p, 'quote', 2000), c.now)], checks: agreementGuards(c, a), audit: [{ action: 'comment.add', agreementId: a.id, summary: `Commented on version ${v.number}` }] }
}

/** Links an agreement into its family (MSA, amendment, order form). */
const linkFamily: Handler = async (c, p) => {
  requireRole(c.actor, ['owner', 'counsel'], 'confirm agreement family links')
  const a = await visibleAgreement(c, p.agreementId)
  const parent = await visibleAgreement(c, p.parentId)
  if (parent.id === a.id) fail('INVALID', 'An agreement cannot be its own parent.')
  let cursor: string | null = parent.parent_id
  while (cursor) {
    if (cursor === a.id) fail('INVALID', 'That link would make a cycle in the agreement family.')
    cursor = (await c.db.prepare('SELECT parent_id FROM lk_agreements WHERE id=?').bind(cursor).first<{ parent_id: string | null }>())?.parent_id ?? null
  }
  const relation = oneOf(p, 'relation', relations)
  return { allowed: ['owner', 'counsel'], result: { id: a.id }, writes: [bump(c, a, 'parent_id=?, relation=?', parent.id, relation)], checks: agreementGuards(c, a, p), audit: [{ action: 'family.link', agreementId: a.id, summary: `Linked as ${relation.replace('_', ' ')} ${parent.reference}` }] }
}

const grantAccess: Handler = async (c, p) => {
  requireRole(c.actor, may.grantAccess, 'grant access to restricted agreements')
  const a = await visibleAgreement(c, p.agreementId)
  const operatorId = text(p, 'operatorId', 64)
  await operatorExists(c, operatorId)
  const grant = oneOf(p, 'grant', ['grant', 'revoke'] as const)
  const write = grant === 'grant' ? sql('INSERT OR REPLACE INTO lk_access VALUES(?,?,?,?)', a.id, operatorId, c.actor.id, c.now) : sql('DELETE FROM lk_access WHERE agreement_id=? AND operator_id=?', a.id, operatorId)
  return { allowed: may.grantAccess, result: { agreementId: a.id }, writes: [write, bump(c, a)], checks: agreementGuards(c, a), audit: [{ action: `access.${grant}`, agreementId: a.id, summary: `${grant === 'grant' ? 'Granted' : 'Revoked'} access for an operator` }] }
}

/** Clause 1: a legacy PDF/DOCX keeps its bytes, source identity and provenance. */
const importLegacy: Handler = async (c, p) => {
  requireRole(c.actor, may.intake, 'import legacy agreements')
  const file = fileInput(p.file)
  if (!isPdf(file) && !isDocx(file)) fail('FILE_TYPE', 'A legacy agreement must be a PDF or DOCX file.', 415)
  const sourceSystem = text(p, 'sourceSystem', 100), sourceId = text(p, 'sourceId', 200)
  const digest = await sha256(file.bytes)
  const duplicate = await c.db.prepare("SELECT a.reference FROM lk_artifacts f JOIN lk_agreements a ON a.id=f.agreement_id WHERE f.sha256=? AND f.role IN ('original','signed') LIMIT 1").bind(digest).first<{ reference: string }>()
  if (duplicate) fail('DUPLICATE_FILE', `These exact bytes are already held as ${duplicate.reference}.`, 409, { reference: duplicate.reference })
  const sameSource = await c.db.prepare('SELECT a.reference FROM lk_artifacts f JOIN lk_agreements a ON a.id=f.agreement_id WHERE f.source_system=? AND f.source_id=? LIMIT 1').bind(sourceSystem, sourceId).first<{ reference: string }>()
  if (sameSource) fail('DUPLICATE_SOURCE', `${sourceSystem} ${sourceId} was already imported as ${sameSource.reference}.`, 409, { reference: sameSource.reference })
  const party = await partyFor(c, p)
  const ownerId = typeof p.ownerId === 'string' && p.ownerId ? p.ownerId : c.actor.id
  await operatorExists(c, ownerId)
  const id = crypto.randomUUID(), versionId = crypto.randomUUID(), reference = agreementReference(id)
  const title = text(p, 'title', 200), type = oneOf(p, 'type', agreementTypes)
  let body = optionalText(p, 'text', 400_000), source = body ? 'person' : 'none'
  if (!body && isDocx(file)) { body = await docxText(file.bytes); source = 'docx' }
  const provenance = { sourceSystem, sourceId, originalFilename: file.filename, importedBy: c.actor.id, importedAt: new Date(c.now).toISOString(), signedStatus: bool(p, 'signed') ? 'stated signed by importer' : 'not stated' }
  const artifact = await storeArtifact(file, { agreementId: id, versionId, role: 'original', sourceSystem, sourceId, provenance, imported: true, actorId: c.actor.id, at: c.now })
  const vdigest = await versionDigest({ agreementId: id, number: 1, files: [{ role: 'original', sha256: artifact.sha256 }], text: body, fields: null })
  return {
    allowed: may.intake,
    result: { id, reference, versionId, sha256: artifact.sha256 },
    writes: [
      ...party.writes,
      sql('INSERT INTO lk_agreements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)', id, reference, title, type, party.id, money(p, 'value'), 'USD', ownerId, c.actor.id, 'imported', bool(p, 'restricted') ? 1 : 0, null, optionalDate(p, 'startDate'), p.timezone ? timezone(p, 'timezone') : 'America/New_York', null, null, 'legacy', versionId, c.now, c.now),
      ...artifact.writes,
      sql('INSERT INTO lk_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', versionId, id, 1, 'legacy', `Imported from ${sourceSystem}`, null, null, body, source, vdigest, c.actor.id, c.now),
    ],
    checks: [sql('NOT EXISTS(SELECT 1 FROM lk_artifacts WHERE sha256=? AND role IN (\'original\',\'signed\'))', digest)],
    audit: [{ action: 'legacy.import', agreementId: id, summary: `Imported ${file.filename} from ${sourceSystem} ${sourceId}` }],
  }
}

const saveParty: Handler = async (c, p) => {
  requireRole(c.actor, may.intake, 'maintain counterparties')
  const name = text(p, 'name', 200), kind = oneOf(p, 'kind', partyKinds)
  if (typeof p.id === 'string') {
    const row = await c.db.prepare('SELECT version FROM lk_parties WHERE id=?').bind(p.id).first<{ version: number }>()
    if (!row) fail('NOT_FOUND', 'No such counterparty.', 404)
    return { allowed: may.intake, result: { id: p.id }, writes: [sql('UPDATE lk_parties SET name=?, kind=?, abn=?, email=?, version=version+1 WHERE id=?', name, kind, optionalText(p, 'abn', 20), optionalText(p, 'email', 200), p.id)], checks: [sql('(SELECT version FROM lk_parties WHERE id=?)=?', p.id, row.version)], audit: [{ action: 'party.save', summary: `Updated counterparty ${name}` }] }
  }
  const id = crypto.randomUUID()
  return { allowed: may.intake, result: { id }, writes: [sql('INSERT INTO lk_parties VALUES(?,?,?,?,?,?,?,1)', id, name, kind, optionalText(p, 'abn', 20), optionalText(p, 'email', 200), c.actor.id, c.now)], audit: [{ action: 'party.save', summary: `Added counterparty ${name}` }] }
}

export const agreementHandlers: Record<string, Handler> = {
  'party.save': saveParty,
  'request.create': createRequest,
  'request.update': updateRequest,
  'requirement.add': addRequirement,
  'requirement.attach': attachRequirement,
  'requirement.waive': waiveRequirement,
  'agreement.submit': submit,
  'version.upload': uploadVersion,
  'version.generate': generateVersion,
  'version.rendition': attachRendition,
  'comment.add': addComment,
  'family.link': linkFamily,
  'access.set': grantAccess,
  'legacy.import': importLegacy,
}
