// Network-edge fixture shaped only from Linen's published MCP implementation:
// just-every/run-linen@2000a899, features/mcp/{protocol,tools,projection}.ts.
import assert from 'node:assert/strict'

export function linenTicket(recordId = 'synthetic-locket-2', overrides = {}) {
  const created = '2026-09-01T09:00:00.000Z', response = '2026-09-01T09:20:00.000Z', closed = '2026-09-01T12:00:00.000Z'
  const target = (name, dueAt, metAt) => ({ target: name, startedAt: created, dueAt, metAt, state: 'met', breachedAt: null })
  return {
    id: recordId, title: 'Synthetic service request', kind: 'request', state: 'closed', revision: 3,
    created_at: created, updated_at: closed, closed_at: closed, paused_at: null, response_at: response, resolution_at: null,
    requester: { id: 'synthetic-locket-3', name: 'Synthetic requester' }, beneficiary: { id: 'synthetic-locket-3', name: 'Synthetic requester' },
    group: { id: 'synthetic-locket-4', label: 'Synthetic queue' }, priority: 'P2', impact: 'individual', urgency: 'medium',
    category: null, subcategory: null, service: null, custom_fields: [], messages: [],
    sla: {
      policy: { id: 'synthetic-locket-5', revision: 1, hours: 'calendar', firstResponseMinutes: 60, nextResponseMinutes: 60, resolutionMinutes: 240, pauseOn: ['requester'], boundAt: created },
      firstResponse: target('first_response', '2026-09-01T10:00:00.000Z', response), nextResponses: [],
      resolution: target('resolution', '2026-09-01T13:00:00.000Z', closed), pauses: [],
    },
    ...overrides,
  }
}

export function linenMcpFixture({ tickets = [linenTicket()], credential = 'synthetic-locket-1', failure = null } = {}) {
  const requests = [], rawBodies = []
  return { requests, rawBodies, async handle(request) {
    assert.equal(new URL(request.url).pathname, '/api/mcp')
    assert.equal(request.method, 'POST')
    assert.equal(request.headers.get('authorization'), `Bearer ${credential}`)
    const rpc = await request.json(); requests.push(rpc)
    assert.equal(rpc.jsonrpc, '2.0'); assert.equal(rpc.method, 'tools/call')
    assert.equal(rpc.params.name, 'work.get')
    assert.deepEqual(Object.keys(rpc.params.arguments), ['workId'])
    if (failure === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://synthetic-locket-other.test/api/mcp' } })
    if (failure === 'denied') return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Authentication required' } }, { status: 401 })
    const ticket = tickets.find(item => item.id === rpc.params.arguments.workId)
    let body = !ticket || failure === 'missing'
      ? { jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: 'not_found', data: { code: 'not_found' } } }
      : { jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(ticket) }], structuredContent: ticket, isError: false } }
    if (failure === 'wrong-id') body.id = 'synthetic-locket-wrong-id'
    const raw = JSON.stringify(body); rawBodies.push(raw)
    return new Response(raw, { headers: { 'content-type': 'application/json' } })
  } }
}
