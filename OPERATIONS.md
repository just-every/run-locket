# Foundation operations

Run all first-party operations from the composed, runnable edition checkout
with `rer`. Without it, start with
`npx -y @runeditrun/rer dev just-every/run-locket` (set up only:
`npx -y @runeditrun/rer setup just-every/run-locket`; without Node:
`curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-locket`). `rer dev` alone launches
a fresh checkout for review. The detailed flags and effects are in
`RUN-LOCALLY.md` and `SEED-COMMAND-CONTRACT.md`.

```sh
rer install
rer setup --owner-email you@example.com
rer dev
```

Use the setup prompt instead of the owner-email flag when entering the real
mailbox. Open the `RER_OPEN` URL printed by `dev` on this computer; the app opens
signed in as the owner. Application mail is silently suppressed in development
and demo. Stop `dev` with
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

Use `rer describe` to inspect the checkout's actual
capabilities. `rer check --profile first-party` validates the
declared command contract; it does not run application journeys or contact a
provider.

## Local data and recovery

Setup and development use explicit owner identity and real local migrations.
Dev and preview use the same owner and canonical `.wrangler/state`. Development
sign-in is local only. A process with access to the private settings and
checkout key can sign in as the owner. Private settings are
kept in `.dev.vars` with mode 0600 and are not copied into build output.

Local export creates a private archive with an integrity receipt and explicit
exclusions. Locket's archive contains its `lk_` tables (agreements, files and their
bytes, approvals, terms, renewals, proposals and the move-in batches) and the
import-kit journal with its retained originals; it has no background jobs. Owner/auth, historical development mail, bookkeeping, private settings and
transient runtime state are excluded. Import validates and restores atomically
into an empty destination; confirmed reset preserves export archives. Run setup
after restore to establish a fresh owner. Each first-party seed verifies local
export/import/export equivalence across its supported resources. Remote transfer
is available only when the adapter declares complete resource coverage.

Preserve ambiguous state and applied migration history. Never place a remote
credential, owner secret or local resource ID in source. A schema change needs
a forward migration and verified transition/recovery.

## Deployment

`rer deploy --dry-run` validates the real owner-account
deployment declaration and builds locally without provider requests. Real
deployment requires privately supplied `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`, the declared owner/session/setup secrets, and a real
verified mail sender in `deploy.json`. Follow the owner-account deploy-kit
instructions under `node_modules/@runeditrun/rer/modules/deploy-kit`; account scope,
resource ownership, migrations, receipt and health checks are defined there.
Local validation does not prove hosted acceptance, provider delivery or remote
health.

Approved notice emails use the installation's Resend sender. Configure the optional server-only `NOTICE_RESEND_WEBHOOK_SECRET` through setup or the matching deploy secret. Subscribe its Resend endpoint `/api/locket/notice-events/resend` to delivered, bounced, delivery_delayed, failed and complained events; the same endpoint records RENEW-002 deadline-reminder events. Approval (APPROVE-004) and deadline (RENEW-002) reminders run from an hourly Cron Trigger (`triggers.crons` in `wrangler.jsonc`, `crons` in `deploy.json`). Provider sends require the signing key so their delivery evidence can be authenticated; local/demo sends remain suppressed. Inspect the notice's retained dispatch and provider-event history before preparing another notice after an uncertain/interrupted result; Locket never automatically retries these sends. Provider reports and manual courier receipts are evidence for counsel, not a legal-service determination.

Custom report schedules (REPORT-002) use the same hourly trigger. Each schedule captures the installation time zone at creation, retaining local time across daylight-saving changes and clamping month-end. The scheduler authorizes the enabled report, active human creator and current recipient and records attributed restricted reads before generating an attachment. Each occurrence/recipient is attempted once; inspect its retained outcome under Custom reports before arranging another send after an interrupted attempt. Local/demo sends are suppressed. Reports and outcomes are included in the complete archive.

Family model analysis stays off unless the owner configures the model and `AI_TRAINING_PROHIBITED=true`. Set that declaration only after the configured provider is contractually prohibited from training on the submitted contract texts. Owner consent to each exact family snapshot is still required. The deployment declaration records the contractual prerequisite; it cannot inspect or enforce a provider contract.

Family analysis additionally requires a committed passing REVIEW-006 live evaluation for the exact provider, model and shipped prompt. None is shipped. The owner-supplied counsel-labelled held-out set is unavailable, so model analysis remains blocked even when enabled and covered by a provider training prohibition. Deployment flags never waive this prerequisite.

AGENT-001 and AGENT-002 use the shared installation mail door. Select Postmark explicitly with MAIL_PROVIDER=postmark and MAIL_API_KEY; their old dedicated server-token setting does not select a provider. Resend remains supported through the same door. Existing scheduled legal notices still require their Resend signing configuration and verified delivery callbacks; selecting another provider does not invent delivery proof.

Supplier performance reports require the assigned agreement owner's explicit source consent and counsel's exact signed metric and credit formula. For optional Linen ticket reads, configure private LINEN_ORIGIN and LINEN_MCP_TOKEN for that installation's owner-minted integration principal with only work.read, work.get and the selected queue grants. Locket reads only the explicitly authorized record IDs; it does not discover tickets, read attachments or modify the source. Original MCP projections may include conversation and identity data, so the consent covers their retention as agreement evidence under the existing original-file custody rules. Missing timestamps remain unknown. Linen closure does not establish contractual resolution or delivery, and its unreconstructible business calendar is not treated as wall-clock performance.

## Release and security review

Run `node scripts/security-questionnaire.mjs` to compare the enabled-build
deployment bindings with the subprocessor response inventory in
`security/questionnaire.json`. Optional connectors are included even when
disabled. Buyers must additionally review owner-configured endpoint destinations
and contracts; this declaration does not inspect an external provider contract.
The response covers data flows, encryption, access, audit, backup, incident
response, vulnerability handling and the buyer responsibility split. It provides
procurement domain answers for SIG Lite and CAIQ review, with no certification
claim and no claim to reproduce or complete the official licensed question sets.

Run `node scripts/release-history.mjs` with repository read access. It reads
published releases, verifies their tags still exist, and reads published security
advisories. It refuses any release gap above thirty-one days, including the
current trailing gap. For each published advisory, record its identifier,
`fixedRelease` tag and merged fix pull-request number as `ghsa`,
`fixedRelease` and `pull` in `security/security-fixes.json`.
The check obtains merge timestamps from GitHub and refuses missing provenance,
mismatched advisory patched versions and publication after seven days.
An empty advisory list does not constitute a security assurance claim.

The pinned CLI has no update verb. No automatic export-before-update or tested
previous-release transition is claimed by these checks. Export and verify a
complete archive before applying a deployment change; hosted export remains
unsupported by the pinned CLI. OPS-001 remains partial.


## Hosted delivery

The source-owned policy in `packaging.json` packages the real Worker build and
all unchanged SQL migrations. Run `pnpm run build`, `pnpm delivery:spec` and
`pnpm check:deployment-spec` before packaging with
`node scripts/delivery/base/cli.mjs package --config packaging.json --output rer-package`.
The committed descriptor binds the exact setup manifest; the committed deployment
specification is checked for freshness during hosted verification.

Managed hosting assigns the `rer` mail provider, sender, relay URL and private
installation credential. Assisted hosting asks for the selected Resend,
SendGrid, Cloudflare or Postmark settings. Local development suppresses mail.
The relay supports one recipient and ordinary text or HTML messages; it refuses
attachments, reply-to, carbon copies and unsupported headers. Workflows that need
those features require a direct provider with the corresponding capabilities.
A configured provider is not proof of a live delivery or legally effective notice.
Retain a complete export and the previous source before an update. Follow the
recovery instructions above, restore only into empty resources and compare a
fresh re-export before directing traffic to the restored installation.
