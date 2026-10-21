import { visibleSetSql } from './access'
// Check every selected revision and current permission using one bound snapshot;
// the number of query parameters stays fixed as the report grows. The caller's
// guard also verifies that the actor still holds this exact role.
import { sql, type Actor } from './model'

export function reportSnapshot(actor:Actor,rows:{id:string;version:number}[]){
  const visible=visibleSetSql(actor,rows.map(r=>r.id))
  return sql(`(${visible.sql}) AND NOT EXISTS(SELECT 1 FROM json_each(?) snapshot LEFT JOIN lk_agreements a ON a.id=json_extract(snapshot.value,'$.id') WHERE a.id IS NULL OR a.version<>json_extract(snapshot.value,'$.version'))`,...visible.params,JSON.stringify(rows.map(r=>({id:r.id,version:r.version}))))
}
