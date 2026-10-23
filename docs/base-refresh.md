# Refreshing Locket's Base copies

Locket pins rer 0.2.79. The refresh uses Base tag `rer-v0.2.79`
(`4280971d7c0295b8a88c3e1179048efcbbe14f30`). The reconciliation command comes
from Base `fec4051542cc2f2b1b5efd0f2f2028b5dd1c2818`, which added explicit adaptations.
This package-mode seed does not vendor the authoring CLI: run
`node /path/to/base/edition-authoring/cli.mjs` from the Locket root in place of
`node scripts/edition-authoring/cli.mjs` in the upstream examples below.

Three files retain their original Base baseline: `src/mail.server.mjs`
(Postmark delivery), `src/server.dev.ts` (branded local sign-in), and
`migrations/core/0001_owner.sql` (already-applied schema). Declare them with
`adapt-base` before `refresh-base`, and keep their bytes unchanged. Migration
0068 carries Base's scheduled-policy and last-sign-in schema changes; migration
0069 carries the dependency-key sealing fields. Neither new migration is a
refreshable copy. Do not re-baseline 0001: `rer check` SC-05 verifies its historical
bytes. Its upstream conflict note intentionally remains visible.

The following adaptation instructions are copied from
[Base edition-authoring/README.md](https://github.com/runeditrun/base/blob/fec4051542cc2f2b1b5efd0f2f2028b5dd1c2818/edition-authoring/README.md).

**Keep seed adaptations.** Before refreshing, explicitly declare each adapted file:

```sh
node scripts/edition-authoring/cli.mjs adapt-base .github/workflows/run-demo.yml
node scripts/edition-authoring/cli.mjs adapt-base public/fonts/fonts.css
node scripts/edition-authoring/cli.mjs adapt-base src/base/dispatch.ts
node scripts/edition-authoring/cli.mjs adapt-base src/base/font-head.ts
node scripts/edition-authoring/cli.mjs refresh-base FULL_40_HEX_COMMIT --base /absolute/base-checkout
```

`adapt-base <file> [--record <file>]` only accepts an existing regular recorded
file. It keeps local bytes and mode unchanged, and adds `adapted: {"local/path":
"ORIGINAL_FULL_BASE_COMMIT"}` and `acknowledged: {"local/path":
{"sha256": "SHA256_OF_LOCAL_BYTES", "mode": "100644"}}` to that copy (`100755`
for an executable file). The existing `files` digest and
`modes` entry remain the Base baseline at this per-file commit, even when the
copy's other files move to a newer revision. Repeating the declaration does not
advance that baseline. Commit the record alongside the adaptation.

The acknowledgement records those local bytes and mode. With that snapshot
unchanged, a later change to either makes `refresh-base` refuse the entire refresh
before writing any file or record. `verify-base` exits nonzero and
reports `adaptation-modified` or `adaptation-mode` with the file and a runnable
`acknowledge` command, including `--record` when needed. Review the change, then
run `adapt-base <file>` again to update the local snapshot. This keeps the original
Base baseline and upstream conflict notes. Older declarations without an
`acknowledged` snapshot remain readable, but report `adaptation-unacknowledged`
and block refresh until the same explicit re-acknowledgement; neither command
automatically accepts the current bytes.

The record is plain data in the owner's repository, under the owner's control.
Its acknowledged snapshot guards against accidental later drift in a declared
file's digest or mode; it is not tamper-evident. A hand edit to the record that
supplies a digest and mode matching the current file is treated as acknowledged
by `verify-base` (online or offline) and `refresh-base`, just like running
`adapt-base`. Both are the same owner trust act. Review record diffs in code
review like source diffs, alongside the adaptations they acknowledge.

Refresh never writes or removes declared adaptations, including when Base deletes
the source. It still refreshes every untouched copy. Its `adapted` report lists
each seed-owned file; `conflict: true` means upstream bytes, mode or existence
changed against the original baseline. A conflict note supplies a Git diff hint
for explicit reconciliation. The note remains visible on repeated refreshes until
you reconcile the baseline; it does not prevent other copies from refreshing.
A second refresh to the same commit leaves the record and local file bytes
unchanged. Undeclared local edits that differ from both the recorded and incoming
Base bytes still block before any file is written, with an instruction naming
`adapt-base`.

`verify-base` reports declarations separately: it checks their existence,
regular-file status, acknowledged local bytes and mode, and retained Base
baselines. `--offline` checks the local acknowledgement but cannot
validate the upstream baseline. Run the edition's product tests for adaptations.
For richer source comparisons, use `edition.json` origins and mappings with
`compare` instead.

To return a copy to verbatim management, save the seed adaptation somewhere safe,
restore its files and modes from the desired Base commit (including deletions),
then run `record-base <copy-path> <origin-path> <commit> --base <checkout>`.
This explicitly replaces that copy's declarations with a fresh verbatim record;
redeclare any other adaptations in the same copy before refreshing. Verify and
run edition tests before committing. To retain a reconciled adaptation against a
new baseline, record that Base baseline first, restore the saved adaptation, and
run `adapt-base <file>` again. Never update a previously applied migration in
place: keep it and add a new seed migration for schema changes.
