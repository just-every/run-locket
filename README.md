# Locket

Locket keeps a small business's commercial agreements from request to renewal: approved templates and a clause playbook, negotiated versions, cited review findings, approvals pinned to the exact version, a signature-ready package for the signing service you already use, executed files reconciled on return, obligations and renewal notice deadlines. Agents you invite prepare work; people approve it. MIT licensed.

- Source code: [just-every/run-locket](https://github.com/just-every/run-locket).
- Site: [run-locket.com](https://run-locket.com).

# Run it locally

Install the `rer` command once with `npx -y @runeditrun/rer cli install`, or the
installer script on the RER site (`curl -fsSL https://runeditrun.com/install.sh | sh`).
This edition is runnable after composition. From the composed edition's
checkout root, `rer dev` alone launches it for review: it installs pinned
dependencies, sets up a local owner on a free port, starts the real app and
prints `RER_READY` and a sign-in link. To install for a real owner, run the
verbs yourself:

```sh
rer install
rer setup --owner-email you@example.com
rer dev
```

Commands that run project work select the exact Node version declared by the
project. They use an exact matching installed runtime or a checksum-verified
copy cached at `~/.rer/node/node-vVERSION-PLATFORM-ARCH/`; when needed on
supported platforms, the runner retrieves the official Node release and checks
its SHA-256 against `SHASUMS256.txt`. It does not change global Node installations.
Set `RER_NODE_AUTO=0` to disable automatic selection. If selection is disabled
or acquisition fails, the command reports a repair invocation in this form:
`npm exec --yes --package=node@VERSION -- node SCRIPT VERB --cwd PROJECT`.
Help, check, describe, doctor and stop do not select or acquire Node.

After `RER_READY`, `dev` prints `RER_SIGNED_IN EMAIL` and `RER_OPEN URL`.
Open that URL on this computer: the app opens signed in as the owner and
finishes first-run setup at `/setup`. Treat the line as a credential.
`dev --as PERSONA` starts as a persona or signed out; legacy `dev --login`
uses the same automatic sign-in. Until first-run
completion is stored durably, app routes send the signed-in owner to `/setup`;
signed-out visitors sign in and return there. Once complete, `/setup` opens the
app or settings. Mail is silently suppressed in local dev and demo.

The saved local port is used; a first setup saves the first free port from 8787. Explicit ports are decimal
integers from 1 through 65535 and must be free; a busy requested port fails
instead of silently moving. Only `127.0.0.1`, `localhost` and `::1` are allowed.
Dev applies the selected host and port to both the listener and runtime bindings;
readiness is bounded and failure stops the owned processes.

Missing non-interactive setup answers exit 3 and name the manifest fields.
Read `rer-setup.json` and pass a private, mode-0600 JSON object keyed by those
names using `rer setup --answers PATH --non-interactive`,
for example `{"OWNER_EMAIL":"owner@example.com"}`. Secret values stay in
private inputs and never go in command arguments. A setup rerun with the saved
owner and origin preserves existing owner/data and exact private settings.
Conflicting saved identity or origin reports an actionable recovery path.
Review reset's exact removal inventory before confirmation; export domain data
first if it should be restored, and import only into an empty destination.

Queue waits report immediately with a reason and numeric one-based position,
then refresh about every 15 seconds while waiting. Package mode has no queue status command; a waiting command reports its live position.

Use the setup prompt instead of `--owner-email` when entering the real owner
mailbox. Open the `RER_OPEN` URL printed by `dev` on this computer; the app opens
signed in as the owner; no email is sent. `dev` serves
live editing with HMR and stays in the foreground on its first invocation; a
compatible repeated invocation reuses the server and exits. Stop `dev` with
`rer dev --stop` or Ctrl-C, and stop `preview` with
`rer preview --stop` before build or verification.

```sh
rer verify
rer reset --yes
rer export --output exports/installation.rer
rer import --input exports/installation.rer --yes
rer deploy
rer describe
```

`verify` ends by loading each public page of the production build in Chromium to
prove its sections hydrate as separate units (`src/base/hydration/README.md`); run
`pnpm exec playwright install chromium` once on a new machine.

Reset is destructive local cleanup. Import requires an empty destination and
explicit confirmation. Use `rer describe` to inspect the
checkout's actual commands and flags. The maintained pins are Node 22.20.0 and
pnpm 10.12.4. Read `RUN-LOCALLY.md` for data custody, deploy requirements and
remote-transfer support.

## What Locket does

Locket keeps a small business's commercial agreements: requests with their
required attachments, approved templates and a clause playbook, negotiated
versions with comparison, cited review findings, approvals pinned to the exact
version, a signature-ready package for the signing service you already use,
signed files and certificates reconciled on return, confirmed terms and
obligations, and the renewal queue with notice deadlines in your time zone.
Agents you invite prepare work; people approve it. Moving in starts with a
DocuSign archive. See [CONTRACT.md](CONTRACT.md) for the first release and its
boundaries, [ACCEPTANCE.md](ACCEPTANCE.md) for what is proven,
[API.md](API.md) for the API and [IMPORT.md](IMPORT.md) for moving in.

Locket organises and prepares agreements; it does not give legal advice or
decide whether an agreement is valid.

## Edition notes

Private HTTP routes and Start functions must authorize native sessions inside
every server function, including direct transport calls. Route guards alone are
insufficient. Keep server-only modules and secrets out of client bundles.
Unknown documents and missing assets return real 404s. Keep Queue/Cron handlers
and named Worker exports in `src/server.ts`; the dispatcher only selects HTTP
ownership.

An installed instance's `/` is the Lobby, served by `src/server.ts` from
`src/base/lobby.ts` with `GET /setup/state`: Sign in, or Finish setup until the
owner confirms first-run setup. `src/identity.ts` holds its edition identity
(the name from `src/branding.json`, its purpose, tagline, sign-in route and the
run-locket.com origin from `deploy-site.json`). The public run site and
homepage arrive with their own round; see `HOMEPAGE-VARIANTS.md`.

The edition owns `rer-setup.json`, application branding and its installer
adapter. Keep one setup manifest and declare actual answers, defaults, managed
secrets, migrations, build targets, health checks and owner behavior there and
in the adapter. Setup must preserve existing local owner/data and exact private
settings on reruns. Never create a second owner or rotate secrets implicitly.

Local durable data lives in `.wrangler/state`; private settings default to
`.dev.vars` with mode 0600. Local export/import covers declared supported
resources and excludes owner/auth, private settings and transient
runtime state. Every first-party seed verifies local export/import/export
equivalence across its supported resources. Preserve applied migration history
and require forward migrations for schema changes. Remote transfer is supported
only when the adapter covers all required resources.

`deploy --dry-run` builds and validates locally without provider requests. Real
deployment uses the owner-account procedure and requires its private account
credentials, declared migrations and a real verified mail configuration. Local
verification does not establish hosted acceptance, remote health or mail
delivery. See `OPERATIONS.md`, `ONBOARDING.md`, `SEED-COMMAND-CONTRACT.md` and
`RUN-LOCALLY.md` for the implemented requirements.
