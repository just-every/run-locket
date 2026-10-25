import { sql } from './model'

/** Called only after a real provider operation, inside its durable outcome batch. */
export function signingObservation(id:string,account:string,at:number,success:boolean,reason:string,connectionVersion:number) {
 const incident=crypto.randomUUID()
 return sql(`INSERT INTO lk_connection_health
 (id,account,status,reason,checked_at,last_sync_at,incident_id,alert_status,version)
 SELECT ?,?,?,?,?,?,?,?,1 WHERE (SELECT version FROM lk_signature_connections WHERE provider=?)=?
 ON CONFLICT(id) DO UPDATE SET
 account=excluded.account,status=excluded.status,reason=excluded.reason,checked_at=excluded.checked_at,
 last_sync_at=CASE WHEN excluded.status='healthy' THEN excluded.last_sync_at WHEN account=excluded.account THEN last_sync_at ELSE NULL END,
 last_success_at=CASE WHEN account=excluded.account THEN last_success_at ELSE NULL END,
 provider_account=CASE WHEN account=excluded.account THEN provider_account ELSE NULL END,
 incident_id=CASE WHEN excluded.status='healthy' THEN NULL WHEN account=excluded.account AND status='failing' THEN incident_id ELSE excluded.incident_id END,
 alert_status=CASE WHEN excluded.status='healthy' THEN NULL WHEN account=excluded.account AND status='failing' THEN alert_status ELSE 'pending' END,
 version=version+1`,id,account,success?'healthy':'failing',reason,at,success?at:null,success?null:incident,success?null:'pending',id,connectionVersion)
}
