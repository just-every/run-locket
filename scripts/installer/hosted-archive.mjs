import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cloudflare } from '@runeditrun/rer/modules/deploy-kit/provider';
import { activeWorker } from '@runeditrun/rer/internal/modules/deploy-kit/worker.mjs';
import { readOwnerState, sameDeployment, ownerWorkerName, checkResourceIdentity } from '@runeditrun/rer/modules/deploy-kit/owner';
import { hookState } from '@runeditrun/rer/internal/cli/deploy-hook-record.mjs';
import { createPortability } from '@runeditrun/rer/modules/portability';
import { exportArchive } from '@runeditrun/rer/modules/portability/files';
import policy from './archive-policy.mjs';
import { cloudflareDatabase } from './cloudflare-database.mjs';

export async function deployment(root, environment = 'production') {
 const path = await hookState(root, environment) ?? join('.rer/deploy', `${environment}.json`);
 try { return {path: join(root,path), state: JSON.parse(await readFile(join(root,path),'utf8'))}; }
 catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function hostedDatabase(root, environment, signal) {
 const held = await deployment(root,environment);
 if (!held?.state.receipt) throw Error('update-needs-completed-deployment');
 const target = {accountId:process.env.CLOUDFLARE_ACCOUNT_ID, project:'contracts/locket', environment, worker:ownerWorkerName('contracts/locket',environment)};
 const state = await readOwnerState(held.path,target);
 const api = cloudflare({accountId:target.accountId,token:process.env.CLOUDFLARE_API_TOKEN,maxRequests:10000,requestSignal:()=>signal});
 const live = await activeWorker(api,target.worker);
 if (!sameDeployment(live,state.receipt.provider)) throw Error('update-owned-worker-replaced');
 const resource = state.receipt.resources.d1.find(item => item.binding === 'DB');
 if (!resource) throw Error('update-database-missing');
 const row = await api.request(`/d1/database/${resource.id}`);
 checkResourceIdentity('d1',resource.name,row,state.owned.d1[resource.name]);
 if (row.name !== resource.name || !live.settings.bindings.some(item => item.name === 'DB' && item.id === resource.id)) throw Error('update-database-identity-mismatch');
 return {state,db:cloudflareDatabase(api,resource.id)};
}

export async function exportHosted({root,environment = 'production',path,signal,store}) {
 const {state,db} = await hostedDatabase(root,environment,signal);
 const service = await createPortability({db,policy});
 const receipt = await exportArchive(service,path,['runtime caches, private configuration and earlier update archives'], progress => {
  if (progress.phase === 'building') store?.report(`Snapshot: ${progress.parts} archive parts built.`);
 });
 return {state,receipt};
}
