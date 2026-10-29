import type { SourceBundle, TargetEffect } from '../../modules/import-kit/src/d1/index'
import { canonicalJson, sha256 as kitSha256 } from '../../modules/import-kit/src/d1/index'
import { encodeBase64, isPdf, PDF, DOCX } from '../artifacts'
import type { Ctx } from '../commands'
import { customFieldChecks, customFields, fieldApplies, fieldRequired } from '../custom-fields'
import { normalizedValue } from '../custom-values'
import type { EntityRow } from '../entities'
import { agreementReference, fail, json, parse, sql, type Sql } from '../model'
import { IRONCLAD, mappedValue, mappingCatalogue, sourceValue, type IroncladInput } from './ironclad'

const relations = ['amends', 'order_under', 'schedule_to', 'renews', 'statement_of_work_under', 'supersedes']

export async function planIronclad(c: Ctx, input: IroncladInput, p: Record<string, unknown>, batchId: string, entity: EntityRow | null) {
  const catalogue = mappingCatalogue(input, p.mapping)
  if (catalogue.unmapped.length) fail('IRONCLAD_MAPPING', `Create a custom field or explicitly skip: ${catalogue.unmapped.join(', ')}.`, 400, catalogue)
  const fields = await customFields(c.db), checks: Sql[] = customFieldChecks(fields)
  if (entity) checks.push(sql('(SELECT version FROM lk_entities WHERE id=?)=?', entity.id, entity.version))
  else checks.push(sql('NOT EXISTS(SELECT 1 FROM lk_entities)'))
  const parties = new Map((await c.db.prepare('SELECT id, lower(name) AS name FROM lk_parties WHERE merged_into IS NULL').all<{ id: string; name: string }>()).results.map(r => [r.name, r.id]))
  const existingParties = new Set(parties.values())
  const storedParents=(await c.db.prepare("SELECT DISTINCT f.source_id,a.id,a.version,a.reference FROM lk_artifacts f JOIN lk_agreements a ON a.id=f.agreement_id WHERE f.source_system='ironclad' AND a.status='imported'").all<{source_id:string;id:string;version:number;reference:string}>()).results
  const parentVersions=new Map<string,number>()
  const usedFiles = new Set<string>(), seenDigests = new Set<string>(), planned = new Map<string, TargetEffect[]>(), ids = new Map(input.records.map(r => [r.id, crypto.randomUUID()]))
  const rows: any[] = []
  for (const r of input.records) {
    const notes: string[] = [], type = catalogue.mapping.types[r.type]
    const claims = (record: typeof r, path: string) => {
      const folder = path.split('/')[0]
      // A known record folder is authoritative; a foreign filename never steals it.
      if (input.records.some(other => other.id === folder)) return folder === record.id
      return record.attachments.some(a => a === path || (a === path.split('/').pop() && input.files.filter(x => x.path.split('/').pop() === a).length === 1))
    }
    const ambiguous = input.files.filter(f => claims(r,f.path) && input.records.filter(other => claims(other,f.path)).length !== 1)
    const matched = input.files.filter(f => claims(r,f.path) && !ambiguous.includes(f))
    matched.forEach(f => usedFiles.add(f.path))
    const supported = matched.filter(f => isPdf(f) || (/\.docx$/i.test(f.path) && f.bytes[0] === 0x50 && f.bytes[1] === 0x4b))
    const document = supported[0]
    let outcome = 'import'
    if (ambiguous.length) { outcome='missing'; notes.push('Attachment identity is claimed by multiple records; resolve the source assignment.') }
    if (r.sourceType === 'clickwrap') { outcome='skip'; notes.push('Clickwrap history belongs to MOVE-007; no execution is invented.') }
    if (r.status && !['completed', 'executed', 'signed', 'active', 'expired', 'record', 'archived'].includes(r.status.toLowerCase())) { outcome = 'skip'; notes.push(`Workflow status ${r.status}; active workflows belong to MOVE-006.`) }
    if (!document && outcome === 'import') { outcome = 'missing'; notes.push('Record has no matching PDF or DOCX. Supply its attachments before import.') }
    const missingAttachments = r.attachments.filter(a => !matched.some(f => f.path === a || f.path.split('/').pop() === a))
    if (missingAttachments.length && outcome === 'import') { outcome = 'missing'; notes.push(`Missing or ambiguous documents: ${missingAttachments.join(', ')}.`) }
    if (matched.length !== supported.length) { outcome = 'missing'; notes.push('Unsupported or unreadable documents stay in the journal; supply PDF or DOCX originals.') }
    if (document && outcome === 'import') {
      const held = await c.db.prepare("SELECT 1 FROM lk_artifacts WHERE (source_system='ironclad' AND source_id=?) OR (sha256 IN (SELECT value FROM json_each(?)) AND role IN ('original','signed','attachment')) LIMIT 1").bind(r.id, json(supported.map(f => f.sha256))).first()
      if (held || supported.some(f => seenDigests.has(f.sha256))) { outcome = 'duplicate'; notes.push('The record ID or a document digest is already held; no existing agreement is changed.') }
      if(outcome==='import')supported.forEach(f => seenDigests.add(f.sha256))
    }
    const values = new Map<string, unknown>()
    for (const [property, target] of Object.entries(catalogue.mapping.properties)) if (!['skip', 'unmapped'].includes(target) && r.properties[property] !== undefined && r.properties[property] !== null && r.properties[property] !== '') values.set(target, r.properties[property])
    const counterparty = String(sourceValue(values.get('counterparty') ?? 'Unknown counterparty','counterparty')).trim()
    if (!counterparty || counterparty.length > 200) fail('IRONCLAD_VALUE', 'Map counterparty to a name of at most 200 characters.')
    const subject = String(sourceValue(values.get('title') ?? r.name ?? r.id,'title')).trim() || r.id
    if (subject.length > 300) fail('IRONCLAD_VALUE', 'Map the title to at most 300 characters.')
    const relation = r.parentId ? String((p.relations as any)?.[r.id] ?? (r.relation || (type === 'amendment' ? 'amends' : type === 'order_form' ? 'order_under' : 'schedule_to'))) : ''
    if (r.parentId && !relations.includes(relation)) fail('IRONCLAD_FAMILY', 'Choose a supported relation for every child record.')
    const row = { row: rows.length + 1, recordId: r.id, workflowId: r.workflowId, envelopeId: r.id, subject, status: r.status || 'record', type, counterparty, parentId: r.parentId, parentReference:'', relation, document: document ? { path: document.path, sha256: document.sha256, size: document.bytes.length } : null, schedules: supported.slice(1).map(f => ({ path: f.path, sha256: f.sha256, size: f.bytes.length })), certificate: null, completedOn: null, outcome, notes, proposedTerms:[] as {key:string;value:string}[] }
    rows.push(row)
    if (outcome !== 'import') continue
    checks.push(sql("NOT EXISTS(SELECT 1 FROM lk_artifacts WHERE ((source_system='ironclad' AND source_id=?) OR (sha256 IN (SELECT value FROM json_each(?)) AND role IN ('original','signed','attachment'))) AND NOT (source_system IS 'ironclad' AND json_extract(provenance,'$.batch') IS ?))",r.id,json(supported.map(f=>f.sha256)),batchId))
    const agreementId = ids.get(r.id)!, versionId = crypto.randomUUID(), executionId = crypto.randomUUID(), effects: TargetEffect[] = []
    let partyId = parties.get(counterparty.toLowerCase())
    if (!partyId) {
      partyId = crypto.randomUUID(); parties.set(counterparty.toLowerCase(), partyId)
      effects.push({ targetKind: 'party', targetId: partyId, value: { id: partyId, name: counterparty, kind: 'other', tax_id: null, tax_id_kind: null, email: null, created_by: c.actor.id, created_at: c.now, version: 1 } })
    } else if (existingParties.has(partyId)) checks.push(sql('EXISTS(SELECT 1 FROM lk_parties WHERE id=? AND lower(name)=? AND merged_into IS NULL)', partyId, counterparty.toLowerCase()))
    const terms: any[] = []
    for (const [key, raw] of values) if (!['title', 'counterparty'].includes(key) && !key.startsWith('custom:')) {
      const value = mappedValue(key, raw)
      terms.push({ id: crypto.randomUUID(), agreement_id: agreementId, key, value, citation: json({ source: 'import-manifest', kit: IRONCLAD, recordId: r.id, workflowId: r.workflowId, manifest: input.manifest.path, note: 'Proposed from Ironclad metadata. Cite the original document before confirming.' }), status: 'proposed', proposed_by: c.actor.id, proposal_id: null, confirmed_by: null, confirmed_at: null, supersedes_id: null, reason: 'Imported proposal; confirm against the original document.', created_at: c.now })
    }
    const customValues: any[] = []
    for (const [key, raw] of values) if (key.startsWith('custom:')) {
      const field = fields.find(f => f.id === key.slice(7) && fieldApplies(f, type))
      if (!field || !parse<string[]>(field.edit_roles).includes(c.actor.role)) fail('IRONCLAD_MAPPING', 'Map only custom fields available for this record type and your role.')
      const typed = sourceValue(raw,field.kind)
      const converted = field.kind === 'number' ? (typeof typed === 'number' ? typed : typeof typed === 'string' && typed.trim() ? Number(typed) : NaN) : field.kind === 'yes_no' ? String(typed).toLowerCase() === 'true' ? true : String(typed).toLowerCase() === 'false' ? false : typed : typed
      const normalized=await normalizedValue(c, field, converted, checks)
      if(['date','money'].includes(field.kind)) terms.push({ id:crypto.randomUUID(),agreement_id:agreementId,key:`custom:${field.id}`,value:json(normalized),citation:json({source:'import-manifest',kit:IRONCLAD,recordId:r.id,workflowId:r.workflowId,fieldId:field.id,fieldVersion:field.version,note:'Imported custom date or value; confirm against the original document.'}),status:'proposed',proposed_by:c.actor.id,proposal_id:null,confirmed_by:null,confirmed_at:null,supersedes_id:null,reason:'Imported proposal; confirm against the original document.',created_at:c.now })
      else customValues.push({ agreement_id: agreementId, field_id: field.id, value: json(normalized), updated_by: c.actor.id, updated_at: c.now })
    }
    if (fields.some(f => fieldApplies(f, type) && fieldRequired(f, 'imported') && !customValues.some(v => v.field_id === f.id && v.value !== 'null'))) fail('FIELDS', 'Map the required custom fields before importing this agreement type.')
    row.proposedTerms=terms.map(t=>({key:t.key,value:t.value}))
    const artifacts = supported.map((f, i) => {
      const id = crypto.randomUUID()
      return { id, effect: { targetKind: 'artifact', targetId: id, value: { id, agreement_id: agreementId, version_id: i === 0 ? versionId : null, role: i === 0 ? 'signed' : 'attachment', filename: f.path.split('/').pop(), media_type: isPdf(f) ? PDF : DOCX, size: f.bytes.length, sha256: f.sha256, source_system: 'ironclad', source_id: r.id, provenance: json({ kit: IRONCLAD, batch: batchId, recordId: r.id, workflowId: r.workflowId, path: f.path, imported: true }), imported: 1, uploaded_by: c.actor.id, uploaded_at: c.now }, attachment: { base64: encodeBase64(f.bytes), sha256: f.sha256, mediaType: isPdf(f) ? PDF : DOCX } } as TargetEffect }
    })
    effects.push({ targetKind: 'agreement', targetId: agreementId, value: {
      agreement: { id: agreementId, reference: agreementReference(agreementId), title: subject, type, party_id: partyId, value_cents: null, currency: 'USD', owner_id: c.actor.id, requester_id: c.actor.id, status: 'imported', restricted: 0, needed_by: null, start_date: null, timezone: entity?.timezone ?? 'America/New_York', entity_id: entity?.id ?? null, parent_id: null, relation: null, origin: 'legacy', current_version_id: versionId, created_at: c.now, updated_at: c.now, version: 1 },
      version: { id: versionId, agreement_id: agreementId, number: 1, kind: 'imported', label: `Imported Ironclad record ${r.id}${r.workflowId ? `; workflow ${r.workflowId}` : ''}`, template_version_id: null, fields: json({ ironclad: { recordId: r.id, workflowId: r.workflowId } }), text: null, text_source: 'none', digest: document!.sha256, created_by: c.actor.id, created_at: c.now },
      execution: { id: executionId, agreement_id: agreementId, package_id: null, provider: 'ironclad', envelope_id: r.id, signed_artifact_id: artifacts[0].id, certificate_artifact_id: null, signers: '[]', executed_on: '', imported: 1, checks: json([{ check: 'imported-record', ok: true, detail: `Imported Ironclad repository record ${r.id}. Original documents retained; this is not a Locket signature event.` }, { check: 'signature-evidence', ok: false, detail: 'Imported history; signature validity and legal sufficiency require human review.' }]), status: 'needs_review', resolution: null, resolved_by: null, recorded_by: c.actor.id, recorded_at: c.now },
      terms: terms.sort((a, b) => a.id.localeCompare(b.id)), customValues: customValues.sort((a,b)=>a.field_id.localeCompare(b.field_id)),
    } as any }, ...artifacts.map(a => a.effect))
    planned.set(r.id, effects)
  }
  // Bind earlier imported parents by their exact Ironclad source identity and
  // current revision. This lets a large family span reviewed bounded batches.
  for (const row of rows) if (row.outcome === 'import' && row.parentId) {
    const parent = rows.find(r => r.recordId === row.parentId)
    if (!parent || parent.outcome !== 'import') {
      const existing=storedParents.filter(p=>p.source_id===row.parentId)
      if(existing.length!==1)fail('IRONCLAD_FAMILY', `Include importable parent ${row.parentId} with child ${row.recordId}, or select its uniquely identified earlier Ironclad import.`)
      ids.set(row.parentId,existing[0].id as ReturnType<typeof crypto.randomUUID>)
      parentVersions.set(row.parentId,existing[0].version);row.parentReference=existing[0].reference
      checks.push(sql("EXISTS(SELECT 1 FROM lk_agreements WHERE id=? AND version=? AND status='imported')",existing[0].id,existing[0].version))
    }
    const visited = new Set([row.recordId]); let cursor = parent
    while (cursor) {
      if (visited.has(cursor.recordId)) fail('IRONCLAD_FAMILY', 'The source family contains a cycle.')
      visited.add(cursor.recordId); cursor = rows.find(r => r.recordId === cursor.parentId)
    }
  }
  const source: SourceBundle = { records: [], diagnostics: [], artifacts: [...input.originals, ...input.files].filter((f, i, all) => all.findIndex(a => a.path === f.path) === i).map(f => ({ name: f.path, sha256: f.sha256, size: f.bytes.length, original: { status: 'available' as const, base64: encodeBase64(f.bytes) } })) }
  for (const row of rows) {
    const payload = { ...row, mapping: catalogue.mapping }
    source.records.push({ namespace: IRONCLAD, kind: 'record', sourceId: row.outcome === 'import' ? row.recordId : `${row.recordId}#${batchId}`, payload, payloadHash: kitSha256(canonicalJson(payload)), artifactHash: input.manifest.sha256, location: { artifact: input.manifest.path, row: row.row } })
  }
  for (const row of rows) if (row.outcome === 'import' && row.parentId) {
    const sourceId = `family:${row.recordId}`, payload = { id: ids.get(row.recordId)!, parent_id: ids.get(row.parentId)!, parent_version:parentVersions.get(row.parentId)??1, relation: row.relation }
    source.records.push({ namespace: IRONCLAD, kind: 'family', sourceId, payload, payloadHash: kitSha256(canonicalJson(payload)), artifactHash: input.manifest.sha256, location: {artifact:input.manifest.path,row:row.row} })
    planned.set(sourceId, [{ targetKind: 'ironclad-family', targetId: payload.id, value: payload }])
  }
  const orphans = input.files.filter(f => !usedFiles.has(f.path)).map(f => f.path)
  const counts = { rows: rows.length, import: rows.filter(r => r.outcome === 'import').length, skip: rows.filter(r => r.outcome === 'skip').length, duplicate: rows.filter(r => r.outcome === 'duplicate').length, missing: rows.filter(r => r.outcome === 'missing').length, orphanFiles: orphans.length, withoutCertificate: 0 }
  return { source, planned, checks, summary: { rows, counts, orphans, ...catalogue, manifest: { filename: input.manifest.path, sha256: input.manifest.sha256 }, reviewedGuards: checks, entityId: entity?.id ?? null, entityVersion: entity?.version ?? null, fieldVersions: fields.map(f => ({ id: f.id, version: f.version })) } }
}
