import type { Bindings } from '../auth.server'
import { state } from '../locket/views'
import { canonical } from '../locket/model'
import { ToolRefusal, type ToolContext, type ToolDefinition } from '../modules/agent-door/index.ts'
import { agentActor, nativeCall } from './native'
import { peopleClassification } from './records'

/** Each decision binds the exact native projection, including the sponsor's
 * current role. Keep separate snapshots for simultaneous invocations. */
export function peopleProjection(env: Bindings): Pick<ToolDefinition, 'classify' | 'run'> {
  const snapshots = new WeakMap<Record<string, unknown>, string>()
  const read = async (ctx: ToolContext) => {
    const actor = await agentActor(env, ctx)
    const members = (await nativeCall(() => state(env, actor))).operators
    return { result: { members }, snapshot: canonical({ person: actor.id, role: actor.role, members }) }
  }
  return {
    async classify(args, ctx) {
      snapshots.delete(args)
      const current = await read(ctx)
      snapshots.set(args, current.snapshot)
      return peopleClassification(current.result.members)
    },
    async run(args, ctx) {
      const snapshot = snapshots.get(args)
      if (snapshot === undefined) throw new ToolRefusal('resource_unavailable')
      const current = await read(ctx)
      if (current.snapshot !== snapshot) throw new ToolRefusal('resource_changed')
      // A read retry rechecks current content. An earlier human approval cannot
      // authorize a different number or kind of sensitive records on that retry.
      if (ctx.approvers.length) {
        const approval = await env.DB.prepare("SELECT saved FROM agent_door_approvals WHERE json_extract(saved,'$.principal.operationId')=? AND json_extract(saved,'$.tool')='locket.people.list'")
          .bind(ctx.operationId).first<{ saved: string }>()
        if (!approval || canonical(JSON.parse(approval.saved).classes) !== canonical(peopleClassification(current.result.members))) throw new ToolRefusal('resource_changed')
      }
      return { result: current.result }
    },
  }
}
