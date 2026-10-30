// Move-in commands: preview (dry run, nothing native written), apply through
// the import-kit journal, and undo while nothing has used the imported records.
import { readD1ImportOriginals, applyD1ImportBatches, canonicalJson, createD1ImportJob, planD1Import, sha256 as kitSha256, undoD1Import, type D1ImportContext, type SourceBundle, type TargetEffect } from '../../modules/import-kit/src/d1/index'
import { authority, may, requireRole } from '../access'
import { refuseErasedAddress } from '../erasure-addresses'
import { encodeBase64, PDF } from '../artifacts'
import type { Ctx, Handler } from '../commands'
import { agreementReference, fail, integer, json, oneOf, parse, sql, text, type Actor } from '../model'
import { plural } from '../display'
import { locketTargets } from './adapter'
import { entityForNewAgreement, type EntityRow } from '../entities'
import { KIT, MAPPING_VERSION, preview, readKitInput, type PreviewRow } from './docusign'
import { previewEnterprise, confirmImportValue, remapEnterprise } from './enterprise'
import { enterpriseKits } from './enterprise-source'

const DESTINATION = 'locket'

export function importContext(c: Ctx, batchId: string, kit: string = KIT): D1ImportContext {
  return {
    destination: DESTINATION,
    namespace: kit,
    mappingVersion: kit === KIT ? MAPPING_VERSION : `${kit}/1`,
    operationKey: `locket:${batchId}`,
    batchSize: 1,
    storage: { database: c.db as any, targets: locketTargets(kit) },
    authorization: {
      // Bound to the owner role, not one operator row, so a restored installation can still undo.
      principalId: 'role:owner',
      predicate: () => {
        const a = authority(c.actor as Actor, may.imports)
        const checks=[a,...(c.erasureChecks??[])]
        return {sql:checks.map(s=>`(${s.sql})`).join(' AND '),params:checks.flatMap(s=>s.params)}
      },
    },
  }
}

/** Native rows each importable envelope becomes, with identities fixed at preview. */
function plannedEntities(c: Ctx, r: PreviewRow, files: Map<string, Uint8Array>, parties: Map<string, string>, batchId: string, at: number, entity: EntityRow | null): TargetEffect[] {
  const agreementId = crypto.randomUUID(), versionId = crypto.randomUUID(), executionId = crypto.randomUUID()
  const effects: TargetEffect[] = []
  let partyId = parties.get(r.counterparty.toLowerCase())
  if (!partyId) {
    partyId = crypto.randomUUID()
    parties.set(r.counterparty.toLowerCase(), partyId)
    effects.push({ targetKind: 'party', targetId: partyId, value: { id: partyId, name: r.counterparty, kind: 'other', tax_id: null, tax_id_kind: null, email: null, created_by: c.actor.id, created_at: at, version: 1 } })
  }
  const provenance = (path: string) => json({ kit: KIT, batch: batchId, envelopeId: r.envelopeId, path, manifestRow: r.row, imported: true })
  const artifact = (role: string, f: { path: string; sha256: string; size: number }, version: string | null) => {
    const id = crypto.randomUUID()
    return {
      id,
      effect: {
        targetKind: 'artifact',
        targetId: id,
        value: { id, agreement_id: agreementId, version_id: version, role, filename: f.path.split('/').pop()!, media_type: PDF, size: f.size, sha256: f.sha256, source_system: 'docusign', source_id: r.envelopeId, provenance: provenance(f.path), imported: 1, uploaded_by: c.actor.id, uploaded_at: at },
        attachment: { base64: encodeBase64(files.get(f.path)!), sha256: f.sha256, mediaType: PDF },
      } as TargetEffect,
    }
  }
  const signed = artifact('signed', r.document!, versionId)
  const certificate = r.certificate ? artifact('certificate', r.certificate, null) : null
  const schedules = r.schedules.map(s => artifact('attachment', s, null))
  const signerList = r.recipients.map(p => ({ name: p.name, email: p.email, signedAt: null }))
  const checks = [
    { check: 'envelope', ok: true, detail: `Envelope ${r.envelopeId} from the DocuSign envelope report (row ${r.row}).` },
    { check: 'signers', ok: signerList.length > 0, detail: signerList.length ? `Recipients from the report: ${signerList.map(s => s.email || s.name).join(', ')}.` : 'The report lists no recipients.' },
    { check: 'document', ok: true, detail: `Signed PDF ${r.document!.path} (sha256 ${r.document!.sha256.slice(0, 16)}…) kept exactly as exported.` },
    { check: 'certificate', ok: !!r.certificate, detail: r.certificate ? `DocuSign Certificate of Completion kept as exported (${r.certificate.path}).` : 'No separate Certificate of Completion supplied.' },
  ]
  const reference = agreementReference(agreementId)
  const terms = [] as Record<string, unknown>[]
  const term = (key: string, value: string) => ({ id: crypto.randomUUID(), agreement_id: agreementId, key, value, citation: json({ source: 'import-manifest', kit: KIT, envelopeId: r.envelopeId, row: r.row, note: 'From the owner’s manifest, not yet checked against the signed PDF.' }), status: 'proposed', proposed_by: c.actor.id, proposal_id: null, confirmed_by: null, confirmed_at: null, supersedes_id: null, reason: 'Imported value; confirm against the signed clause.', created_at: at })
  if (r.endDate) terms.push(term('end_date', r.endDate))
  if (r.noticeDays !== null) terms.push(term('notice_days', String(r.noticeDays)))
  terms.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  effects.push({
    targetKind: 'agreement',
    targetId: agreementId,
    value: {
      agreement: { id: agreementId, reference, title: agreementTitle(r.subject) || `DocuSign envelope ${r.envelopeId}`, type: r.type, party_id: partyId, value_cents: null, currency: 'USD', owner_id: c.actor.id, requester_id: c.actor.id, status: 'imported', restricted: 0, needed_by: null, start_date: null, timezone: entity?.timezone ?? 'America/New_York', entity_id: entity?.id ?? null, parent_id: null, relation: null, origin: KIT, current_version_id: versionId, created_at: at, updated_at: at, version: 1 },
      version: { id: versionId, agreement_id: agreementId, number: 1, kind: 'imported', label: `Signed in DocuSign, envelope ${r.envelopeId}`, template_version_id: null, fields: null, text: null, text_source: 'none', digest: r.document!.sha256, created_by: c.actor.id, created_at: at },
      execution: { id: executionId, agreement_id: agreementId, package_id: null, provider: 'docusign', envelope_id: r.envelopeId, signed_artifact_id: signed.id, certificate_artifact_id: certificate?.id ?? null, signers: json(signerList), executed_on: r.completedOn, imported: 1, checks: json(checks), status: r.certificate && signerList.length ? 'reconciled' : 'needs_review', resolution: null, resolved_by: null, recorded_by: c.actor.id, recorded_at: at },
      terms,
    } as any,
  })
  effects.push(signed.effect, ...(certificate ? [certificate.effect] : []), ...schedules.map(s => s.effect))
  return effects
}

const previewImport: Handler = async (c, p) => {
  requireRole(c.actor, may.imports, 'move archives in')
  oneOf(p, 'kit', [KIT, ...enterpriseKits] as const)
  if (p.kit !== KIT) return previewEnterprise(c, p)
  const input = await readKitInput(p)
  // ENTITY-001: one batch moves in for one of our entities once any is recorded.
  const entity = await entityForNewAgreement(c, p)
  const result = await preview(c.db, input)
  const batchId = crypto.randomUUID()
  const files = new Map(input.files.map(f => [f.path, f.bytes]))
  const existing = (await c.db.prepare('SELECT id, lower(name) AS name FROM lk_parties').all<{ id: string; name: string }>()).results
  const parties = new Map(existing.map(x => [x.name, x.id]))
  // The kit keeps the manifest and every supplied file's exact bytes in its journal.
  const source: SourceBundle = {
    records: [],
    diagnostics: [],
    artifacts: [
      { name: input.manifest.filename, sha256: input.manifest.sha256, size: input.manifest.bytes.length, original: { status: 'available', base64: encodeBase64(input.manifest.bytes) } },
      ...input.files.map(f => ({ name: f.path, sha256: f.sha256, size: f.bytes.length, original: { status: 'available' as const, base64: encodeBase64(f.bytes) } })),
    ],
  }
  const planned = new Map<string, TargetEffect[]>()
  const identities = new Set<string>()
  for (const r of result.rows) {
    // Only an envelope this batch imports claims the envelope's source identity;
    // rows it reports but does not import are named by batch and row.
    const sourceId = r.outcome === 'import' && !identities.has(r.envelopeId) ? r.envelopeId : `${r.envelopeId || 'no-envelope'}#${batchId}#row${r.row}`
    identities.add(sourceId)
    const payload = { row: r.row, envelopeId: r.envelopeId, outcome: r.outcome, notes: r.notes, document: r.document, certificate: r.certificate }
    source.records.push({ namespace: KIT, kind: 'envelope', sourceId, payload, payloadHash: kitSha256(canonicalJson(payload)), artifactHash: input.manifest.sha256, location: { artifact: input.manifest.filename, row: r.row } })
    if (r.outcome === 'import') planned.set(sourceId, plannedEntities(c, r, files, parties, batchId, c.now, entity))
  }
  const context = importContext(c, batchId)
  const plan = await planD1Import(source, { version: MAPPING_VERSION, map: record => {
    const effects = planned.get(record.sourceId)
    return effects ? { effects } : { effects: [], rejection: (record.payload as any).notes.join(' ') || 'Not imported.' }
  } }, context)
  context.reviewedFingerprint = plan.fingerprint
  const job = await createD1ImportJob(plan, context)
  const summary = { ...result, fingerprint: plan.fingerprint, jobId: job.id, kitCounts: plan.counts }
  return {
    allowed: may.imports,
    result: { batchId, counts: result.counts, fingerprint: plan.fingerprint },
    writes: [sql('INSERT INTO lk_import_batches VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)', batchId, KIT, 'previewed', input.label, json(summary), plan.fingerprint, job.id, c.actor.id, c.now, null, null, null, null, null)],
    audit: [{ action: 'import.preview', summary: `Dry run ${input.label}: ${result.counts.import} to import, ${plural(result.counts.duplicate, 'duplicate')}, ${result.counts.missing} missing evidence, ${result.counts.skip} not completed` }],
  }
}

async function batchOf(c: Ctx, p: Record<string, unknown>) {
  const batch = await c.db.prepare('SELECT * FROM lk_import_batches WHERE id=?').bind(text(p, 'batchId', 64)).first<any>()
  if (!batch) fail('NOT_FOUND', 'No such import batch.', 404)
  if (integer(p, 'version', 1) !== batch.version) fail('STALE', 'This import batch changed since you loaded it.', 409)
  return batch
}

/** The agreement's title from the envelope subject, without DocuSign's "Please DocuSign:" email prefix. */
const agreementTitle = (subject: string) => subject.replace(/^please docusign:\s*/i, '').trim()

const applyImport: Handler = async (c, p) => {
  requireRole(c.actor, may.imports, 'move archives in')
  const batch = await batchOf(c, p)
  if (batch.status !== 'previewed') fail('STATUS', `This batch is already ${batch.status}.`, 409)
  if (p.fingerprint !== batch.fingerprint) fail('FINGERPRINT', 'Apply exactly the dry run you reviewed (its fingerprint did not match).', 409)
  const originals=await readD1ImportOriginals(batch.job_id,importContext(c,batch.id,batch.kit))
  c.erasureChecks=[...await refuseErasedAddress(c,'import.apply',{originals}), sql('EXISTS(SELECT 1 FROM lk_import_batches WHERE id=? AND version=? AND status=?)',batch.id,batch.version,'previewed')]
  const reviewed = parse<any>(batch.preview)
  if (batch.kit !== KIT) {
    if (reviewed.unmapped.length) fail('IMPORT_MAPPING','Map or explicitly skip every unmapped field in a new dry run before applying.',409)
    const guards = reviewed.guards as {sql:string;params:unknown[]}[]
    const current = await c.db.prepare(`SELECT 1 WHERE ${guards.map(g=>`(${g.sql})`).join(' AND ')}`).bind(...guards.flatMap(g=>g.params)).first()
    if (!current) fail('IMPORT_STALE', 'A reviewed entity, field definition or counterparty changed. Run a new dry run.', 409)
    c.erasureChecks.push(...guards)
    const selected = reviewed.rows.filter((r:any)=>r.outcome==='import').map((r:any)=>({id:r.sourceId,sha:r.documents.find((d:any)=>d.role==='signed').sha256}))
    const fresh = sql("NOT EXISTS(SELECT 1 FROM lk_artifacts f JOIN json_each(?) source ON (f.source_system=? AND f.source_id=json_extract(source.value,'$.id')) OR (f.sha256=json_extract(source.value,'$.sha') AND f.role IN ('original','signed')) WHERE COALESCE(json_extract(f.provenance,'$.batch'),'')<>?)",json(selected),batch.kit,batch.id)
    if(!await c.db.prepare(`SELECT 1 WHERE ${fresh.sql}`).bind(...fresh.params).first())fail('IMPORT_STALE','A source identity or signed file was imported after this review. Run a new dry run; the journal retains any progress.',409)
    c.erasureChecks.push(fresh)
  }
  const context = { ...importContext(c, batch.id, batch.kit), reviewedFingerprint: batch.fingerprint }
  const job = await applyD1ImportBatches(batch.job_id, context)
  if (job.state !== 'completed' && batch.kit !== KIT) return {allowed:may.imports,result:{batchId:batch.id,status:'applying',version:batch.version+1,job:{state:job.state,checkpoint:job.checkpoint,total:job.total}},writes:[sql('UPDATE lk_import_batches SET version=version+1 WHERE id=?',batch.id)],audit:[{action:'import.progress',summary:`Applying ${batch.source_label}: ${job.checkpoint} of ${job.total} source rows; resume the reviewed journal.`}]}
  if (job.state !== 'completed') fail('IMPORT_INCOMPLETE', `The import stopped at ${job.checkpoint} of ${job.total}; apply again to resume from the journal.`, 409)
  const summary = parse(batch.preview)
  return {
    allowed: may.imports,
    result: { batchId: batch.id, status: 'applied', job: { state: job.state, checkpoint: job.checkpoint, total: job.total } },
    writes: [sql("UPDATE lk_import_batches SET status='applied', applied_by=?, applied_at=?, version=version+1 WHERE id=?", c.actor.id, c.now, batch.id)],
    checks: [sql("(SELECT status FROM lk_import_batches WHERE id=?)='previewed'", batch.id)],
    audit: [{ action: 'import.apply', summary: `Applied ${batch.source_label}: ${plural(summary.counts.import, 'agreement')} imported with original files and certificates` }],
  }
}

/** Records that were used after import keep the batch from being undone. */
async function dependents(c: Ctx, batchId: string) {
  // Undo removes artifacts before agreements and can resume in another request.
  // The durable agreement effects still identify this batch after its files are gone.
  const ids = (await c.db.prepare("SELECT DISTINCT k.target_id AS id FROM ik_provenance k JOIN lk_import_batches b ON b.job_id=k.job_id WHERE b.id=? AND k.target_kind='agreement' AND k.reversed=0").bind(batchId).all<{ id: string }>()).results.map(r => r.id)
  const used: { reference: string; reasons: string[] }[] = []
  const importedReferences = new Set<string>()
  for (const id of ids) {
    const a = await c.db.prepare('SELECT reference, version FROM lk_agreements WHERE id=?').bind(id).first<{ reference: string; version: number }>()
    if (!a) continue
    importedReferences.add(a.reference)
    const reasons: string[] = []
    if (a.version !== 1) reasons.push('edited in Locket')
    for (const [table, label] of [['lk_terms WHERE status!=\'proposed\' AND', 'terms confirmed'], ['lk_obligations WHERE', 'obligations recorded'], ['lk_notices WHERE', 'notices prepared'], ['lk_renewals WHERE', 'renewal queued'], ['lk_comments WHERE', 'comments'], ['lk_access WHERE', 'access grants']] as const) {
      const hit = await c.db.prepare(`SELECT 1 AS x FROM ${table} agreement_id=? LIMIT 1`).bind(id).first()
      if (hit) reasons.push(label)
    }
    if (await c.db.prepare("SELECT 1 AS x FROM lk_agreements a WHERE parent_id=? AND NOT EXISTS(SELECT 1 FROM lk_artifacts f WHERE f.agreement_id=a.id AND json_extract(f.provenance,'$.batch')=?) LIMIT 1").bind(id,batchId).first()) reasons.push('linked as a parent outside the batch')
    if (reasons.length) used.push({ reference: a.reference, reasons })
  }
  // A counterparty this batch created that another agreement now names stays, so undo would break that agreement.
  const batch = await c.db.prepare('SELECT job_id FROM lk_import_batches WHERE id=?').bind(batchId).first<{ job_id: string }>()
  const sharing = (await c.db.prepare("SELECT a.reference, p.name FROM ik_provenance k JOIN lk_parties p ON p.id=k.target_id JOIN lk_agreements a ON a.party_id=p.id WHERE k.job_id=? AND k.target_kind='party' AND k.reversed=0 ORDER BY a.reference").bind(batch!.job_id).all<{ reference: string; name: string }>()).results
  for (const s of sharing) if (!importedReferences.has(s.reference)) used.push({ reference: s.reference, reasons: [`names the imported counterparty ${s.name}`] })
  return used
}

const undoImport: Handler = async (c, p) => {
  requireRole(c.actor, may.imports, 'undo a move-in')
  const batch = await batchOf(c, p)
  if (batch.status !== 'applied') fail('STATUS', `Only an applied batch can be undone; this one is ${batch.status}.`, 409)
  const reason = text(p, 'reason', 1000)
  const used = await dependents(c, batch.id)
  if (used.length) fail('IMPORT_DEPENDENCY', `Imported agreements are in use and keep their history: ${used.map(u => `${u.reference} (${u.reasons.join(', ')})`).join('; ')}. Undo is refused; correct those records instead.`, 409, { used })
  c.erasureChecks=[sql('EXISTS(SELECT 1 FROM lk_import_batches WHERE id=? AND version=? AND status=?)',batch.id,batch.version,'applied')]
  const job = await undoD1Import(batch.job_id, importContext(c, batch.id, batch.kit))
  if (job.state !== 'undone' && batch.kit !== KIT) return {allowed:may.imports,result:{batchId:batch.id,status:'undoing',version:batch.version+1},writes:[sql('UPDATE lk_import_batches SET version=version+1 WHERE id=?',batch.id)],audit:[{action:'import.progress',summary:`Undoing ${batch.source_label}; retained originals remain in the journal.`}]}
  if (job.state !== 'undone') fail('IMPORT_INCOMPLETE', 'Undo stopped before finishing; run it again to resume from the journal.', 409)
  return {
    allowed: may.imports,
    result: { batchId: batch.id, status: 'undone' },
    writes: [sql("UPDATE lk_import_batches SET status='undone', undone_by=?, undone_at=?, undo_reason=?, version=version+1 WHERE id=?", c.actor.id, c.now, reason, batch.id)],
    checks: [sql("(SELECT status FROM lk_import_batches WHERE id=?)='applied'", batch.id)],
    audit: [{ action: 'import.undo', summary: `Undid ${batch.source_label}: ${reason}` }],
  }
}

export const importHandlers: Record<string, Handler> = {
  'import.preview': previewImport,
  'import.apply': applyImport,
  'import.undo': undoImport,
  'import.remap': remapEnterprise,
  'import.value.confirm': confirmImportValue,
}
