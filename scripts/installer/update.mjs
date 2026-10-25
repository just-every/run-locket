import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { refuse } from '@runeditrun/rer/errors';
import { deployment, exportHosted } from './hosted-archive.mjs';
import { archiveInventory, compareArchives } from './archive-inventory.mjs';
import { storeUpdateArchive } from './update-storage.mjs';
export { archiveInventory, compareArchives } from './archive-inventory.mjs';

const git = (root,...args) => execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function previousRelease(root,sha) {
 if (!/^[a-f0-9]{40}$/.test(sha)) throw refuse('Update refused: the deployed source record is invalid (update-previous-source-invalid). Restore the original deployment record before updating.');
 try { return JSON.parse(git(root,'show',`${sha}:RELEASE.json`)); }
 catch { throw refuse('Update refused: fetch the deployed source history before updating (update-previous-release-unavailable). No export or migration was started.'); }
}

export function updatingDeploy(native) {
 return Object.assign(async context => {
  const {root,options,store} = context, environment = options.environment ?? 'production';
  if (options.remove || options.setSecret || options.unsetSecret || options.rotateSecret || options.reopenInstallationKey || options.site || options.demo || options.platform === 'container') return native(context);
  const held = await deployment(root,environment);
  const release = JSON.parse(await readFile(join(root,'RELEASE.json'),'utf8'));
  let record, recordPath, directory, backupId;
  if (held?.state.receipt) {
   const prior = held.state.receipt, previous = previousRelease(root,prior.source.sha);
   const applied = new Set(prior.migrations.flatMap(binding => binding.history.map(item => item.name)));
   const {readdir} = await import('node:fs/promises');
   const pending = (await readdir(join(root,'migrations/core'))).filter(name => name.endsWith('.sql') && !applied.has(name)).sort();
   store.report(`Update preview: ${previous.version} (${prior.source.sha}) to ${release.version}; forward migrations: ${pending.join(', ') || 'none'}.`);
   store.report(`Release notes: ${release.publicReleaseNotes}`);
   if (!options.dryRun) {
    const candidate = git(root,'rev-parse','HEAD');
    if (git(root,'status','--porcelain','--untracked-files=no')) throw Error('update-source-not-committed');
    backupId = randomUUID();
    directory = join(root,'.rer/deploy/updates',environment,backupId);
    await mkdir(directory,{recursive:true,mode:0o700});
    const archive = join(directory,'before.rer');
    const backup = await exportHosted({root,environment,path:archive,signal:context.signal,store});
    if (backup.state.receipt.fingerprint !== prior.fingerprint) throw Error('update-deployment-changed-during-export');
    record = {version:1,createdAt:new Date().toISOString(),previous:{release:previous,receipt:prior},candidate:{sha:candidate,release,pendingMigrations:pending},archive:{path:relative(root,archive),...backup.receipt,...await archiveInventory(archive)},status:'exported'};
    recordPath = join(directory,'previous-release.json');
    await writeFile(recordPath,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
    store.report(`Complete pre-update export verified. Previous release retained at ${relative(root,recordPath)}.`);
   }
  } else store.report(`Fresh deployment: ${release.version}; no previous installation to export.`);
  const result = await native(context);
  if (record && result.deployed) {
   const after = join(directory,'after.rer');
   await exportHosted({root,environment,path:after,signal:context.signal,store});
   const preserved = await compareArchives(join(root,record.archive.path),after);
   const remoteArchive = await storeUpdateArchive({root,environment,path:join(root,record.archive.path),key:`${backupId}.rer`,signal:context.signal});
   const appliedPath = join(directory,'applied.json');
   await writeFile(appliedPath,JSON.stringify({version:1,status:'applied',source:record.candidate.sha,previousRelease:relative(root,recordPath),preserved,remoteArchive,appliedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx',mode:0o600});
   await storeUpdateArchive({root,environment,path:recordPath,key:`${backupId}.json`,signal:context.signal});
   store.report(`Update preservation checked: ${preserved.records} records and ${preserved.files} file digests retained.`);
  }
  return result;
 },{declaration:native.declaration,managesHostedOwner:native.managesHostedOwner});
}
