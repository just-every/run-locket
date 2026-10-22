// Delete only native, unexecuted drafts. Schema-derived dependencies keep every
// native child in the same transaction; audit/command outcomes remain history.
import type { Ctx } from './commands'
import { fail, json, sql, type Sql } from './model'
import { agreementGuards, type AgreementRow } from './records'

export async function draftDeletion(c: Ctx, a: AgreementRow): Promise<{writes:Sql[];checks:Sql[]}> {
  if(a.status!=='draft'||a.origin!=='intake') fail('STATUS','Only an unexecuted native draft can be deleted.',409)
  if(await c.db.prepare('SELECT 1 FROM lk_executions WHERE agreement_id=?').bind(a.id).first()) fail('RETAINED','Execution evidence must be retained.',409)
  if(await c.db.prepare('SELECT 1 FROM lk_agreements WHERE parent_id=?').bind(a.id).first()) fail('LINKED','Unlink child agreements before deleting this draft.',409)
  if(await c.db.prepare('SELECT 1 FROM lk_legal_holds WHERE agreement_id=? AND active=1').bind(a.id).first()) fail('LEGAL_HOLD','Counsel must release the legal hold before deleting this draft or its files.',409)
  const names=(await c.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'lk_%'").all<{name:string}>()).results.map(r=>r.name).filter(n=>/^lk_[a-z_]+$/.test(n)&&!['lk_audit','lk_commands','lk_guard'].includes(n))
  const scopes=new Map<string,Set<number>>(),foreign=new Map<string,{table:string;from:string;to:string}[]>()
  for(const name of names){
    const columns=(await c.db.prepare(`PRAGMA table_info(${name})`).all<{name:string}>()).results
    const direct=name==='lk_agreements'?'id':columns.some(r=>r.name==='agreement_id')?'agreement_id':null
    const ids=direct?(await c.db.prepare(`SELECT rowid AS rid FROM ${name} WHERE ${direct}=?`).bind(a.id).all<{rid:number}>()).results.map(r=>r.rid):[]
    scopes.set(name,new Set(ids))
    foreign.set(name,(await c.db.prepare(`PRAGMA foreign_key_list(${name})`).all<{table:string;from:string;to:string}>()).results)
  }
  // Include indirect children (chunks, comment replies, deliveries, rule decisions).
  let changed=true
  while(changed){
    changed=false
    for(const [name,keys] of foreign) for(const key of keys){
      const parent=scopes.get(key.table)
      if(!parent?.size||!key.to)continue
      const rows=(await c.db.prepare(`SELECT rowid AS rid FROM ${name} WHERE "${key.from}" IN (SELECT "${key.to}" FROM ${key.table} WHERE rowid IN (SELECT value FROM json_each(?)))`).bind(json([...parent])).all<{rid:number}>()).results
      for(const row of rows)if(!scopes.get(name)!.has(row.rid)){scopes.get(name)!.add(row.rid);changed=true}
    }
  }
  // D1 honors deferred FK checks at batch commit, including self-referencing comments.
  const writes=[sql('PRAGMA defer_foreign_keys=ON')]
  for(const [name,ids]of scopes)if(ids.size&&name!=='lk_agreements')writes.push(sql(`DELETE FROM ${name} WHERE rowid IN (SELECT value FROM json_each(?))`,json([...ids])))
  writes.push(sql('DELETE FROM lk_agreements WHERE id=?',a.id))
  return {writes,checks:[...agreementGuards(c,a),sql("NOT EXISTS(SELECT 1 FROM lk_legal_holds WHERE agreement_id=? AND active=1) AND NOT EXISTS(SELECT 1 FROM lk_executions WHERE agreement_id=?) AND NOT EXISTS(SELECT 1 FROM lk_agreements WHERE parent_id=?)",a.id,a.id,a.id)]}
}
