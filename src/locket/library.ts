// Versioned templates and the clause playbook (clauses 3 and 4). Only an
// approved template version can populate a request; reviews cite the active
// playbook version they were made against.
import { may, requireRole } from './access'
import type { Handler } from './commands'
import { agreementTypes } from './agreements'
import { entityFields, requireEntitiesExist } from './entities'
import { fail, json, list, object, oneOf, optionalText, sql, text } from './model'

const fieldName = /^[a-z][a-z0-9_]{0,39}$/
const clauseKey = /^[a-z0-9_-]{1,40}$/

function templateContent(p: Record<string, unknown>) {
  const body = text(p, 'body', 200_000)
  const fields = list(p, 'fields', 60).map((value, i) => {
    const f = object(value, `fields[${i}]`)
    const name = text(f, 'name', 40)
    if (!fieldName.test(name)) fail('INVALID', `Field names use lower case letters, digits and underscores (${name}).`)
    return { name, label: text(f, 'label', 120), required: f.required !== false }
  })
  const clauses = list(p, 'clauses', 60).map((value, i) => {
    const c = object(value, `clauses[${i}]`)
    const key = text(c, 'key', 40)
    if (!clauseKey.test(key)) fail('INVALID', `Clause keys use lower case letters, digits, dashes and underscores (${key}).`)
    const variants = list(c, 'variants', 10).map((v, j) => {
      const variant = object(v, `clauses[${i}].variants[${j}]`)
      return { id: text(variant, 'id', 40), label: text(variant, 'label', 120), text: text(variant, 'text', 20_000), notes: optionalText(variant, 'notes', 4000) ?? '', entityId: optionalText(variant, 'entityId', 100) }
    })
    if (!variants.length) fail('INVALID', `Clause ${key} needs at least one wording.`)
    if (new Set(variants.map(v => v.id)).size !== variants.length) fail('INVALID', `Clause ${key} has duplicate variant identities.`)
    return { key, title: text(c, 'title', 120), notes: optionalText(c, 'notes', 4000) ?? '', ruleKey: optionalText(c, 'ruleKey', 40) ?? key, variants }
  })
  if (new Set(clauses.map(c => c.key)).size !== clauses.length) fail('INVALID', 'Each clause key must be unique.')
  for (const m of body.matchAll(/\{\{([a-z0-9_]+)\}\}/gi)) if (!fields.some(f => f.name === m[1]) && !['counterparty', 'title', ...entityFields].includes(m[1])) fail('INVALID', `The body uses {{${m[1]}}} but no field defines it.`)
  for (const m of body.matchAll(/\[\[clause:([a-z0-9_-]+)\]\]/g)) if (!clauses.some(c => c.key === m[1])) fail('INVALID', `The body places clause ${m[1]} but no clause defines it.`)
  return { body, fields, clauses }
}

const variantEntities = (content: { clauses: { variants: { entityId: string | null }[] }[] }) => content.clauses.flatMap(c => c.variants.map(v => v.entityId))

const createTemplate: Handler = async (c, p) => {
  requireRole(c.actor, may.library, 'maintain templates')
  const id = crypto.randomUUID(), versionId = crypto.randomUUID()
  const name = text(p, 'name', 120), type = oneOf(p, 'type', agreementTypes)
  const content = templateContent(p)
  const entityId = optionalText(p, 'entityId', 100)
  await requireEntitiesExist(c, [entityId, ...variantEntities(content)])
  return {
    allowed: may.library,
    result: { id, versionId },
    writes: [
      sql('INSERT INTO lk_templates VALUES(?,?,?,?,?,?)', id, name, type, c.actor.id, c.now, entityId),
      sql('INSERT INTO lk_template_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)', versionId, id, 1, content.body, json(content.fields), json(content.clauses), 'draft', c.actor.id, c.now, null, null),
    ],
    audit: [{ action: 'template.create', summary: `Drafted template ${name} v1` }],
  }
}

const reviseTemplate: Handler = async (c, p) => {
  requireRole(c.actor, may.library, 'maintain templates')
  const template = await c.db.prepare('SELECT * FROM lk_templates WHERE id=?').bind(p.templateId).first<any>()
  if (!template) fail('NOT_FOUND', 'No such template.', 404)
  if(await c.db.prepare('SELECT 1 FROM lk_word_templates w JOIN lk_template_versions v ON v.id=w.id WHERE v.template_id=?').bind(template.id).first())fail('WORD_TEMPLATE','Upload a new Word version so the original formatting is retained.',409)
  const last = await c.db.prepare('SELECT MAX(number) AS n FROM lk_template_versions WHERE template_id=?').bind(template.id).first<{ n: number }>()
  const number = (last?.n ?? 0) + 1, versionId = crypto.randomUUID()
  const content = templateContent(p)
  await requireEntitiesExist(c, variantEntities(content))
  return {
    allowed: may.library,
    result: { versionId, number },
    writes: [sql('INSERT INTO lk_template_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)', versionId, template.id, number, content.body, json(content.fields), json(content.clauses), 'draft', c.actor.id, c.now, null, null)],
    checks: [sql('(SELECT COALESCE(MAX(number),0) FROM lk_template_versions WHERE template_id=?)=?', template.id, number - 1)],
    audit: [{ action: 'template.revise', summary: `Drafted ${template.name} v${number}` }],
  }
}

const decideTemplate: Handler = async (c, p) => {
  requireRole(c.actor, may.library, 'approve templates')
  const v = await c.db.prepare('SELECT v.*, t.name FROM lk_template_versions v JOIN lk_templates t ON t.id=v.template_id WHERE v.id=?').bind(p.versionId).first<any>()
  if (!v) fail('NOT_FOUND', 'No such template version.', 404)
  const decision = oneOf(p, 'decision', ['approve', 'retire'] as const)
  if (decision === 'approve' && v.status !== 'draft') fail('STATUS', `${v.name} v${v.number} is already ${v.status}.`, 409)
  if (decision === 'retire' && v.status === 'retired') fail('STATUS', `${v.name} v${v.number} is already retired.`, 409)
  const word=await c.db.prepare('SELECT * FROM lk_word_templates WHERE id=?').bind(v.id).first<any>()
  if(decision==='approve'&&word&&(word.preview_revision!==word.revision||!word.preview_artifact_id))fail('PREVIEW','Preview the current markings with sample answers before approving this Word template.',409)
  const blocks=await c.db.prepare('SELECT revision FROM lk_signature_template_blocks WHERE template_version_id=?').bind(v.id).first<{revision:number}>()
  const status = decision === 'approve' ? 'approved' : 'retired'
  return {
    allowed: may.library,
    result: { versionId: v.id, status },
    writes: [sql('UPDATE lk_template_versions SET status=?, approved_by=COALESCE(approved_by,?), approved_at=COALESCE(approved_at,?) WHERE id=?', status, decision === 'approve' ? c.actor.id : null, decision === 'approve' ? c.now : null, v.id)],
    checks: [sql('COALESCE((SELECT revision FROM lk_signature_template_blocks WHERE template_version_id=?),0)=?',v.id,blocks?.revision??0),sql('(SELECT status FROM lk_template_versions WHERE id=?)=?', v.id, v.status),...(word?[sql('(SELECT revision FROM lk_word_templates WHERE id=?)=?',v.id,word.revision)]:[])],
    audit: [{ action: `template.${decision}`, summary: `${decision === 'approve' ? 'Approved' : 'Retired'} ${v.name} v${v.number}` }],
  }
}

const authorities = ['counsel', 'approver'] as const
function playbookRules(p: Record<string, unknown>) {
  const rules = list(p, 'rules', 100).map((value, i) => {
    const r = object(value, `rules[${i}]`)
    const key = text(r, 'key', 40)
    if (!clauseKey.test(key)) fail('INVALID', `Clause keys use lower case letters, digits, dashes and underscores (${key}).`)
    return {
      key,
      title: text(r, 'title', 120),
      preferred: text(r, 'preferred', 20_000),
      alternatives: list(r, 'alternatives', 10).map(a => (typeof a === 'string' && a.trim() ? a.trim() : fail('INVALID', `Alternatives for ${key} must be text.`))),
      authority: oneOf(r, 'authority', authorities),
      guidance: typeof r.guidance === 'string' ? r.guidance.slice(0, 4000) : '',
      entityId: optionalText(r, 'entityId', 100),
    }
  })
  if (!rules.length) fail('INVALID', 'A playbook version needs at least one clause rule.')
  if (new Set(rules.map(r => r.key)).size !== rules.length) fail('INVALID', 'Each clause appears once in a playbook version.')
  return rules
}

const draftPlaybook: Handler = async (c, p) => {
  requireRole(c.actor, may.library, 'maintain the clause playbook')
  const rules = playbookRules(p)
  await requireEntitiesExist(c, rules.map(r => r.entityId))
  const last = await c.db.prepare('SELECT MAX(number) AS n FROM lk_playbook_versions').first<{ n: number | null }>()
  const number = (last?.n ?? 0) + 1, id = crypto.randomUUID()
  return {
    allowed: may.library,
    result: { id, number },
    writes: [sql('INSERT INTO lk_playbook_versions VALUES(?,?,?,?,?,?,?,?)', id, number, json(rules), 'draft', c.actor.id, c.now, null, null)],
    checks: [sql('(SELECT COALESCE(MAX(number),0) FROM lk_playbook_versions)=?', number - 1)],
    audit: [{ action: 'playbook.draft', summary: `Drafted playbook v${number}` }],
  }
}

const activatePlaybook: Handler = async (c, p) => {
  requireRole(c.actor, may.library, 'activate the clause playbook')
  const v = await c.db.prepare('SELECT * FROM lk_playbook_versions WHERE id=?').bind(p.id).first<any>()
  if (!v) fail('NOT_FOUND', 'No such playbook version.', 404)
  if (v.status !== 'draft') fail('STATUS', `Playbook v${v.number} is ${v.status}.`, 409)
  return {
    allowed: may.library,
    result: { id: v.id },
    writes: [sql("UPDATE lk_playbook_versions SET status='superseded' WHERE status='active'"), sql("UPDATE lk_playbook_versions SET status='active', activated_by=?, activated_at=? WHERE id=?", c.actor.id, c.now, v.id)],
    checks: [sql("(SELECT status FROM lk_playbook_versions WHERE id=?)='draft'", v.id)],
    audit: [{ action: 'playbook.activate', summary: `Activated playbook v${v.number}` }],
  }
}

export const libraryHandlers: Record<string, Handler> = {
  'template.create': createTemplate,
  'template.revise': reviseTemplate,
  'template.decide': decideTemplate,
  'playbook.draft': draftPlaybook,
  'playbook.activate': activatePlaybook,
}
