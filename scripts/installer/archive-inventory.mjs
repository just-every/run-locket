import { createHash } from 'node:crypto';
import { fileRecords } from '@runeditrun/rer/modules/portability/files';

const hash = value => createHash('sha256').update(value).digest('hex');
export async function archiveInventory(path) {
 const tables = {}, artifacts = [], chunks = new Map();
 for await (const record of fileRecords(path)) {
  if (record.kind === 'manifest') for (const table of record.tables) tables[table.name] = table.count;
  if (record.kind !== 'part') continue;
  for (const item of record.items) {
   if (item.kind === 'row' && item.table === 'lk_artifacts') artifacts.push(item.row);
   if (item.kind === 'row' && item.table === 'lk_artifact_chunks') {
    const rows = chunks.get(item.row.artifact_id) ?? [];
    rows.push(item.row); chunks.set(item.row.artifact_id, rows);
   }
  }
 }
 const files = artifacts.map(artifact => {
  const digest = createHash('sha256'); let size = 0;
  for (const [ordinal,row] of (chunks.get(artifact.id) ?? []).sort((a,b)=>a.ordinal-b.ordinal).entries()) {
   if (ordinal !== row.ordinal || !row.bytes?.blob) throw Error('update-file-chunks-invalid');
   const bytes = Buffer.from(row.bytes.blob,'base64'); size += bytes.length; digest.update(bytes);
  }
  const sha256 = digest.digest('hex');
  if (size !== artifact.size || sha256 !== artifact.sha256) throw Error('update-file-digest-mismatch');
  return {id:artifact.id,sha256,size};
 });
 return {tables,files:files.sort((a,b)=>a.id.localeCompare(b.id))};
}

// Compare the old columns of every archived row; additive columns may be new.
// Keep only hashes in memory, including repeated rows in tables without keys.
export async function compareArchives(before,after) {
 const columns = new Map(), remaining = new Map();
 const rowHash = item => hash(JSON.stringify(columns.get(item.table).map(name=>item.row[name])));
 for await (const record of fileRecords(before)) {
  if (record.kind === 'manifest') for (const table of record.tables) { columns.set(table.name,table.columns.filter(column=>!column.hidden).map(column=>column.name)); remaining.set(table.name,new Map()); }
  if (record.kind === 'part') for (const item of record.items) if (item.kind === 'row') {
   const rows = remaining.get(item.table), key = rowHash(item); rows.set(key,(rows.get(key) ?? 0)+1);
  }
 }
 for await (const record of fileRecords(after)) if (record.kind === 'part') for (const item of record.items) if (item.kind === 'row' && columns.has(item.table)) {
  const rows = remaining.get(item.table), key = rowHash(item), count = rows.get(key);
  if (count) { if (count === 1) rows.delete(key); else rows.set(key,count-1); }
 }
 const missing = [...remaining].filter(([,rows])=>rows.size).map(([name])=>name);
 if (missing.length) throw Error(`update-record-preservation-failed: ${missing.join(', ')}`);
 const prior = await archiveInventory(before), current = await archiveInventory(after);
 for (const file of prior.files) if (!current.files.some(item=>item.id===file.id && item.sha256===file.sha256 && item.size===file.size)) throw Error('update-file-preservation-failed');
 return {tables:Object.keys(prior.tables).length,records:Object.values(prior.tables).reduce((a,b)=>a+b,0),files:prior.files.length};
}
