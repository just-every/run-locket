import { requireRole } from './access'
import type { Handler } from './commands'
import { fail, parse, sql, text } from './model'
import { agreementGuards, bump, visibleAgreement } from './records'

type Row = { id: string; [key: string]: any }
export const selectFamilyTerm: Handler = async (c, p) => {
  requireRole(c.actor, ['owner', 'counsel'], 'select governing family terms')
  const root = await visibleAgreement(c, p.agreementId)
  const term = await c.db.prepare("SELECT * FROM lk_terms WHERE id=? AND status='confirmed'").bind(text(p, 'termId', 64)).first<Row>()
  if (!term) fail('TERM', 'Select a currently confirmed term.', 409)
  const source = await visibleAgreement(c, term.agreement_id)
  const evidence=parse<any>(term.citation)
  if (!evidence.quote || !evidence.versionId || evidence.versionId!==source.current_version_id) fail('SOURCE','Select a cited term from the current source document.',409)
  const chain = [source]
  while (chain.at(-1)!.parent_id) {
    const next = await visibleAgreement(c, chain.at(-1)!.parent_id)
    if (chain.some(a => a.id === next.id)) fail('INVALID', 'The family contains a cycle.')
    chain.push(next)
  }
  if (chain.at(-1)!.id !== root.id || root.parent_id) fail('FAMILY', 'Choose a confirmed term in this agreement family.', 409)
  return {
    allowed: ['owner', 'counsel'], result: { id: root.id, key: term.key, termId: term.id },
    checks: [...agreementGuards(c, root, p), ...chain.flatMap(a => agreementGuards(c, a)), sql("EXISTS(SELECT 1 FROM lk_terms WHERE id=? AND status='confirmed' AND value=? AND citation=?)", term.id,term.value,term.citation)],
    writes: [sql(`INSERT INTO lk_family_terms VALUES(?,?,?,?,?,?,?) ON CONFLICT(root_id,key) DO UPDATE SET term_id=excluded.term_id,source_parent_id=excluded.source_parent_id,source_relation=excluded.source_relation,selected_by=excluded.selected_by,selected_at=excluded.selected_at`, root.id, term.key, term.id, source.parent_id, source.relation, c.actor.id, c.now), bump(c, root)],
    audit: [{ action: 'family.term', agreementId: root.id, summary: `Selected governing ${term.key.replaceAll('_', ' ')} from ${source.reference}; recorded choice, not automatic legal precedence.` }],
  }
}
