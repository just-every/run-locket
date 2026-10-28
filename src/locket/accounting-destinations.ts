import type { Bindings } from '../auth.server'
import type { Ctx, Handler } from './commands'
import { requireRole } from './access'
import { fail, integer, sql, text } from './model'
import { pantryOrigin, publicPantryOrigin } from './accounting-records'

export type PantryDestination = {origin:string;revision:number;enabled:number;configured_by:string;configured_at:number}
export const pantryDestination = (db:D1Database) => db.prepare("SELECT * FROM lk_accounting_destinations WHERE provider='pantry'").first<PantryDestination>()
export function pantryServerMatches(env:Bindings,origin:string){
 try{return pantryOrigin(env)===origin}catch{return false}
}
export function destinationGuard(destination:{origin:string;revision:number}){
 return sql("EXISTS(SELECT 1 FROM lk_accounting_destinations WHERE provider='pantry' AND enabled=1 AND origin=? AND revision=?)",destination.origin,destination.revision)
}
export async function currentPantryDestination(c:Ctx,expected?:{origin:string;revision:number}){
 const destination=await pantryDestination(c.db)
 if(!destination?.enabled||!pantryServerMatches(c.env,destination.origin)||expected&&(expected.origin!==destination.origin||expected.revision!==destination.revision))fail('STALE','The Pantry destination revision is no longer current. Configure the matching server connection and prepare fresh exact consent.',409)
 return destination
}
const configure:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'configure the accounting destination')
 const revision=integer(p,'revision'),origin=publicPantryOrigin(text(p,'origin',300))
 if(p.consent!==true)fail('CONSENT','Confirm that this new destination revision invalidates earlier accounting consent.')
 return {allowed:['owner'],result:{revision:revision+1},checks:[sql("COALESCE((SELECT revision FROM lk_accounting_destinations WHERE provider='pantry'),0)=?",revision)],writes:[sql("INSERT INTO lk_accounting_destinations VALUES('pantry',?,?,1,?,?) ON CONFLICT(provider) DO UPDATE SET origin=excluded.origin,revision=excluded.revision,enabled=1,configured_by=excluded.configured_by,configured_at=excluded.configured_at",origin,revision+1,c.actor.id,c.now),sql("DELETE FROM lk_connection_health WHERE id='pantry'")],audit:[{action:'accounting.destination.configure',summary:`Owner selected Pantry ${origin} at revision ${revision+1}. Earlier proposal consent remains stale; credentials stay in matching private server settings.`}]}
}
const invalidate:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'invalidate the accounting destination')
 const revision=integer(p,'revision',1)
 if(p.consent!==true)fail('CONSENT','Confirm invalidation of earlier accounting consent.')
 return {allowed:['owner'],result:{revision:revision+1},checks:[sql("(SELECT revision FROM lk_accounting_destinations WHERE provider='pantry')=?",revision)],writes:[sql("UPDATE lk_accounting_destinations SET revision=?,enabled=0,configured_by=?,configured_at=? WHERE provider='pantry'",revision+1,c.actor.id,c.now),sql("DELETE FROM lk_connection_health WHERE id='pantry'")],audit:[{action:'accounting.destination.invalidate',summary:`Owner disabled the Pantry destination at revision ${revision+1}. No earlier proposal can revive.`}]}
}
export const accountingDestinationHandlers={'accounting.destination.configure':configure,'accounting.destination.invalidate':invalidate}
