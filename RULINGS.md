# Locket rulings

Rulings preserve their recorded scope. RL-1, RL-5 and RL-6 are reserved withdrawn labels: the source notes were pending requests, not rulings. Their correction and original text are recorded in CHANGELOG.md; those labels will not be reused. Agent decisions are interpreted through company policy under the RER contract standard of 28 October 2026.

### RL-2 — Groups, departments and field-level access

Date: 2026-10-23 · Ruled by: ct · Governs: `REPO-009`.

Policy approved by ct on 23 October 2026 at 11:28Z and reaffirmed on 24 October at 17:06Z: owner and counsel retain full access; unmatched readers are denied; only the owner manages visibility and field policy and classification.

Transferred from the old contract record; implementation and evidence remain independently judged.

### RL-3 — Internal and external sides of a negotiation

Date: 2026-10-22 · Ruled by: ct · Governs: `NEG-005`.

ct (22 Oct 2026, 854aeca) approves the owner/counsel explicit-designation and plain-rendition boundary.

Transferred from the old contract record; implementation and evidence remain independently judged.

### RL-4 — Counterparty exchange by email and secure link

Date: 2026-10-22 · Ruled by: ct · Governs: `NEG-006`.

Authority and disclosure (ct 22 Oct 2026): only owner or counsel initiates sharing.

Transferred from the old contract record; implementation and evidence remain independently judged.

### RL-7 — SSO and SCIM provisioning

Date: 2026-10-23 · Ruled by: ct · Governs: `INT-003`.

Identity policy approved by ct on 23 October 21:00Z.

Transferred from the old contract record; implementation and evidence remain independently judged.

### RL-8 — Personal-data erasure with legal hold

Date: 2026-10-22 · Ruled by: ct · Governs: `ERASE-001`.

Authority and retention (ct 22 Oct 2026).

Transferred from the old contract record; implementation and evidence remain independently judged.

### RL-9 — Invoices reconciled against signed terms

Date: 2026-10-22 · Ruled by: ct · Governs: `AGENT-001`.

Designated authority and exact supplier-message consent approved by ct on 22 October 21:45Z

Transferred from the old contract record; implementation and evidence remain independently judged.

### RL-10 — Service levels and supplier performance

Date: 2026-10-22 · Ruled by: ct · Governs: `AGENT-002`.

ct approved 22 October 22:40Z and 23 October 00:35Z; immutable source evidence, unknowns, named approvals and installation mail enforced

Transferred from the old contract record; implementation and evidence remain independently judged.

### RL-11 — Exceptions become measured playbook changes

Date: 2026-10-22 · Ruled by: ct · Governs: `AGENT-007`.

ct approved 22 October 21:45Z; proposal-only output, counsel future scope, unknown timing and pinned history enforced

Transferred from the old contract record; implementation and evidence remain independently judged.

### RL-101 — Public API, webhooks, Zapier and Crank

Date: 2026-10-28 · Ruled by: ct · Governs: `INT-002`.

**Question.** May scoped integration tokens expire with the creator’s session while longer-lived automation remains unfinished?

**Proposed/adopted default.** Signed-in-owner issuance, explicit native-door scopes, maximum thirty days, creator-session termination, no minting or automatic outbound action.

**Outcome: adopt with rider.** Approve the bounded owner-session token as an explicitly labelled short-lived delegated credential, intersected with current native rights and immediately unusable on revocation or creator-session end; it cannot mint another credential.

**Why.** Ironclad uses OAuth bearer credentials and separately managed integration tokens. No common norm establishes session-coupled thirty-day machine tokens; this is a safe initial credential type, not a substitute for the required automation/API product.

**Rider.** Token settings must show scopes, expiry, issuer and stopped reason without showing a retained secret; preserve durable scoped service/integration authorization, signed hooks/retries/delivery logs and full command coverage as required work.

**Place once.** INT-002 owns token lifecycle acceptance; cite Base credential custody once.

**Incumbent/source behavior.**

- [Ironclad primarily authenticates API bearer tokens with OAuth 2.0.](https://developer.ironcladapp.com/reference/authentication-api)
- [Ironclad labels integration tokens, shows the secret at creation and supports deletion or regeneration; it does not document session-coupled thirty-day tokens here.](https://support.ironcladapp.com/hc/en-us/articles/19066546502935-Manage-Ironclad-Authorization-Tokens)

**Engineering/proof distinction.** Partner app publication may need owner accounts and remains reserved; in-repository trigger tests and webhooks are ordinary engineering.

Main reference: `CONTRACT.md:630` at `9f218efd95ae71650c2a66f146a228e6466332b5`; current Status Gap was read in full. Route: `round`.

### RL-102 — Slack, Microsoft Teams and Nook intake and updates

Date: 2026-10-28 · Ruled by: ct · Governs: `INTAKE-005`.

**Question.** May chat intake and notifications require exact authenticated identity and a complete authorized human conversation audience?

**Proposed/adopted default.** Owner-only mapping; all human members mapped current full-field readers; authenticated Slack bot excluded; incomplete membership/digest withholding.

**Outcome: adopt with rider.** Approve exact provider-to-native identity mapping and generic authenticated-link messages only when every current human audience member has required record/field access; withhold on incomplete membership or unavailable requested digest delivery.

**Why.** Ironclad Slack uses administrator installation, email-linked OAuth identity, personal notification settings and native workflow permission checks. No common norm promises Locket’s complete-channel membership proof; it is a deliberate protection against restricted-record disclosure.

**Rider.** Exclude only the verified app’s own authenticated bot from the human audience; other bots/apps need explicit handling and grant no identity shortcut. Mapping administration can later be delegated by explicit integration-admin rights; staff intake remains attributed to the actual mapped person.

**Place once.** INTAKE-005 cites NOTIFY-001 for shared consent/digest/outcome controls and owns one audience-authorization point.

**Incumbent/source behavior.**

- [Ironclad administrators install Slack; each user controls notifications and OAuth email identity preserves native workflow access.](https://support.ironcladapp.com/hc/en-us/articles/14647023880983-Integration-with-Slack-Overview)

**Engineering/proof distinction.** Nook NOOK-063, Teams/Nook intake, watcher lifecycle and batching remain receiving-service/build work.

Main reference: `CONTRACT.md:120` at `9f218efd95ae71650c2a66f146a228e6466332b5`; current Status Gap was read in full. Route: `round`.
