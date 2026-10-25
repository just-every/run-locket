import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cloudflare } from '@runeditrun/rer/modules/deploy-kit/provider';
import { checkResourceIdentity, ownerResourceName } from '@runeditrun/rer/modules/deploy-kit/owner';
import { hostedDatabase } from './hosted-archive.mjs';

// Cloudflare's account API accepts raw object uploads up to 300 MB.
const maximumBytes = 300_000_000;
const objectKey = /^(?!00000000-0000-0000-0000-000000000000\.)[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.(?:rer|json)$/i;
const requireValue = (value, code) => { if (!value) throw Error(code); };

async function hashBytes(source, expectedBytes, signal) {
 const hash = createHash('sha256');
 let bytes = 0;
 for await (const chunk of source) {
  signal?.throwIfAborted();
  bytes += chunk.length;
  requireValue(bytes <= expectedBytes, 'update-archive-readback-size-mismatch');
  hash.update(chunk);
 }
 requireValue(bytes === expectedBytes, 'update-archive-readback-size-mismatch');
 return hash.digest('hex');
}

async function uploadResult(response, key, bytes) {
 requireValue(response.ok && response.body, 'update-archive-upload-refused');
 const reader = response.body.getReader();
 const chunks = [];
 let length = 0;
 try {
  for (;;) {
   const next = await reader.read();
   if (next.done) break;
   length += next.value.length;
   requireValue(length <= 65536, 'update-archive-upload-response-too-large');
   chunks.push(next.value);
  }
 } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
 let result;
 try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
 catch { throw Error('update-archive-upload-invalid-response'); }
 requireValue(result?.success === true && Array.isArray(result.errors) && result.errors.length === 0 && result.result && typeof result.result === 'object', 'update-archive-upload-refused');
 requireValue(result.result.key === undefined || result.result.key === key, 'update-archive-upload-key-mismatch');
 requireValue(result.result.size === undefined || String(result.result.size) === String(bytes), 'update-archive-upload-size-mismatch');
}

async function objectRequest(url, options, phase) {
 try { return await fetch(url, { ...options, redirect: 'error' }); }
 catch { throw Error(`update-archive-${phase}-failed`); }
}

/** Retain and byte-verify a backup in this deployment's own private R2 bucket. */
export async function storeUpdateArchive({ root, environment = 'production', state, api, path, key, signal }) {
 const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
 const token = process.env.CLOUDFLARE_API_TOKEN;
 requireValue(typeof accountId === 'string' && /^[a-f0-9]{32}$/i.test(accountId) && !/^0+$/.test(accountId), 'update-archive-account-invalid');
 requireValue(typeof token === 'string' && token.trim() && !/[\r\n]/.test(token), 'update-archive-token-invalid');
 requireValue(typeof key === 'string' && objectKey.test(key), 'update-archive-key-invalid');
 requireValue(typeof path === 'string' && path.length > 0, 'update-archive-path-invalid');
 signal?.throwIfAborted();
 if (state === undefined) {
  requireValue(typeof root === 'string' && root.length > 0, 'update-archive-deployment-missing');
  ({ state, api } = await hostedDatabase(root, environment, signal));
 }
 requireValue(state?.version === 1 && state.kind === 'rer-deploy-owner-state' && state.accountId === accountId && state.environment === environment, 'update-archive-deployment-mismatch');
 api ??= cloudflare({ accountId, token, requestSignal: () => signal });
 requireValue(api.accountId === accountId && typeof api.request === 'function', 'update-archive-provider-mismatch');
 const resources = state.receipt?.resources?.r2;
 requireValue(Array.isArray(resources), 'update-archive-bucket-missing');
 const candidates = resources.filter(item => item.binding === 'UPDATE_ARCHIVES');
 requireValue(candidates.length === 1, 'update-archive-bucket-missing');
 const bucket = candidates[0].name;
 requireValue(bucket === ownerResourceName(state.worker, 'UPDATE_ARCHIVES'), 'update-archive-bucket-mismatch');
 const owned = state.owned?.r2?.[bucket];
 // Older state without a recorded bucket identity cannot establish ownership.
 requireValue(owned?.status === 'created' && typeof owned.id === 'string' && owned.id.length > 0, 'update-archive-bucket-not-owned');
 const row = await api.request(`/r2/buckets/${bucket}`);
 requireValue(row?.name === bucket && row.creation_date === owned.id, 'update-archive-bucket-identity-mismatch');
 checkResourceIdentity('r2', bucket, row, owned);
 const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${key}`;
 const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000);
 const headers = { Authorization: `Bearer ${token}` };
 const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
 try {
  const info = await file.stat();
  requireValue(info.isFile() && Number.isSafeInteger(info.size), 'update-archive-source-invalid');
  requireValue(info.size <= maximumBytes, 'update-archive-over-300mb');
  const sha256 = await hashBytes(file.createReadStream({ start: 0, autoClose: false, signal: requestSignal }), info.size, requestSignal);
  const body = file.createReadStream({ start: 0, autoClose: false, signal: requestSignal });
  let uploaded;
  try {
   uploaded = await objectRequest(url, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(info.size) },
    body, duplex: 'half', signal: requestSignal,
   }, 'upload');
   await uploadResult(uploaded, key, info.size);
  } finally { body.destroy(); await uploaded?.body?.cancel().catch(() => {}); }
  const downloaded = await objectRequest(url, { method: 'GET', headers, signal: requestSignal }, 'readback');
  try {
   requireValue(downloaded.ok && downloaded.body, 'update-archive-readback-refused');
   const actual = await hashBytes(downloaded.body, info.size, requestSignal);
   requireValue(actual === sha256, 'update-archive-readback-digest-mismatch');
  } finally { await downloaded.body?.cancel().catch(() => {}); }
  return { bucket, key, sha256, bytes: info.size };
 } finally { await file.close(); }
}
