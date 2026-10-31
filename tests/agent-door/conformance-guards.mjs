import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { accessToken, autonomousPolicy, heldPolicy } from '../../node_modules/@runeditrun/rer/modules/agent-door/conformance/crypto.mjs'
import { listedDoor } from '../../node_modules/@runeditrun/rer/modules/agent-door/conformance/discovery.mjs'
import { runJourney } from '../../node_modules/@runeditrun/rer/modules/agent-door/conformance/journey.mjs'
import { negativePhase } from '../../node_modules/@runeditrun/rer/modules/agent-door/conformance/negative.mjs'
import { blockedPhases, removalPhase } from '../../node_modules/@runeditrun/rer/modules/agent-door/conformance/policy-phases.mjs'
import { errorCode } from '../../node_modules/@runeditrun/rer/modules/agent-door/conformance/protocol.mjs'

/** Exercise the installed verifier with unsafe door transcripts and real native effects.
 * Faults exist only in this disposable client's transport. Neither the product nor
 * the shared verifier is patched; native writes use the signed-in person's door.
 */
export default async function conformanceGuards(c, native) {
  const surface = c.surface
  const create = surface.journey.find(step => step.id === 'create')
  const sensitive = surface.journey.find(step => step.id === 'create_sensitive')
  assert.ok(create && sensitive)
  const failures = points => points.filter(point => !point.ok)
  const leak = async () => {
    const answer = await native('/api/locket/commands', { method: 'POST', body: JSON.stringify({
      commandId: randomUUID(), type: 'request.create', payload: {
        title: 'synthetic-locket-conformance', type: 'supplier',
        party: { name: 'synthetic-locket-conformance', kind: 'supplier' }, restricted: true,
      },
    }) })
    assert.equal(answer.ok, true)
  }

  // Every broken transcript has a passing control on the same Worker. Keep its
  // deliberately failed points separate from the enclosing production journey.
  const trial = async ({ name, step = create, check, fault, expected }) => {
    const saved = { points: c.points, surface: c.surface, mcp: c.mcp }
    c.surface = { ...surface, journey: [structuredClone(step)], escalations: [] }
    c.points = []
    try {
      await c.adopt(autonomousPolicy())
      await listedDoor(c)
      assert.deepEqual(failures(c.points), [])
      await c.phase('BASE-AGENT-013.guard', check)
      assert.deepEqual(failures(c.points), [], name + ' control must pass')
      c.points = []
      c.mcp = fault(saved.mcp)
      await c.phase('BASE-AGENT-013.guard', check)
      assert.ok(c.points.some(point => point.id === expected && !point.ok),
        name + ' must fail its own verifier assertion: ' + JSON.stringify(failures(c.points)))
      console.log(`PROBE BASE-AGENT-013 harness ${name}: installed verifier, passing control then unsafe transcript -> ${expected} fails`)
    } finally {
      Object.assign(c, saved)
    }
  }

  await trial({
    name: 'missing schema', check: () => listedDoor(c),
    fault: mcp => async (method, params, options) => {
      const answer = await mcp(method, params, options)
      if (method === 'tools/list' && answer.result?.tools) {
        const result = structuredClone(answer.result)
        delete result.tools.find(tool => tool.name === create.tool).inputSchema
        return { ...answer, result }
      }
      return answer
    },
    expected: `BASE-AGENT-002.2.schema.${create.tool}`,
  })

  await trial({
    name: 'computed class', check: () => runJourney(c, 'autonomous'),
    fault: mcp => {
      c.surface.journey[0].expect = structuredClone(sensitive.expect)
      return mcp
    },
    expected: `BASE-AGENT-006.2.autonomous.${create.id}`,
  })

  await trial({
    name: 'person flag changes class', step: { ...create, inject: { person_confirmed: true } },
    check: () => runJourney(c, 'autonomous', { injections: true }),
    fault: mcp => async (method, params, options) => {
      const answer = await mcp(method, params, options)
      if (method === 'tools/call' && params.arguments?.person_confirmed && answer.decision) {
        const decision = structuredClone(answer.decision)
        decision.classes.push({ class: 'sensitive', facts: { measure: 1 }, do: 'autonomous' })
        return { ...answer, decision }
      }
      return answer
    },
    expected: `BASE-AGENT-005.5.autonomous.${create.id}`,
  })

  await trial({
    name: 'effect before approval', step: sensitive,
    check: async () => { await c.adopt(heldPolicy()); await runJourney(c, 'held', { held: true }) },
    fault: mcp => async (method, params, options) => {
      const answer = await mcp(method, params, options)
      if (method === 'tools/call' && params.name === sensitive.tool && answer.result?.resultType === 'input_required') await leak()
      return answer
    },
    expected: `BASE-AGENT-007.5.no-effect.${sensitive.id}`,
  })

  await trial({
    name: 'effect under blocked policy', step: sensitive, check: () => blockedPhases(c),
    fault: mcp => async (method, params, options) => {
      const answer = await mcp(method, params, options)
      if (method === 'tools/call' && params.name === sensitive.tool && errorCode(answer) === 'policy_blocked') await leak()
      return answer
    },
    expected: `BASE-AGENT-007.1.blocked-no-effect.sensitive.${sensitive.id}`,
  })

  await trial({
    name: 'effect before policy setup', check: () => removalPhase(c),
    fault: mcp => async (method, params, options) => {
      const answer = await mcp(method, params, options)
      if (method === 'tools/call' && params.name === create.tool && errorCode(answer) === 'policy_unset') await leak()
      return answer
    },
    expected: 'BASE-AGENT-007.2.unset-no-effect',
  })

  await trial({
    name: 'duplicate retry effect', check: () => runJourney(c, 'autonomous', { replay: true }),
    fault: mcp => {
      const seen = new Set()
      return async (method, params, options) => {
        const answer = await mcp(method, params, options)
        if (method === 'tools/call' && params.name === create.tool) {
          const key = params.arguments.idempotency_key
          if (seen.has(key)) await leak()
          seen.add(key)
        }
        return answer
      }
    },
    expected: 'BASE-AGENT-012.1.autonomous',
  })

  await trial({
    name: 'wrong audience accepted', check: () => negativePhase(c),
    fault: mcp => async (method, params, options) => {
      const claims = options?.token ? JSON.parse(Buffer.from(options.token.split('.')[1], 'base64url')) : null
      if (claims?.aud === 'https://sibling.invalid/mcp') return mcp(method, params, { ...options, token: await accessToken(c) })
      return mcp(method, params, options)
    },
    expected: 'BASE-AGENT-004.2.audience',
  })
}
