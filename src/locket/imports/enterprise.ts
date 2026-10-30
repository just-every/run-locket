import { readD1ImportOriginals, createD1ImportJob, planD1Import, canonicalJson, sha256 as kitSha256, type SourceBundle, type TargetEffect } from '../../modules/import-kit/src/d1/index'
import { requireRole, may } from '../access'
import { encodeBase64, isPdf } from '../artifacts'
import type { Ctx, Handler } from '../commands'
import { entityForNewAgreement } from '../entities'
import { customFields, customFieldChecks, fieldApplies } from '../custom-fields'
import { normalizedValue } from '../custom-values'
import { citation } from '../obligations'
import { agreementGuards, bump, visibleAgreement } from '../records'
import { agreementReference, date, fail, integer, json, money, object, parse, sql, text, type Sql, type Role } from '../model'
import { refuseErasedAddress } from '../erasure-addresses'
import { relations } from '../family-relations'
import { importContext } from './commands'
import { enterpriseInput, type EnterpriseKit } from './enterprise-source'
import { readTable } from './spreadsheet'

export const destinations = ['id', 'code', 'title', 'type', 'status', 'counterparty', 'parent', 'relation', 'documents', 'effective_date', 'end_date', 'auto_renew', 'renewal_type', 'initial_term_months', 'renewal_term_months', 'renewals_allowed', 'notice_days', 'governing_law', 'payment_terms', 'value', 'currency', 'skip']
const aliases: Record<string, string[]> = {
  id: ['System ID', 'Record ID', 'id'], code: ['Agreement Code'], title: ['Name', 'Contract Title', 'contract_title'],
  type: ['Contract Type', 'contract_type'], status: ['Status', 'contract_status'], counterparty: ['Second Party', 'Company', 'company_name'],
  parent: ['Parent ID', 'Parent Contract', 'parent_contract'], relation: ['Relation'], documents: ['Documents'],
  effective_date: ['Effective Date', 'Start Date'], end_date: ['Expiry Date', 'End Date'], value: ['Value', 'Amount'], currency: ['Currency'],
  governing_law: ['Governing Law'], payment_terms: ['Payment Terms'], auto_renew: ['Auto Renewal'], renewal_type: ['Renewal Type'], renewal_term_months: ['Renewal Months'], initial_term_months: ['Initial Months'], renewals_allowed: ['Renewals Allowed'], notice_days: ['Notice Days'],
}
const types = ['customer', 'supplier', 'nda', 'amendment', 'order_form', 'other']
type Row = Record<string, any>

export const previewEnterprise: Handler = async (c, p) => {
  requireRole(c.actor, may.imports, 'move archives in')
  const kit = p.kit as EnterpriseKit
  const input = await enterpriseInput(c, p, kit), entity = await entityForNewAgreement(c, p)
  if (input.files.some(f=>f.bytes.length>5*1024*1024 || /[\x00-\x1f]/.test(f.path) || f.path.split('/').some(s=>s==='.' || s==='..'))) fail('IMPORT_FILES','Use plain relative paths and files no larger than 5 MB.',413)
  c.erasureChecks=[...(c.erasureChecks??[]),...await refuseErasedAddress(c,'import.preview',{manifest:{base64:encodeBase64(input.manifest.bytes)},files:input.files.map(f=>({path:f.path,base64:encodeBase64(f.bytes)}))})]
  const table = readTable(input.manifest.filename, input.manifest.bytes)
  if (!table.header.length || table.header.some(h => !h) || new Set(table.header).size !== table.header.length) fail('MANIFEST_COLUMNS', 'Use distinct nonempty column headings.')
  if(table.header.length>250 || table.rows.some(r=>Object.values(r).some(v=>v.length>4000)))fail('IMPORT_LIMIT','Use at most 250 columns and metadata values no longer than 4000 characters.',413)
  if (table.rows.length > 100) fail('IMPORT_LIMIT', 'Select at most 100 records per reviewed batch.', 413)
  const fields = await customFields(c.db), checks = customFieldChecks(fields)
  const supplied = p.mapping === undefined ? {} : object(p.mapping, 'mapping'), mapping: Record<string, string> = {}
  for (const column of table.header) {
    const target = supplied[column] ?? Object.entries(aliases).find(([, names]) => names.some(n => n.toLowerCase() === column.toLowerCase()))?.[0] ?? 'unmapped'
    if (typeof target !== 'string' || ![...destinations, 'unmapped'].includes(target) && !fields.some(f => `custom:${f.id}` === target)) fail('IMPORT_MAPPING', `Choose a known field or skip for ${column}.`)
    mapping[column] = target
  }
  if (Object.keys(supplied).some(k => !table.header.includes(k))) fail('IMPORT_MAPPING', 'The mapping names a column absent from this source.')
  const targets = Object.values(mapping).filter(v => !['unmapped', 'skip'].includes(v))
  if (new Set(targets).size !== targets.length) fail('IMPORT_MAPPING', 'Map each destination only once.')
  const missingMappings = ['id','title','type','status','counterparty'].filter(required=>!targets.includes(required))
  const typeMapping = p.typeMapping === undefined ? {} : object(p.typeMapping, 'typeMapping')
  const fileRoles = p.fileRoles === undefined ? {} : object(p.fileRoles, 'fileRoles')
  if (Object.values(fileRoles).some(v => !['signed', 'version', 'attachment', 'certificate'].includes(String(v)))) fail('IMPORT_MAPPING', 'Choose signed, version, attachment or certificate for each file field.')
  const signedStatuses = p.signedStatuses ?? ['Executed', 'Signed', 'Completed']
  if (!Array.isArray(signedStatuses) || !signedStatuses.length || signedStatuses.length>20 || signedStatuses.some(v => typeof v !== 'string' || !v.trim() || v.length>100)) fail('IMPORT_MAPPING', 'Choose the source statuses that explicitly mean signed.')
  const unmapped = table.header.filter(h => mapping[h] === 'unmapped'), used = new Set<string>(), ids = new Map<string, string>(), seen = new Set<string>(), digests = new Set<string>()
  const rows: Row[] = [], planned = new Map<string, TargetEffect[]>()
  const batchId = crypto.randomUUID(), parties = new Map((await c.db.prepare('SELECT id,lower(name) AS name FROM lk_parties WHERE merged_into IS NULL').all<{ id: string; name: string }>()).results.map(p => [p.name, p.id]))
  for (const [index, raw] of table.rows.entries()) {
    const values = Object.fromEntries(Object.entries(mapping).filter(([, target]) => !['unmapped', 'skip'].includes(target)).map(([column, target]) => [target, raw[column] ?? '']))
    const id = values.id?.trim() ?? '', type = String(typeMapping[values.type] ?? (types.includes(values.type?.toLowerCase()) ? values.type.toLowerCase() : ''))
    if (id && !ids.has(id)) ids.set(id, crypto.randomUUID())
    const notes: string[] = []
    let outcome = 'import'
    const matched = input.files.filter(f => !f.path.startsWith('_api/') && !f.path.startsWith('_source/') && (f.path.split('/')[0] === id || values.code && f.path.split('/')[0] === values.code || (values.documents ?? '').split(';').map(s => s.trim()).includes(f.path)))
    matched.forEach(f => used.add(f.path))
    const role = (path: string) => String(fileRoles[path] ?? fileRoles[path.split('/')[1]] ?? (path.toLowerCase().endsWith('.pdf') && !/certificate|summary/i.test(path) ? 'version' : /certificate|summary/i.test(path) ? 'certificate' : 'attachment'))
    const primary = matched.find(f => role(f.path) === 'signed') ?? matched.find(f => role(f.path) === 'version' && isPdf(f))
    if (missingMappings.length || !id || !values.title || !values.counterparty) { outcome = 'missing'; notes.push('Identity, title and counterparty are required.') }
    else if (seen.has(id)) { outcome = 'duplicate'; notes.push('Repeated source identity.') }
    else if (!signedStatuses.some(s => s.toLowerCase() === values.status?.toLowerCase())) { outcome = 'skip'; notes.push('This source status was not declared signed; no execution will be invented.') }
    else if (/[\/\x00-\x1f]/.test(id) || id==='.' || id==='..') { outcome='missing'; notes.push('Use a plain source identity without path separators.') }
    else if (!types.includes(type)) { outcome = 'missing'; notes.push('Map this source contract type to a Locket agreement type.') }
    else if (!primary || !isPdf(primary)) { outcome = 'missing'; notes.push('No signed PDF matched this record.') }
    else {
      const held = await c.db.prepare('SELECT 1 FROM lk_artifacts WHERE (source_system=? AND source_id=?) OR (sha256=? AND role IN (\'original\',\'signed\')) LIMIT 1').bind(kit, id, primary.sha256).first()
      if (held || digests.has(primary.sha256)) { outcome = 'duplicate'; notes.push('The source identity or signed bytes are already held.') }
      else digests.add(primary.sha256)
    }
    if(matched.filter(f=>role(f.path)==='signed').length>1){outcome='missing';notes.push('Multiple files were mapped as the signed agreement. Choose one exact signed path and map the others as source versions or supporting files.')}
    if (id) seen.add(id)
    if(values.value && !values.currency){outcome='missing';notes.push('Map a currency for the source amount; no currency will be assumed.')}
    const proposed: { key: string; value: string; column: string }[] = []
    for (const [key, rawValue] of Object.entries(values)) {
      if (!rawValue || !['effective_date', 'end_date', 'auto_renew', 'renewal_type', 'initial_term_months', 'renewal_term_months', 'renewals_allowed', 'notice_days', 'governing_law', 'payment_terms', 'value', 'currency'].includes(key) && !key.startsWith('custom:')) continue
      let value = rawValue
      try {
        if (key.endsWith('_date')) {
          if (/^\d+(\.\d+)?$/.test(value)) value = new Date(Date.UTC(1899, 11, 30) + Number(value) * 86400000).toISOString().slice(0, 10)
          value = date({ value }, 'value')
        } else if (['initial_term_months', 'renewal_term_months', 'renewals_allowed', 'notice_days'].includes(key)) value = String(integer({ value: Number(value) }, 'value', key.endsWith('months') ? 1 : 0, key === 'notice_days' ? 730 : 100000))
        else if (key === 'auto_renew') { value = value.toLowerCase(); if (!['yes', 'no'].includes(value)) throw Error() }
        else if (key === 'renewal_type' && !['fixed', 'auto_renew', 'evergreen', 'optional'].includes(value)) throw Error()
        else if (key === 'value') money({ value }, 'value')
        else if (key === 'currency' && !/^[A-Z]{3}$/.test(value)) throw Error()
        else if (key.startsWith('custom:')) {
          const field = fields.find(f => 'custom:' + f.id === key)!
          if (!fieldApplies(field, type)) throw Error()
          const raw = field.kind === 'yes_no' ? value === 'true' || value === 'yes' ? true : value === 'false' || value === 'no' ? false : value : field.kind === 'number' ? Number(value) : value
          value = json(await normalizedValue(c, field, raw, checks))
        }
        proposed.push({ key: ['value', 'currency'].includes(key) ? 'import:' + key : key, value, column: Object.keys(mapping).find(k => mapping[k] === key)! })
      } catch { outcome = 'missing'; notes.push(`Invalid ${key}; correct the source or mapping before applying.`) }
    }
    rows.push({ row: index + 2, sourceId: id, code: values.code ?? null, subject: values.title, counterparty: values.counterparty, type, status: values.status, parentSourceId: values.parent ?? null, relation: values.relation || (type === 'amendment' ? 'amends' : 'order_under'), outcome, notes, documents: matched.map(f => ({ path: f.path, sha256: f.sha256, size: f.bytes.length, role: f === primary ? 'signed' : role(f.path) })), proposed, values })
  }
  // Topological order ensures parent custody exists before a child; invalid links
  // hold their record, rather than silently discarding source relationships.
  const ordered: Row[] = [], visiting = new Set<string>(), visited = new Set<Row>()
  const visit = (r: Row) => {
    if (visited.has(r)) return
    if (visiting.has(r.sourceId)) fail('IMPORT_FAMILY', 'The source contains a family cycle; correct it before applying.')
    visiting.add(r.sourceId)
    if (r.outcome === 'import' && r.parentSourceId) {
      const parent = rows.find(p => p.sourceId === r.parentSourceId)
      if (!parent || parent.outcome !== 'import' || !relations.includes(r.relation)) { r.outcome = 'missing'; r.notes.push('The parent and relation must be importable in the same reviewed batch.') }
      else visit(parent)
      if (parent?.outcome !== 'import') r.outcome = 'missing'
    }
    visiting.delete(r.sourceId); visited.add(r); ordered.push(r)
  }
  rows.forEach(visit)
  const source: SourceBundle = { records: [], diagnostics: [], artifacts: [{ name: input.manifest.filename, sha256: input.manifest.sha256, size: input.manifest.bytes.length, original: { status: 'available', base64: encodeBase64(input.manifest.bytes) } }, ...input.files.map(f => ({ name: f.path, sha256: f.sha256, size: f.bytes.length, original: { status: 'available' as const, base64: encodeBase64(f.bytes) } }))] }
  for (const r of ordered) {
    const sourceId = r.outcome === 'import' ? r.sourceId : `${r.sourceId}#${batchId}#${r.row}`
    source.records.push({ namespace: kit, kind: 'agreement', sourceId, payload: JSON.parse(JSON.stringify(r)), payloadHash: kitSha256(canonicalJson(r)), artifactHash: input.manifest.sha256, location: { artifact: input.manifest.filename, row: r.row } })
    if (r.outcome !== 'import') continue
    const effects: TargetEffect[] = [], id = ids.get(r.sourceId)!, versionId = crypto.randomUUID()
    let partyId = parties.get(r.counterparty.toLowerCase())
    if (!partyId) {
      partyId = crypto.randomUUID(); parties.set(r.counterparty.toLowerCase(), partyId)
      effects.push({ targetKind: 'party', targetId: partyId, value: { id: partyId, name: r.counterparty, kind: 'other', tax_id: null, tax_id_kind: null, email: null, created_by: c.actor.id, created_at: c.now, version: 1 } })
    }
    const docs = r.documents as Row[], signed = docs.find(d => d.role === 'signed')!, certificate = docs.find(d => d.role === 'certificate'), versions: Row[] = []
    const artifactEffects: TargetEffect[] = []
    for (const d of docs) {
      const artifactId = crypto.randomUUID(); d.artifactId = artifactId
      let vId: string | null = null
      if (d.role === 'signed') vId = versionId
      else if (d.role === 'version') {
        vId = crypto.randomUUID()
        versions.push({ id: vId, agreement_id: id, number: versions.length + 2, kind: 'imported', label: `Imported source document: ${d.path}`, template_version_id: null, fields: null, text: null, text_source: 'none', digest: d.sha256, created_by: c.actor.id, created_at: c.now })
      }
      const f = input.files.find(f => f.path === d.path)!
      const mediaType = f.path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : f.path.toLowerCase().endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/octet-stream'
      artifactEffects.push({ targetKind: 'artifact', targetId: artifactId, value: { id: artifactId, agreement_id: id, version_id: vId, role: d.role === 'version' ? 'original' : d.role, filename: d.path.split('/').pop(), media_type: mediaType, size: f.bytes.length, sha256: f.sha256, source_system: kit, source_id: r.sourceId, provenance: json({ kit, batch: batchId, path: d.path, sourceId: r.sourceId, code: r.code, manifestRow: r.row, imported: true }), imported: 1, uploaded_by: c.actor.id, uploaded_at: c.now }, attachment: { base64: encodeBase64(f.bytes), sha256: f.sha256, mediaType } })
    }
    const terms = r.proposed.map((t: any) => ({ id: crypto.randomUUID(), agreement_id: id, key: t.key, value: t.value, citation: json({ source: 'import-manifest', kit, sourceId: r.sourceId, code: r.code, row: r.row, column: t.column, ...(t.key.startsWith('custom:') ? {definitionVersion: fields.find(f=>'custom:'+f.id===t.key)?.version} : {}), note: 'Imported metadata, not checked against the signed document.' }), status: 'proposed', proposed_by: c.actor.id, proposal_id: null, confirmed_by: null, confirmed_at: null, supersedes_id: null, reason: 'Confirm against the original signed document before use.', created_at: c.now })).sort((a: any, b: any) => a.id.localeCompare(b.id))
    effects.push({ targetKind: 'agreement', targetId: id, value: {
      agreement: { id, reference: agreementReference(id), title: r.subject, type: r.type, party_id: partyId, value_cents: null, currency: 'USD', owner_id: c.actor.id, requester_id: c.actor.id, status: 'imported', restricted: p.restricted === true ? 1 : 0, needed_by: null, start_date: null, timezone: entity?.timezone ?? 'America/New_York', entity_id: entity?.id ?? null, parent_id: r.parentSourceId ? ids.get(r.parentSourceId) : null, relation: r.parentSourceId ? r.relation : null, origin: 'legacy', current_version_id: versionId, created_at: c.now, updated_at: c.now, version: 1 },
      version: { id: versionId, agreement_id: id, number: 1, kind: 'imported', label: `Imported ${kit} ${r.sourceId}${r.code ? ' / ' + r.code : ''}`, template_version_id: null, fields: json({ enterpriseImport: { kit, sourceId: r.sourceId, code: r.code, batch: batchId } }), text: null, text_source: 'none', digest: signed.sha256, created_by: c.actor.id, created_at: c.now }, versions,
      execution: { id: crypto.randomUUID(), agreement_id: id, package_id: null, provider: kit, envelope_id: r.sourceId, signed_artifact_id: signed.artifactId, certificate_artifact_id: certificate?.artifactId ?? null, signers: '[]', executed_on: '', imported: 1, checks: json([{ check: 'imported', ok: true, detail: 'Source marked signed; imported history only. Signers and legal validity remain unverified.' }]), status: 'needs_review', resolution: null, resolved_by: null, recorded_by: c.actor.id, recorded_at: c.now }, terms,
    } as any }, ...artifactEffects)
    planned.set(sourceId, effects)
  }
  const context = importContext(c, batchId, kit)
  // Field definitions and referenced typed identities are repeated at each native write.
  c.erasureChecks = [...(c.erasureChecks ?? []), ...checks]
  const plan = await planD1Import(source, { version: `${kit}/1`, map: r => planned.has(r.sourceId) ? { effects: planned.get(r.sourceId)! } : { effects: [], rejection: 'See reviewed row diagnostics.' } }, context)
  context.reviewedFingerprint = plan.fingerprint
  const job = await createD1ImportJob(plan, context)
  const orphans = input.files.filter(f => !used.has(f.path) && !f.path.startsWith('_api/') && !f.path.startsWith('_source/')).map(f => f.path)
  const counts = { rows: rows.length, import: rows.filter(r => r.outcome === 'import').length, skip: rows.filter(r => r.outcome === 'skip').length, duplicate: rows.filter(r => r.outcome === 'duplicate').length, missing: rows.filter(r => r.outcome === 'missing').length, orphanFiles: orphans.length, withoutCertificate: rows.filter(r => r.outcome === 'import' && !r.documents.some((d: Row) => d.role === 'certificate')).length }
  const summary = { rows, orphans, counts, mapping, unmapped, missingMappings, typeMapping: Object.fromEntries([...new Set(table.rows.map(r => r[Object.keys(mapping).find(k => mapping[k] === 'type')!] ?? ''))].map(t => [t, typeMapping[t] ?? (types.includes(t.toLowerCase()) ? t.toLowerCase() : '')])), fileRoles, signedStatuses, entityId: entity?.id, restricted: p.restricted === true, guards: checks, api: input.api ?? null, fields: fields.map(f => ({ id: f.id, version: f.version })), fingerprint: plan.fingerprint, jobId: job.id, manifest: { filename: input.manifest.filename, sha256: input.manifest.sha256, columns: table.header } }
  return { allowed: may.imports, result: { batchId, counts, fingerprint: plan.fingerprint }, checks, writes: [sql('INSERT INTO lk_import_batches VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)', batchId, kit, 'previewed', input.label, json(summary), plan.fingerprint, job.id, c.actor.id, c.now, null, null, null, null, null)], audit: [{ action: 'import.preview', summary: `Reviewed ${kit} ${input.label}: ${counts.import} importable, ${unmapped.length} unmapped fields. Originals retained; no agreements written.` }] }
}

export const confirmImportValue: Handler = async (c, p) => {
  requireRole(c.actor, ['owner', 'counsel', 'approver'], 'confirm imported metadata')
  const a = await visibleAgreement(c, p.agreementId), term = await c.db.prepare("SELECT * FROM lk_terms WHERE id=? AND agreement_id=? AND status='proposed'").bind(text(p, 'termId', 100), a.id).first<any>()
  if (!term || !term.key.startsWith('custom:') && term.key !== 'import:value') fail('NOT_FOUND', 'No proposed imported metadata value has this identity.', 404)
  if (!['imported','executed'].includes(a.status)) fail('NOT_EXECUTED','Confirm metadata against an imported or executed agreement.',409)
  const cite = await citation(c, a, p.citation), checks: Sql[] = [...agreementGuards(c, a), sql("EXISTS(SELECT 1 FROM lk_terms WHERE id=? AND status='proposed')", term.id)]
  const writes: Sql[] = []
  let allowed: Role[] = ['owner','counsel','approver']
  if (term.key.startsWith('custom:')) {
    const fields = await customFields(c.db), field = fields.find(f => 'custom:' + f.id === term.key && fieldApplies(f, a.type))
    if (!field || field.version!==parse<any>(term.citation).definitionVersion) fail('STALE', 'The imported custom field definition changed; review a new proposal.', 409)
    allowed = allowed.filter(role=>parse<Role[]>(field.edit_roles).includes(role))
    requireRole(c.actor, allowed, 'confirm this custom field')
    checks.push(...customFieldChecks(fields))
    const value = parse(term.value)
    // Money proposals are already normalized cents; normalize only at import.
    if (field.kind !== 'money') await normalizedValue(c, field, value, checks, a.id)
    writes.push(sql('INSERT INTO lk_custom_values VALUES(?,?,?,?,?) ON CONFLICT(agreement_id,field_id) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at', a.id, field.id, term.value, c.actor.id, c.now))
    writes.push(sql("UPDATE lk_terms SET status='superseded' WHERE agreement_id=? AND key=? AND status='confirmed'", a.id, term.key))
  } else {
    const currency = await c.db.prepare("SELECT value FROM lk_terms WHERE agreement_id=? AND key='import:currency' ORDER BY created_at DESC LIMIT 1").bind(a.id).first<{ value: string }>()
    if (currency?.value && currency.value !== 'USD') fail('IMPORT_CURRENCY', 'Confirm a non-USD amount through the native value editor with an explicit USD conversion rate; the imported amount stays proposed.', 409)
    writes.push(sql('UPDATE lk_agreements SET value_cents=? WHERE id=?', money({ value: term.value }, 'value'), a.id))
  }
  writes.push(sql("UPDATE lk_terms SET status='confirmed',citation=?,confirmed_by=?,confirmed_at=? WHERE id=?", json({ ...cite, importedSource: parse(term.citation) }), c.actor.id, c.now, term.id), bump(c, a))
  return { allowed, result: { id: term.id }, checks, writes, audit: [{ action: 'import.value.confirm', agreementId: a.id, summary: 'Person confirmed an imported value against its signed document.' }] }
}

export const remapEnterprise: Handler = async (c, p) => {
  requireRole(c.actor, may.imports, 'review import mappings')
  const batch = await c.db.prepare("SELECT * FROM lk_import_batches WHERE id=? AND status='previewed'").bind(text(p,'batchId',100)).first<any>()
  if (!batch || !['icertis','agiloft'].includes(batch.kit)) fail('NOT_FOUND','No editable enterprise dry run has this identity.',404)
  const progress=await c.db.prepare('SELECT checkpoint FROM ik_jobs WHERE id=?').bind(batch.job_id).first<{checkpoint:number}>()
  if((progress?.checkpoint??0)>0)fail('IMPORT_PROGRESS','Finish the already-reviewed import before changing its mapping; its journal progress is retained.',409)
  if (batch.version !== integer(p,'version',1)) fail('STALE','The dry run changed.',409)
  const summary = parse<any>(batch.preview), originals = await readD1ImportOriginals(batch.job_id,importContext(c,batch.id,batch.kit))
  const manifest = originals.find(o=>o.name===summary.manifest.filename && o.original.status==='retained')
  if (!manifest || manifest.original.status!=='retained') fail('IMPORT_SOURCE','The retained source is unavailable.',409)
  return previewEnterprise(c,{...p,kit:batch.kit,label:batch.source_label+' (revised mapping)',entityId:summary.entityId,restricted:summary.restricted,source:'export',dateFormat:'iso',manifest:{filename:manifest.name,base64:manifest.original.base64},files:originals.filter(o=>o!==manifest&&o.kind==='artifact'&&o.original.status==='retained').map(o=>({path:o.name,base64:o.original.status==='retained'?o.original.base64:''})),fileRoles:p.fileRoles??summary.fileRoles,typeMapping:p.typeMapping??summary.typeMapping,signedStatuses:p.signedStatuses??summary.signedStatuses})
}
