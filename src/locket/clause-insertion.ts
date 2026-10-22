import { applicableRecommendationPlaybook } from './playbook-recommendations'
// The browser and future Word door share this versioned insertion command.
import { may, requireRole } from './access'
import { PDF, storeArtifact } from './artifacts'
import { retainedClauseUses, type ClauseUse } from './clause-provenance'
import type { Handler } from './commands'
import { fail, integer, json, parse, sql, text } from './model'
import { textPdf } from './pdf'
import { requireEntityScope } from './entities'
import { agreementGuards, bump, currentVersion, invalidateApprovals, requireStatus, statusAfterChange, versionDigest, visibleAgreement } from './records'

export const insertClause: Handler = async (c, p) => {
  requireRole(c.actor, may.intake, 'insert library clauses')
  const a = await visibleAgreement(c, p.agreementId)
  requireStatus(a, ['draft', 'in_review', 'approved', 'imported'], 'take a new negotiation version')
  const base = await currentVersion(c, a)
  if (base.id !== p.versionId) fail('NOT_CURRENT', 'Insert into the current document version. Reload before editing.', 409)
  if (base.text === null) fail('NO_TEXT', 'This version needs text before a clause can be inserted.', 409)
  const libraryVersionId = text(p, 'libraryVersionId', 100)
  const library = await c.db.prepare('SELECT v.*, t.name, t.entity_id AS template_entity_id FROM lk_template_versions v JOIN lk_templates t ON t.id=v.template_id WHERE v.id=?').bind(libraryVersionId).first<any>()
  if (!library || library.status !== 'approved') fail('TEMPLATE_NOT_APPROVED', 'Choose a clause from an approved library version.', 409)
  const clause = parse<any[]>(library.clauses).find(x => x.key === text(p, 'clauseKey', 40))
  const variant = clause?.variants.find((x: any) => x.id === text(p, 'variantId', 40))
  if (!clause || !variant) fail('INVALID', 'That wording is not in this library version.')
  requireEntityScope(library.template_entity_id, a, `${library.name} v${library.number}`)
  requireEntityScope(variant.entityId, a, `The ${clause.title} wording ${variant.label}`)
  const start = integer(p, 'start', 0, base.text.length), end = integer(p, 'end', start, base.text.length)
  if (typeof p.quote !== 'string' || base.text.slice(start, end) !== p.quote) fail('CITATION', 'The selected passage changed. Select it again.', 409)
  const insertedText = start === end && start === base.text.length && start > 0 && !base.text.endsWith('\n') ? '\n' + variant.text : variant.text
  const body = base.text.slice(0, start) + insertedText + base.text.slice(end)
  if (body.length > 400_000) fail('INVALID', 'The resulting document is too long.')
  const active = await c.db.prepare("SELECT id, rules FROM lk_playbook_versions WHERE status='active'").first<any>()
  const playbook=await applicableRecommendationPlaybook(c,a,active)
  const ruleKey = clause.ruleKey || clause.key
  const use: ClauseUse = {
    libraryVersionId: library.id, libraryVersionNumber: library.number, templateName: library.name,
    clauseKey: clause.key, clauseTitle: clause.title, variantId: variant.id, variantLabel: variant.label,
    text: variant.text, notes: [clause.notes, variant.notes].filter(Boolean).join('\n'), ruleKey,
    playbookVersionId: playbook && parse<any[]>(playbook.rules).some(r => r.key === ruleKey) ? playbook.id : null,
    insertedBy: c.actor.id, insertedAt: c.now,
  }
  const uses = retainedClauseUses(base.fields, body).filter(x => !(x.libraryVersionId === use.libraryVersionId && x.clauseKey === use.clauseKey && x.variantId === use.variantId))
  const fields = { ...(base.fields ? parse<any>(base.fields) : {}), clauseLibrary: [...uses, use] }
  const id = crypto.randomUUID(), number = base.number + 1
  const bytes = textPdf(a.title, body, `${a.reference} v${number} — browser clause insertion`)
  const artifact = await storeArtifact({ filename: `${a.reference}-v${number}.pdf`, mediaType: PDF, bytes }, { agreementId: a.id, versionId: id, role: 'original', provenance: { generatedFrom: base.id, clauseLibrary: use }, actorId: c.actor.id, at: c.now })
  const digest = await versionDigest({ agreementId: a.id, number, files: [{ role: 'original', sha256: artifact.sha256 }], text: body, fields })
  return {
    allowed: may.intake, result: { versionId: id, number, digest, clauseLibrary: fields.clauseLibrary },
    writes: [...artifact.writes,
      sql('INSERT INTO lk_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, a.id, number, 'upload', `${clause.title}: ${variant.label}`, null, json(fields), body, 'person', digest, c.actor.id, c.now),
      bump(c, a, 'current_version_id=?, status=?', id, a.status === 'imported' ? 'draft' : statusAfterChange(a)),
      invalidateApprovals(c, a.id, `Library clause inserted in version ${number}`)],
    checks: [...agreementGuards(c, a, p), sql("(SELECT status FROM lk_template_versions WHERE id=?)='approved'", library.id), sql('(SELECT digest FROM lk_versions WHERE id=?)=?', base.id, base.digest),
      sql('(SELECT id FROM lk_playbook_versions WHERE status=\'active\') IS ?', active?.id ?? null)],
    audit: [{ action: 'clause.insert', agreementId: a.id, summary: `Inserted ${clause.title} / ${variant.label} from ${library.name} v${library.number} into document v${number}` }],
  }
}
