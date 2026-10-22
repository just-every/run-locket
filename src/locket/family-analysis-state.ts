import type { Bindings } from '../auth.server'
import { factsMatch, type FamilyFacts } from './family-analysis-facts'
import { familyClear } from './family-analysis-guard'

export async function familyAnalysisState(env:Bindings,agreements:any[],terms:any[]) {
 const ids=new Set(agreements.map(a=>a.id))
 const rows=(await env.DB.prepare('SELECT * FROM lk_family_analyses ORDER BY revision DESC').all<any>()).results
 const latest=rows.filter((a,i)=>rows.findIndex(b=>b.root_id===a.root_id)===i)
 const blocked=new Set<string>()
 for(const a of latest){
  const check=familyClear(a.root_id)
  const clear=(await env.DB.prepare(`SELECT (${check.sql}) AS ok`).bind(...check.params).first<{ok:number}>())?.ok
  if(clear)continue
  const members=new Set<string>([a.root_id,...JSON.parse(a.facts).members.map((m:any)=>m.id)])
  let previous=-1
  while(previous!==members.size){previous=members.size;for(const row of agreements)if(members.has(row.parent_id))members.add(row.id)}
  for(const id of members)if(ids.has(id))blocked.add(id)
 }
 return {familyBlocks:[...blocked],familyAnalyses:rows.filter(a=>ids.has(a.root_id)&&JSON.parse(a.facts).members.every((m:any)=>ids.has(m.id))).map(a=>({...a,stale:!factsMatch(JSON.parse(a.facts) as FamilyFacts,agreements,terms)}))}
}
