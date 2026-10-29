import { fail, integer, list, object, oneOf, text } from './model'
import { playbookRules } from './library'
import type { DraftingSource } from './playbook-drafting-sources'

/** Store only validated fields, with exact signed-page and template custody. */
export function draftedRules(raw: unknown, sources: DraftingSource[]) {
 const p = object(raw), rules = playbookRules(p)
 if (rules.length > 30) fail('MODEL_RESPONSE', 'The provider returned too many rules.', 502)
 return rules.map((rule, index) => {
  const input = object((p.rules as unknown[])[index])
  if (rule.entityId) fail('MODEL_RESPONSE', 'The provider cannot choose an entity scope.', 502)
  const citations = list(input, 'citations', 100).map(value => {
   const c = object(value), kind = oneOf(c, 'kind', ['template', 'agreement'] as const), id = text(c, 'id', 100)
   const source = sources.find(s => s.kind === kind && s.id === id)
   const page = c.page === null ? null : integer(c, 'page', 1, 5000)
   const part = source?.pages.find(p => p.page === page), quote = text(c, 'quote', 20000)
   if (!source || !part) fail('CITATION', 'A cited source or signed page was not in this request.', 502)
   const start = integer(c, 'start', 0, part.text.length), end = integer(c, 'end', start + 1, part.text.length)
   if (part.text.slice(start, end) !== quote) fail('CITATION', 'A provider quote does not match its exact source offsets.', 502)
   const position = oneOf(c, 'position', ['preferred', 'fallback'] as const)
   const alternativeIndex = position === 'fallback' ? integer(c, 'alternativeIndex', 0, rule.alternatives.length - 1) : null
   if (position === 'preferred' && kind !== 'template' || position === 'fallback' && kind !== 'agreement') fail('CITATION', 'Preferred positions need approved-template evidence; fallbacks need signed-history evidence.', 502)
   if (position === 'fallback' && rule.alternatives[alternativeIndex!] !== quote) fail('CITATION', 'Each suggested fallback must retain the exact signed wording cited for it.', 502)
   return { kind, id, title: source.title, versionId: source.versionId, version: source.number, digest: source.digest, artifactId: source.facts.artifactId ?? null, artifactDigest: source.facts.artifactDigest ?? null, page, start, end, quote, position, alternativeIndex }
  })
  if (!citations.some(c => c.position === 'preferred') || !citations.some(c => c.kind === 'agreement') || rule.alternatives.some((_, i) => !citations.some(c => c.alternativeIndex === i))) fail('CITATION', 'Every rule needs template and signed-agreement evidence, including each suggested fallback.', 502)
  return { proposed: rule, citations, decision: 'pending', history: [], effective: null, decidedBy: null, decidedAt: null, reason: null }
 })
}
export function editedRule(value: unknown, original: any) {
 const edited = playbookRules({ rules: [object(value)] })[0]
 if (edited.key !== original.key || edited.entityId) fail('INVALID', 'Keep the clause identity and use the separately approved future scope.')
 // Wording may change, while original signed evidence remains explicitly historical.
 return edited
}
