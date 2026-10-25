// The provider REST batch is a single D1 transaction, like the Worker binding.
// https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
export function cloudflareDatabase(api, id) {
 async function batch(statements) {
  const result = await api.request(`/d1/database/${id}/query`, {
   method: 'POST', body: { batch: statements.map(({sql,params}) => ({sql,params})) },
  });
  if (!Array.isArray(result) || result.length !== statements.length || result.some(row => row.success !== true)) throw Error('update-database-query-failed');
  return result;
 }
 function prepare(sql, params = []) {
  return {sql,params,bind: (...values) => prepare(sql, values),
   all: async () => (await batch([{sql,params}]))[0],
   run: async () => (await batch([{sql,params}]))[0],
   first: async column => { const row = (await batch([{sql,params}]))[0].results[0]; return column === undefined ? row ?? null : row?.[column] ?? null; },
   raw: async () => (await batch([{sql,params}]))[0].results.map(row => Object.values(row)),
  };
 }
 return {prepare,batch};
}
