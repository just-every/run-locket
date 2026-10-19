// Base import-kit target adapter for Locket's tables. Each imported envelope is
// one `agreement` entity (agreement, version, imported execution, proposed
// terms) plus one `artifact` entity per file and an optional new `party`.
// matches() fences the exact native snapshot: any later edit or downstream use
// (versions, approvals, terms confirmed, notices...) makes undo refuse.
import type { D1Sql, D1TargetAdapter, TargetRow } from '../../modules/import-kit/src/d1/index'
import { decodeBase64 } from '../artifacts'

const q = (sql: string, ...params: unknown[]): D1Sql => ({ sql, params })
const CHUNK = 512 * 1024

export const columns = {
  lk_parties: ['id', 'name', 'kind', 'tax_id', 'tax_id_kind', 'email', 'created_by', 'created_at', 'version'],
  lk_agreements: ['id', 'reference', 'title', 'type', 'party_id', 'value_cents', 'currency', 'owner_id', 'requester_id', 'status', 'restricted', 'needed_by', 'start_date', 'timezone', 'parent_id', 'relation', 'origin', 'current_version_id', 'created_at', 'updated_at', 'version', 'entity_id'],
  lk_versions: ['id', 'agreement_id', 'number', 'kind', 'label', 'template_version_id', 'fields', 'text', 'text_source', 'digest', 'created_by', 'created_at'],
  lk_executions: ['id', 'agreement_id', 'package_id', 'provider', 'envelope_id', 'signed_artifact_id', 'certificate_artifact_id', 'signers', 'executed_on', 'imported', 'checks', 'status', 'resolution', 'resolved_by', 'recorded_by', 'recorded_at'],
  lk_terms: ['id', 'agreement_id', 'key', 'value', 'citation', 'status', 'proposed_by', 'proposal_id', 'confirmed_by', 'confirmed_at', 'supersedes_id', 'reason', 'created_at'],
  lk_artifacts: ['id', 'agreement_id', 'version_id', 'role', 'filename', 'media_type', 'size', 'sha256', 'source_system', 'source_id', 'provenance', 'imported', 'uploaded_by', 'uploaded_at'],
} as const
type Table = keyof typeof columns
type Row = Record<string, unknown>

const objectSql = (table: Table) => `json_object(${columns[table].map(c => `'${c}',${c}`).join(',')})`
const ordered = (table: Table, row: Row) => JSON.stringify(Object.fromEntries(columns[table].map(c => [c, row[c] ?? null])))
const insert = (table: Table, row: Row) => q(`INSERT INTO ${table} (${columns[table].join(',')}) VALUES(${columns[table].map(() => '?').join(',')})`, ...columns[table].map(c => row[c] ?? null))
const exact = (table: Table, row: Row) => q(`(SELECT ${objectSql(table)} FROM ${table} WHERE id=?)=?`, row.id, ordered(table, row))

/** Tables whose rows mean an imported agreement has been used since import. */
const downstream = ['lk_requirements', 'lk_comments', 'lk_deviations', 'lk_approvals', 'lk_packages', 'lk_obligations', 'lk_renewals', 'lk_notices', 'lk_access']

export interface AgreementValue {
  agreement: Row
  version: Row
  execution: Row
  terms: Row[]
}

async function first<T>(db: D1Database, sql: string, ...params: unknown[]) {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null
}

const applied = (kind: string, id: string, revision: string) => q('(SELECT revision FROM lk_import_targets WHERE kind=? AND id=?)=?', kind, id, revision)

export function locketTargets(): D1TargetAdapter {
  const adapter: D1TargetAdapter = {
    async read(db, destination, kind, id) {
      const d = db as unknown as D1Database
      const revision = (await first<{ revision: string }>(d, 'SELECT revision FROM lk_import_targets WHERE kind=? AND id=?', kind, id))?.revision ?? 'native'
      if (kind === 'party') {
        const row = await first<{ v: string }>(d, `SELECT ${objectSql('lk_parties')} AS v FROM lk_parties WHERE id=?`, id)
        return row ? { destination, targetKind: kind, targetId: id, revision, value: JSON.parse(row.v) } : undefined
      }
      if (kind === 'artifact') {
        const row = await first<{ v: string }>(d, `SELECT ${objectSql('lk_artifacts')} AS v FROM lk_artifacts WHERE id=?`, id)
        if (!row) return undefined
        const value = JSON.parse(row.v)
        const chunks = (await d.prepare('SELECT bytes FROM lk_artifact_chunks WHERE artifact_id=? ORDER BY ordinal').bind(id).all<{ bytes: ArrayBuffer }>()).results
        const bytes = new Uint8Array(chunks.reduce((n, c) => n + new Uint8Array(c.bytes).length, 0))
        let at = 0
        for (const c of chunks) { bytes.set(new Uint8Array(c.bytes), at); at += new Uint8Array(c.bytes).length }
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return { destination, targetKind: kind, targetId: id, revision, value, attachment: { base64: btoa(binary), sha256: value.sha256, mediaType: value.media_type } }
      }
      const agreement = await first<{ v: string }>(d, `SELECT ${objectSql('lk_agreements')} AS v FROM lk_agreements WHERE id=?`, id)
      if (!agreement) return undefined
      const version = await first<{ v: string }>(d, `SELECT ${objectSql('lk_versions')} AS v FROM lk_versions WHERE agreement_id=? ORDER BY number LIMIT 1`, id)
      const execution = await first<{ v: string }>(d, `SELECT ${objectSql('lk_executions')} AS v FROM lk_executions WHERE agreement_id=? ORDER BY recorded_at LIMIT 1`, id)
      const terms = (await d.prepare(`SELECT ${objectSql('lk_terms')} AS v FROM lk_terms WHERE agreement_id=? ORDER BY id`).bind(id).all<{ v: string }>()).results.map(t => JSON.parse(t.v))
      const parsed = JSON.parse(agreement.v)
      return { destination, targetKind: kind, targetId: id, revision, value: { agreement: parsed, version: version ? JSON.parse(version.v) : null, execution: execution ? JSON.parse(execution.v) : null, terms } }
    },
    matches(row, destination, kind, id) {
      const parts = adapter.matchesParts!(row, destination, kind, id)
      return { sql: parts.map(p => `(${p.sql})`).join(' AND '), params: parts.flatMap(p => p.params ?? []) }
    },
    matchesParts(row, _destination, kind, id) {
      if (kind === 'party') {
        if (!row) return [q('NOT EXISTS(SELECT 1 FROM lk_parties WHERE id=?)', id)]
        return [exact('lk_parties', row.value as Row), applied(kind, id, row.revision)]
      }
      if (kind === 'artifact') {
        if (!row) return [q('NOT EXISTS(SELECT 1 FROM lk_artifacts WHERE id=?)', id), q('NOT EXISTS(SELECT 1 FROM lk_artifact_chunks WHERE artifact_id=?)', id)]
        const value = row.value as Row
        return [exact('lk_artifacts', value), applied(kind, id, row.revision), q('(SELECT COALESCE(SUM(length(bytes)),0) FROM lk_artifact_chunks WHERE artifact_id=?)=?', id, value.size)]
      }
      if (!row) return [q('NOT EXISTS(SELECT 1 FROM lk_agreements WHERE id=?)', id)]
      const v = row.value as unknown as AgreementValue
      return [
        exact('lk_agreements', v.agreement),
        applied(kind, id, row.revision),
        exact('lk_versions', v.version),
        exact('lk_executions', v.execution),
        q(`(SELECT COUNT(*) FROM lk_versions WHERE agreement_id=?)=1`, id),
        q(`(SELECT COUNT(*) FROM lk_executions WHERE agreement_id=?)=1`, id),
        q(`(SELECT json_group_array(json(t)) FROM (SELECT ${objectSql('lk_terms')} AS t FROM lk_terms WHERE agreement_id=? ORDER BY id))=?`, id, JSON.stringify(v.terms.map(t => JSON.parse(ordered('lk_terms', t))))),
        // Files added in Locket after import (imported=0) mean the agreement is in use.
        q('NOT EXISTS(SELECT 1 FROM lk_artifacts WHERE agreement_id=? AND imported=0)', id),
        q('NOT EXISTS(SELECT 1 FROM lk_agreements WHERE parent_id=?)', id),
        q('NOT EXISTS(SELECT 1 FROM lk_proposals WHERE agreement_id=?)', id),
        ...downstream.map(t => q(`NOT EXISTS(SELECT 1 FROM ${t} WHERE agreement_id=?)`, id)),
      ]
    },
    write(row) {
      const mark = q('INSERT OR REPLACE INTO lk_import_targets VALUES(?,?,?)', row.targetKind, row.targetId, row.revision)
      if (row.targetKind === 'party') return [insert('lk_parties', row.value as Row), mark]
      if (row.targetKind === 'artifact') {
        const bytes = decodeBase64(row.attachment!.base64)
        const out = [insert('lk_artifacts', row.value as Row), mark]
        for (let i = 0, n = 0; i < bytes.length; i += CHUNK, n++) out.push(q('INSERT INTO lk_artifact_chunks VALUES(?,?,?)', row.targetId, n, bytes.slice(i, i + CHUNK)))
        return out
      }
      const v = row.value as unknown as AgreementValue
      return [insert('lk_agreements', v.agreement), insert('lk_versions', v.version), insert('lk_executions', v.execution), ...v.terms.map(t => insert('lk_terms', t)), mark]
    },
    remove(_destination, kind, id) {
      const unmark = q('DELETE FROM lk_import_targets WHERE kind=? AND id=?', kind, id)
      if (kind === 'party') return [q('DELETE FROM lk_parties WHERE id=?', id), unmark]
      if (kind === 'artifact') return [q('DELETE FROM lk_artifact_chunks WHERE artifact_id=?', id), q('DELETE FROM lk_artifacts WHERE id=?', id), unmark]
      return [unmark, q('DELETE FROM lk_terms WHERE agreement_id=?', id), q('DELETE FROM lk_executions WHERE agreement_id=?', id), q('DELETE FROM lk_versions WHERE agreement_id=?', id), q('DELETE FROM lk_agreements WHERE id=?', id)]
    },
    async list(db, destination) {
      const d = db as unknown as D1Database
      const ids = (await d.prepare("SELECT id FROM lk_agreements WHERE origin='docusign-archive'").all<{ id: string }>()).results
      const rows: TargetRow[] = []
      for (const { id } of ids) {
        const row = await adapter.read(db, destination, 'agreement', id)
        if (row) rows.push(row)
      }
      return rows
    },
    matchesCount(count) {
      return q("(SELECT COUNT(*) FROM lk_agreements WHERE origin='docusign-archive')=?", count)
    },
  }
  return adapter
}
