import type { Bindings } from '../auth.server'
import { defineTool, ToolRefusal, type ToolDefinition, type ToolContext, type JsonSchemaObject } from '../modules/agent-door/index.ts'
import { agreementHandlers } from '../locket/agreements'
import { proposalHandlers } from '../locket/proposals'
import { peopleHandlers, roleSnapshot } from '../locket/people'
import { may, requireRole, fullReaders, grantsFor, canSee } from '../locket/access'
import { agentActor, command, nativeCall } from './native'
import { classification, disclosureClasses, nativeWitness, record, records } from './records'
import { nativeActor } from './people'
import catalogue from './catalogue.json'

const definitions = new Map(catalogue.map(item => [item.name, item]))
function metadata(name: string) {
  const value = definitions.get(name)
  if (!value) throw new Error(`Missing native tool metadata: ${name}`)
  return { ...value, inputSchema: value.inputSchema as unknown as JsonSchemaObject, classes: value.classes as ToolDefinition['classes'] }
}
const id = (args: Record<string, unknown>) => String(args.agreementId)

function roleWidens(before: string, after: string) {
  const permissions = (role: string) => [
    ...Object.entries(may).filter(([, allowed]) => (allowed as readonly string[]).includes(role)).map(([action]) => action),
    ...((fullReaders as readonly string[]).includes(role) ? ['all_restricted_records'] : []),
  ]
  const current = permissions(before)
  return permissions(after).some(permission => !current.includes(permission))
}

export function tools(env: Bindings): ToolDefinition[] {
  const agreement = async (args: Record<string, unknown>, ctx: ToolContext) => record(env, await agentActor(env, ctx), 'agreements', id(args))
  const target = async (args: Record<string, unknown>, ctx: ToolContext) => ({ kind: 'agreement', id: String((await agreement(args, ctx)).id) })
  const read: ToolDefinition = defineTool({ ...metadata('locket.agreements.read'),
    classify: async (args, ctx) => classification(await agreement(args, ctx)), target,
    async run(args, ctx) { return { result: await agreement(args, ctx), resources: [{ uri: `locket://agreements/${id(args)}`, name: 'Agreement' }] } },
  })
  const create = defineTool({ ...metadata('locket.requests.create'),
    classify: args => classification({ title: args.title, party: args.party }),
    summary: args => ({ target: { name: String(args.title) }, items: ['Create draft request', String((args.party as { name: string }).name)] }),
    async run(args, ctx) {
      const result = await command(env, ctx, 'request.create', args, agreementHandlers['request.create']) as { id: string }
      ctx.emit('request.created', `locket://agreements/${result.id}`)
      return { result, resources: [{ uri: `locket://agreements/${result.id}`, name: 'Draft request' }] }
    },
  })
  const update = defineTool({ ...metadata('locket.requests.update'), target,
    classify: async (args, ctx) => classification({ current: await agreement(args, ctx), title: args.title }),
    summary: async (args, ctx) => ({ target: { id: id(args), name: String((await agreement(args, ctx)).title) }, items: ['Change title', String(args.title)] }),
    revision: async (args, ctx) => Number((await agreement(args, ctx)).version),
    async run(args, ctx) {
      const result = await command(env, ctx, 'request.update', args, agreementHandlers['request.update'])
      ctx.emit('request.updated', `locket://agreements/${id(args)}`)
      return { result, resources: [{ uri: `locket://agreements/${id(args)}`, name: 'Updated request' }] }
    },
  })
  const search = defineTool({ ...metadata('locket.repo.search_and_structured_filters'),
    classify: async (args, ctx) => { const query = String(args.query ?? '').trim().toLocaleLowerCase(); const rows = await records(env, await agentActor(env, ctx), 'agreements'); return classification(rows.filter(row => !query || `${row.reference} ${row.title}`.toLocaleLowerCase().includes(query)).map(row => ({ title: row.title }))) },
    async run(args, ctx) {
      const query = String(args.query ?? '').trim().toLocaleLowerCase()
      const rows = await records(env, await agentActor(env, ctx), 'agreements')
      return { result: { records: rows.filter(row => !query || `${row.reference} ${row.title}`.toLocaleLowerCase().includes(query)).map(row => ({ id: row.id, reference: row.reference, title: row.title, status: row.status, version: row.version })) } }
    },
  })
  const prepare = defineTool({ ...metadata('locket.proposals.prepare'),
    classify: args => classification(args),
    summary: args => ({ target: { name: String((args.payload as { title: string }).title) }, items: ['Prepare intake proposal; no agreement created'] }),
    async run(args, ctx) {
      const result = await command(env, ctx, 'proposal.prepare', { ...args, kind: 'intake' }, proposalHandlers['proposal.prepare'])
      return { result }
    },
  })
  const access = defineTool({ ...metadata('locket.access.update'),
    revision: async (args, ctx) => Number((await agreement(args, ctx)).version),
    async authority(args, ctx) {
      const row = await agreement(args, ctx)
      const subject = await nativeActor(env, String(args.operatorId))
      const allowed = canSee(subject, row as never, await grantsFor(env, subject))
      return { subject: subject.id, widens: args.grant === 'grant' && !allowed }
    },
    async classify(args, ctx) {
      const actor = await agentActor(env, ctx)
      await nativeCall(async () => requireRole(actor, may.grantAccess, 'change agreement visibility'))
      const row = await agreement(args, ctx)
      const subject = await nativeActor(env, String(args.operatorId))
      const widens = args.grant === 'grant' && !canSee(subject, row as never, await grantsFor(env, subject))
      return [{ class: 'access', facts: { measure: 1, direction: widens ? 'widens' : 'narrows' } }, ...(await disclosureClasses(env, actor, String(row.id))).filter(item => item.class === 'sensitive')]
    }, target,
    summary: async (args, ctx) => ({ target: { id: id(args), name: String((await agreement(args, ctx)).title) }, recipients: [(await nativeActor(env, String(args.operatorId))).name + ' (' + String(args.operatorId) + ')'], items: [String(args.grant)] }),
    async run(args, ctx) {
      const result = await command(env, ctx, 'access.set', args, agreementHandlers['access.set'])
      ctx.emit('agreement.access_changed', `locket://agreements/${id(args)}`)
      return { result }
    },
  })
  const people = defineTool({ ...metadata('locket.people.update'),
    revisionType: 'string',
    revision: async args => (await nativeCall(() => roleSnapshot(env.DB, String(args.operatorId)))).revision,
    async authority(args) {
      const subject = await nativeActor(env, String(args.operatorId))
      return { subject: subject.id, widens: roleWidens(subject.role, String(args.role)) }
    },
    async classify(args, ctx) {
      await nativeCall(async () => requireRole(await agentActor(env, ctx), may.manageRoles, 'assign roles'))
      const subject = await nativeActor(env, String(args.operatorId))
      return [{ class: 'access', facts: { measure: 1, direction: roleWidens(subject.role, String(args.role)) ? 'widens' : 'narrows' } }]
    },
    summary: async args => {
      const subject = await nativeCall(() => roleSnapshot(env.DB, String(args.operatorId)))
      return { target: { id: String(args.operatorId), name: subject.display_name }, role: String(args.role),
        items: ['Current role: ' + subject.role, 'Native revision: ' + subject.revision] }
    },
    async run(args, ctx) {
      const subject = await nativeCall(() => roleSnapshot(env.DB, String(args.operatorId)))
      return { result: await command(env, ctx, 'role.set', { ...args, expectedRevision: subject.revision }, peopleHandlers['role.set']) }
    },
  })
  const list = defineTool({ ...metadata('locket.people.list'), classify: () => classification(null),
    async run(_args, ctx) {
      const actor = await agentActor(env, ctx)
      const current = await nativeCall(() => import('../locket/views').then(({state}) => state(env, actor)))
      return { result: { members: current.operators } }
    },
  })
  const count = defineTool({ ...metadata('locket.records.count'), classify: () => classification(null),
    async run(_args, ctx) { return { result: await nativeWitness(env, await agentActor(env, ctx)) } },
  })
  return [read, create, update, search, prepare, access, people, list, count]
}
