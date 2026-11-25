// What the version page polls while embedded PDF text is read: one rendition's progress, not the whole workspace.
import type { Bindings } from '../auth.server'
import { may, requireRole, visibleSql } from './access'
import { source, type PdfRendition } from './pdf-renditions'
import { hiddenFields } from './repository-access'
import type { Actor } from './model'

export type PdfRenditionProgress = Pick<PdfRendition, 'id' | 'agreement_id' | 'version_id' | 'status' | 'processed_pages' | 'total_pages' | 'error' | 'revision'> & {
  pages: { page: number; status: string; reason?: string }[]
}

/** The workspace's view of one version's rendition, without its text or geometry; null when there is none this person may see. */
export async function pdfRenditionProgress(env: Bindings, actor: Actor, versionId: string): Promise<PdfRenditionProgress | null> {
  requireRole(actor, may.read, 'read agreements')
  if ((await hiddenFields(env.DB, actor)).length) return null
  const row = await env.DB.prepare(`SELECT r.id,r.agreement_id,r.version_id,r.status,r.processed_pages,r.total_pages,r.pages,r.error,r.revision,CASE WHEN ${source} THEN 1 ELSE 0 END AS source_current
    FROM lk_pdf_renditions r WHERE r.version_id=? ORDER BY r.rowid LIMIT 1`).bind(versionId).first<Omit<PdfRenditionProgress, 'pages'> & { pages: string; source_current: number }>()
  if (!row) return null
  const access = visibleSql(actor, row.agreement_id)
  if (!(await env.DB.prepare(`SELECT CASE WHEN ${access.sql} THEN 1 ELSE 0 END AS ok`).bind(...access.params).first<{ ok: number }>())?.ok) return null
  const { source_current, pages, ...rest } = row
  if (!source_current) return { ...rest, status: 'stale', error: 'The source changed; this rendition is unavailable.', pages: [] }
  return { ...rest, pages: (JSON.parse(pages) as { page: number; status: string; reason?: string }[]).map(({ page, status, reason }) => ({ page, status, ...(reason ? { reason } : {}) })) }
}
