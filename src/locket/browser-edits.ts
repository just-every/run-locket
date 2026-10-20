// Browser text revisions preserve their base, attributed redline and exact PDF.
import { may, requireRole } from './access'
import { PDF, storeArtifact } from './artifacts'
import { retainedClauseUses } from './clause-provenance'
import type { Handler } from './commands'
import { diffLines } from './diff'
import { fail, json, parse, sql } from './model'
import { textPdf } from './pdf'
import { agreementGuards, bump, currentVersion, invalidateApprovals, requireStatus, statusAfterChange, versionDigest, visibleAgreement } from './records'

export const editVersion: Handler = async (c, p) => {
  requireRole(c.actor, may.intake, 'edit document versions')
  const a = await visibleAgreement(c, p.agreementId)
  requireStatus(a, ['draft', 'in_review', 'approved', 'imported'], 'take a browser revision')
  const base = await currentVersion(c, a)
  if (base.id !== p.versionId) fail('NOT_CURRENT', 'Edit the current version. Reload before saving.', 409)
  if (base.text === null) fail('NO_TEXT', 'Add document text before editing.', 409)
  if (typeof p.text !== 'string' || !p.text.trim() || p.text.length > 400_000) fail('INVALID', 'Enter document text of at most 400,000 characters.')
  const body = p.text
  if (base.text === body) fail('UNCHANGED', 'Change the document before saving a revision.', 409)
  const fields = { ...(base.fields ? parse<Record<string, unknown>>(base.fields) : {}), clauseLibrary: retainedClauseUses(base.fields, body), browserEdits: { baseVersionId: base.id, actorId: c.actor.id, at: c.now, lines: diffLines(base.text, body) } }
  const id = crypto.randomUUID(), number = base.number + 1
  const artifact = await storeArtifact({ filename: `${a.reference}-v${number}.pdf`, mediaType: PDF, bytes: textPdf(a.title, body, `${a.reference} v${number} — browser text revision`) }, { agreementId: a.id, versionId: id, role: 'original', provenance: { generatedFrom: base.id, browserRevision: true }, actorId: c.actor.id, at: c.now })
  const digest = await versionDigest({ agreementId: a.id, number, files: [{ role: 'original', sha256: artifact.sha256 }], text: body, fields })
  return {
    allowed: may.intake, result: { versionId: id, number, digest },
    writes: [...artifact.writes, sql('INSERT INTO lk_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, a.id, number, 'upload', 'Browser text revision', null, json(fields), body, 'person', digest, c.actor.id, c.now), bump(c, a, 'current_version_id=?, status=?', id, a.status === 'imported' ? 'draft' : statusAfterChange(a)), invalidateApprovals(c, a.id, `Browser revision ${number}`)],
    checks: [...agreementGuards(c, a, p), sql('(SELECT digest FROM lk_versions WHERE id=?)=?', base.id, base.digest)],
    audit: [{ action: 'version.edit', agreementId: a.id, summary: `Saved attributed browser changes from v${base.number} as v${number}; earlier approvals no longer count` }],
  }
}
