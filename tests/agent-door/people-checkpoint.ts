import native from '../api/worker'

// Test-only scheduling at the policy decision boundary. Every SQL statement
// still runs unchanged against D1. The checkpoint uses real signed-in HTTP
// commands; it cannot replace a query result or insert fixture state.
export default {
  async fetch(request: Request, env: any) {
    if (new URL(request.url).pathname !== '/mcp' && !new URL(request.url).pathname.endsWith('/approve')) return native.fetch(request, env)
    const database = new Proxy(env.DB, {
      get(target, key) {
        if (key !== 'prepare') return typeof target[key] === 'function' ? target[key].bind(target) : target[key]
        return (sql: string) => {
          const wrap = (statement: any): any => new Proxy(statement, {
            get(value, method) {
              if (method === 'bind') return (...args: unknown[]) => wrap(value.bind(...args))
              if (method === 'run' && sql.startsWith('UPDATE agent_door_state SET decision_lock=?')) return async () => {
                const checkpoint = await env.PEOPLE_CHECKPOINT.fetch('https://synthetic-locket.invalid/checkpoint')
                if (!checkpoint.ok) throw new Error('Native people checkpoint failed')
                return value.run()
              }
              return typeof value[method] === 'function' ? value[method].bind(value) : value[method]
            },
          })
          return wrap(target.prepare(sql))
        }
      },
    })
    return native.fetch(request, { ...env, DB: database })
  },
}
