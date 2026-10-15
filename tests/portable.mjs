// Full public-command portability proof. Runs sequential fresh installations;
// every child and directory is owned by this script and closed in finally.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, cp, rm, readFile } from "node:fs/promises";
import { pdf, docx, file } from "./api/files.mjs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
const workspace = resolve("."),
  parent = await mkdtemp(join(tmpdir(), "locket-portable-")),
  children = new Set();
const excluded = new Set([
  ".git",
  "node_modules",
  ".wrangler",
  ".rer",
  ".seed",
  ".cache",
  ".tanstack",
  "dist",
  "exports",
  "test-results",
]);
const clean = (s) =>
  s
    .replace(/RER_OPEN[^\n]*/g, "RER_OPEN [private]")
    .replace(/token=[^\s"&<>]+/g, "token=[private]")
    .replace(/rer-dev=[^\s"&<>]+/g, "rer-dev=[private]");
async function copy(name) {
  const root = join(parent, name);
  await cp(workspace, root, {
    recursive: true,
    filter: (path) => {
      const rel = path.slice(workspace.length + 1);
      return (
        !excluded.has(rel.split("/")[0]) &&
        !rel.startsWith(".dev.vars") &&
        !rel.startsWith(".env")
      );
    },
  });
  // Setup may relink dependencies. Each installation must own its node_modules
  // so the public setup command cannot mutate the source checkout or its peer.
  await command(
    root,
    ["pnpm", "install", "--frozen-lockfile"],
    "corepack",
  );
  return root;
}
function child(root, args, executable = join(root, "node_modules/.bin/rer")) {
  const environment = { ...process.env };
  // Each scratch installation owns a new operation; the outer verification
  // token belongs to the source checkout and is invalid at another root.
  delete environment.RER_LOCAL_OPERATION;
  delete environment.RER_ONBOARDING_PROCESS_OWNER;
  const proc = spawn(executable, args, {
    cwd: root,
    env: {
      ...environment,
      CI: "true",
      RER_SERVER_JOURNEY: "1",
      WRANGLER_SEND_METRICS: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(proc);
  let output = "";
  for (const pipe of [proc.stdout, proc.stderr])
    pipe.on("data", (chunk) => (output += chunk));
  const done = new Promise((resolve, reject) => {
    proc.once("error", reject);
    proc.once("close", (code) => {
      children.delete(proc);
      resolve(code);
    });
  });
  return { proc, done, output: () => output };
}
async function command(root, args, executable) {
  const p = child(root, args, executable),
    code = await p.done;
  assert.equal(code, 0, clean(p.output()).slice(-5000));
}
async function port() {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const p = server.address().port;
  await new Promise((r) => server.close(r));
  return p;
}
async function start(root, p) {
  const runtime = child(root, [
    "preview",
    "--port",
    String(p),
    "--no-queue",
  ]);
  try {
    const deadline = Date.now() + 120000;
    while (!runtime.output().includes("RER_READY") && Date.now() < deadline) {
      if (runtime.proc.exitCode !== null)
        throw Error(clean(runtime.output()).slice(-3000));
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(
      runtime.output().includes("RER_READY"),
      clean(runtime.output()).slice(-3000),
    );
    const origin = `http://127.0.0.1:${p}`;
    let cookie = "";
    const request = (path, method = "GET", body, as = cookie) =>
      fetch(origin + path, {
        method,
        redirect: "manual",
        headers: { origin, "content-type": "application/json", cookie: as },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    // Preview serves production output and does not print a dev sign-in link.
    // This test owns the installation and uses its private key for local mail.
    const key = (await readFile(join(root, '.rer/local/dev-key.env'), 'utf8'))
      .match(/^RER_DEV_KEY=([A-Za-z0-9_-]+)/m)?.[1];
    assert.ok(key, "Setup created this installation's private dev key");
    const gate = await request("/__dev/key", "POST", { key });
    cookie = gate.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; ");
    await request("/auth/magic-link", "POST", { email: "owner@example.test" });
    const listing = await (await request("/__dev/outbox")).text();
    const msg = listing.match(/href="(\/__dev\/outbox\?message=[^"]+)"/)?.[1];
    assert.ok(msg);
    const body = await (await request(msg.replaceAll("&amp;", "&"))).text();
    const href = body.match(/href="([^"]*\/auth\/confirm\?token=[^"]+)"/)?.[1];
    assert.ok(href);
    const token = new URL(
      href.replaceAll("&amp;", "&"),
      origin,
    ).searchParams.get("token");
    const confirmed = await request("/auth/confirm", "POST", { token });
    assert.equal(confirmed.status, 303);
    cookie +=
      "; " +
      confirmed.headers
        .getSetCookie()
        .map((x) => x.split(";")[0])
        .join("; ");
    return {
      request,
      sessionCookie: () => cookie,
      async cmd(type, payload) {
        const response = await request("/api/locket/commands", "POST", {
          commandId: randomUUID(),
          type,
          payload,
        });
        const result = await response.json();
        assert.equal(response.status, 200, JSON.stringify(result));
        return result.result;
      },
      async close() {
        await command(root, ["preview", "--stop"]);
        if (runtime.proc.exitCode === null) runtime.proc.kill("SIGTERM");
        await runtime.done;
      },
    };
  } catch (error) {
    await command(root, ["preview", "--stop"]).catch(() => {});
    if (runtime.proc.exitCode === null) runtime.proc.kill("SIGTERM");
    await runtime.done;
    throw error;
  }
}
// Locket's leave-and-return proof: a populated installation (library, an
// executed agreement with files, confirmed terms, a renewal and a DocuSign
// move-in) goes through `rer export` and `rer import` into an empty install.
let running
try {
  const source = await copy('source'), destination = await copy('destination'), p = await port()
  await command(source, ['setup', '--owner-email', 'owner@example.test', '--port', String(p), '--non-interactive', '--no-queue'])
  running = await start(source, p)
  const state = async () => (await running.request('/api/locket/state')).json()
  const tpl = await running.cmd('template.create', { name: 'NDA', type: 'nda', body: 'NDA with {{counterparty}}.\n[[clause:term]]', fields: [], clauses: [{ key: 'term', title: 'Term', variants: [{ id: 'two', label: '2 years', text: 'Obligations last 2 years.' }] }] })
  await running.cmd('template.decide', { versionId: tpl.versionId, decision: 'approve' })
  const created = await running.cmd('request.create', { title: 'Portable NDA', type: 'nda', party: { name: 'Portable Co', kind: 'partner' }, value: '1000', templateVersionId: tpl.versionId })
  const agreement = async () => (await state()).agreements.find(a => a.id === created.id)
  let a = await agreement()
  await running.cmd('version.upload', { agreementId: a.id, version: a.version, kind: 'counterparty', file: file('markup.docx', docx(['NDA with Portable Co.', 'Obligations last 3 years.'])) })
  a = await agreement()
  await running.cmd('agreement.submit', { agreementId: a.id, version: a.version })
  a = await agreement()
  await running.cmd('approval.decide', { agreementId: a.id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' })
  a = await agreement()
  await running.cmd('version.rendition', { agreementId: a.id, version: a.version, versionId: a.current_version_id, file: file('markup.pdf', pdf('NDA with Portable Co. Obligations last 3 years.')) })
  a = await agreement()
  await running.cmd('approval.decide', { agreementId: a.id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' })
  a = await agreement()
  const pkg = await running.cmd('package.prepare', { agreementId: a.id, version: a.version, provider: 'docusign', recipients: [{ name: 'Pat', email: 'pat@portable.example', action: 'sign' }] })
  a = await agreement()
  await running.cmd('package.sent', { agreementId: a.id, version: a.version, packageId: pkg.packageId, envelopeId: 'ENV-PORTABLE' })
  a = await agreement()
  await running.cmd('execution.record', { agreementId: a.id, version: a.version, envelopeId: 'ENV-PORTABLE', executedOn: '2026-08-01', documentConfirmed: true, signers: [{ name: 'Pat', email: 'pat@portable.example' }], signed: file('signed.pdf', pdf('Signed NDA')), certificate: file('Summary.pdf', pdf('Certificate')) })
  for (const [key, value, quote] of [['end_date', '2028-08-01', 'Obligations last 3 years.'], ['notice_days', '45', 'NDA with Portable Co.']]) {
    const term = await running.cmd('term.propose', { agreementId: a.id, key, value, citation: { quote } })
    await running.cmd('term.decide', { agreementId: a.id, termId: term.id, decision: 'confirm' })
  }
  const MSA = '3F2A9C10-5B7E-4D21-9A6B-1C2D3E4F5A60'
  const dry = await running.cmd('import.preview', { kit: 'docusign-archive', label: 'Portable move-in', dateFormat: 'dmy', manifest: file('envelopes.csv', await readFile('tests/fixtures/docusign-archive/envelopes.csv')), files: [{ path: `${MSA}/MSA.pdf`, base64: pdf('Signed MSA', 2).toString('base64') }, { path: `${MSA}/Summary.pdf`, base64: pdf('MSA certificate').toString('base64') }] })
  let batch = (await state()).imports.find(b => b.id === dry.batchId)
  await running.cmd('import.apply', { batchId: batch.id, version: batch.version, fingerprint: batch.fingerprint })
  const before = await (await running.request('/api/locket/export')).json()
  assert.equal(before.records.lk_agreements.length, 2)
  assert.equal(before.records.lk_renewals.length, 1)
  const oldSession = running.sessionCookie()
  await running.close()
  running = null
  const archive = join(parent, 'installation.rer')
  await command(source, ['export', '--output', archive, '--no-queue'])
  await command(destination, ['import', '--input', archive, '--yes', '--no-queue'])
  const p2 = await port()
  await command(destination, ['setup', '--owner-email', 'owner@example.test', '--port', String(p2), '--non-interactive', '--no-queue'])
  running = await start(destination, p2)
  assert.equal((await running.request('/api/locket/state', 'GET', undefined, oldSession)).status, 401, 'restored operator evidence does not restore the source session')
  const after = await (await running.request('/api/locket/export')).json()
  const ids = rows => [...rows].sort((x, y) => String(x.id ?? x.operator_id ?? x.agreement_id).localeCompare(String(y.id ?? y.operator_id ?? y.agreement_id)))
  for (const table of Object.keys(before.records)) assert.deepEqual(ids(after.records[table]), ids(before.records[table]), `${table} restored exactly`)
  assert.deepEqual(after.files.map(f => [f.id, f.sha256, f.base64]).sort(), before.files.map(f => [f.id, f.sha256, f.base64]).sort(), 'every file restored byte for byte')
  // The restored owner continues work: the move-in journal still undoes, and new terms still compute.
  batch = (await (await running.request('/api/locket/state')).json()).imports.find(b => b.id === dry.batchId)
  await running.cmd('import.undo', { batchId: batch.id, version: batch.version, reason: 'Undo the restored move-in through its retained journal' })
  const fix = await running.cmd('term.propose', { agreementId: a.id, key: 'end_date', value: '2028-09-01', reason: 'Correction after restore', citation: { quote: 'Obligations last 3 years.' } })
  await running.cmd('term.decide', { agreementId: a.id, termId: fix.id, decision: 'confirm' })
  const final = await (await running.request('/api/locket/state')).json()
  assert.equal(final.agreements.length, 1)
  assert.equal(final.renewals.find(r => r.agreement_id === a.id).deadline_date, '2028-07-18')
  await running.close()
  running = null
  console.log('Fresh rer export/import restored every Locket record and file byte for byte; a new owner session undid the restored move-in and corrected a term.')
} finally {
  if (running) await running.close().catch(() => {})
  for (const proc of children) {
    proc.kill('SIGTERM')
    await new Promise(r => (proc.exitCode !== null ? r() : proc.once('close', r)))
  }
  await rm(parent, { recursive: true, force: true })
}
