// Check every selected revision and current permission using one bound snapshot;
// the number of query parameters stays fixed as the report grows. The caller's
// guard also verifies that the actor still holds this exact role.
import { sql, type Actor } from './model'

export function reportSnapshot(actor:Actor,rows:{id:string;version:number}[]){
  return sql(`NOT EXISTS(SELECT 1 FROM json_each(?) snapshot
    LEFT JOIN lk_agreements a ON a.id=json_extract(snapshot.value,'$.id')
    WHERE a.id IS NULL OR a.version<>json_extract(snapshot.value,'$.version')
      OR NOT(a.restricted=0 OR ? IN ('owner','counsel') OR a.requester_id=? OR a.owner_id=?
        OR EXISTS(SELECT 1 FROM lk_access g WHERE g.agreement_id=a.id AND g.operator_id=?)))`,JSON.stringify(rows.map(r=>({id:r.id,version:r.version}))),actor.role,actor.id,actor.id,actor.id)
}
