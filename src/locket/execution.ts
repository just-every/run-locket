// Signature-ready package and manual handoff to the owner's existing signing
// service, then signed-file/certificate ingestion and reconciliation (clauses 8 and 9).
// Locket never signs and never creates a certificate of its own.
import { may, requireRole } from './access'
import { fileInput, isPdf, PDF, readArtifactBytes, storeArtifact } from './artifacts'
import type { Ctx, Handler } from './commands'
import { bool, date, fail, json, list, object, oneOf, optionalText, sha256, sql, text, type Sql } from './model'
import { textPdf } from './pdf'
import { compareExecutionPdf, comparisonCheck } from './execution-comparison'
import { executionFieldsCheck, inspectExecutionFields } from './execution-fields'
import { day, plural, providerName } from './display'
import { agreementGuards, bump, currentVersion, requireStatus, visibleAgreement, type AgreementRow } from './records'
import { decisionContext, routing } from './review'
import { entityById, signatoriesOf } from './entities'

export const providers = ['docusign', 'adobe-acrobat-sign', 'dropbox-sign', 'pandadoc', 'documenso', 'docuseal', 'paper', 'other'] as const
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The approvals that still count for the current version and context. */
async function confirmApproved(c: Ctx, a: AgreementRow) {
  const v = await currentVersion(c, a)
  const { digest } = await decisionContext(c.db, a, v)
  const live = (await c.db.prepare("SELECT id, kind, deviation_id FROM lk_approvals WHERE agreement_id=? AND version_id=? AND version_digest=? AND context_digest=? AND invalidated_at IS NULL AND decision='approved'").bind(a.id, v.id, v.digest, digest).all<any>()).results
  const required = await routing(c.db, a)
  const missing = required.filter(r => !live.some(x => x.kind === r.kind && (x.deviation_id ?? null) === (r.deviationId ?? null)))
  if (missing.length) fail('NOT_APPROVED', `Still needs: ${missing.map(m => m.label).join('; ')}.`, 409)
  return { v, approvals: live.map(x => x.id) }
}

const preparePackage: Handler = async (c, p) => {
  requireRole(c.actor, may.signature, 'prepare signature packages')
  const a = await visibleAgreement(c, p.agreementId)
  requireStatus(a, ['approved'], 'go to signature')
  const { v, approvals } = await confirmApproved(c, a)
  const provider = oneOf(p, 'provider', providers)
  const recipients = list(p, 'recipients', 20).map((value, i) => {
    const r = object(value, `recipients[${i}]`)
    const address = text(r, 'email', 200)
    if (!email.test(address)) fail('INVALID', `${address} is not an email address.`)
    return { order: i + 1, name: text(r, 'name', 200), email: address.toLowerCase(), action: oneOf(r, 'action', ['sign', 'copy'] as const), signingFor: optionalText(r, 'signingFor', 200) }
  })
  // ENTITY-001: our side signs through one of the contracting entity's recorded signatories.
  const entity = await entityById(c, a.entity_id)
  let ourSignatory: { name: string; email: string; title: string } | null = null
  if (entity) {
    const listed = signatoriesOf(entity)
    if (!listed.length) fail('NO_SIGNATORY', `${entity.legal_name} has no authorized signatory recorded. The owner records one with the entity.`, 409)
    const chosen = optionalText(p, 'signatoryEmail', 200)?.toLowerCase()
    ourSignatory = chosen ? listed.find(s => s.email === chosen) ?? fail('SIGNATORY', `${chosen} is not a recorded signatory of ${entity.legal_name}.`, 400, { field: 'signatoryEmail' }) : listed[0]
    for (const r of recipients)
      if (r.signingFor?.toLowerCase() === entity.legal_name.toLowerCase() && !listed.some(s => s.email === r.email)) fail('SIGNATORY', `${r.email} is not a recorded signatory of ${entity.legal_name}.`, 400, { field: 'recipients' })
    const present = recipients.find(r => r.email === ourSignatory!.email)
    if (present) Object.assign(present, { action: 'sign', signingFor: entity.legal_name })
    else recipients.push({ order: recipients.length + 1, name: ourSignatory.name, email: ourSignatory.email, action: 'sign', signingFor: entity.legal_name })
  }
  if (!recipients.some(r => r.action === 'sign')) fail('INVALID', 'Name at least one signer.')
  // The exact approved PDF: the version's own PDF or its attached signing PDF;
  // only text Locket generated from a template is rendered here.
  const files = (await c.db.prepare("SELECT id, role, filename, media_type, sha256 FROM lk_artifacts WHERE version_id=? AND role IN ('original','rendition')").bind(v.id).all<any>()).results
  const pdfFile = files.find(f => f.role === 'rendition') ?? files.find(f => f.role === 'original' && f.media_type === PDF)
  const writes: Sql[] = []
  let pdf: { id: string; sha256: string; filename: string }
  if (pdfFile) pdf = { id: pdfFile.id, sha256: pdfFile.sha256, filename: pdfFile.filename }
  else if (v.kind === 'template' && v.text !== null) {
    const bytes = textPdf(a.title, v.text, `${a.reference} v${v.number} - version digest ${v.digest.slice(0, 16)}`)
    const stored = await storeArtifact({ filename: `${a.reference}-v${v.number}.pdf`, mediaType: PDF, bytes }, { agreementId: a.id, versionId: v.id, role: 'package', provenance: { renderedFrom: v.id, versionDigest: v.digest }, actorId: c.actor.id, at: c.now })
    writes.push(...stored.writes)
    pdf = { id: stored.id, sha256: stored.sha256, filename: `${a.reference}-v${v.number}.pdf` }
  } else fail('NEEDS_PDF', `Version ${v.number} is a DOCX. Attach the PDF it will be signed as (and re-approve) so formatting is not lost in a conversion.`, 409)
  const packageId = crypto.randomUUID()
  const manifest = {
    format: 'locket-signature-manifest/1',
    agreement: { id: a.id, reference: a.reference, title: a.title },
    ...(entity ? { entity: { id: entity.id, legalName: entity.legal_name, signatory: ourSignatory } } : {}),
    version: { id: v.id, number: v.number, digest: v.digest },
    document: { filename: pdf.filename, sha256: pdf.sha256 },
    approvals,
    provider,
    recipients,
    preparedAt: new Date(c.now).toISOString(),
    note: 'Send this exact PDF through the named provider. Locket records the handoff and the returned evidence; it does not sign.',
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n')
  const stored = await storeArtifact({ filename: `${a.reference}-v${v.number}-routing.json`, mediaType: 'application/json', bytes: manifestBytes }, { agreementId: a.id, versionId: v.id, role: 'manifest', provenance: { package: packageId }, actorId: c.actor.id, at: c.now })
  writes.push(...stored.writes)
  writes.push(sql("UPDATE lk_packages SET status='voided', void_reason='Replaced by a newer package' WHERE agreement_id=? AND status='prepared'", a.id))
  writes.push(sql('INSERT INTO lk_packages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', packageId, a.id, v.id, v.digest, pdf.id, stored.id, json(manifest), provider, 'prepared', null, null, null, null, c.actor.id, c.now))
  writes.push(bump(c, a))
  return { allowed: may.signature, result: { packageId, pdfArtifactId: pdf.id, manifestArtifactId: stored.id, documentSha256: pdf.sha256, recipients }, writes, checks: [...agreementGuards(c, a, p), sql('(SELECT digest FROM lk_versions WHERE id=?)=?', v.id, v.digest), ...(entity ? [sql('(SELECT version FROM lk_entities WHERE id=?)=?', entity.id, entity.version)] : [])], audit: [{ action: 'package.prepare', agreementId: a.id, summary: `Prepared v${v.number} for ${providerName(provider)} with ${plural(recipients.length, 'recipient')}` }] }
}

async function packageOf(c: Ctx, a: AgreementRow, id: unknown) {
  const pkg = await c.db.prepare('SELECT * FROM lk_packages WHERE id=? AND agreement_id=?').bind(id, a.id).first<any>()
  if (!pkg) fail('NOT_FOUND', 'That signature package is not on this agreement.', 404)
  return pkg
}

const markSent: Handler = async (c, p) => {
  requireRole(c.actor, may.signature, 'record a signature handoff')
  const a = await visibleAgreement(c, p.agreementId)
  requireStatus(a, ['approved'], 'be sent for signature')
  const pkg = await packageOf(c, a, p.packageId)
  if (pkg.status !== 'prepared') fail('STATUS', `This package is ${pkg.status}.`, 409)
  if (pkg.version_id !== a.current_version_id) fail('NOT_CURRENT', 'This package was prepared for an earlier version. Prepare a new one.', 409)
  const envelopeId = text(p, 'envelopeId', 200)
  return {
    allowed: may.signature,
    result: { packageId: pkg.id, status: 'sent' },
    writes: [sql("UPDATE lk_packages SET status='sent', envelope_id=?, sent_by=?, sent_at=? WHERE id=?", envelopeId, c.actor.id, c.now, pkg.id), bump(c, a, "status='out_for_signature'")],
    checks: [...agreementGuards(c, a, p), sql("(SELECT status FROM lk_packages WHERE id=?)='prepared'", pkg.id)],
    audit: [{ action: 'package.sent', agreementId: a.id, summary: `Recorded handoff to ${providerName(pkg.provider)}, envelope ${envelopeId}` }],
  }
}

const voidPackage: Handler = async (c, p) => {
  requireRole(c.actor, may.signature, 'void a signature package')
  const a = await visibleAgreement(c, p.agreementId)
  const pkg = await packageOf(c, a, p.packageId)
  if (!['prepared', 'sent'].includes(pkg.status)) fail('STATUS', `This package is ${pkg.status}.`, 409)
  const reason = text(p, 'reason', 500)
  return {
    allowed: may.signature,
    result: { packageId: pkg.id, status: 'voided' },
    writes: [sql("UPDATE lk_packages SET status='voided', void_reason=? WHERE id=?", reason, pkg.id), bump(c, a, 'status=?', a.status === 'out_for_signature' ? 'approved' : a.status)],
    checks: agreementGuards(c, a, p),
    audit: [{ action: 'package.void', agreementId: a.id, summary: `Voided signature package: ${reason}` }],
  }
}

/** Clause 9: ingest signed file and certificate, reconcile envelope, signers and document identity. */
const recordExecution: Handler = async (c, p) => {
  requireRole(c.actor, may.signature, 'record execution')
  const a = await visibleAgreement(c, p.agreementId)
  requireStatus(a, ['out_for_signature'], 'record execution (record the signature handoff first)')
  const pkg = (await c.db.prepare("SELECT * FROM lk_packages WHERE agreement_id=? AND status='sent' ORDER BY sent_at DESC LIMIT 1").bind(a.id).first<any>()) ?? fail('NO_PACKAGE', 'No sent signature package to reconcile against.', 409)
  const signed = fileInput(p.signed, 'signed')
  if (!isPdf(signed)) fail('FILE_TYPE', 'The signed agreement must be the PDF returned by the signing service.', 415)
  const certificate = p.certificate ? fileInput(p.certificate, 'certificate') : null
  const envelopeId = text(p, 'envelopeId', 200)
  const signers = list(p, 'signers', 20).map((value, i) => {
    const s = object(value, `signers[${i}]`)
    return { name: text(s, 'name', 200), email: text(s, 'email', 200).toLowerCase(), signedAt: optionalText(s, 'signedAt', 40) }
  })
  const executedOn = date(p, 'executedOn')
  const signedSha = await sha256(signed.bytes)
  const duplicate = await c.db.prepare("SELECT e.id FROM lk_executions e LEFT JOIN lk_artifacts f ON f.id=e.signed_artifact_id WHERE (e.provider=? AND e.envelope_id=?) OR f.sha256=?").bind(pkg.provider, envelopeId, signedSha).first()
  if (duplicate) fail('DUPLICATE_EXECUTION', 'This signed file or envelope is already recorded as executed.', 409)
  // Reconciliation: each check names what was compared; mismatches need a person's resolution.
  const manifest = JSON.parse(pkg.manifest)
  const expectedSigners = new Set<string>(manifest.recipients.filter((r: any) => r.action === 'sign').map((r: any) => r.email))
  const actualSigners = new Set(signers.map(s => s.email))
  const packagePdf = await readArtifactBytes(c.db, pkg.pdf_artifact_id)
  const comparison = await compareExecutionPdf(packagePdf, signed.bytes)
  const expectedPages = comparison.approvedPages, actualPages = comparison.signedPages
  const checks = [
    { check: 'envelope', ok: envelopeId === pkg.envelope_id, detail: envelopeId === pkg.envelope_id ? `Envelope ${envelopeId} matches the recorded handoff.` : `Envelope ${envelopeId} differs from the handoff's ${pkg.envelope_id}.` },
    { check: 'signers', ok: expectedSigners.size === actualSigners.size && [...expectedSigners].every(e => actualSigners.has(e)), detail: `Package signers: ${[...expectedSigners].join(', ')}. Signed by: ${[...actualSigners].join(', ') || 'nobody listed'}.` },
    { check: 'document', ok: bool(p, 'documentConfirmed') && (expectedPages === null || actualPages === null || actualPages >= expectedPages), detail: `${bool(p, 'documentConfirmed') ? 'Recorder confirmed' : 'Recorder did not confirm'} the signed file is the packaged document${pagesNote(expectedPages, actualPages)}.` },
    comparisonCheck(comparison),
    executionFieldsCheck(await inspectExecutionFields(packagePdf, signed.bytes)),
    { check: 'certificate', ok: certificate !== null, detail: certificate ? `Provider certificate kept as supplied (${certificate.filename}).` : 'No completion certificate supplied.' },
  ]
  const reconciled = checks.every(x => x.ok)
  const executionId = crypto.randomUUID()
  const signedArtifact = await storeArtifact(signed, { agreementId: a.id, role: 'signed', sourceSystem: pkg.provider, sourceId: envelopeId, provenance: { package: pkg.id, envelopeId, recordedBy: c.actor.id }, actorId: c.actor.id, at: c.now })
  const certArtifact = certificate ? await storeArtifact(certificate, { agreementId: a.id, role: 'certificate', sourceSystem: pkg.provider, sourceId: envelopeId, provenance: { package: pkg.id, envelopeId, issuedBy: pkg.provider }, actorId: c.actor.id, at: c.now }) : null
  const writes: Sql[] = [
    ...signedArtifact.writes,
    ...(certArtifact?.writes ?? []),
    sql('INSERT INTO lk_executions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', executionId, a.id, pkg.id, pkg.provider, envelopeId, signedArtifact.id, certArtifact?.id ?? null, json(signers), executedOn, 0, json(checks), reconciled ? 'reconciled' : 'needs_review', null, null, c.actor.id, c.now),
  ]
  if (reconciled) writes.push(sql("UPDATE lk_packages SET status='completed' WHERE id=?", pkg.id), bump(c, a, "status='executed'"))
  else writes.push(bump(c, a))
  return {
    allowed: may.signature,
    result: { executionId, status: reconciled ? 'reconciled' : 'needs_review', checks },
    writes,
    checks: [...agreementGuards(c, a, p), sql("(SELECT status FROM lk_packages WHERE id=?)='sent'", pkg.id), sql('NOT EXISTS(SELECT 1 FROM lk_artifacts WHERE sha256=? AND role=\'signed\')', signedSha)],
    audit: [{ action: 'execution.record', agreementId: a.id, summary: reconciled ? `Executed ${day(executedOn)}; envelope, signers, document and certificate reconciled` : `Signed file recorded; needs review: ${checks.filter(x => !x.ok).map(x => x.check).join(', ')}` }],
  }
}

const resolveExecution: Handler = async (c, p) => {
  requireRole(c.actor, may.resolveExecution, 'accept an execution with mismatches')
  const a = await visibleAgreement(c, p.agreementId)
  const e = await c.db.prepare('SELECT * FROM lk_executions WHERE id=? AND agreement_id=?').bind(p.executionId, a.id).first<any>()
  if (!e || e.status !== 'needs_review') fail('STATUS', 'Only an execution that needs review can be resolved.', 409)
  const reason = text(p, 'reason', 2000)
  return {
    allowed: may.resolveExecution,
    result: { executionId: e.id, status: 'accepted' },
    writes: [sql("UPDATE lk_executions SET status='accepted', resolution=?, resolved_by=? WHERE id=?", reason, c.actor.id, e.id), sql("UPDATE lk_packages SET status='completed' WHERE id=?", e.package_id), bump(c, a, "status='executed'")],
    checks: agreementGuards(c, a, p),
    audit: [{ action: 'execution.accept', agreementId: a.id, summary: `Accepted execution despite mismatches: ${reason}` }],
  }
}

/** The page counts of the packaged and the signed file, as a reader checks them. */
function pagesNote(packaged: number | null, signed: number | null) {
  if (packaged === null || signed === null) return ''
  return packaged === signed ? ` (${plural(signed, 'page')}, as packaged)` : ` (packaged ${plural(packaged, 'page')}; the signed file has ${signed})`
}

export const executionHandlers: Record<string, Handler> = {
  'package.prepare': preparePackage,
  'package.sent': markSent,
  'package.void': voidPackage,
  'execution.record': recordExecution,
  'execution.resolve': resolveExecution,
}
