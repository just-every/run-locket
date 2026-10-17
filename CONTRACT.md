# Locket product contract

Target edition: 17 October 2026. Locket is the owned contract lifecycle management (CLM) product a US business buys instead of Ironclad, Icertis or Agiloft, with the AI-first speed buyers now expect from SpotDraft and Juro. It covers the whole job those products sell: intake from where requests start, templates and clause playbooks, Word-compatible negotiation with built-in AI review grounded in the business's own playbook, approvals, integrated signing, a searchable repository fed by OCR and bulk import, and obligations and renewals that are actually followed through, with reminders delivered and outcomes verified.

This is a target contract: it describes the product Locket is being built towards, not only what ships today, so that anyone can see how close the code is. Every clause states what a buyer gets and the acceptance evidence that proves it through a public door (a route, a command, a built page or a browser journey), with fakes only at a paid or network provider edge. [Status](#status) marks each clause `done`, `partial` or `missing` from the code and tests at a recorded commit; [ACCEPTANCE.md](ACCEPTANCE.md) lists the same evidence for build rounds. Local proof is not hosted, provider, legal or real-owner acceptance. This documentation round changes no homepage, interface or runtime behaviour.

## Product target

| | |
| --- | --- |
| Category | Contract lifecycle management (CLM) |
| Incumbents a buyer switches from | Ironclad, Icertis, Agiloft |
| Up-and-comers it must also beat | SpotDraft, Juro |
| First buyer | A US operations or legal lead at a 25–250 person business managing customer and supplier contracts: values in USD, deadlines in US time zones, an existing Docusign or Adobe Acrobat Sign account, Salesforce or HubSpot as CRM, Google Workspace or Microsoft 365, and the buyer's own Cloudflare account |
| What switching means | Their repository arrives with original files, parties, dates, renewal terms and values extracted and cited; every daily job (request, draft, negotiate in Word, review, approve, sign, track, renew, report) has a Locket equivalent; their CRM, signing provider, chat, storage, calendar, accounting and procurement systems plug in; and deadlines are delivered to people rather than waiting in a queue |

A buyer replacing an incumbent needs the whole job, so the target is the whole job:

- **Request.** Configurable request forms, email intake, CRM intake from Salesforce, HubSpot and Orbit, Slack, Microsoft Teams and Nook intake, a visible queue with owners and service levels, and third-party paper read on arrival (`INTAKE-*`).
- **Draft.** Approved templates with fields and conditional clauses that produce Word documents, a clause library with fallbacks, template authoring from existing Word files, and playbooks drafted from templates and history for counsel to approve (`DRAFT-*`, `PLAY-*`).
- **Negotiate.** Versions with exact originals, Word tracked changes and comments read and written, a Locket for Word add-in, browser redlining, internal and external sides kept apart, and counterparty exchange by email and secure link (`NEG-*`).
- **Review.** Built-in AI review against the active playbook with cited findings and editable redlines, natural-language questions over the repository with cited answers, and model records and controls (`REVIEW-*`).
- **Approve.** Conditional rules by type, USD value, department and risk, exceptions by the rule's authority, approvals pinned to the exact version, approval from email, chat, Word or phone, and reminders and escalation for pending approvals (`APPROVE-*`).
- **Sign.** Signers chosen by rule with a fallback, signature fields placed from template signature blocks or by a coordinator, multi-document packets, live Docusign, Adobe Acrobat Sign, Dropbox Sign and Inkwell connections with status webhooks and automatic retrieval of signed files and certificates, filing into connected storage, and clickwrap acceptance of published terms (`SIGN-*`, `EXEC-*`).
- **Keep.** A permission-restricted repository fed by OCR and bulk import, extracted and confirmed metadata whose AI and OCR accuracy is proven on a live provider against named labelled sets (`REVIEW-006`), custom fields, search, saved views, bulk edits and CSV round-trips, agreement families and counterparty records (`REPO-*`).
- **Follow through.** Obligations with owners and fulfilment evidence, renewal and notice deadlines delivered by email and calendar with escalation, renewal briefs, and notices sent with delivery evidence (`OBL-*`, `RENEW-*`).
- **Connect and report.** Accounting and procurement links (Pantry, QuickBooks Online, NetSuite, Purse, Coupa), storage (Google Drive, OneDrive/SharePoint, Chest), a public API, webhooks and Zapier and Crank apps, SSO and SCIM, the business's own contracting entities, a self-hosted install with stated updates and security answers, cycle-time and portfolio reporting, phone-width and native apps, and move-in from every named incumbent, including Ironclad workflows still in progress at cutover (`LINK-*`, `INT-*`, `ENTITY-001`, `OPS-001`, `REPORT-*`, `MOBILE-*`, `MOVE-*`).
- **Go further.** Agents that reconcile what was signed with what happens (invoices, service levels, supplier performance), carry authorised renewal, renegotiation or remediation to a verified outcome, and report missed obligations and avoidable spend in USD (`AGENT-*`).

### Neighbouring products stay separate

Locket is one product. Where the market sells a neighbouring product separately, Locket connects to it and does not rebuild it; when the neighbour is a Run Edit Run sibling, Locket links to that sibling first and to the US incumbent second.

| Job | Owned by | How Locket meets it |
| --- | --- | --- |
| Electronic signature, signer identity and certificates | [Inkwell](https://github.com/just-every/run-inkwell) (or Docusign eSignature, Adobe Acrobat Sign, Dropbox Sign) | Live envelope creation, status webhooks and automatic retrieval of signed files and certificates (`SIGN-002`, `SIGN-003`, `EXEC-002`); Locket never creates signature evidence of its own |
| Sales CRM and deal pipeline | [Orbit](https://github.com/just-every/run-orbit) (or Salesforce Sales Cloud, HubSpot Sales Hub) | Request from the deal, status and executed contract written back to it (`INTAKE-004`) |
| Proposals and quotes | [Platter](https://github.com/just-every/run-platter) (or PandaDoc, Proposify) | An accepted proposal becomes a contract request with its pricing (`LINK-003`) |
| Accounting, bills and invoices | [Pantry](https://github.com/just-every/run-pantry) (or QuickBooks Online, NetSuite) | Vendor and customer links, spend to date and payment schedules (`LINK-001`, `AGENT-001`) |
| Procurement and purchase orders | [Purse](https://github.com/just-every/run-purse) (or Coupa, Procurify) | Purchase request to contract request, executed terms activated on the supplier and PO (`LINK-002`) |
| Subscription billing | [Nectar](https://github.com/just-every/run-nectar) (or Stripe Billing, Chargebee) | Executed customer terms handed to billing (`LINK-003`) |
| File storage | [Chest](https://github.com/just-every/run-chest) (or Google Drive, OneDrive/SharePoint) | Import from and file executed agreements into connected folders (`INT-001`) |
| Team chat | [Nook](https://github.com/just-every/run-nook) (or Slack, Microsoft Teams) | Intake, notifications and approvals in chat (`INTAKE-005`, `APPROVE-003`) |
| Workflow automation across apps | [Crank](https://github.com/just-every/run-crank) (or Zapier, Make) | Webhooks, public API and published Crank and Zapier apps (`INT-002`) |
| Workforce identity | [Auth](https://github.com/just-every/run-auth) (or Okta, Microsoft Entra ID) | SAML/OIDC sign-in and SCIM provisioning (`INT-003`) |
| Legal matters, litigation and outside-counsel billing | [Satchel](https://github.com/just-every/run-satchel) (or Clio) | Agreements link to a matter; Locket does not manage matters |
| Service levels delivered and supplier incidents | [Uptime](https://github.com/just-every/run-uptime), [Linen](https://github.com/just-every/run-linen), [HappyToHelp](https://github.com/just-every/run-happytohelp) | Read as evidence for service-level reconciliation (`AGENT-002`) |

## Operating rules

These rules hold for every clause, released and target.

- A new installation starts empty: no sample agreements, parties, templates or playbook. The owner enters or imports real records.
- Every write re-reads the current session and role on the server, in every handler, and repeats the session, role and record-version checks inside the same D1 batch that writes. A changed record, a revoked session or a removed role makes the write fail with nothing saved.
- Uploaded, signed, certificate and imported files keep their exact bytes and SHA-256. Locket never rewrites an original, never re-signs, and never creates a certificate in a provider's name. Imported history stays labelled imported. Word round-trips (`NEG-002`, `NEG-003`) create new versions beside the originals.
- An approval pins the exact version identity (its files' bytes, its text and its populated fields) and the decision context (value, counterparty, review findings). Any change to either makes earlier approvals stop counting, visibly.
- Proposed values (from the built-in model, an agent, an importer, a connector or a person) drive nothing until a person with authority confirms them against the document they cite.
- An approved notice is not a sent notice, and a provider's delivery event is not legally effective service. Sending and delivery are recorded separately with method, time and evidence.
- Connectors fail visibly: a failed sync, webhook, reminder or filing is shown on the record and on the connection (`INT-004`), never dropped.
- Locket organises, prepares, reviews and follows through on agreements. It does not give legal advice, validate signatory authority, or claim any agreement is legally valid or enforceable.

## Released contract

These are the clauses the first release promised. They still hold, rewritten only where the US-first target changed a default (currency and time-zone defaults now live in `US-001`).

### Released flows

- **REPO-001 — Import a legacy agreement.** A person uploads a PDF or DOCX with where it came from and its source ID. Locket keeps the original bytes and SHA-256, the source system and ID, the original filename, who imported it and when, and reads DOCX text. The same bytes or the same source ID cannot be imported twice. *Acceptance:* downloading the stored file and comparing bytes and digest, and the refused duplicates (flow test 01).
- **INTAKE-001 — Capture a request.** A requester records title, request type, counterparty (existing or new), value, responsible person, needed-by and start dates, and whether it is restricted. Each type carries its default required attachments (`US-001`), and more can be added. A request cannot go to review while a required attachment is missing unless owner or counsel waives it with a reason. Amendments and order forms must name their parent agreement. *Acceptance:* the stored request and the refused submission until the attachment is present (flow test 02).
- **DRAFT-001 — Use an approved template.** Owner or counsel author versioned templates with fields and clause wordings, and approve a version for use. A requester can only populate an approved version; required fields must be filled; the chosen clause wording is recorded. A later template version never rewrites a version already produced. *Acceptance:* the refusal of a draft template, the populated text and the unchanged earlier version (flow test 03).
- **PLAY-001 — Maintain the clause playbook.** Owner or counsel keep versioned rules: preferred wording, allowed alternatives and who decides exceptions (counsel or approver). One version is active; each review finding records the playbook version it used. *Acceptance:* activation superseding the earlier version and findings citing it (flow test 04).
- **NEG-001 — Negotiate in versions.** People add our revisions and counterparty markups (PDF or DOCX), compare any two versions line by line, and comment with quoted passages. Originals stay byte-for-byte. A version added against a stale view of the agreement is refused. *Acceptance:* the comparison of two DOCX versions and the untouched downloads (flow test 05).
- **REVIEW-001 — Record review findings.** A reviewer records, against a playbook rule, whether the rule is met, breached or cannot be determined, citing the exact passage by position and quote (checked against the version text), with proposed wording and open questions. Agents submit findings only as proposals. *Acceptance:* the refused mismatched quote and an agent's findings applied only after counsel's approval (flow test 06).
- **APPROVE-001 — Approve the exact version.** Every agreement needs commercial approval (owner or approver); each breached or undetermined finding needs an exception decision by the rule's authority. The requester cannot approve their own request unless they are the owner. Approvals pin version identity and decision context; a new version, a signing PDF or a value change withdraws them and the agreement returns to review. *Acceptance:* the route, the role refusals, and the withdrawal after a new version and after a value change (flow test 07).
- **SIGN-001 — Prepare for signature with any provider.** From an approved version Locket produces the signature-ready PDF (the approved PDF itself; a text PDF for template versions; DOCX versions need the PDF they will be signed as, attached and approved first) and a routing manifest naming version identity, document SHA-256, approvals, provider and ordered recipients. A person can send it through Docusign, Adobe Acrobat Sign, Dropbox Sign, PandaDoc, Documenso, DocuSeal, paper or another route and record the envelope ID; this manual route stays available beside the live connections in `SIGN-002` and `SIGN-003`. *Acceptance:* the downloaded PDF and manifest and the recorded handoff (flow test 08).
- **EXEC-001 — Record and reconcile execution.** The signed PDF and the provider's certificate are recorded (uploaded by a person, or retrieved by `EXEC-002`). Locket reconciles the envelope ID with the handoff, the signers with the package's signers, the document (confirmation and page count) and the certificate's presence. A clean match marks the agreement executed; a mismatch stays unsigned until owner or counsel accepts it with a reason. The same signed file or envelope cannot be recorded twice. *Acceptance:* a reconciled execution, a mismatch held for review, and a refused duplicate (flow test 09).
- **TERMS-001 — Confirm terms and obligations.** People propose effective and end dates, auto-renewal, renewal term, notice period, governing law and payment terms, each citing words from the executed text (or a signed-PDF page when there is no text). Owner, counsel or approver confirm or reject each. Correcting a confirmed term supersedes it and keeps the history. Obligations have an owner, due date and recurrence; they are confirmed and then marked done. *Acceptance:* an agent's terms confirmed by an approver, a correction that keeps the superseded value, and an obligation through to done (flow test 10).
- **RENEW-001 — Work the renewal queue.** Confirmed end date and notice period produce the notice deadline: the end of the deadline day (23:59:59) in the agreement's IANA time zone, including daylight-saving changes. Owner or approver decide renew, renegotiate or terminate; a notice is drafted (by a person or an agent proposal), approved for sending by owner or approver (not by its preparer unless owner), and then recorded as sent with method, time and optional evidence. *Acceptance:* deadlines on both sides of a daylight-saving change and a notice that stays "approved, not sent" until sending is recorded (flow test 11).
- **PORT-001 — Search, export and restore.** People search titles, counterparties, references and version text of the agreements they may access. The owner exports a complete archive of every record and every file's exact bytes and digest. `rer export` and `rer import` restore the whole installation into an empty one, after which the restored owner signs in afresh and continues work, including undoing a restored move-in. *Acceptance:* restricted results hidden from others, the archive's digests, and a fresh-install restore compared record by record and byte by byte (flow test 12 and `tests/portable.mjs`).

### Released safeguards

- **ROLE-001 — Six roles enforced on the server.** Roles are **owner** (everything), **counsel** (library, legal exceptions, restricted agreements, execution mismatches), **approver** (commercial approval, renewal decisions, notice approval), **requester** (requests, versions, attachments, signature handoff), **viewer** (reads) and **agent** (reads and prepares proposals only). The installation's native owner is always owner; other operators are invited through Base sign-in and given a Locket role. *Acceptance:* signed-out and cross-site requests, viewers, agents and demoted approvers refused by the server (security test).
- **SEC-001 — Writes recheck session, role and version atomically.** Every command re-reads the session and role and repeats the session, role and record-version checks inside the D1 batch that writes, so a revoked session, removed role or changed record saves nothing. *Acceptance:* a revoked session and a decision against a stale snapshot both refused with no write (security test).
- **SEC-002 — Retried commands return their first outcome.** Every command carries a command identity. Retrying the same identity and content returns the first outcome; reusing it for different content is refused. *Acceptance:* a retried command returning its first result and a reused identity with new content refused (security test).
- **ACCESS-001 — Restricted agreements are invisible to others.** A restricted agreement and everything attached to it (versions, files, findings, approvals, terms, proposals, counterparty, search hits) is visible only to the owner, counsel, its requester, its responsible person and people explicitly granted access. To anyone else it does not exist. *Acceptance:* an agent-prepared restricted request, counterparty included, hidden from everyone outside it, and restricted search results hidden (security test and flow test 12).
- **FILE-001 — Originals keep their exact bytes.** Uploaded, signed, certificate and imported files are stored with their SHA-256 and served byte-for-byte with the digest in a response header; nothing rewrites an original. *Acceptance:* downloads compared byte for byte with their uploads (flow tests 01, 05 and 09).
- **PROPOSE-001 — Agents prepare, people approve.** An agent is an invited operator with the `agent` role using the same HTTP API ([API.md](API.md)). It prepares proposals with evidence and assumptions: intake details, playbook findings, agreement-family links, extracted terms and renewal notice drafts. Approval runs the same checks as doing the work by hand, records who prepared and who decided, and links the result to the proposal. An agent never approves, signs, sends or confirms anything; nobody may decide a proposal they prepared unless they are the owner. *Acceptance:* agent findings and terms applied only after a person's approval, and agent writes refused (flow tests 06 and 10, security test).
- **MOVE-001 — DocuSign archive move-in.** The DocuSign kit takes an Envelope Report CSV and the downloaded completed envelopes (one folder per envelope ID with the signed PDFs and `Summary.pdf`, the Certificate of Completion). A dry run shows every row's outcome (import, not completed, missing evidence, duplicate), missing certificates and files not in the report, and writes nothing. Applying the exact reviewed dry run creates imported agreements with the signed file and certificate kept byte-for-byte, an imported execution record (never a new signature event), and end date and notice period as proposed terms. The journal keeps the report and every supplied file. An unused batch can be undone; once an imported agreement is used, undo is refused and the history stays. Shape and limits: [IMPORT.md](IMPORT.md). *Acceptance:* dry run, apply with originals, repeated envelopes unchanged, undo, re-import and refused undo once used (move-in test).

## Target clauses

### Intake and requests

#### INTAKE-002 — Configurable request forms and routing.
Owner or counsel design a request form per agreement type without code: fields (text, number, USD money, date, pick list, person, counterparty, file), conditional questions (a supplier contract over $50,000 asks for a security questionnaire), required attachments, and routing rules that assign the responsible person, reviewer and approval route by type, value, department, region and risk answers. A form or rule change is drafted, previewed against sample answers that show the resulting route and required documents, then published as a new version; requests already in flight keep the version they started with. Each form also names who may launch it, by role, group or department (`REPO-009`). Anyone else does not see the form, and a launch through the API is refused.

*Acceptance:* a browser journey creates a supplier form with a conditional security question and a rule routing values over $50,000 to counsel, limits launching to the Procurement group, previews two sample requests (one above, one below the threshold) and sees the two routes, publishes, then submits both requests through the form; an in-flight request created before publishing keeps its original route; a requester outside Procurement does not see the form and their API launch is refused.

*Status:* partial. Typed requests with configurable required attachments ship (`src/locket/agreements.ts`); the form designer, conditional fields, rule-based routing and preview do not exist.

#### INTAKE-003 — Email intake.
Each installation has an intake address (Postmark inbound, or a forwarding rule from a Gmail or Outlook mailbox). An email to it, or a message forwarded by a staff member, becomes a draft request: the sender is matched to an operator, attachments are stored byte-for-byte as the first version and supporting files, and `INTAKE-007` proposes the request details. Mail from unknown senders is held for owner review, never auto-created. Replies on the thread attach to the same request.

*Acceptance:* a Workers journey with a Postmark inbound fake posts a forwarded counterparty MSA with a DOCX and a PDF; a draft request appears for the matched sender with both files and their digests, and proposed details awaiting confirmation. A reply attaches to the same request, and mail from an unknown sender lands in the held queue. A live run against a Postmark inbound stream on a Postmark test server is recorded before the clause is accepted.

*Status:* missing. No inbound email path exists.

#### INTAKE-004 — CRM intake and status writeback: Salesforce, HubSpot and Orbit.
The owner connects Salesforce, HubSpot or Orbit with OAuth. A seller starts a contract request from an opportunity or deal (a Salesforce Lightning action, a HubSpot CRM card, an Orbit deal action); account, contacts, amount in USD and close date populate the request. The deal's products (Salesforce opportunity products, HubSpot line items, Orbit deal lines) come across with product, quantity, unit price, discount and term, and fill the pricing table of the generated order form (`DRAFT-002`). Locket writes the agreement's status, current version link and, on execution, the executed PDF link and key dates back to the deal. Field mappings are visible and editable; a failed writeback is shown on the agreement and the connection (`INT-004`).

*Acceptance:* a Workers journey with a HubSpot API fake and an Orbit fake starts a request from a deal, sees the mapped fields, drives the agreement to executed and reads the deal's status, link and end date written back; a forced 500 on writeback shows a retryable failure on both the agreement and the connection. A deal with three line items produces an order form whose pricing table lists them and totals the deal amount in USD. The same journey runs against a Salesforce fake. Live runs against a Salesforce Developer Edition org and a HubSpot developer test account are recorded before the clause is accepted.

*Status:* missing. No CRM connector exists.

#### INTAKE-005 — Slack, Microsoft Teams and Nook intake and updates.
A `/contract` command or message shortcut in Slack, Microsoft Teams or Nook opens the request form and creates the request as the signed-in person. Request owners and watchers receive status changes, mentions, approval requests and signature completion in a direct message or a chosen channel, each linking to the record. Messages never reveal a restricted agreement to a channel member without access.

*Acceptance:* a journey with a Slack API fake submits a request from the shortcut, receives the approval-needed and executed messages in direct messages, and confirms that a restricted agreement's update is withheld from a channel whose members lack access. The same journey runs against Teams and Nook fakes.

*Status:* missing. No chat connector exists.

#### INTAKE-006 — Request queue, assignment and service levels.
Legal and operations see one queue of open requests with responsible person, assignee, stage, needed-by date, age and the next action, filterable by type, team and status, plus a "my work" view. Assignment rules spread new requests across a team; a person can reassign with a reason. Each type has a service level (for example an NDA turned around in 2 business days); requests close to or past it are flagged and escalated to the team lead.

*Acceptance:* a browser journey at 1440 and 390 pixels creates three requests, sees them assigned round-robin, reassigns one, advances the clock past an NDA's 2-business-day service level and sees it flagged and the team lead notified.

*Status:* partial. Responsible people, a status queue and an attributed activity feed ship (`src/locket/views.ts`, `tests/browser/journey.spec.ts`); assignees, assignment rules, service levels and escalation do not exist.

#### INTAKE-007 — Third-party paper read at intake.
When a counterparty's document arrives (upload, email or CRM), the built-in model (`REVIEW-005`) reads it and proposes the request details: agreement type, counterparty legal name, our entity, value, term, governing law and the template or playbook that applies, each citing the passage it came from. The requester confirms or corrects the proposal before the request is created.

*Acceptance:* a journey with a model-provider fake uploads a supplier's DOCX and a scanned PDF; each yields a cited proposal, a wrong value is corrected before confirmation, and the created request records who confirmed and that the source was a model proposal.

*Status:* partial. External agents can propose intake details for approval (`src/locket/proposals.ts`); built-in extraction does not exist.

### Repository and ingestion

#### REPO-002 — PDF text and OCR.
Every PDF, including scanned and image-only signed copies, gets a searchable text layer with page and position anchors, run asynchronously with progress. A PDF that already carries a text layer is read directly. Scanned and image-only pages go to the OCR provider the owner chooses, with the owner's own credentials: Amazon Textract, Google Cloud Document AI (Enterprise Document OCR) or Azure AI Document Intelligence (Read model). Provider choice and switch-off sit with the model settings (`REVIEW-005`). The original bytes are untouched; the text layer is a derived rendition. Search, citations (`REVIEW-001`, `TERMS-001`) and extraction use it, and a person can see each page's OCR confidence and correct a misread passage, which is kept with history.

*Acceptance:* a journey with an OCR-provider fake uploads a 20-page scanned agreement; the text becomes searchable, a term is cited to page 14, the original downloads with its original digest, and a corrected passage keeps the machine reading in history. The same journey runs against Textract, Document AI and Document Intelligence fakes. The clause is accepted only when a live OCR run under `REVIEW-006` meets the OCR bar with at least one named provider.

*Status:* partial. DOCX text is read (`src/locket/docx.ts`); PDF text extraction and OCR do not exist.

#### REPO-003 — Bulk repository import with extraction.
An owner imports a legacy repository in bulk: a ZIP or folder of up to 10,000 PDF and DOCX files (files up to 50 MB, batches streamed in parts), or a connected Google Drive, OneDrive/SharePoint or Chest folder (`INT-001`), with an optional metadata CSV. Locket deduplicates by digest, runs OCR (`REPO-002`) and extraction (`REPO-004`), infers agreement families, and shows a reconciliation report (imported, duplicate, unreadable, needs review) before anything is used. Extracted parties, dates, renewal terms and USD values stay proposed until confirmed, individually or in bulk by a reviewer who has sampled them. A batch can be undone until any of its agreements is used, like `MOVE-001`.

*Acceptance:* a journey imports a 500-file fixture ZIP with 12 duplicates, 3 unreadable files and a CSV; the report counts match, every file keeps its digest, 50 sampled extractions are confirmed in bulk and the rest stay proposed, renewal deadlines appear only for confirmed terms, and undo before use removes the batch while keeping the journal.

*Status:* partial. Reviewed, undoable batch import ships for DocuSign archives (`src/locket/imports/commands.ts`, `tests/api/move-in.test.mjs`); generic PDF/DOCX bulk import, OCR, extraction and large-file streaming do not exist.

#### REPO-004 — Built-in term and metadata extraction.
For any executed or imported agreement, the built-in model proposes parties and our signing entity, effective, end and renewal dates, auto-renewal, renewal term, notice period and method, termination rights, governing law, payment terms, total and annual value in USD (with original currency kept), price-increase caps, liability caps, insurance requirements and every custom field (`REPO-005`), each citing its passage and confidence. Proposals follow `TERMS-001`: nothing drives a deadline until confirmed. Extraction accuracy is measured on a live provider under `REVIEW-006` and shown to the owner per field. A field whose latest live result is below its bar is marked low-confidence on every proposal and is never offered for bulk confirmation (`REPO-003`).

*Acceptance:* a journey with a model-provider fake extracts 14 standard fields and two custom fields from a fixture MSA with citations; a person confirms twelve, corrects one and rejects one; the renewal deadline appears after the end date and notice period are confirmed. The clause is accepted only when a live run under `REVIEW-006` meets the extraction bars.

*Status:* partial. Cited terms proposed by an agent or importer are confirmed by people (`src/locket/proposals.ts`, `src/locket/obligations.ts`); built-in extraction and custom fields do not exist.

#### REPO-005 — Custom metadata fields.
The owner defines custom fields (text, number, USD money, date, pick list, yes/no, person, counterparty) per agreement type, with help text, required-at-stage rules and who may edit them. Fields appear on intake forms, the agreement page, extraction proposals, search filters, saved views, reports, exports and the API.

*Acceptance:* a journey adds a "Data processing" yes/no field and a "Cost center" pick list required before approval, sees approval refused until the field is filled, filters the repository by both fields and finds them in the CSV export and the API state.

*Status:* missing. Agreement fields are fixed in the schema.

#### REPO-006 — Search and structured filters.
People search the full text of every version they may access (DOCX text and OCR text), titles, references, counterparties and field values, with clause-level hits that open the exact passage. Structured filters cover type, status, counterparty, owner, department, value range, any date range (effective, end, notice deadline), auto-renewal, governing law, playbook deviations and custom fields, and combine with the text query. Results respect `ACCESS-001`.

*Acceptance:* a journey searches "limitation of liability" filtered to supplier agreements over $100,000 ending in the next 180 days, opens a hit at its passage, and a viewer without access to a restricted match does not see it.

*Status:* partial. Permission-scoped search over titles, counterparties, references and version text with a status-filtered register ships (`src/locket/views.ts`, `src/ui/register.tsx`, `tests/api/flows.test.mjs`); OCR text, field, value and date filters and clause-level hits do not exist.

#### REPO-007 — Saved views and columns.
A person saves a repository view (query, filters, sort and chosen columns, including custom fields) as private or shared with a role or group, pins it, and exports it to CSV. Shared views respect each viewer's access.

*Acceptance:* a journey saves "Supplier renewals next quarter" with value, owner and notice-deadline columns, shares it with approvers, opens it as an approver who sees only permitted rows, and exports the CSV with matching rows.

*Status:* missing. The register has fixed columns and no saved views.

#### REPO-008 — Agreement families.
Agreements link as amends, order under, statement of work under, schedule to, renews and supersedes. The family page shows the parent, every child in date order, and the governing value of each key term with the document that sets it. Linking runs the same version and authority checks as other writes, and an agent's proposed link is decided by owner or counsel.

*Acceptance:* a journey links an MSA, two order forms and an amendment that extends the term; the family page lists them in order and shows the amended end date as governing, with the amendment cited; a requester's attempt to link is refused.

*Status:* partial. Parent links with amends, order, schedule and renews relations and agent link proposals ship (`src/locket/agreements.ts`); the family page and governing-term view do not, and no flow test exercises family links.

#### REPO-009 — Groups, departments and field-level access.
Beyond restricted agreements, the owner defines departments and groups (Sales, Procurement, HR, Finance) and grants each visibility by agreement type and department, and can hide specific fields (value, pricing schedules) from roles that may otherwise read the agreement. Every read, search hit, export, notification and connector payload applies the same rules.

*Acceptance:* a journey grants Sales visibility of customer agreements only and hides value from viewers; a Sales viewer sees customer agreements without value in the register, search, CSV export and API state, and sees no supplier agreement.

*Status:* partial. Restricted agreements with explicit grants ship (`src/locket/access.ts`, `tests/api/security.test.mjs`); groups, departments and field-level hiding do not exist.

#### REPO-010 — Counterparty records.
Each counterparty has its legal entity name, entity type and state of formation, EIN where supplied, addresses, notice address and method, contacts and authorised signatories, every agreement in its families, total and annual contracted value in USD, and open obligations and deadlines. Duplicates are merged with history; CRM, accounting and procurement records (`INTAKE-004`, `LINK-001`, `LINK-002`) link to the same counterparty.

*Acceptance:* a journey adds a counterparty with a notice address, links three agreements, merges a duplicate created by intake, and sees the combined value, open deadlines and linked HubSpot company on the counterparty page.

*Status:* partial. Counterparties with a name, kind and email are created and reused by intake (`src/locket/agreements.ts`); entity details, notice addresses, signatories, merging and the counterparty page do not exist.

#### REPO-011 — Bulk repository actions.
From any search, filter or saved view (`REPO-006`, `REPO-007`), a person selects up to 5,000 agreements and acts on all of them at once:

- Set or clear a standard or custom field (`REPO-005`), such as Department = Sales or a corrected agreement type.
- Reassign the responsible person, and every open obligation and reminder a departing person owns (`OBL-001`, `RENEW-002`), to a named colleague.
- Change group and department access (`REPO-009`).
- Download the selected originals, signed files and certificates as one ZIP with a manifest of file digests.
- Export the selection's metadata to CSV, edit it in a spreadsheet and re-import it as an update. A dry run shows the diff by record and field, and nothing changes until a person applies that exact dry run.

Every bulk change is applied record by record through the same role, access, version and atomic checks as a single edit (`SEC-001`). A record the person may not edit, or one that changed after it was selected, is reported as skipped and left untouched. Each changed record shows an audited change linked to the bulk operation (`AUDIT-001`). A bulk operation can be reverted as one, which restores the prior values and keeps both changes in history. Restricted agreements stay invisible to people without access (`ACCESS-001`). Viewers cannot run bulk actions; agents may only propose a bulk update for a person to apply (`PROPOSE-001`).

*Acceptance:* a journey filters 300 imported agreements, sets Department = Sales on all of them, and reassigns a departing owner's 40 agreements and their open obligations to a colleague. It moves 25 agreements to the Finance group and downloads 20 originals as a ZIP whose digests match. It then exports the CSV, corrects the type on 15 rows and re-imports it, seeing a dry-run diff of exactly those 15 before applying. Each record's activity shows its audited change, and reverting the department change restores the prior values with history kept. A viewer's bulk edit is refused, and a record changed after selection is reported as skipped.

*Status:* missing. The register has no selection or bulk actions.

### Drafting and playbooks

#### DRAFT-002 — Word documents from templates.
A populated template produces a formatted DOCX (and its PDF rendition) that keeps the template's styles, numbering, headers and tables, with conditional clauses chosen by the requester's answers and fields filled. Repeating pricing tables fill from line items (`INTAKE-004`, `LINK-003`) with a USD total. The template's signature blocks carry through as signature fields (`SIGN-005`). Business users generate standard agreements (NDA, MSA, order form, SOW) self-service; the result is the first version with its digest.

*Acceptance:* a journey populates an approved Word-based MSA template whose answers include a conditional data-processing clause; the downloaded DOCX opens with the template's styles and numbering, contains the conditional clause and the fields, renders a three-row pricing table with its total, and its PDF rendition is approved for signing.

*Status:* partial. Approved templates produce populated text and a text PDF (`src/locket/library.ts`, `src/locket/pdf.ts`); DOCX output with preserved formatting and answer-driven conditional clauses do not exist.

#### DRAFT-003 — Clause library in negotiation.
Approved clauses (preferred, fallback one, fallback two, walk-away) are searchable by topic with usage notes, the playbook rule they satisfy, and how often each was accepted. During negotiation a person inserts a clause into a new version in the browser or Word (`NEG-003`), and the inserted text is recorded against the library version.

*Acceptance:* a journey searches the library for "indemnity", inserts fallback one into a new version from the browser, and sees the version record the clause and library version; the clause's acceptance count rises when the agreement is executed with it.

*Status:* partial. Versioned clause wordings within approved templates and playbook alternatives ship (`src/locket/library.ts`); a searchable library, insertion during negotiation and usage counts do not exist.

#### DRAFT-004 — Templates authored from existing Word documents.
Owner or counsel upload an existing Word template, mark fields and optional clauses in the browser (or with the Word add-in), preview it with sample answers, and approve it as a template version, keeping the document's formatting.

*Acceptance:* a journey uploads a firm's NDA DOCX, marks four fields and one optional clause, previews with sample answers, approves it, and a requester generates an NDA from it under `DRAFT-002`.

*Status:* missing. Templates are authored as text in Locket.

#### PLAY-002 — Playbooks drafted from templates and history.
The built-in model drafts playbook rules from the approved templates and past executed agreements: for each clause topic, the preferred position, fallbacks seen in signed deals and suggested exception authority, citing the agreements it learned from. Counsel edits, accepts or rejects each rule; nothing activates until counsel approves a new playbook version under `PLAY-001`.

*Acceptance:* a journey with a model-provider fake drafts rules from two templates and 20 executed agreements; counsel accepts six, edits two and rejects one; the new playbook version activates only on approval and cites its source agreements.

*Status:* missing. Playbooks are authored by hand only.

### Negotiation

#### NEG-002 — Word tracked changes round-trip.
Locket reads Word tracked changes (insertions, deletions, moves, formatting), comments and their authors from a counterparty's DOCX and shows them as redlines against the version they were made on. It writes a DOCX with Locket-side changes as tracked changes and comments, attributed to the person who made them. Accepting or rejecting changes produces a new version; the counterparty's original file stays byte-for-byte. Clean and redline outputs are both available.

*Acceptance:* a journey uploads a fixture DOCX with 12 tracked changes and 4 comments from two authors; all are listed with authors and positions; accepting 9 and rejecting 3 creates a new version whose downloaded DOCX carries the remaining comments and our replies as Word comments, and the counterparty file downloads with its original digest. The output opens without repair in Word and LibreOffice.

*Status:* partial. DOCX originals are kept and their text read and compared (`src/locket/docx.ts`, `src/locket/diff.ts`); tracked changes and comments are not read or written.

#### NEG-003 — Locket for Word add-in.
An Office add-in for Word on Windows, Mac and the web, distributed through Microsoft AppSource and the buyer's Microsoft 365 admin, signs in with the person's Locket session, opens the current version, shows playbook findings beside the clauses they cite, inserts clause-library text, applies accepted AI redlines as tracked changes, and saves back as a new version with the stale-version check. Approvers can review and approve the exact version from the add-in.

*Acceptance:* a Word-on-the-web journey opens an agreement in the add-in, sees three findings anchored to their clauses, applies one AI redline as a tracked change, saves as version 4, and is refused when saving over a version someone else has replaced; an approver approves version 4 from the add-in and the approval pins its digest. A sideloaded run in Word on the web against a Microsoft 365 developer tenant, and the add-in's passing AppSource validation, are recorded before the clause is accepted.

*Status:* missing. No Word add-in exists.

#### NEG-004 — Browser redlining and threaded comments.
People edit a version in the browser with changes recorded as tracked changes, comment on a selected passage, @mention colleagues, reply in threads and resolve them. Saving creates a new version; mentions notify (`NOTIFY-001`).

*Acceptance:* a browser journey at 1440 and 390 pixels edits two clauses, comments on a third, mentions counsel, who replies and resolves; the saved version shows the tracked edits and the compare view lists exactly those changes.

*Status:* partial. Line-by-line comparison of versions and comments with quoted passages ship (`src/locket/diff.ts`, `src/locket/agreements.ts`); in-browser editing, threads, mentions and resolution do not exist.

#### NEG-005 — Internal and external sides of a negotiation.
Every comment and version is marked internal or external. Internal comments, findings, approvals and internal-only versions never appear in anything shared with the counterparty (downloads, emails, the secure link). A person sends the external view by choice; Locket warns when an outgoing DOCX still carries internal comments or metadata and strips them.

*Acceptance:* a journey adds two internal and one external comment, shares the version with the counterparty under `NEG-006`, and confirms the counterparty view and the outgoing DOCX contain only the external comment; an attempt to send a file still carrying an internal comment is warned and cleaned.

*Status:* partial. Our and counterparty versions are distinguished and comments are stored per version (`src/locket/agreements.ts`); internal and external marking, sharing and stripping do not exist.

#### NEG-006 — Counterparty exchange by email and secure link.
A person sends the external version to counterparty contacts from Locket by email (Postmark, or the person's connected Gmail or Outlook) or a secure, expiring link where the counterparty can view, download, comment and upload a markup without an account. Replies with attachments come back as counterparty versions on the same agreement. Every send, open and upload is recorded.

*Acceptance:* a journey with a Postmark fake sends version 2 to a counterparty contact, opens the secure link as the counterparty, uploads a markup and comments; version 3 appears as a counterparty version with its digest, the activity shows sent, opened and uploaded, and the link refuses access after expiry.

*Status:* missing. Exchange with counterparties happens outside Locket.

### Built-in AI review

#### REVIEW-002 — Built-in playbook review.
On any version (ours or theirs, DOCX or OCR'd PDF), a person runs review: the built-in model checks every rule in the active playbook and returns, per rule, met, breached or cannot determine, with the exact cited passage, the reason, and proposed wording from the rule's fallbacks. Findings arrive as a proposal under `REVIEW-001`; a reviewer accepts, edits or rejects each one, and only accepted findings drive exception approvals. Review of a 40-page agreement against 30 rules completes within 2 minutes at the 90th percentile, measured on a live provider. Accuracy is measured live under `REVIEW-006` and shown to the owner per rule.

*Acceptance:* a journey with a model-provider fake runs review on a fixture supplier agreement against a 12-rule playbook; findings cite passages that match the version text, a quote that is not in the text is refused, a reviewer edits one proposed wording and rejects one finding, and the exception route reflects only accepted findings. The clause is accepted only when a live run under `REVIEW-006` meets the review bars, including the 2-minute time.

*Status:* partial. Cited findings, quote checking and proposals from an external agent ship (`src/locket/review.ts`, `src/locket/proposals.ts`, `tests/api/flows.test.mjs`); the built-in model run does not exist.

#### REVIEW-003 — AI redlines a person edits before sending.
Accepted findings with proposed wording become tracked changes in the next version (browser and Word), each with its reason as a comment that is internal by default. The reviewer edits the wording and the reason before anything is shared, and the version records which changes came from the model and who accepted them.

*Acceptance:* a journey accepts three findings, edits one redline's wording and one reason, saves the version, and sees three tracked changes attributed to the reviewer with model provenance, with reasons internal unless marked external.

*Status:* partial. Findings carry proposed wording and questions (`src/locket/review.ts`); turning findings into tracked changes does not exist.

#### REVIEW-004 — Ask the repository.
A person asks questions in plain English ("Which supplier agreements auto-renew next quarter with more than 60 days' notice?", "What is our liability cap with Acme?") and gets an answer with a list of matching agreements and cited passages, built only from agreements and fields the person may access. Answers that rely on proposed, unconfirmed values say so.

*Acceptance:* a journey with a model-provider fake asks both questions over a fixture repository; the first returns the exact matching agreements with their confirmed terms cited, the second cites the clause; a viewer without access to a restricted agreement gets an answer that omits it.

*Status:* missing. No question answering exists.

#### REVIEW-005 — Model choice, records and switch-off.
The owner chooses the model provider (Anthropic or OpenAI with the owner's API key under a no-training, zero-retention agreement, or Cloudflare Workers AI) and can switch AI off for the installation or per agreement type. Every model output records the provider, model, prompt version, playbook version, input document digests and the person who accepted it. Usage and estimated cost are shown in USD per month. The same settings choose the OCR provider (`REPO-002`). Beside each provider and model they show its latest live evaluation (`REVIEW-006`). A task the model has not passed live is not offered.

*Acceptance:* a journey configures a provider fake, runs review and extraction, reads each output's record (model, prompt, playbook and input digests), switches AI off for NDAs and sees review refused on an NDA, and reads the month's usage in USD. A model with no passing live evaluation for review is shown as not evaluated, and review is refused with it.

*Status:* missing. Locket makes no model calls.

#### REVIEW-006 — Live accuracy evidence for review, extraction and OCR.
No AI review, extraction or OCR task is offered for a provider and model until an evaluation command in the repository has run the shipped prompts against that real provider and recorded the result. A fake never counts. Each run is committed as an evaluation record: provider, model, prompt version, dataset name, version and digest, per-field and per-rule scores, latency and USD cost. A new prompt version or model needs a new passing run before it is offered.

The labelled sets are named:

- **Clause location:** the CUAD v1 test split from the Atticus Project (102 of CUAD's 510 US commercial contracts, 41 labelled clause categories). It is scored on the categories that map to Locket fields: parties, agreement, effective and expiration dates, renewal term, notice period to terminate renewal, governing law, termination for convenience, cap on liability, uncapped liability, insurance, audit rights, minimum commitment, price restrictions, exclusivity and most favoured nation.
- **Normalised values:** a held-out Locket set of 100 US commercial agreements (NDAs, MSAs, order forms, supplier agreements and amendments), labelled by counsel with normalised values (dates, day counts, USD amounts, states). It is kept out of prompt development, and its labels and digest are committed.
- **Review:** 50 agreements from that held-out set against a 12-rule US supplier playbook, each rule labelled met, breached or cannot determine by counsel.
- **OCR:** the 102 CUAD test contracts rendered as 200-dpi greyscale page images, scored against CUAD's text.

The bars a run must meet:

- **Extraction:** clause-location recall of at least 0.85 and precision of at least 0.80 for each mapped CUAD category. Exact-value accuracy of at least 0.90 for each normalised field, and at least 0.95 for end date, notice period and auto-renewal, the fields that drive deadlines.
- **Review:** per-rule agreement with counsel of at least 0.85. No rule may call a breached case "met" in more than 3% of its breached cases. Every cited quote matches the version text.
- **OCR:** character error rate of at most 2% overall and at most 5% on any single contract, with the page anchor correct for every cited passage.
- **Speed:** at the 90th percentile, review of a 40-page agreement against 30 rules in 2 minutes and extraction of a 40-page agreement in 60 seconds.

*Acceptance:* the evaluation command run against a provider fake refuses to record a result, because it is not a live run. A live run with Anthropic (and with OpenAI or Workers AI where offered), plus one with at least one named OCR provider, is committed with dataset digests and meets every bar. The model settings (`REVIEW-005`) show those results. A recorded run that misses one bar leaves that task unavailable for that model.

*Status:* missing. No evaluation command, labelled set or recorded live run exists.

#### REVIEW-007 — Plain-English summary of one agreement.
A person generates a plain-English summary of a single agreement for a business stakeholder. It covers the parties and our entity (`ENTITY-001`); what each side must do; price and payment; the term, renewal and notice deadline; termination rights; liability and insurance; and the playbook exceptions accepted. Every line cites its passage and says whether the value is confirmed or still proposed. The summary is pinned to the version it was made from. It is marked stale when a new version or a corrected term arrives, and is never silently rewritten. It can be shared only with people who may see the agreement. The model run follows `REVIEW-005` and is offered only after the extraction bar in `REVIEW-006` is met.

*Acceptance:* a journey with a model-provider fake summarises a fixture MSA. Every line cites a passage in the version text, and an unconfirmed renewal term is labelled proposed. Adding version 3 marks the summary stale, and a viewer without access to the agreement cannot open the summary.

*Status:* missing. No summaries exist.

### Approval routing

#### APPROVE-002 — Conditional approval rules in USD.
Owner-configured rules add approvers by agreement type, USD value thresholds, department, counterparty risk and accepted findings (for example: Finance over $100,000, Security when data processing is "yes", the CFO over $500,000), in sequence or in parallel, with named delegates while someone is away. A rule change is previewed against sample agreements before publishing (`INTAKE-002`). Approvals still pin the exact version and context (`APPROVE-001`).

*Acceptance:* a journey publishes rules for $100,000 and $500,000 thresholds and a data-processing condition, submits a $600,000 supplier agreement with data processing and sees Finance, Security and CFO approvals required in order; a delegate approves for an absent approver; a value change withdraws all three.

*Status:* partial. Commercial approval plus exception decisions routed to the playbook rule's authority ship (`src/locket/review.ts`, `tests/api/flows.test.mjs`); configurable value, department and condition rules, ordering and delegates do not exist.

#### APPROVE-003 — Approve where people work.
Approvers are asked by email, Slack, Teams or Nook, in the Word add-in or on a phone (`MOBILE-001`). Every approval, wherever it is given, passes through the same server checks and pins the exact version digest the approver saw; an approval of a version that has since changed is refused and the approver is shown the new version.

*Acceptance:* a journey sends an approval request by email (Postmark fake) and Slack (fake); approving from the Slack action records the approver and version digest; a second approver acting from an email link after a new version was added is refused and shown the new version.

*Status:* missing. Approvals are given only in the Locket screens.

#### APPROVE-004 — Approval reminders and escalation.
A pending approval reminds its approver through their notification channel (`NOTIFY-001`, `APPROVE-003`) at owner-configured intervals. The default is after 1 business day, then daily, in the approver's US time zone. If it is still pending after a configured time (default 3 business days), it escalates to the approver's delegate (`APPROVE-002`), or to the rule's escalation contact when there is no delegate. Anyone working on the agreement can press "Remind approver", at most once every 4 hours per approver. Every reminder and escalation is recorded in the agreement's activity, and reminders stop as soon as the approval is given, declined or withdrawn.

*Acceptance:* a journey with a Postmark fake and a controlled clock submits an agreement for approval. The approver is reminded after 1 business day and escalated to their delegate after 3. A manual reminder is sent and a second one within 4 hours is refused. Once the approver approves, no further reminder goes out, and each reminder and the escalation appear in the activity.

*Status:* missing. Approvals send no reminders.

### Signing and execution

#### SIGN-002 — Live Docusign, Adobe Acrobat Sign and Dropbox Sign.
The owner connects a Docusign, Adobe Acrobat Sign or Dropbox Sign account with OAuth. From an approved signature package (`SIGN-001`), Locket creates and sends the envelope with every document in the packet and the recipients, signing order, CCs and signature fields that `SIGN-005` decides, records the envelope ID, and tracks status through the provider's webhooks (Docusign Connect, Acrobat Sign webhooks, Dropbox Sign callbacks), verifying each callback's signature. People see sent, viewed, signed, declined and voided per signer, can send reminders, and Locket voids the envelope if the agreement changes after sending. Provider credentials stay in the owner's secret store.

*Acceptance:* a Workers journey with a Docusign API fake sends an approved two-document package with its `SIGN-005` signers and fields, receives signed callbacks for viewed, one signer completed and envelope completed, rejects a callback with a bad signature, and voids an envelope when a new version is added; the same journey runs against Acrobat Sign and Dropbox Sign fakes. A live sandbox run against each provider's developer account is recorded before the clause is accepted.

*Status:* partial. Provider-named packages, routing manifests and recorded envelope IDs ship (`src/locket/execution.ts`, `tests/api/flows.test.mjs`); live sending, webhooks, reminders and voiding do not exist.

#### SIGN-003 — Inkwell signing.
Inkwell, the Run Edit Run e-signature product, connects the same way as `SIGN-002`: Locket sends the approved package to the buyer's Inkwell installation, receives signed status events and retrieves the completed file and Inkwell's completion certificate automatically.

*Acceptance:* a journey against an Inkwell installation fake sends a package, receives completion and retrieves the file and certificate, which `EXEC-001` reconciles cleanly.

*Status:* missing. No Inkwell connection exists.

#### EXEC-002 — Automatic retrieval and filing of executed agreements.
When a connected provider reports completion, Locket downloads the signed PDF and the certificate of completion, stores them byte-for-byte, runs `EXEC-001` reconciliation (mismatches held for owner or counsel), marks the agreement executed, starts extraction (`REPO-004`), files copies into the connected Google Drive, OneDrive/SharePoint or Chest folder by the owner's naming rule (`INT-001`), and notifies the requester and CRM. Retrieval failures retry with backoff and stay visible until resolved.

*Acceptance:* a journey with a Docusign fake completes an envelope; within one minute the agreement is executed with the signed file and certificate digests matching the fake's, a copy is in the Drive fake's folder under the naming rule, and HubSpot's deal shows executed; a forced download failure leaves a visible retrying state and no executed status.

*Status:* partial. Signed files and certificates are stored and reconciled after a person uploads them (`src/locket/execution.ts`); automatic retrieval, filing and notification do not exist.

#### SIGN-004 — Clickwrap acceptance of published terms.
Counsel publishes versioned standard terms (terms of service, data processing addendum, partner terms) for acceptance on the buyer's website or app through an embeddable script or the API. Each acceptance records who accepted (account, email), the exact terms version and digest, time, IP address, user agent and the page shown; a new version can require re-acceptance. Acceptance records are searchable, exportable and linked to the counterparty.

*Acceptance:* a journey publishes terms version 1, accepts it through the embed on a test page, publishes version 2 requiring re-acceptance, and sees the same user prompted again; the export lists both acceptances with digests, time and IP.

*Status:* missing. No clickwrap capability exists.

#### SIGN-005 — Signer rules, signature fields and multi-document packets.
Locket decides who signs, where they sign and what they sign before an envelope leaves, so nothing needs tagging by hand in the provider.

- **Our signer by rule.** The owner sets rules that choose our signatory by agreement type, USD value, department and our contracting entity (`ENTITY-001`), on the same rule engine and preview as `APPROVE-002`. For example, the VP Sales signs under $100,000 and the CFO at $100,000 or more. Every rule set has a required fallback signer, used when no rule matches or the chosen signer is marked unavailable. Counterparty signers come from the request's contacts and the counterparty's authorised signatories (`REPO-010`).
- **Fields from templates.** Templates carry signature blocks per party role: signature, name, title, date and initials. Locket writes these into the signing PDF as each provider's anchor or text tags (Docusign anchor tabs, Acrobat Sign text tags, Dropbox Sign text tags, and the same placements for Inkwell), so fields land on the blocks automatically.
- **Signature coordinator.** Before sending, a person with the signature role reviews the packet. They can reorder, add or remove signers and add CCs. On a document with no template blocks, such as counterparty paper, they place fields by hand on a page preview. Every change is recorded in the routing manifest.
- **Packets.** One envelope carries the main agreement plus approved signable attachments, such as a DPA, order form or SOW. Each document is pinned by digest and covered by the approval (`APPROVE-001`). Attachments that are not for signature can travel as reference documents.

*Acceptance:* a journey takes a $250,000 MSA plus a DPA from templates to the Docusign fake as one envelope holding both documents and their digests. The CFO is the internal signer by rule, and the fields sit on each template's signature blocks as anchor tabs. A $50,000 agreement routes to the VP Sales, and with the CFO marked unavailable the fallback signer is chosen. On a counterparty PDF, the coordinator places a signature and a date field on page 7 and adds a CC, and the envelope carries those placements. The same packet reaches the Acrobat Sign, Dropbox Sign and Inkwell fakes with matching fields.

*Status:* partial. Ordered signers and copy recipients entered by hand are recorded in the routing manifest and reconciled at execution (`src/locket/execution.ts`, `tests/api/flows.test.mjs`); signer rules, the fallback signer, template signature blocks, field placement and multi-document packets do not exist.

### Obligations and renewals

#### OBL-001 — Obligation extraction, owners and status.
The built-in model proposes obligations from executed agreements (deliverables, payment milestones, service levels, insurance certificates, reporting, audit rights, data return or destruction, exclusivity, minimum commitments), each with the party bound, due date or recurrence, and citation. Confirmed obligations get an owner and status (upcoming, due, done, missed, waived) and appear on the owner's list and the counterparty page.

*Acceptance:* a journey with a model-provider fake extracts six obligations from a fixture supplier agreement, a person confirms five with owners and rejects one; the confirmed ones appear on each owner's list with their next due dates and recurrence.

*Status:* partial. People and agents propose cited obligations with owner, due date and recurrence, which are confirmed and marked done (`src/locket/obligations.ts`, `tests/api/flows.test.mjs`); built-in extraction, status values beyond done and owner lists do not exist.

#### OBL-002 — Fulfilment evidence and escalation.
Marking an obligation done requires evidence when its type says so (a file such as a certificate of insurance, a link, or a note). Overdue obligations notify the owner, then escalate to the agreement's responsible person and to an approver after the configured days; each obligation carries a risk rating that rolls up to the agreement and counterparty.

*Acceptance:* a journey marks an insurance obligation done and is refused without a certificate, attaches one and succeeds; another obligation passes its due date, its owner is emailed (Postmark fake), and after three more days the approver is notified and the counterparty page shows the raised risk.

*Status:* partial. Confirmed obligations are marked done with actor and time (`src/locket/obligations.ts`); evidence requirements, overdue escalation and risk ratings do not exist.

#### RENEW-002 — Delivered reminders and escalation by email.
Each renewal and obligation deadline sends reminder emails at owner-configured offsets (default 90, 60, 30 and 7 days before the notice deadline) in the recipient's US time zone, from Postmark or the installation's mail provider, with a daily digest option. If no renewal decision is recorded by the 30-day reminder, Locket escalates to the agreement's approver and the owner. Every message keeps its provider message ID and delivery, bounce and complaint events; a bounced reminder is retried to an alternate recipient and shown on the deadline.

*Acceptance:* a Workers journey with a Postmark fake and a controlled clock confirms an end date and 60-day notice in America/Chicago, advances to each offset and receives the four reminders at 9:00 local time, sees escalation at 30 days without a decision, and sees a bounce event shown on the deadline with the alternate recipient emailed.

*Status:* partial. Notice deadlines are computed in the agreement's time zone and listed in the renewal queue (`src/locket/obligations.ts`, `src/locket/dates.ts`); no reminder is scheduled or sent.

#### RENEW-003 — Deadlines on Google Calendar and Outlook.
A person connects Google Calendar or Outlook (Microsoft Graph) and chooses which deadlines appear (their own, their team's, all they may see). Notice deadlines, end dates and obligation due dates become calendar events with a link back, updated when a confirmed term is corrected and removed when the agreement ends or the deadline is met.

*Acceptance:* a journey with Google Calendar and Graph fakes connects both, confirms terms and sees the notice-deadline event created; correcting the end date moves the event; recording the renewal decision marks it done. Live runs against a Google Workspace test calendar and a Microsoft 365 developer tenant are recorded before the clause is accepted.

*Status:* missing. No calendar connection exists.

#### RENEW-004 — Bulk reminders for imported contracts.
After a bulk import (`REPO-003`, `MOVE-*`), a person selects confirmed agreements by view or filter and sets reminder schedules and owners on all of them in one action, with a preview of the deadlines that will be tracked and those skipped for missing confirmed terms.

*Acceptance:* a journey selects 40 imported agreements, 34 with confirmed terms, previews 34 tracked deadlines and 6 skipped with reasons, applies, and sees reminders scheduled for the 34.

*Status:* missing. Reminder schedules do not exist.

#### RENEW-005 — Renewal briefs and renewal workflows.
At a configured lead time before each notice deadline, Locket prepares a renewal brief for the decision-maker: current terms and amendments, price-increase cap, spend to date and invoices (`LINK-001`), obligation and service-level history, open issues and the options (renew, renegotiate, terminate) with their deadlines. Choosing renew or renegotiate opens a renewal request linked as `renews` with the brief attached.

*Acceptance:* a journey with an accounting fake reaches the lead time on a supplier agreement; the brief cites the cap clause and shows spend to date; choosing renegotiate opens a linked renewal request routed under `INTAKE-002`.

*Status:* partial. Renewal decisions and agent-prepared notice drafts ship (`src/locket/obligations.ts`, `src/locket/proposals.ts`); briefs and renewal-request creation do not exist.

#### RENEW-006 — Send approved notices with delivery evidence.
An approved notice (`RENEW-001`) is sent from Locket by email to the counterparty's notice address (`REPO-010`) with the PDF letter attached, or exported as a letter for certified mail or courier with the tracking number recorded. Locket keeps the sent message, provider events and tracking status as delivery evidence, separate from approval; whether that evidence is legally effective notice remains counsel's decision.

*Acceptance:* a journey with a Postmark fake sends an approved termination notice; the notice shows sent and delivered with the message ID and the PDF digest; a certified-mail notice records its tracking number and stays "sent, delivery unconfirmed" until the delivered status is recorded.

*Status:* partial. Notice approval and separately recorded sending evidence ship (`src/locket/obligations.ts`, `tests/api/flows.test.mjs`); sending from Locket and provider delivery events do not exist.

### Commercial systems

#### LINK-001 — Accounting links: Pantry, QuickBooks Online and NetSuite.
The owner connects Pantry, QuickBooks Online or NetSuite. Agreements link to the vendor or customer record; Locket reads bills, invoices and payments for linked counterparties to show spend or revenue to date against the contract value and payment schedule in USD, and offers confirmed payment obligations to the accounting system as scheduled bills or invoice reminders for a person to accept there.

*Acceptance:* a journey with a QuickBooks Online fake links a supplier agreement to its vendor, reads 8 bills totalling $84,000 against a $100,000 contract, shows 84% consumed, and a Pantry fake receives a proposed payment schedule that stays pending until accepted there.

*Status:* missing. No accounting connection exists.

#### LINK-002 — Procurement links: Purse and Coupa.
A purchase request in Purse or Coupa that needs a contract opens a Locket request with supplier, amount and requester. On execution, Locket sends the supplier record the contract's key terms (value cap, dates, payment terms, renewal) so purchase orders draw down against it, and reads PO totals back to show remaining value.

*Acceptance:* a journey with a Purse fake starts a request from a purchase request, executes it, sees the terms on the supplier record in the fake, and reads back two POs showing remaining contract value; the same runs against a Coupa fake.

*Status:* missing. No procurement connection exists.

#### LINK-003 — Proposal and billing handoffs: Platter and Nectar.
An accepted proposal in Platter (or PandaDoc) opens a customer contract request with the quoted products, prices and term. An executed customer agreement sends its confirmed pricing, start date, term and renewal terms to Nectar (or Stripe Billing) as a proposed subscription that a billing person activates there.

*Acceptance:* a journey with a Platter fake converts an accepted proposal into a request with its line items, executes it, and a Nectar fake receives the proposed subscription with matching price, start date and renewal, pending activation.

*Status:* missing. No proposal or billing connection exists.

### Connections and administration

#### INT-001 — Google Drive, OneDrive/SharePoint and Chest.
The owner connects Google Drive, OneDrive/SharePoint or Chest. Locket imports from chosen folders (`REPO-003`) and files executed agreements and certificates into a folder structure by naming rule (for example `Contracts/{counterparty}/{year}`), linking each stored copy back to the record. Locket remains the system of record; changes made to copies in storage do not alter Locket's originals.

*Acceptance:* a journey with Drive and Graph fakes imports a folder of 30 agreements, executes a new agreement and finds it filed under the naming rule in both; editing the stored copy leaves Locket's original digest unchanged. Live runs against a Google Drive test folder and a SharePoint document library in a Microsoft 365 developer tenant are recorded before the clause is accepted.

*Status:* missing. No storage connection exists.

#### INT-002 — Public API, webhooks, Zapier and Crank.
A documented REST API covers every command and read the screens use, with scoped API tokens for integrations. Signed outgoing webhooks fire for request created, submitted, approved, sent for signature, executed, term confirmed, deadline approaching and obligation overdue, with retries and a delivery log. Published Zapier and Crank apps expose the same triggers and actions.

*Acceptance:* a journey creates a scoped token, drives an agreement through the API to executed, and receives each webhook with a valid signature at a test endpoint; a failing endpoint is retried and logged; the Zapier and Crank apps' trigger tests pass against a running installation.

*Status:* partial. The authenticated HTTP API serving the screens and agents ships and is documented (`src/locket/api.ts`, `API.md`); scoped tokens, webhooks and the Zapier and Crank apps do not exist.

#### INT-003 — SSO and SCIM provisioning.
Operators sign in through SAML or OIDC with Okta, Microsoft Entra ID, Google Workspace or Auth, and SCIM provisioning creates, updates and deactivates operators and maps groups to Locket roles and departments (`REPO-009`). Deactivation revokes sessions immediately.

*Acceptance:* a journey with an Okta fake signs in through SAML, provisions a user into the Counsel group by SCIM and sees the counsel role, then deactivates the user and sees their open session refused on the next command.

*Status:* partial. Native invitations, sign-in and Locket roles ship (`src/locket/people.ts`, `src/locket/access.ts`); SSO and SCIM do not exist.

#### INT-004 — Connection health.
Every connection (CRM, signing, storage, calendar, chat, accounting, procurement, mail, model) shows its status, the account it acts as, last successful sync, and each failure with its reason and a retry, and the owner is emailed when a connection starts failing or its credentials near expiry.

*Acceptance:* a journey with fakes connects HubSpot and Docusign, forces an expired token on Docusign, and sees the connection marked failing with the reason, the affected agreements listed, an owner email sent, and recovery after reconnecting.

*Status:* missing. No connections exist yet.

#### NOTIFY-001 — Notifications and preferences.
People receive in-app and email notifications (and chat under `INTAKE-005`) for assignments, mentions, approval requests, signature events, overdue obligations and deadlines, with per-person preferences for channel and a daily digest. Notifications never disclose an agreement the recipient may not see.

*Acceptance:* a journey mentions a counsel in a comment, assigns a request and completes a signature; counsel receives the in-app and email notifications under their preferences, switching to a daily digest batches the next day's notifications, and a viewer without access receives none for a restricted agreement.

*Status:* missing. Locket sends no notifications.

#### US-001 — US defaults.
A new installation defaults to USD with values entered and shown as US dollars, an installation time zone chosen from US zones (Eastern, Central, Mountain, Arizona, Pacific, Alaska, Hawaii) that new agreements inherit and can change per agreement, US date format, governing law chosen from US states and the District of Columbia (with other jurisdictions available), counterparty EIN in place of ABN, and an option to roll notice deadlines that fall on a weekend or US federal holiday to the previous business day. Agreements in another currency keep their original amount and show the USD equivalent at a recorded rate. Default required attachments: supplier agreements need a certificate of insurance and a Form W-9; customer agreements need a statement of work or order form; amendments need the signed parent; NDAs none.

*Acceptance:* a fresh installation's request form shows USD and the installation's America/Los_Angeles zone, a supplier request requires a certificate of insurance and W-9, a deadline falling on Thanksgiving rolls back to the Wednesday with the business-day option on, and a GBP agreement shows its USD equivalent and rate.

*Status:* partial. Per-agreement IANA time zones with daylight-saving-correct deadlines ship (`src/locket/model.ts`, `src/locket/dates.ts`); values are stored and shown in AUD, the default zone is Australia/Sydney, counterparties carry an ABN, and US defaults, business-day rolling and multi-currency do not exist.

#### AUDIT-001 — Filterable activity audit trail.
Every action is recorded with actor, role, time, agreement and summary, including views of restricted agreements and downloads. The owner and counsel filter the audit trail by person, agreement, action and date and export it as CSV; the complete archive (`PORT-001`) includes it.

*Acceptance:* a journey performs approvals, downloads and a restricted view, filters the trail by one person and date range, and exports a CSV whose rows match the screen.

*Status:* partial. Attributed activity is recorded and exported in the complete archive (`src/locket/views.ts`, `tests/api/flows.test.mjs`); filtering, CSV export and view and download events are absent.

#### ERASE-001 — Personal-data erasure with legal hold.
On a verified request (for example under the California Consumer Privacy Act), the owner erases a person's personal data from contacts, comments and notifications while keeping executed agreements, signatures and audit records that must be retained, with a recorded reason. Agreements under a legal hold (set by counsel) cannot be deleted or have files removed until the hold is released. Retention rules delete or anonymise expired, unexecuted drafts after a configured period.

*Acceptance:* a journey erases a counterparty contact who appears on comments and a notice; their name and email are replaced in those records, the executed agreement and audit entries remain with the erasure recorded; a legal hold refuses deletion of a draft until released.

*Status:* missing. No erasure, hold or retention capability exists.

#### ENTITY-001 — Our contracting entities.
The owner records each of the business's own legal entities: legal name, entity type, state or country of formation, EIN or foreign tax ID, registered and notice addresses, default currency and time zone, and authorised signatories. Every agreement names the entity that contracts. Templates, clause wordings, playbooks and signer rules (`SIGN-005`) can be limited to an entity. The entity's legal name, notice address and signatory fill templates and outgoing notices (`RENEW-006`). Search, saved views and reports filter and group by entity, and extraction proposes our entity from the document (`INTAKE-007`, `REPO-004`).

*Acceptance:* a journey adds a Delaware parent company and a UK subsidiary. An agreement for the UK entity offers only that entity's template and routes to its signatory. Its termination notice carries the UK entity's notice address, and the register filters agreements by entity.

*Status:* missing. Agreements have no record of our contracting entity.

#### OPS-001 — Self-hosted install, updates and security answers.
Locket runs in the buyer's own Cloudflare account. `rer setup` and `rer deploy` create the Worker, D1 database and R2 storage there, so contract data stays in the buyer's account.

- **Updates.** Releases ship with release notes and their migration list at least monthly. Security fixes ship within 7 days of a fix being available. The owner previews an update, then applies it with one `rer` command, which takes a complete export (`PORT-001`) before running forward-only migrations. Release notes call out any change to how data is handled.
- **Security answers.** The repository ships a completed security questionnaire for a self-hosted install, in the SIG Lite and CAIQ question sets procurement teams send. It covers data flows, subprocessors (Cloudflare and each connector the owner enables), encryption in transit and at rest, access control, audit (`AUDIT-001`), backup and restore, incident response and vulnerability handling. It also sets out the split of responsibilities between the buyer and the software. Locket claims no SOC 2 report of its own for software the buyer runs; Cloudflare's SOC 2 Type II report covers the platform.

*Acceptance:* a fresh `rer deploy` to a test Cloudflare account creates the Worker, database and storage in that account. Updating from the previous release takes an export, applies the migrations and keeps every record and file digest. The questionnaire lists every connector the build can enable as a subprocessor, which a check compares with the build's connectors.

*Status:* partial. Setup, deploy to the owner's own Cloudflare account, and complete export and restore ship (`OPERATIONS.md`, `deploy.json`, `tests/portable.mjs`); the release cadence, the one-command update with an automatic export and the security questionnaire do not exist.

### Reporting

#### REPORT-001 — Cycle time, throughput and bottlenecks.
Dashboards show requests opened and completed by type and team, median and 90th-percentile time in each stage (intake, drafting, negotiation, approval, signature), the longest-waiting approvals and counterparties, and service-level performance (`INTAKE-006`), filterable by period.

*Acceptance:* a journey drives 20 fixture agreements through stages with a controlled clock and sees the stage medians, the slowest approver and the service-level breach count match the fixture's known values.

*Status:* missing. No analytics exist.

#### REPORT-002 — Custom and scheduled reports.
A person builds a report from a saved view (`REPO-007`) with grouping and totals (value in USD by counterparty, renewals by month) and schedules it weekly or monthly by email as CSV or PDF to chosen people, who receive only the rows they may see.

*Acceptance:* a journey builds "Renewals by month" from a view, schedules it, advances the clock and receives the email (Postmark fake) with a CSV whose totals match the screen; a recipient with narrower access receives fewer rows.

*Status:* missing. No reports or schedules exist.

#### REPORT-003 — Portfolio dashboard.
A home dashboard shows total contracted value in USD by type, renewals and notice deadlines in the next 30, 60 and 90 days with their value, overdue obligations, agreements with accepted playbook exceptions, and agreements missing confirmed key terms.

*Acceptance:* a journey on a fixture repository sees each tile's count and USD value match a query over the same data, and each tile opens the filtered register.

*Status:* missing. The register lists agreements and next deadlines without a dashboard.

### Mobile

#### MOBILE-001 — Phone-width web app.
Every screen works at 390 pixels wide: a person can submit a request, read a review summary, approve or decline from a notification link, search, see deadlines and upload a signed copy from the phone's camera or files, without horizontal scrolling.

*Acceptance:* the browser journey at 390 pixels runs request to renewal notice, and an approval opened from an emailed link is completed on the phone layout.

*Status:* partial. The whole released journey runs at 1440 and 390 pixels (`tests/browser/journey.spec.ts`); approval from notification links and camera upload are not exercised.

#### MOBILE-002 — iOS and Android apps.
Native iOS and Android apps (App Store and Google Play) sign in with the installation, receive push notifications for approvals, mentions and deadlines, approve the exact version, search the repository and view documents, and capture a signed paper copy with the camera as a PDF.

*Acceptance:* device-farm journeys on a current iPhone and Pixel receive an approval push, approve the version with its digest recorded, search for an agreement and scan a two-page signed copy into its execution record.

*Status:* missing. No native apps exist.

### Move-in from incumbents

#### MOVE-002 — Ironclad move-in.
The kit reads Ironclad's three documented outputs, alone or together:

- **Repository metadata export:** CSV, JSON or XLSX, exported by an Ironclad admin from the Dashboard or the Imports tab.
- **Attachments ZIP:** the bulk download of the selected records' documents as one ZIP.
- **Public API:** the Records API (`GET /records`, with each record's type, properties, attachments and parent and child links), and attachment downloads, which Ironclad prepares as a background job that the kit polls until ready.

A dry run maps each Ironclad record type to a Locket agreement type and each property to a Locket field or custom field (`REPO-005`). The mapping is shown and editable, and every unmapped property is listed for a person to create as a custom field or skip. Ironclad's parent and child linked records become agreement families (`REPO-008`) with their relation. Every document is matched to its record and kept byte-for-byte with its digest. Files without a record and records without a file are listed. Each imported item keeps its Ironclad record ID, and its workflow ID where it came from a workflow, and is searchable by them. Signed records import as executed agreements with imported execution records, and dates and values come in as proposed terms (`TERMS-001`). Apply, undo and journal follow `MOVE-001`. Workflows still in progress move under `MOVE-006`, and clickwrap acceptances under `MOVE-007`.

*Acceptance:* a journey uses a fixture built from Ironclad's documented export columns, Records API JSON and an attachments ZIP. It holds 50 records, including two parent MSAs with three child order forms and one amendment. The dry run shows the type and property mappings and lists three unmapped properties. After applying, the families are linked with their relations, documents download with matching digests, and each agreement is found by its Ironclad record ID. Proposed terms are confirmed on two, and an unused batch is undone. The same fixture imported through the API path (a Records API fake whose attachment job reports pending, then ready) gives the same result. An authorised real export and a live run against an Ironclad sandbox's API are recorded before the clause is accepted.

*Status:* missing. Only the DocuSign kit exists.

#### MOVE-003 — Icertis and Agiloft move-in.
The same reviewed dry run, apply and undo take an Icertis contract export and an Agiloft contracts table export with attachments, mapping their contract types, parties, dates, values and custom attributes.

*Acceptance:* journeys with documented-shape Icertis and Agiloft fixtures each import 30 records with files and mapped fields, list unmapped attributes and undo cleanly.

*Status:* missing. No Icertis or Agiloft kit exists.

#### MOVE-004 — SpotDraft and Juro move-in.
The same reviewed dry run, apply and undo take SpotDraft and Juro repository exports (documents with their metadata and smart fields), keeping signed copies and signing certificates where the export includes them.

*Acceptance:* journeys with documented-shape SpotDraft and Juro fixtures each import 30 records with files, metadata and certificates and undo cleanly.

*Status:* missing. No SpotDraft or Juro kit exists.

#### MOVE-005 — PandaDoc and Adobe Acrobat Sign archives.
Completed PandaDoc documents and Adobe Acrobat Sign agreements, with their audit trails, import like `MOVE-001`: originals and certificates byte-for-byte, imported execution records and proposed terms.

*Acceptance:* journeys with documented-shape PandaDoc and Acrobat Sign archives import completed documents with their audit trails and refuse incomplete ones in the dry run.

*Status:* missing. Only the DocuSign kit exists.

#### MOVE-006 — Ironclad workflows in progress at cutover.
On the day the Ironclad licence ends, a buyer still has active workflows mid-negotiation. The kit reads them from Ironclad's Workflows API: each workflow's ID, template or third-party paper, launch-form answers, current step, assignees, documents and counterparty. A dry run lists each one as an open Locket agreement at its matching stage. Workflows in create or review steps become drafts, and those in approval or signature steps become agreements in review. The latest document comes in as the current version and the counterparty's files as counterparty versions, byte-for-byte with their digests. Launch-form answers become request fields, and the Ironclad workflow ID is kept and searchable. Approvals and signatures given in Ironclad never carry over: each imported workflow is approved again under `APPROVE-001`. A workflow already out for signature in Ironclad is listed, so the owner can finish it there and import the signed copy under `MOVE-002`, or prepare a new signature package in Locket. Apply and undo follow `MOVE-001`.

*Acceptance:* a journey with a Workflows API fake holds 5 active workflows: two in review, two in negotiation with counterparty markups, and one approved and out for signature. After the dry run and apply, five open agreements appear in the request queue (`INTAKE-006`) at their mapped stages. Their latest documents and counterparty files match the fake's digests, and each shows its Ironclad workflow ID. None carries an approval, and one is then approved under `APPROVE-001`. The workflow out for signature is listed for the owner's decision. A live run against an Ironclad sandbox's Workflows API is recorded before the clause is accepted.

*Status:* missing. No Ironclad workflow import exists.

#### MOVE-007 — Ironclad Clickwrap acceptance history.
A buyer moving clickwrap to `SIGN-004` keeps proof of who accepted what. The kit reads the acceptance activity from Ironclad Clickwrap (its activity export or REST API): the signer's identifier and email, the contract and version accepted, acceptance time, IP address, and each version's document. It imports them as acceptance records labelled imported, linked to each terms version kept byte-for-byte. From then on, Locket's own versions and re-acceptance rules apply. Apply and undo follow `MOVE-001`.

*Acceptance:* a journey with a documented-shape Ironclad Clickwrap fixture of 200 acceptances over two terms versions imports them as labelled imported acceptances with their versions and digests. A user who accepted only version 1 is prompted to accept Locket's next published version under `SIGN-004`. The export lists imported and native acceptances distinctly, and an unused batch undoes cleanly.

*Status:* missing. No clickwrap import exists.

## Push further

Agents serve the job beyond what today's up-and-comers ship: they connect what was negotiated to what actually happens, and carry authorised work to a verified outcome. Each agent works through the same API and checks as people (`PROPOSE-001`), reads only what its grant allows, and changes nothing outside Locket without an explicit approval naming the exact action.

#### AGENT-001 — Invoices reconciled against signed terms.
*What the agent does:* joins each executed agreement's confirmed pricing, rate cards, price-increase caps, discounts, payment terms and amendments with the bills, invoices, credits and purchase orders linked through `LINK-001` and `LINK-002`, and flags overcharges, increases above the cap, missed volume discounts, early-payment terms not taken and unclaimed credits, each with the clause and transaction cited and the USD amount at stake. For an approved finding it drafts the dispute or credit request to the supplier.

*Data:* confirmed terms and families (`TERMS-001`, `REPO-008`), bills and payments from Pantry, QuickBooks Online or NetSuite, POs from Purse or Coupa.

*Human control:* counsel confirms the interpretation, finance confirms the accounting; nothing is sent to a supplier or posted to an accounting system until the finding's owner approves the exact message or entry. Rejected findings are kept with the reason and suppress identical future flags.

*Acceptance:* a journey with QuickBooks and Purse fakes holds a supplier agreement capped at 3% annual increase and invoices showing 7%; the agent flags the overcharge with the clause, invoice and $4,000 at stake, finance approves, the drafted credit request is sent through the Postmark fake only after approval, and a rejected finding on another invoice is not raised again.

*Status:* partial. Confirmed, cited terms and owned obligations exist as the agent's input (`src/locket/obligations.ts`); invoice and PO reconciliation does not exist.

#### AGENT-002 — Service levels and supplier performance.
*What the agent does:* reads service-level commitments (uptime, response and resolution times, delivery dates) from confirmed terms and compares them with performance evidence: monitoring results from Uptime, tickets from Linen or HappyToHelp, delivery records, or the supplier's own reports. It computes service credits owed under the agreement's formula, records misses as obligation breaches by the supplier, and drafts the credit claim before the claim window closes.

*Data:* confirmed service-level terms, connected monitoring and ticket data, supplier reports uploaded to the agreement.

*Human control:* the agreement's owner approves each claim and its amount; the agent never contacts the supplier directly without that approval and never changes the evidence it read.

*Acceptance:* a journey with an Uptime fake shows 99.2% monthly availability against a 99.9% commitment with a 10% credit tier; the agent computes the credit in USD, cites the clause and the monitoring evidence, shows the claim deadline, and sends the claim only after the owner approves.

*Status:* missing. No service-level comparison exists.

#### AGENT-003 — Renewal decision to verified notice delivery.
*What the agent does:* from the executed notice clause, confirmed deadline, authorised notice recipients and address (`REPO-010`) and the decision recorded under `RENEW-001`, it prepares the notice, schedules the approved send with margin before the deadline (`RENEW-006`), watches for delivery failures and missing acknowledgement, and chases through the approved alternate method (courier, second address) until delivery evidence exists or the decision-maker is told it does not.

*Data:* executed text, confirmed terms, counterparty notice details, mail and tracking events.

*Human control:* an authorised legal or commercial owner approves the content, method, recipients and send time; delivery evidence is shown as evidence, not as a claim of legally effective notice, and counsel decides whether more is needed.

*Acceptance:* a journey decides to terminate a supplier agreement 45 days before its deadline; the agent's notice is approved, sent by the Postmark fake, bounces, and the agent proposes the courier route to the notice address; after approval the tracking number is recorded and the deadline shows delivered evidence before 23:59:59 local time.

*Status:* partial. Renewal decisions, notice approval and separately recorded sending evidence exist (`src/locket/obligations.ts`); sending, delivery tracking and chasing do not exist.

#### AGENT-004 — Authorised renegotiation to an executed amendment.
*What the agent does:* under a written mandate from the decision-maker (target price, acceptable term, walk-away and which playbook positions may be offered), it drafts the counterparty email and the amendment from the template and playbook, sends each round only after approval, reads the counterparty's replies and markups (`NEG-006`, `NEG-002`), proposes the next response within the mandate, and stops at execution: the amendment is approved under `APPROVE-001`, signed under `SIGN-002`, and the family's governing terms updated under `AGENT-005`.

*Data:* the agreement family, renewal brief (`RENEW-005`), playbook, counterparty correspondence.

*Human control:* every outgoing message and version needs approval; any position outside the mandate goes back to the decision-maker; the agent never signs or accepts terms.

*Acceptance:* a journey mandates a 5% reduction with a 2-year term; the agent's first proposal is approved and sent, the counterparty fake counters at 3%, the agent proposes 4% within the mandate, a counter outside the mandate is escalated rather than answered, and the executed amendment updates the governing price on the family page.

*Status:* missing. No negotiation agent exists.

#### AGENT-005 — Governing terms across a contract family.
*What the agent does:* compares the parent agreement, order forms, statements of work and amendments; finds conflicting dates, prices, notice rights and precedence clauses; and proposes the currently governing value of each key term with the exact passages, propagating confirmed results to deadlines and obligations.

*Data:* the family's executed texts and confirmed terms (`REPO-008`).

*Human control:* counsel confirms precedence and effective terms; until resolved, derived obligations stay blocked and both candidate deadlines remain visible.

*Acceptance:* a journey adds an amendment that changes the notice period from 60 to 90 days while an order form says 30; the agent flags the conflict with three citations, both candidate deadlines show, and counsel's choice updates the renewal deadline and clears the block.

*Status:* partial. Family links and agent family proposals exist (`src/locket/agreements.ts`, `src/locket/proposals.ts`); conflict detection and governing-term propagation do not exist.

#### AGENT-006 — Signed document matches the approved version.
*What the agent does:* compares the approved version, the provider envelope, the signed document and the extracted terms; identifies edits made after approval, missing pages, missing signatures or initials and signers who differ from the routing; and refreshes obligations only from a confirmed execution.

*Data:* approved package and manifest (`SIGN-001`), signed file and certificate (`EXEC-001`, `EXEC-002`), OCR text (`REPO-002`).

*Human control:* owner or counsel accepts any mismatch with a reason; the agent never signs, never invents a certificate and never treats a changed document as approved.

*Acceptance:* a journey returns a signed PDF whose liability cap was changed after approval; the agent flags the passage, the agreement stays unsigned under `EXEC-001`, and counsel's acceptance with a reason is recorded; a clean return executes without intervention.

*Status:* partial. Exact approved-version handoff and execution mismatch holds exist (`src/locket/execution.ts`); text comparison of the signed document does not exist.

#### AGENT-007 — Exceptions become measured playbook changes.
*What the agent does:* compares approved exceptions, counterparty negotiation outcomes and later operational issues (disputes, missed obligations, credits from `AGENT-001` and `AGENT-002`), and recommends a revised clause position with examples, the expected effect on cycle time (`REPORT-001`) and the agreements that would have been affected.

*Data:* findings, exception approvals, negotiation versions, outcomes.

*Human control:* counsel approves a new playbook version and chooses where it applies; signed agreements and earlier approvals never change.

*Acceptance:* a journey with 30 fixture negotiations where a liability fallback was accepted 22 times; the agent recommends making it a standard alternative with the 22 citations and predicted cycle-time saving, counsel approves a new playbook version, and earlier findings still cite the old version.

*Status:* partial. Versioned playbooks and recorded exception decisions exist (`src/locket/review.ts`, `src/locket/library.ts`); exception analysis and recommendations do not exist.

#### AGENT-008 — Obligation remediation to verified evidence.
*What the agent does:* for an overdue or at-risk obligation (an expired certificate of insurance, a missing SOC 2 report, an unreturned data-destruction certificate, our own late deliverable), it identifies the responsible party, drafts the request to the supplier contact or the internal owner, chases on schedule, checks returned evidence against the requirement (coverage amount, dates, named insured) and marks the obligation fulfilled only when the evidence matches.

*Data:* confirmed obligations (`OBL-001`, `OBL-002`), counterparty contacts, returned documents.

*Human control:* the obligation's owner approves outbound requests and the chase schedule; a person confirms any evidence the agent cannot verify fully; the agent never waives an obligation.

*Acceptance:* a journey lets a supplier's certificate of insurance expire; the agent's approved request goes to the supplier contact, an uploaded certificate with $1M coverage against a $2M requirement is rejected with the reason, and a compliant certificate marks the obligation done with the evidence attached.

*Status:* missing. No remediation agent exists.

#### AGENT-009 — Missed obligations and avoidable spend report.
*What the agent does:* each month it reports, in USD where measurable, deadlines missed or met late, auto-renewals that renewed without a recorded decision, overdue obligations on both sides, overcharges and credits found and recovered (`AGENT-001`, `AGENT-002`) and spend on agreements past their end date, each figure linking to its evidence, and compares with prior months.

*Data:* deadlines, decisions, obligations, reconciliation findings, accounting links.

*Human control:* read-only; the owner chooses recipients, and the report shows only what each recipient may see.

*Acceptance:* a journey on a fixture year of activity produces the monthly report whose counts and dollar totals equal queries over the same data, with every figure linked to its records, delivered to two recipients with different access.

*Status:* missing. No outcome reporting exists.

## Decided defaults

- **Name:** Locket (working name; no legal name clearance claimed).
- **First market:** the United States. USD, US time zones and US state governing law by default (`US-001`); other jurisdictions are recorded but no multi-jurisdiction validity claim is made. Templates and execution requirements need the owner's qualified review.
- **Approval:** commercial approval always; exceptions by the rule's authority; requester self-approval refused except for the owner; configured rules add approvers (`APPROVE-002`).
- **Notice deadline:** end date minus notice days, at 23:59:59 local time in the agreement's zone, optionally rolled to the previous US business day (`US-001`).
- **Reminders:** 90, 60, 30 and 7 days before each notice deadline, escalation at 30 days without a decision (`RENEW-002`).
- **Approval reminders:** after 1 business day, then daily; escalation to the delegate after 3 business days (`APPROVE-004`).
- **AI and OCR:** offered for a provider and model only after a passing live run on the named labelled sets (`REVIEW-006`).
- **Move-in order:** DocuSign archive (shipped), then Ironclad, PandaDoc and Adobe Acrobat Sign, then Icertis, Agiloft, SpotDraft and Juro. Only an authorised real export with original bytes, source IDs and disclosed missing files is accepted as owner move-in evidence.
- **Limits:** today 5 MB per uploaded file and 6 MB per move-in batch; the target is 50 MB per file and streamed batches of up to 10,000 files (`REPO-003`).

## Honest boundaries

Locket owns the contract lifecycle. These jobs stay with the buyer's chosen services or with a sibling product, and Locket keeps their credentials, states and failures visible on the record.

| Locket does not | How the buyer gets it |
| --- | --- |
| Give legal advice, opinions on enforceability or guarantees of signatory authority | Qualified counsel controls templates, playbooks, interpretation and signing requirements; Locket records their decisions |
| Provide signature trust services, identity proofing, notarisation or qualified electronic signatures | Inkwell, Docusign, Adobe Acrobat Sign or Dropbox Sign, connected under `SIGN-002` and `SIGN-003`; remote online notarisation through the provider's notary service |
| Rebuild Microsoft Word | DOCX originals are kept, tracked changes read and written (`NEG-002`), and Word itself is used through the add-in (`NEG-003`) |
| Act as the ledger, pay suppliers, raise POs or bill customers | Pantry, QuickBooks Online, NetSuite, Purse, Coupa, Nectar and Stripe Billing, linked under `LINK-*` |
| Operate an email carrier, a mail house or a model | Postmark (or the installation's Base mail provider) for email; a certified-mail or courier service for letters with tracking recorded (`RENEW-006`); the owner's chosen OCR and model provider (`REVIEW-005`) |
| Manage legal matters, litigation, e-discovery or outside-counsel billing | Satchel or Clio; agreements link to the matter |
| Hold its own SOC 2 report for software the buyer runs in their own Cloudflare account | The completed security questionnaire and shared-responsibility split (`OPS-001`), with Cloudflare's SOC 2 Type II report for the platform |
| Claim EU, UK or other non-US regulatory compliance, or hold a health-data agreement | US-first; other jurisdictions' requirements are recorded as clauses when a buyer needs them, with counsel's review |

## Status

Judged from the code and tests at commit `60d8141678e03c5186ab053e58f0ed92e8c1074e` (17 October 2026).

| Clauses | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Published | 19 | 0 | 0 | 19 |
| Target and push further | 0 | 37 | 42 | 79 |
| All | 19 | 37 | 42 | 98 |

| Clause | Title | Kind | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| `REPO-001` | Import a legacy agreement | published | done | `tests/api/flows.test.mjs`; `src/locket/agreements.ts` |  |
| `INTAKE-001` | Capture a request | published | done | `tests/api/flows.test.mjs`; `src/locket/agreements.ts` |  |
| `DRAFT-001` | Use an approved template | published | done | `tests/api/flows.test.mjs`; `src/locket/library.ts` |  |
| `PLAY-001` | Maintain the clause playbook | published | done | `tests/api/flows.test.mjs`; `src/locket/library.ts` |  |
| `NEG-001` | Negotiate in versions | published | done | `tests/api/flows.test.mjs`; `src/locket/diff.ts` |  |
| `REVIEW-001` | Record review findings | published | done | `tests/api/flows.test.mjs`; `src/locket/review.ts` |  |
| `APPROVE-001` | Approve the exact version | published | done | `tests/api/flows.test.mjs`; `src/locket/review.ts` |  |
| `SIGN-001` | Prepare for signature with any provider | published | done | `tests/api/flows.test.mjs`; `src/locket/execution.ts` |  |
| `EXEC-001` | Record and reconcile execution | published | done | `tests/api/flows.test.mjs`; `src/locket/execution.ts` |  |
| `TERMS-001` | Confirm terms and obligations | published | done | `tests/api/flows.test.mjs`; `src/locket/obligations.ts` |  |
| `RENEW-001` | Work the renewal queue | published | done | `tests/api/flows.test.mjs`; `src/locket/dates.ts` |  |
| `PORT-001` | Search, export and restore | published | done | `tests/api/flows.test.mjs`; `tests/portable.mjs` |  |
| `ROLE-001` | Six roles enforced on the server | published | done | `tests/api/security.test.mjs`; `src/locket/access.ts` |  |
| `SEC-001` | Writes recheck session, role and version atomically | published | done | `tests/api/security.test.mjs`; `src/locket/commands.ts` |  |
| `SEC-002` | Retried commands return their first outcome | published | done | `tests/api/security.test.mjs`; `src/locket/commands.ts` |  |
| `ACCESS-001` | Restricted agreements are invisible to others | published | done | `tests/api/security.test.mjs`; `src/locket/records.ts` |  |
| `FILE-001` | Originals keep their exact bytes | published | done | `tests/api/flows.test.mjs`; `src/locket/artifacts.ts` |  |
| `PROPOSE-001` | Agents prepare, people approve | published | done | `tests/api/flows.test.mjs`; `tests/api/security.test.mjs`; `src/locket/proposals.ts` |  |
| `MOVE-001` | DocuSign archive move-in | published | done | `tests/api/move-in.test.mjs`; `src/locket/imports/docusign.ts` |  |
| `INTAKE-002` | Configurable request forms and routing | target | partial | `src/locket/agreements.ts` | The form designer, conditional fields, rule-based routing and preview do not exist |
| `INTAKE-003` | Email intake | target | missing |  | No inbound email path exists |
| `INTAKE-004` | CRM intake and status writeback: Salesforce, HubSpot and Orbit | target | missing |  | No CRM connector exists |
| `INTAKE-005` | Slack, Microsoft Teams and Nook intake and updates | target | missing |  | No chat connector exists |
| `INTAKE-006` | Request queue, assignment and service levels | target | partial | `src/locket/views.ts`; `tests/browser/journey.spec.ts` | Assignees, assignment rules, service levels and escalation do not exist |
| `INTAKE-007` | Third-party paper read at intake | target | partial | `src/locket/proposals.ts` | Built-in extraction does not exist |
| `REPO-002` | PDF text and OCR | target | partial | `src/locket/docx.ts` | PDF text extraction and OCR do not exist |
| `REPO-003` | Bulk repository import with extraction | target | partial | `src/locket/imports/commands.ts`; `tests/api/move-in.test.mjs` | Generic PDF/DOCX bulk import, OCR, extraction and large-file streaming do not exist |
| `REPO-004` | Built-in term and metadata extraction | target | partial | `src/locket/proposals.ts`; `src/locket/obligations.ts` | Built-in extraction and custom fields do not exist |
| `REPO-005` | Custom metadata fields | target | missing |  | Agreement fields are fixed in the schema |
| `REPO-006` | Search and structured filters | target | partial | `src/locket/views.ts`; `src/ui/register.tsx`; `tests/api/flows.test.mjs` | OCR text, field, value and date filters and clause-level hits do not exist |
| `REPO-007` | Saved views and columns | target | missing |  | The register has fixed columns and no saved views |
| `REPO-008` | Agreement families | target | partial | `src/locket/agreements.ts` | The family page and governing-term view do not, and no flow test exercises family links |
| `REPO-009` | Groups, departments and field-level access | target | partial | `src/locket/access.ts`; `tests/api/security.test.mjs` | Groups, departments and field-level hiding do not exist |
| `REPO-010` | Counterparty records | target | partial | `src/locket/agreements.ts` | Entity details, notice addresses, signatories, merging and the counterparty page do not exist |
| `REPO-011` | Bulk repository actions | target | missing |  | The register has no selection or bulk actions |
| `DRAFT-002` | Word documents from templates | target | partial | `src/locket/library.ts`; `src/locket/pdf.ts` | DOCX output with preserved formatting and answer-driven conditional clauses do not exist |
| `DRAFT-003` | Clause library in negotiation | target | partial | `src/locket/library.ts` | A searchable library, insertion during negotiation and usage counts do not exist |
| `DRAFT-004` | Templates authored from existing Word documents | target | missing |  | Templates are authored as text in Locket |
| `PLAY-002` | Playbooks drafted from templates and history | target | missing |  | Playbooks are authored by hand only |
| `NEG-002` | Word tracked changes round-trip | target | partial | `src/locket/docx.ts`; `src/locket/diff.ts` | Tracked changes and comments are not read or written |
| `NEG-003` | Locket for Word add-in | target | missing |  | No Word add-in exists |
| `NEG-004` | Browser redlining and threaded comments | target | partial | `src/locket/diff.ts`; `src/locket/agreements.ts` | In-browser editing, threads, mentions and resolution do not exist |
| `NEG-005` | Internal and external sides of a negotiation | target | partial | `src/locket/agreements.ts` | Internal and external marking, sharing and stripping do not exist |
| `NEG-006` | Counterparty exchange by email and secure link | target | missing |  | Exchange with counterparties happens outside Locket |
| `REVIEW-002` | Built-in playbook review | target | partial | `src/locket/review.ts`; `src/locket/proposals.ts`; `tests/api/flows.test.mjs` | The built-in model run does not exist |
| `REVIEW-003` | AI redlines a person edits before sending | target | partial | `src/locket/review.ts` | Turning findings into tracked changes does not exist |
| `REVIEW-004` | Ask the repository | target | missing |  | No question answering exists |
| `REVIEW-005` | Model choice, records and switch-off | target | missing |  | Locket makes no model calls |
| `REVIEW-006` | Live accuracy evidence for review, extraction and OCR | target | missing |  | No evaluation command, labelled set or recorded live run exists |
| `REVIEW-007` | Plain-English summary of one agreement | target | missing |  | No summaries exist |
| `APPROVE-002` | Conditional approval rules in USD | target | partial | `src/locket/review.ts`; `tests/api/flows.test.mjs` | Configurable value, department and condition rules, ordering and delegates do not exist |
| `APPROVE-003` | Approve where people work | target | missing |  | Approvals are given only in the Locket screens |
| `APPROVE-004` | Approval reminders and escalation | target | missing |  | Approvals send no reminders |
| `SIGN-002` | Live Docusign, Adobe Acrobat Sign and Dropbox Sign | target | partial | `src/locket/execution.ts`; `tests/api/flows.test.mjs` | Live sending, webhooks, reminders and voiding do not exist |
| `SIGN-003` | Inkwell signing | target | missing |  | No Inkwell connection exists |
| `EXEC-002` | Automatic retrieval and filing of executed agreements | target | partial | `src/locket/execution.ts` | Automatic retrieval, filing and notification do not exist |
| `SIGN-004` | Clickwrap acceptance of published terms | target | missing |  | No clickwrap capability exists |
| `SIGN-005` | Signer rules, signature fields and multi-document packets | target | partial | `src/locket/execution.ts`; `tests/api/flows.test.mjs` | Signer rules, the fallback signer, template signature blocks, field placement and multi-document packets do not exist |
| `OBL-001` | Obligation extraction, owners and status | target | partial | `src/locket/obligations.ts`; `tests/api/flows.test.mjs` | Built-in extraction, status values beyond done and owner lists do not exist |
| `OBL-002` | Fulfilment evidence and escalation | target | partial | `src/locket/obligations.ts` | Evidence requirements, overdue escalation and risk ratings do not exist |
| `RENEW-002` | Delivered reminders and escalation by email | target | partial | `src/locket/obligations.ts`; `src/locket/dates.ts` | No reminder is scheduled or sent |
| `RENEW-003` | Deadlines on Google Calendar and Outlook | target | missing |  | No calendar connection exists |
| `RENEW-004` | Bulk reminders for imported contracts | target | missing |  | Reminder schedules do not exist |
| `RENEW-005` | Renewal briefs and renewal workflows | target | partial | `src/locket/obligations.ts`; `src/locket/proposals.ts` | Briefs and renewal-request creation do not exist |
| `RENEW-006` | Send approved notices with delivery evidence | target | partial | `src/locket/obligations.ts`; `tests/api/flows.test.mjs` | Sending from Locket and provider delivery events do not exist |
| `LINK-001` | Accounting links: Pantry, QuickBooks Online and NetSuite | target | missing |  | No accounting connection exists |
| `LINK-002` | Procurement links: Purse and Coupa | target | missing |  | No procurement connection exists |
| `LINK-003` | Proposal and billing handoffs: Platter and Nectar | target | missing |  | No proposal or billing connection exists |
| `INT-001` | Google Drive, OneDrive/SharePoint and Chest | target | missing |  | No storage connection exists |
| `INT-002` | Public API, webhooks, Zapier and Crank | target | partial | `src/locket/api.ts`; `API.md` | Scoped tokens, webhooks and the Zapier and Crank apps do not exist |
| `INT-003` | SSO and SCIM provisioning | target | partial | `src/locket/people.ts`; `src/locket/access.ts` | SSO and SCIM do not exist |
| `INT-004` | Connection health | target | missing |  | No connections exist yet |
| `NOTIFY-001` | Notifications and preferences | target | missing |  | Locket sends no notifications |
| `US-001` | US defaults | target | partial | `src/locket/model.ts`; `src/locket/dates.ts` | Values are stored and shown in AUD, the default zone is Australia/Sydney, counterparties carry an ABN, and US defaults, business-day rolling and multi-currency do not exist |
| `AUDIT-001` | Filterable activity audit trail | target | partial | `src/locket/views.ts`; `tests/api/flows.test.mjs` | Filtering, CSV export and view and download events are absent |
| `ERASE-001` | Personal-data erasure with legal hold | target | missing |  | No erasure, hold or retention capability exists |
| `ENTITY-001` | Our contracting entities | target | missing |  | Agreements have no record of our contracting entity |
| `OPS-001` | Self-hosted install, updates and security answers | target | partial | `OPERATIONS.md`; `deploy.json`; `tests/portable.mjs` | The release cadence, the one-command update with an automatic export and the security questionnaire do not exist |
| `REPORT-001` | Cycle time, throughput and bottlenecks | target | missing |  | No analytics exist |
| `REPORT-002` | Custom and scheduled reports | target | missing |  | No reports or schedules exist |
| `REPORT-003` | Portfolio dashboard | target | missing |  | The register lists agreements and next deadlines without a dashboard |
| `MOBILE-001` | Phone-width web app | target | partial | `tests/browser/journey.spec.ts` | Approval from notification links and camera upload are not exercised |
| `MOBILE-002` | iOS and Android apps | target | missing |  | No native apps exist |
| `MOVE-002` | Ironclad move-in | target | missing |  | Only the DocuSign kit exists |
| `MOVE-003` | Icertis and Agiloft move-in | target | missing |  | No Icertis or Agiloft kit exists |
| `MOVE-004` | SpotDraft and Juro move-in | target | missing |  | No SpotDraft or Juro kit exists |
| `MOVE-005` | PandaDoc and Adobe Acrobat Sign archives | target | missing |  | Only the DocuSign kit exists |
| `MOVE-006` | Ironclad workflows in progress at cutover | target | missing |  | No Ironclad workflow import exists |
| `MOVE-007` | Ironclad Clickwrap acceptance history | target | missing |  | No clickwrap import exists |
| `AGENT-001` | Invoices reconciled against signed terms | push-further | partial | `src/locket/obligations.ts` | Invoice and PO reconciliation does not exist |
| `AGENT-002` | Service levels and supplier performance | push-further | missing |  | No service-level comparison exists |
| `AGENT-003` | Renewal decision to verified notice delivery | push-further | partial | `src/locket/obligations.ts` | Sending, delivery tracking and chasing do not exist |
| `AGENT-004` | Authorised renegotiation to an executed amendment | push-further | missing |  | No negotiation agent exists |
| `AGENT-005` | Governing terms across a contract family | push-further | partial | `src/locket/agreements.ts`; `src/locket/proposals.ts` | Conflict detection and governing-term propagation do not exist |
| `AGENT-006` | Signed document matches the approved version | push-further | partial | `src/locket/execution.ts` | Text comparison of the signed document does not exist |
| `AGENT-007` | Exceptions become measured playbook changes | push-further | partial | `src/locket/review.ts`; `src/locket/library.ts` | Exception analysis and recommendations do not exist |
| `AGENT-008` | Obligation remediation to verified evidence | push-further | missing |  | No remediation agent exists |
| `AGENT-009` | Missed obligations and avoidable spend report | push-further | missing |  | No outcome reporting exists |
