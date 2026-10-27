# Contract status claims

Generated from CONTRACT.md. These source claims retain every named gap and require their recorded publication gates.

| Clauses | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Published | 19 | 0 | 0 | 19 |
| Target and push further | 45 | 20 | 17 | 82 |
| All | 64 | 20 | 17 | 101 |

| Clause | Title | Kind | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| `REPO-001` | Import a legacy agreement | published | done | [Source evidence](CONTRACT.md#status) |  |
| `INTAKE-001` | Capture a request | published | done | [Source evidence](CONTRACT.md#status) |  |
| `DRAFT-001` | Use an approved template | published | done | [Source evidence](CONTRACT.md#status) |  |
| `PLAY-001` | Maintain the clause playbook | published | done | [Source evidence](CONTRACT.md#status) |  |
| `NEG-001` | Negotiate in versions | published | done | [Source evidence](CONTRACT.md#status) |  |
| `REVIEW-001` | Record review findings | published | done | [Source evidence](CONTRACT.md#status) |  |
| `APPROVE-001` | Approve the exact version | published | done | [Source evidence](CONTRACT.md#status) |  |
| `SIGN-001` | Prepare for signature with any provider | published | done | [Source evidence](CONTRACT.md#status) |  |
| `EXEC-001` | Record and reconcile execution | published | done | [Source evidence](CONTRACT.md#status) |  |
| `TERMS-001` | Confirm terms and obligations | published | done | [Source evidence](CONTRACT.md#status) |  |
| `RENEW-001` | Work the renewal queue | published | done | [Source evidence](CONTRACT.md#status) |  |
| `PORT-001` | Search, export and restore | published | done | [Source evidence](CONTRACT.md#status) |  |
| `ROLE-001` | Six roles enforced on the server | published | done | [Source evidence](CONTRACT.md#status) |  |
| `SEC-001` | Writes recheck session, role and version atomically | published | done | [Source evidence](CONTRACT.md#status) |  |
| `SEC-002` | Retried commands return their first outcome | published | done | [Source evidence](CONTRACT.md#status) |  |
| `ACCESS-001` | Restricted agreements are invisible to others | published | done | [Source evidence](CONTRACT.md#status) |  |
| `FILE-001` | Originals keep their exact bytes | published | done | [Source evidence](CONTRACT.md#status) |  |
| `PROPOSE-001` | Agents prepare, people approve | published | done | [Source evidence](CONTRACT.md#status) |  |
| `MOVE-001` | DocuSign archive move-in | published | done | [Source evidence](CONTRACT.md#status) |  |
| `INTAKE-002` | Configurable request forms and routing | target | done | [Source evidence](CONTRACT.md#status) |  |
| `INTAKE-003` | Email intake | target | missing | [Source evidence](CONTRACT.md#status) | No inbound email path exists |
| `INTAKE-004` | CRM intake and status writeback: Salesforce, HubSpot and Orbit | target | missing | [Source evidence](CONTRACT.md#status) | No CRM connector exists |
| `INTAKE-005` | Slack, Microsoft Teams and Nook intake and updates | target | partial | [Source evidence](CONTRACT.md#status) | Teams and Nook intake; Nook status delivery requires its NOOK-063 API; watcher subscriptions and complete lifecycle coverage; chat digest batching. Pending ct approval of owner-only exact identity mapping, complete human audience authorization, authenticated Slack bot exclusion, and withholding when membership or digest delivery is unavailable. |
| `INTAKE-006` | Request queue, assignment and service levels | target | done | [Source evidence](CONTRACT.md#status) | None for current doors; SIGN-002&#47;003 inherit actual provider void; future creation doors inherit queue snapshots |
| `INTAKE-007` | Third-party paper read at intake | target | partial | [Source evidence](CONTRACT.md#status) | Built-in extraction does not exist |
| `REPO-002` | PDF text and OCR | target | partial | [Source evidence](CONTRACT.md#status) | PDF text extraction and OCR do not exist |
| `REPO-003` | Bulk repository import with extraction | target | partial | [Source evidence](CONTRACT.md#status) | Generic PDF&#47;DOCX bulk import, OCR, extraction and large-file streaming do not exist |
| `REPO-004` | Built-in term and metadata extraction | target | partial | [Source evidence](CONTRACT.md#status) | Built-in extraction does not exist; native custom metadata ships under REPO-005 |
| `REPO-005` | Custom metadata fields | target | done | [Source evidence](CONTRACT.md#status) |  |
| `REPO-006` | Search and structured filters | target | done | [Source evidence](CONTRACT.md#status) | Current capabilities conform; REPO-002&#47;004&#47;005&#47;009 and RENEW-007 inherit expanded rendition, field and lifecycle search before shipping |
| `REPO-007` | Saved views and columns | target | done | [Source evidence](CONTRACT.md#status) |  |
| `REPO-008` | Agreement families | target | done | [Source evidence](CONTRACT.md#status) |  |
| `REPO-009` | Groups, departments and field-level access | target | done | [Source evidence](CONTRACT.md#status) | REPO-012 supplies approved redacted renditions; REPO-013 supplies exceptions, per-group hiding, hidden-field submission, access review, privileged notes and policy and classification diffs. INT-002 inherits future connector and webhook payload checks; ERASE-001 retains legal-hold custody |
| `REPO-010` | Counterparty records | target | done | [Source evidence](CONTRACT.md#status) |  |
| `REPO-011` | Bulk repository actions | target | done | [Source evidence](CONTRACT.md#status) | None for current repository metadata, access and files; REPO-012&#47;013 and INT-002 inherit current checks |
| `REPO-012` | Redacted renditions | target | done | [Source evidence](CONTRACT.md#status) | None; files and searchable text are human-produced and counsel-approved, never automatically redacted |
| `REPO-013` | Access exceptions, review and hidden-field work | target | done | [Source evidence](CONTRACT.md#status) | None; existing restricted custody, field hiding and bulk guards remain in force |
| `DRAFT-002` | Word documents from templates | target | done | [Source evidence](CONTRACT.md#status) | None for current source-field&#47;optional-paragraph&#47;manual line-item doors; INTAKE-004&#47;LINK-003 inherit the validated line-item door and SIGN-005 retains signature-field placement. |
| `DRAFT-003` | Clause library in negotiation | target | done | [Source evidence](CONTRACT.md#status) |  |
| `DRAFT-004` | Templates authored from existing Word documents | target | done | [Source evidence](CONTRACT.md#status) | Current main-document plain-text fields and whole-paragraph optionals; unsupported active&#47;tracked&#47;externally linked source packages are explicitly refused |
| `PLAY-002` | Playbooks drafted from templates and history | target | missing | [Source evidence](CONTRACT.md#status) | Playbooks are authored by hand only |
| `NEG-002` | Word tracked changes round-trip | target | partial | [Source evidence](CONTRACT.md#status) | Licensed Word opening proof unavailable; structural revisions, text boxes and non-main-story revisions explicitly refused; plain rendition never satisfies this clause |
| `NEG-003` | Locket for Word add-in | target | missing | [Source evidence](CONTRACT.md#status) | No Word add-in exists |
| `NEG-004` | Browser redlining and threaded comments | target | done | [Source evidence](CONTRACT.md#status) |  |
| `NEG-005` | Internal and external sides of a negotiation | target | partial | [Source evidence](CONTRACT.md#status) | ct (22 Oct 2026, 854aeca) approves the owner&#47;counsel explicit-designation and plain-rendition boundary. Gap: format-preserving outgoing Word files (NEG-002) and Gmail&#47;Outlook sends (NEG-006) must apply the same internal-content stripping and warning before they ship; a plain rendition never satisfies NEG-002. |
| `NEG-006` | Counterparty exchange by email and secure link | target | partial | [Source evidence](CONTRACT.md#status) | Sending through the person’s connected Gmail or Outlook remains blocked on owner mail-account authorization. Original-format round-trip stays with NEG-002. Separate server-generated link and inbound-only reply capabilities now ship; legacy reply addresses require a fresh exchange. No live mail-account receipt is claimed. This round passed real component browser proof against Worker and D1 at 1440 and 390; native rer startup failed and is not claimed as passing. |
| `REVIEW-002` | Built-in playbook review | target | partial | [Source evidence](CONTRACT.md#status) | The built-in model run does not exist |
| `REVIEW-003` | AI redlines a person edits before sending | target | done | [Source evidence](CONTRACT.md#status) | None for accepted review-proposal redlines; REVIEW-002&#47;005&#47;006 retain built-in live model evaluation. |
| `REVIEW-004` | Ask the repository | target | missing | [Source evidence](CONTRACT.md#status) | No question answering exists |
| `REVIEW-005` | Model choice, records and switch-off | target | done | [Source evidence](CONTRACT.md#status) | None for REVIEW-005. REVIEW-006 retains labeled datasets, live evaluation generation, qualification and populated live-result display; simulation never supplies live evaluation evidence. |
| `REVIEW-006` | Live accuracy evidence for every AI and OCR task | target | missing | [Source evidence](CONTRACT.md#status) | No evaluation command, labeled set or recorded live run exists |
| `REVIEW-007` | Plain-English summary of one agreement | target | done | [Source evidence](CONTRACT.md#status) |  |
| `APPROVE-002` | Conditional approval rules in USD | target | done | [Source evidence](CONTRACT.md#status) | None for current doors; APPROVE-003&#47;SIGN-005 inherit frozen rules and current authority&#47;order checks |
| `APPROVE-003` | Approve where people work | target | done | [Source evidence](CONTRACT.md#status) | None |
| `APPROVE-004` | Approval reminders and escalation | target | done | [Source evidence](CONTRACT.md#status) |  |
| `SIGN-002` | Live Docusign, Adobe Acrobat Sign and Dropbox Sign | target | partial | [Source evidence](CONTRACT.md#status) | OAuth, developer-account live sandbox receipts, verified callbacks, correction, provider reminders and provider voiding remain unproved; SIGN-005 packet transports alone do not complete this clause |
| `SIGN-003` | Inkwell signing | target | missing | [Source evidence](CONTRACT.md#status) | BLOCKED: Inkwell public machine-send&#47;manage and signed outgoing completion events are absent at 6c4638762028477f6ddba6b6bd8fc18ad2fcbb04; requires the Inkwell seed before automatic signed PDF&#47;certificate retrieval can complete |
| `EXEC-002` | Automatic retrieval and filing of executed agreements | target | done | [Source evidence](CONTRACT.md#status) |  |
| `SIGN-004` | Clickwrap acceptance of published terms | target | done | [Source evidence](CONTRACT.md#status) |  |
| `SIGN-005` | Signer rules, signature fields and multi-document packets | target | done | [Source evidence](CONTRACT.md#status) | None for the network-edge packet acceptance. Live provider sending&#47;callbacks and sandbox receipts remain SIGN-002&#47;SIGN-003. |
| `OBL-001` | Obligation extraction, owners and status | target | partial | [Source evidence](CONTRACT.md#status) | Built-in extraction, status values beyond done and owner lists do not exist |
| `OBL-002` | Fulfillment evidence and escalation | target | done | [Source evidence](CONTRACT.md#status) |  |
| `RENEW-002` | Delivered reminders and escalation by email | target | done | [Source evidence](CONTRACT.md#status) |  |
| `RENEW-003` | Deadlines on Google Calendar and Outlook | target | partial | [Source evidence](CONTRACT.md#status) | Person OAuth, own&#47;team scopes, obligation events, both-provider decision completion and live Workspace&#47;Microsoft 365 proof |
| `RENEW-004` | Bulk reminders for imported contracts | target | done | [Source evidence](CONTRACT.md#status) |  |
| `RENEW-005` | Renewal briefs and renewal workflows | target | done | [Source evidence](CONTRACT.md#status) | None for current fixed&#47;auto-renewing terms; RENEW-007 inherits expanded types&#47;history; LINK-001 retains wider accounting scope |
| `RENEW-006` | Send approved notices with delivery evidence | target | done | [Source evidence](CONTRACT.md#status) |  |
| `RENEW-007` | Auto-renewal roll-forward and lifecycle status | target | done | [Source evidence](CONTRACT.md#status) | None |
| `LINK-001` | Accounting links: Pantry, QuickBooks Online and NetSuite | target | partial | [Source evidence](CONTRACT.md#status) | The full LINK-001 target remains unproved for proposed scheduled bills and invoice reminders in QuickBooks Online and NetSuite; the current outbound door targets Pantry only. Prove destination changes and effective loss of field authority through the provider outcome write, beyond the asserted session, role, source and field-policy revision cases. Retain the proved three-provider reads, exact USD allocation, positive unmatched amounts and ambiguous due dates, monthly supplier and customer proposals, independently asserted quarterly and annual supplier preparation dates with clamping, unchanged retained snapshot content after failed reads, separate per-occurrence consent, pending acceptance, guarded attributed accounting consent and outcome history, populated accounting erasure and legal holds, and no uncertain resend. The complete original target and every inherited duty remain owed. |
| `LINK-002` | Procurement links: Purse and Coupa | target | missing | [Source evidence](CONTRACT.md#status) | No procurement connection exists |
| `LINK-003` | Proposal and billing handoffs: Platter and Nectar | target | partial | [Source evidence](CONTRACT.md#status) | Successful Nectar handoff with separately preserved differing initial and renewal terms remains an original LINK-003 obligation, blocked by the receiving setup protocol and subsequent Locket integration and end-to-end evidence. Nectar must preserve and validate both terms in its pending setup proposal and expose matching destination readback before a billing person activates it. Until supported, Locket must refuse before sending without equalizing, omitting or inferring either term, silently changing destination, or treating refusal as success. Prove complete matching Nectar readback; exact displayed-payload consent; execution, signed-source digest, destination-account and connection-revision bindings; prepared-handoff staleness and withdrawn consent; current authority through outcome recording; uncertain Nectar no-resend behavior; attributed decision history, restricted custody, archives, erasure and legal holds; and connected proposal pricing through the validated Word line-item door. Record the billing review, consent and outcome screens at 1440 and 390. Retain gaps for PandaDoc quote-builder, ambiguous adjustments and multiple-choice sections; Stripe arrears, taxable prices and nonzero renewal uplifts; and applicable live-provider evidence. Preserve every previously approved provenance, consent, authority, staleness and uncertainty rule. This dependency transfers or waives no acceptance obligation. LINK-003 remains partial. |
| `INT-001` | Google Drive, OneDrive&#47;SharePoint and Chest | target | missing | [Source evidence](CONTRACT.md#status) | No storage connection exists |
| `INT-002` | Public API, webhooks, Zapier and Crank | target | partial | [Source evidence](CONTRACT.md#status) | Signed outgoing webhooks, retries, delivery log, in-repository Zapier and Crank trigger tests and token settings UI remain unfinished at the cloud budget. Partner app publication requires owner accounts. Conservative default ADOPTED pending ct: only the signed-in owner creates explicitly scoped tokens; tokens expire within thirty days, inherit all native access checks, cease with the creator session and cannot mint more tokens. No automatic outbound action is enabled. |
| `INT-003` | SSO and SCIM provisioning | target | done | [Source evidence](CONTRACT.md#status) | Identity policy approved by ct on 23 October 21:00Z. Signed Okta network-edge fixture; other named providers use the native OIDC or configurable signed SAML door without a live-provider claim |
| `INT-004` | Connection health | target | partial | [Source evidence](CONTRACT.md#status) | Verified acting identities and read-only probes for Nook, Inkwell, scoped Uptime and Linen, and mail transports other than Resend and Postmark remain unproved; Resend sender-domain verification does not establish its acting-account identity; automatic chat membership-read and callback health coverage and expiry discovery beyond HubSpot remain unproved. |
| `NOTIFY-001` | Notifications and preferences | target | done | [Source evidence](CONTRACT.md#status) |  |
| `US-001` | US defaults | target | done | [Source evidence](CONTRACT.md#status) |  |
| `AUDIT-001` | Filterable activity audit trail | target | done | [Source evidence](CONTRACT.md#status) |  |
| `ERASE-001` | Personal-data erasure with legal hold | target | done | [Source evidence](CONTRACT.md#status) |  |
| `ENTITY-001` | Our contracting entities | target | done | [Source evidence](CONTRACT.md#status) |  |
| `OPS-001` | Self-hosted install, updates and security answers | target | partial | [Source evidence](CONTRACT.md#status) | Fresh Cloudflare deployment and the exact previous-release update, migration, record preservation, private R2 backup and removal journey remain unproved. Live proof is blocked on a verified outbound mail sender and credential or an approved Auth SSO installation: none of the 66 RunEditRun account zones had an enabled Cloudflare Email Sending sender on 26 October 2026. The authoritative current 2026 SIG Lite workbook, revision and exact question identifiers and text require licensed access; the public historical 2019 mapping does not complete it. No certification is claimed. |
| `REPORT-001` | Cycle time, throughput and bottlenecks | target | done | [Source evidence](CONTRACT.md#status) | None for observed native request workflows; pre-existing stage&#47;SLA starts remain explicitly unknown |
| `REPORT-002` | Custom and scheduled reports | target | done | [Source evidence](CONTRACT.md#status) |  |
| `REPORT-003` | Portfolio dashboard | target | done | [Source evidence](CONTRACT.md#status) |  |
| `MOBILE-001` | Phone-width web app | target | done | [Source evidence](CONTRACT.md#status) |  |
| `MOBILE-002` | iOS and Android apps | target | missing | [Source evidence](CONTRACT.md#status) | No native apps exist |
| `MOVE-002` | Ironclad move-in | target | missing | [Source evidence](CONTRACT.md#status) | Only the DocuSign kit exists |
| `MOVE-003` | Icertis and Agiloft move-in | target | missing | [Source evidence](CONTRACT.md#status) | No Icertis or Agiloft kit exists |
| `MOVE-004` | SpotDraft and Juro move-in | target | missing | [Source evidence](CONTRACT.md#status) | No SpotDraft or Juro kit exists |
| `MOVE-005` | PandaDoc and Adobe Acrobat Sign archives | target | missing | [Source evidence](CONTRACT.md#status) | Only the DocuSign kit exists |
| `MOVE-006` | Ironclad workflows in progress at cutover | target | missing | [Source evidence](CONTRACT.md#status) | No Ironclad workflow import exists |
| `MOVE-007` | Ironclad Clickwrap acceptance history | target | missing | [Source evidence](CONTRACT.md#status) | No clickwrap import exists |
| `AGENT-001` | Invoices reconciled against signed terms | push-further | partial | [Source evidence](CONTRACT.md#status) | BLOCKED on Purse’s new read-only PO-data token door (ct 22 October 21:55Z; not yet shipped); no invented procurement evidence. Rate-card, discount, payment-term, existing-credit and other-provider comparison remain. Designated authority and exact supplier-message consent approved by ct on 22 October 21:45Z |
| `AGENT-002` | Service levels and supplier performance | push-further | done | [Source evidence](CONTRACT.md#status) | ct approved 22 October 22:40Z and 23 October 00:35Z; immutable source evidence, unknowns, named approvals and installation mail enforced |
| `AGENT-003` | Renewal decision to verified notice delivery | push-further | done | [Source evidence](CONTRACT.md#status) |  |
| `AGENT-004` | Authorized renegotiation to an executed amendment | push-further | missing | [Source evidence](CONTRACT.md#status) | No negotiation agent exists |
| `AGENT-005` | Governing terms across a contract family | push-further | partial | [Source evidence](CONTRACT.md#status) | BLOCKED on owner-supplied 100 counsel-labelled held-out agreements and a passing REVIEW-006 live record for the exact provider, model and prompt; evaluated proposals and governing propagation remain unproved |
| `AGENT-006` | Signed document matches the approved version | push-further | partial | [Source evidence](CONTRACT.md#status) | Text&#47;page comparison, signed-text citations and required structured signature&#47;initial-field presence ship; optional&#47;unlabelled or visual&#47;flattened signature and initial detection and OCR remain open |
| `AGENT-007` | Exceptions become measured playbook changes | push-further | done | [Source evidence](CONTRACT.md#status) | ct approved 22 October 21:45Z; proposal-only output, counsel future scope, unknown timing and pinned history enforced |
| `AGENT-008` | Obligation remediation to verified evidence | push-further | done | [Source evidence](CONTRACT.md#status) | None |
| `AGENT-009` | Missed obligations and avoidable spend report | push-further | done | [Source evidence](CONTRACT.md#status) | None for existing sources; recovered amounts remain explicitly unconfirmed and wider accounting sources belong to LINK-001. |
