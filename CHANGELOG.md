# Changelog

## 0.1.4

Locket 0.1.4 is the first release since 0.1.3 to come from main: it carries everything built since, on rer 0.2.134.

- **Connections report their health.** Accounting and calendar connections are monitored through native operations, provider credential expiry is discovered and warned about before it lapses, and signing connection outcomes are observed.
- **Redacted renditions and access exceptions.** Counsel-approved redacted renditions, reasoned repository access exceptions, field custody and access audit diffs.
- **Accounting and execution.** Accounting schedules, confirmed allocation, retained bills compared with the recorded contract value, and execution retrieval from Acrobat and Dropbox under exact owner consent, with separately authorized follow-ups.
- **Agents and models.** Model settings with provenance and monthly usage, cited version-pinned agreement summaries, the signed Business agent door, and per-agent MCP request capacity.
- **Imports.** Enterprise imports and reviewed Ironclad move-in. Imports run on D1 again: the import SQL no longer builds a function call with more than 32 arguments, which D1 refuses.
- **Mail-off Business deployments** are supported, with helpers declared for TypeScript callers.
- **The hosted demo redeploys on each published release.**

### Upgrading from 0.1.3

Back up your data and source changes and exercise a restored copy before adopting. Update to `v0.1.4` and use the same environment and input file for an existing deployment. This release adds 28 forward migrations, 0071 to 0099 (0089 has two files); apply only the ones not yet applied and verify owner sign-in before routing traffic.
