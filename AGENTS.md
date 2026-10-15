# Agent instructions

## Launch for review

When asked to launch, run or review this app, run this from the checkout root
and nothing else:

```sh
rer dev
```

- It installs and sets up a fresh checkout by itself and prints progress; a
  first launch can take several minutes. Give the shell tool at least 10
  minutes. If the tool times out, run the same `rer dev` again: it resumes.
- Never run install, setup, reset or deploy for this, and never ask for an
  email, port, password or answers file.
- Give the owner the `RER_READY` address and the `RER_OPEN` link, and ask
  nothing. `RER_OPEN` is a credential: share it only with the owner, in this
  chat.
- Stop the app with `rer dev --stop`. If a start is refused, the message names
  the cause and the next command: run that command.

Without `rer` on PATH, install it once with `npx -y @runeditrun/rer cli install`
or the installer script: `curl -fsSL https://runeditrun.com/install.sh | sh`.
For the current shell, run `export PATH="$HOME/.local/bin:$PATH"` after installing.

## Run it locally

To install Locket for a real owner instead of a review launch, run the verbs
yourself from the checkout root. `rer` runs each verb with the exact
`@runeditrun/rer` version this checkout pins in `package.json`.

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

Queue waits report their reason and live position while the command waits. Package mode has no queue status command.

Use the setup prompt instead of `--owner-email` when entering the real owner
mailbox. Open the `RER_OPEN` URL printed by `dev` on this computer; the app opens
signed in as the owner; no email is sent. Stop `dev` with
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

Reset removes declared local data and settings. Import requires an empty
destination and explicit confirmation. Read `RUN-LOCALLY.md` for supported
flags, private state, deployment inputs and remote limitations.

`pnpm typecheck` and `rer verify` use checkout-local, gitignored
`.cache/typecheck.tsbuildinfo`; deleting it forces a full check, while
`rer build` builds the real Worker and assets.

## Work on Locket

Read [CONTRACT.md](CONTRACT.md), [ACCEPTANCE.md](ACCEPTANCE.md), [API.md](API.md)
and [IMPORT.md](IMPORT.md) before changing product behaviour. Keep the twelve
first-release flows aligned with CONTRACT.md and mark a status LOCAL PROVEN only
after its named test passed.

Locket owns agreements, versions and files, the library (templates and the
clause playbook), review findings, approvals, signature packages, execution
evidence, terms, obligations, renewals, notices, agent proposals and the
DocuSign move-in kit. Server code lives in `src/locket/` by responsibility;
screens in `src/ui/`; the schema in `migrations/core/0015_locket.sql` (with
Base's import-kit storage in `0014_import_kit.sql`). Add forward migrations;
never edit an applied one.

Every command goes through `src/locket/commands.ts`: the handler checks the
role, validates input and returns its writes, and the runner commits them
behind one guard row that re-checks the session, role and record versions in
the same D1 batch. Keep that shape for new commands. Reads go through
`src/locket/views.ts`, which narrows everything to agreements the person may
see. Never trust the screens for authority.

Keep originals byte-for-byte, keep imported history labelled imported, never
create signature or certificate evidence, and never let a proposed value drive
a deadline before a person confirms it. Agents prepare proposals; people with
the right authority approve them. Start installations empty: no seeded
agreements, sample data, mock providers or fallback answers.

Tests: `pnpm run test:api` for the flow, move-in and security tests through the
real Worker with D1; `node tests/portable.mjs` for export/import; browser
journeys with `node tests/browser/run.mjs` (screenshots go outside the
checkout). `rer verify` runs the declared wall.

Pinned reference: https://github.com/runeditrun/base/blob/79f61faef682f9d6cdb64e843cfbd3cf02887982/TANSTACK-START-MIGRATION.md
Native-session/runtime evidence: https://github.com/runeditrun/base/tree/79f61faef682f9d6cdb64e843cfbd3cf02887982/default-seed
