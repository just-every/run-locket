// Personal definitions are independent of agreement authority. Execution always
// starts again from ACCESS-001; sharing never grants access to an agreement.
import type { Bindings } from '../auth.server'
import { authority, may, requireRole, roleSql } from './access'
import type { Handler } from './commands'
import { date, fail, integer, json, list, money, object, oneOf, sql, text, type Actor, type Role } from './model'
import { repositoryFields } from './repository-fields'

export interface ViewDefinition {
  query: string
  filters: { field: string; operator: 'eq' | 'contains' | 'gte' | 'lte'; value: string }[]
  sort: { field: string; direction: 'asc' | 'desc' }
  columns: string[]
}
const humans: Role[] = ['owner', 'counsel', 'approver', 'requester', 'viewer']
export const defaultViewDefinition: ViewDefinition = { query: '', filters: [], sort: { field: 'title', direction: 'asc' }, columns: ['title', 'counterparty', 'value', 'owner', 'notice_deadline'] }
export function parseViewDefinition(value: unknown): ViewDefinition {
  const p = object(value, 'definition')
  if (typeof p.query !== 'string' || p.query.length > 2000) fail('INVALID', 'query must be text of at most 2000 characters.')
  const field = (id: unknown) => {
    const f = repositoryFields.find(f => f.id === id)
    if (!f) fail('INVALID', 'Choose a repository field from the catalogue.')
    return f
  }
  const filters = list(p, 'filters', 30).map(value => {
    const f = object(value, 'filter'), catalogue = field(f.field)
    const operator = oneOf(f, 'operator', ['eq', 'contains', 'gte', 'lte'] as const)
    const valueText = text(f, 'value', 2000)
    if (catalogue.kind !== 'text' && operator === 'contains') fail('INVALID', 'contains requires a text field.')
    if (catalogue.kind === 'date') date({ value: valueText }, 'value')
    if (catalogue.kind === 'money') money({ value: valueText }, 'value')
    if (catalogue.kind === 'number' && (!/^\d+(\.\d+)?$/.test(valueText) || !Number.isFinite(Number(valueText)))) fail('INVALID', 'Number filters need a finite nonnegative number.')
    return { field: catalogue.id, operator, value: valueText }
  })
  const sort = object(p.sort, 'sort')
  const columns = list(p, 'columns', repositoryFields.length).map(id => field(id).id)
  if (!columns.length || new Set(columns).size !== columns.length) fail('INVALID', 'Choose at least one column, without duplicates.')
  return { query: p.query.trim(), filters, sort: { field: field(sort.field).id, direction: oneOf(sort, 'direction', ['asc', 'desc'] as const) }, columns }
}
interface StoredView { id: string; name: string; definition: string; shared_roles: string; version: number; created_by: string; created_at: number; updated_at: number; pinned?: number }
export interface SavedView extends Omit<StoredView, 'definition' | 'shared_roles' | 'pinned'> { definition: ViewDefinition; shared_roles: Role[]; pinned: boolean }
// SQL uses the current role rather than the role cached in an open screen.
const readable = (actor: Actor) => sql(`(v.created_by=? OR EXISTS(SELECT 1 FROM json_each(v.shared_roles) r WHERE r.value=${roleSql}))`, actor.id, actor.id)
export async function savedViews(env: Bindings, actor: Actor): Promise<SavedView[]> {
  requireRole(actor, may.read, 'read saved views')
  const auth = authority(actor, may.read), access = readable(actor)
  const rows = await env.DB.prepare(`SELECT v.*, EXISTS(SELECT 1 FROM lk_view_pins p WHERE p.view_id=v.id AND p.operator_id=?) AS pinned FROM lk_saved_views v WHERE ${auth.sql} AND ${access.sql} ORDER BY pinned DESC, lower(v.name), v.id`).bind(actor.id, ...auth.params, ...access.params).all<StoredView>()
  return rows.results.map(v => ({ ...v, definition: parseViewDefinition(JSON.parse(v.definition)), shared_roles: JSON.parse(v.shared_roles), pinned: Boolean(v.pinned) }))
}
async function own(db: D1Database, actor: Actor, id: string, version: number) {
  const v = await db.prepare('SELECT * FROM lk_saved_views WHERE id=? AND created_by=?').bind(id, actor.id).first<StoredView>()
  if (!v) fail('NOT_FOUND', 'No saved view you own has that identity.', 404)
  if (v.version !== version) fail('STALE', 'This saved view changed. Reload before editing it.', 409)
  return v
}
const ownCheck = (id: string, version: number, actor: Actor) => sql('EXISTS(SELECT 1 FROM lk_saved_views WHERE id=? AND version=? AND created_by=?)', id, version, actor.id)
export const savedViewHandlers: Record<string, Handler> = {
  'view.save': async (c, p) => {
    requireRole(c.actor, humans, 'manage saved views')
    const name = text(p, 'name', 160), definition = parseViewDefinition(p.definition)
    const sharedRoles = list(p, 'sharedRoles', may.read.length).map(role => oneOf({ role }, 'role', may.read))
    if (new Set(sharedRoles).size !== sharedRoles.length) fail('INVALID', 'Share roles must not repeat.')
    const id = p.id === undefined ? crypto.randomUUID() : text(p, 'id', 100)
    const version = p.id === undefined ? 0 : integer(p, 'version', 1)
    if (version) await own(c.db, c.actor, id, version)
    return { allowed: humans, result: { id, version: version + 1 }, checks: version ? [ownCheck(id, version, c.actor)] : [], writes: version
      ? [sql('UPDATE lk_saved_views SET name=?, definition=?, shared_roles=?, version=version+1, updated_at=? WHERE id=?', name, json(definition), json(sharedRoles), c.now, id)]
      : [sql('INSERT INTO lk_saved_views(id,name,definition,shared_roles,version,created_by,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?)', id, name, json(definition), json(sharedRoles), c.actor.id, c.now, c.now)], audit: [{ action: 'view.save', summary: `${version ? 'Updated' : 'Created'} own saved view; revision ${version + 1}.` }] }
  },
  'view.delete': async (c, p) => {
    requireRole(c.actor, humans, 'delete saved views')
    const id = text(p, 'id', 100), version = integer(p, 'version', 1)
    await own(c.db, c.actor, id, version)
    return { allowed: humans, result: { id }, checks: [ownCheck(id, version, c.actor)], writes: [sql('DELETE FROM lk_view_pins WHERE view_id=?', id), sql('DELETE FROM lk_saved_views WHERE id=?', id)], audit: [{ action: 'view.delete', summary: `Deleted own saved view at revision ${version}.` }] }
  },
  'view.pin': async (c, p) => {
    requireRole(c.actor, humans, 'pin saved views')
    const id = text(p, 'viewId', 100)
    if (typeof p.pinned !== 'boolean') fail('INVALID', 'pinned must be true or false.')
    const views = await savedViews(c.env, c.actor), view = views.find(v => v.id === id)
    if (!view) fail('NOT_FOUND', 'No saved view you can access has that identity.', 404)
    const access = readable(c.actor)
    return { allowed: humans, result: { viewId: id, pinned: p.pinned }, checks: [sql(`EXISTS(SELECT 1 FROM lk_saved_views v WHERE v.id=? AND v.version=? AND ${access.sql})`, id, view.version, ...access.params)], writes: p.pinned
      ? [sql('INSERT INTO lk_view_pins(view_id,operator_id,created_at) VALUES(?,?,?) ON CONFLICT(view_id,operator_id) DO NOTHING', id, c.actor.id, c.now)]
      : [sql('DELETE FROM lk_view_pins WHERE view_id=? AND operator_id=?', id, c.actor.id)], audit: [{ action: 'view.pin', summary: `${p.pinned ? 'Pinned' : 'Unpinned'} a saved view for own workspace.` }] }
  },
}
