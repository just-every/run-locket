<!-- Generated from CONTRACT.md by contract-docs. Edit CONTRACT.md, then regenerate. -->

# Accept a Locket installation

The primary journey: request an agreement, draft and negotiate it, review its cited findings, approve the exact version, hand it to signing, reconcile the returned evidence, then follow obligations and renewal decisions to their recorded outcomes.

## Progress

| Tier | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Core | 38 | 59 | 28 | 125 |
| Agent surface | 0 | 0 | 13 | 13 |
| Later | 0 | 0 | 0 | 0 |
| Full target | 38 | 59 | 41 | 138 |

Judged from the code and tests at commit `5fb535c943584da9c28f588dc3e510fbfb688459` (27 October 2026). Field proof register: 8 rows; 0 passed, 0 failed, 8 not run.

## Core

### Released flows

#### REPO-001 — Import a legacy agreement

Core · published · **done** · Cites BASE-INPUT-003 · Rules D-1

**Requirement.** A person uploads a PDF or DOCX with where it came from and its source ID. Locket keeps the original bytes and SHA-256, the source system and ID, the original filename, who imported it and when, and reads DOCX text. The same bytes or the same source ID cannot be imported twice.

**Acceptance.**
1. downloading the stored file and comparing bytes and digest, and the refused duplicates .

**Evidence.** `tests/api/flows.test.mjs` — “01 legacy PDF and DOCX keep original bytes, source identity and provenance”
**Gap.** None.

#### INTAKE-001 — Capture a request

Core · published · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-ROLE-001 · Rules D-1

**Requirement.** A requester records title, request type, counterparty (existing or new), value, responsible person, needed-by and start dates, and whether it is restricted. Each type carries its default required attachments (`US-001`), and more can be added. A request cannot go to review while a required attachment is missing unless owner or counsel waives it with a reason. Amendments and order forms must name their parent agreement.

**Acceptance.**
1. the stored request and the refused submission until the attachment is present .

**Evidence.** `tests/api/flows.test.mjs` — “02 intake captures the deal and blocks review until required attachments are present”
**Gap.** None.

#### DRAFT-001 — Use an approved template

Core · published · **done** · Rules D-1

**Requirement.** Owner or counsel author versioned templates with fields and clause wordings, and approve a version for use. A requester can only populate an approved version; required fields must be filled; the chosen clause wording is recorded. A later template version never rewrites a version already produced.

**Acceptance.**
1. the refusal of a draft template, the populated text and the unchanged earlier version .

**Evidence.** `tests/api/flows.test.mjs` — “03 only an approved template version populates a request, with its fields and chosen clauses”
**Gap.** None.

#### PLAY-001 — Maintain the clause playbook

Core · published · **done** · Rules D-1

**Requirement.** Owner or counsel keep versioned rules: preferred wording, allowed alternatives and who decides exceptions (counsel or approver). One version is active; each review finding records the playbook version it used.

**Acceptance.**
1. activation superseding the earlier version and findings citing it .

**Evidence.** `tests/api/flows.test.mjs` — “04 the clause playbook is versioned and reviews cite the version they used”
**Gap.** None.

#### NEG-001 — Negotiate in versions

Core · published · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003 · Rules D-1

**Requirement.** People add our revisions and counterparty markups (PDF or DOCX), compare any two versions line by line, and comment with quoted passages. D-1 applies. A version added against a stale view of the agreement is refused.

**Acceptance.**
1. the comparison of two DOCX versions and the untouched downloads .

**Evidence.** `tests/api/flows.test.mjs` — “05 successive negotiation versions compare line by line and keep untouched originals and comments”
**Gap.** None.

#### REVIEW-001 — Record review findings

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-ROLE-001 · Rules D-1

**Requirement.** A reviewer records, against a playbook rule, whether the rule is met, breached or cannot be determined, citing the exact passage by position and quote (checked against the version text), with proposed wording and open questions. An agent’s finding application carries standard; the company’s policy decides whether it is applied or held. Agent calls carry standard as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard, the refused mismatched quote and, under the held company policy for standard, counsel releases an agent’s prepared findings .

**Evidence.** `tests/api/flows.test.mjs` — “06 review findings cite exact passages, separate met, breached and cannot-determine, and agents only propose”
**Gap.** A company-policy journey must apply a finding under all autonomous as well as the held policy; the cited flow proves the old held proposal path.

#### APPROVE-001 — Approve the exact version

Core · published · **done** · Cites BASE-INPUT-003, BASE-ROLE-001 · Rules D-1

**Requirement.** Every agreement needs commercial approval (owner or approver); each breached or undetermined finding needs an exception decision by the rule's authority. The requester cannot approve their own request unless they are the owner. Approvals pin version identity and decision context; a new version, a signing PDF or a value change withdraws them and the agreement returns to review.

**Acceptance.**
1. the route, the role refusals, and the withdrawal after a new version and after a value change .

**Evidence.** `tests/api/flows.test.mjs` — “07 approvals route exceptions to the right authority and pin the exact version and context”
**Gap.** None.

#### SIGN-001 — Prepare for signature with any provider

Core · published · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003 · Rules D-1

**Requirement.** From an approved version Locket produces the signature-ready PDF (the approved PDF itself; a text PDF for template versions; DOCX versions need the PDF they will be signed as, attached and approved first) and a routing manifest naming version identity, document SHA-256, approvals, provider and ordered recipients. A person can send it through Docusign, Adobe Acrobat Sign, Dropbox Sign, PandaDoc, Documenso, DocuSeal, paper or another route and record the envelope ID; this manual route stays available beside the live connections in `SIGN-002` and `SIGN-003`.

**Acceptance.**
1. the downloaded PDF and manifest and the recorded handoff .

**Evidence.** `tests/api/flows.test.mjs` — “08 an approved version becomes a signature-ready PDF and routing manifest for the existing provider”
**Gap.** None.

#### EXEC-001 — Record and reconcile execution

Core · published · **done** · Cites BASE-INPUT-003 · Rules D-1

**Requirement.** The signed PDF and the provider's certificate are recorded (uploaded by a person, or retrieved by `EXEC-002`). Locket reconciles the envelope ID with the handoff, the signers with the package's signers, the document (confirmation and page count) and the certificate's presence. A clean match marks the agreement executed; a mismatch stays unsigned until owner or counsel accepts it with a reason. The same signed file or envelope cannot be recorded twice.

**Acceptance.**
1. a reconciled execution, a mismatch held for review, and a refused duplicate .

**Evidence.** `tests/api/flows.test.mjs` — “09 execution ingests the signed file and certificate and reconciles envelope, signers and document”
**Gap.** None.

#### TERMS-001 — Confirm terms and obligations

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-AUDIT-001, BASE-INPUT-003 · Rules D-1

**Requirement.** People propose effective and end dates, auto-renewal, renewal term, notice period, governing law and payment terms, each citing words from the executed text (or a signed-PDF page when there is no text). Owner, counsel or approver confirm or reject each. Correcting a confirmed term supersedes it and keeps the history. Obligations have an owner, due date and recurrence; they are confirmed and then marked done. The renewal type, renewals allowed and the term roll-forward built on these terms are `RENEW-007`. Agent calls carry standard or commitment as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard or commitment, an agent's terms confirmed by an approver, a correction that keeps the superseded value, and an obligation through to done .

**Evidence.** `tests/api/flows.test.mjs` — “10 terms and obligations are confirmed against the executed text, and corrections keep history”
**Gap.** A company-policy journey must confirm terms under both policies; the cited flow proves a person-confirmed proposal and retained corrections.

#### RENEW-001 — Work the renewal queue

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** Confirmed end date and notice period produce the notice deadline: the end of the deadline day (23:59:59) in the agreement's IANA time zone, including daylight-saving changes. Under the held company policy for standard or commitment, owner or approver decide renew, renegotiate or terminate; a notice is drafted (by a person or an agent proposal), approved for sending by owner or approver (not by its preparer unless owner), and then recorded as sent with method, time and optional evidence. `RENEW-007` extends the deadline to auto-renewing agreements, computing it from the current term rather than an end date already past. Agent calls carry commitment and external as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. deadlines on both sides of a daylight-saving change and a notice that stays "approved, not sent" until sending is recorded .

**Evidence.** `tests/api/flows.test.mjs` — “AGENT-003 / RENEW-001 the renewal queue computes notice deadlines in the agreement time zone and keeps sending evidence separate”
**Gap.** A company-policy journey must decide and send a renewal notice under both policies; cited native journeys prove the held-person path and deadline calculations.

#### PORT-001 — Search, export and restore

Core · published · **done** · Cites BASE-DATA-001, BASE-INPUT-003, BASE-ROLE-001 · Rules D-1

**Requirement.** People search accessible agreement titles, counterparties, references and version text. Locket’s archive retains source identities and exact contract digests; after restoring, the owner can undo a restored unused move-in batch.

**Acceptance.**
1. Search a populated restricted/unrestricted repository, open the archive and compare the contract records, provenance and digests, then restore and undo the unused imported batch.

**Evidence.** `tests/api/flows.test.mjs` — “12 search returns only agreements the person may access, and the owner exports every record and file”; `tests/portable.mjs` — “Full public-command portability proof”
**Gap.** None.

### Released safeguards

#### ROLE-001 — Six roles enforced on the server

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-ROLE-001 · Rules D-1

**Requirement.** Roles are **owner** (everything), **counsel** (library, legal exceptions, restricted agreements, execution mismatches), **approver** (commercial approval, renewal decisions, notice approval), **requester** (requests, versions, attachments, signature handoff), **viewer** (reads) and **agent** (legacy proposal identity; sponsored agents use the sponsor’s role and company policy). The installation's native owner is always owner; other operators are invited through Base sign-in and given a Locket role. REPO-007's personal saved-view preferences are available to every human role, including viewers; this never permits a business-record write, and sponsored agents’ preference writes carry standard under company policy. Agent calls carry access as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard, external and commitment, signed-out and cross-site requests, viewers, agents and demoted approvers refused by the server .

**Evidence.** `tests/api/saved-views.test.mjs` — “REPO-007 ROLE-001 saved views execute current visible agreements identically on screen and CSV, with personal pins and creator revisions”
**Gap.** A sponsored-agent journey must use the sponsor’s current role and company policy; cited native journeys prove legacy agent-role refusals and saved-view preferences.

#### SEC-001 — Writes recheck session, role and version atomically

Core · published · **done** · Cites BASE-ACCESS-002, BASE-AGENT-002, BASE-AGENT-006, BASE-ROLE-001 · Rules D-1

**Requirement.** Locket business writes atomically compare agreement and related-record revisions with their writes, so a change after preparation saves none of the prepared batch.

**Acceptance.**
1. a revoked session and a decision against a stale snapshot both refused with no write .

**Evidence.** `tests/api/security.test.mjs` — “sessions, roles, idempotent commands and stale writes are enforced by the server”
**Gap.** None.

#### SEC-002 — Retried commands return their first outcome

Core · published · **done** · Rules D-1

**Requirement.** Every command carries a command identity. Retrying the same identity and content returns the first outcome; reusing it for different content is refused.

**Acceptance.**
1. a retried command returning its first result and a reused identity with new content refused .

**Evidence.** `tests/api/security.test.mjs` — “sessions, roles, idempotent commands and stale writes are enforced by the server”
**Gap.** None.

#### ACCESS-001 — Restricted agreements are invisible to others

Core · published · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003, BASE-ROLE-001 · Rules D-1

**Requirement.** A restricted agreement and everything attached to it (versions, files, findings, approvals, terms, proposals, counterparty, search hits) is visible only to the owner, counsel, its requester, its responsible person and people explicitly granted access. To anyone else it does not exist.

**Acceptance.**
1. an agent-prepared restricted request, counterparty included, hidden from everyone outside it, and restricted search results hidden .

**Evidence.** `tests/api/security.test.mjs` — “a restricted request prepared by an agent stays hidden, counterparty included, from everyone outside it”
**Gap.** None.

#### FILE-001 — Originals keep their exact bytes

Core · published · **done** · Cites BASE-INPUT-003 · Rules D-1

**Requirement.** Uploaded, signed, certificate and imported files are stored with their SHA-256 and served byte-for-byte with the digest in a response header; nothing rewrites an original.

**Acceptance.**
1. downloads compared byte for byte with their uploads .

**Evidence.** `tests/api/flows.test.mjs` — “01 legacy PDF and DOCX keep original bytes, source identity and provenance”
**Gap.** None.

#### PROPOSE-001 — Evidenced agent proposals and decisions

Core · published · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** An agent uses the same business actions for its named sponsor, through the [documented API](API.md). It prepares proposals with evidence and assumptions: intake details, playbook findings, agreement-family links, extracted terms and renewal notice drafts. Approval runs the same checks as doing the work by hand, records who prepared and who decided, and links the result to the proposal. Applying findings carries standard, sending carries external and a binding confirmation or signature carries commitment; the company’s policy decides each call. A person’s own decision remains subject to the requester conflict rule. Agent calls carry standard, external and commitment as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard, external and commitment, agent findings and terms applied only after a person's approval, and agent writes refused .

**Evidence.** `tests/api/flows.test.mjs` — “01 legacy PDF and DOCX keep original bytes, source identity and provenance”
**Gap.** A company-policy journey must run binding and outside actions under all autonomous; cited flows prove only the legacy proposal-and-person-decision path.

#### MOVE-001 — DocuSign archive move-in

Core · published · **done** · Cites BASE-AUDIT-001, BASE-INPUT-003 · Rules D-1

**Requirement.** The DocuSign kit takes an Envelope Report CSV and the downloaded completed envelopes (one folder per envelope ID with the signed PDFs and `Summary.pdf`, the Certificate of Completion). A dry run shows every row's outcome (import, not completed, missing evidence, duplicate), missing certificates and files not in the report, and writes nothing. Applying the exact reviewed dry run creates imported agreements with the signed file and certificate kept byte-for-byte, an imported execution record (never a new signature event), and end date and notice period as proposed terms. The journal keeps the report and every supplied file. An unused batch can be undone; once an imported agreement is used, undo is refused and the history stays. Shape and limits: [IMPORT.md](IMPORT.md).

**Acceptance.**
1. dry run, apply with originals, repeated envelopes unchanged, undo, re-import and refused undo once used (move-in test).

**Evidence.** `tests/api/move-in.test.mjs` — “DocuSign archive move-in: dry run, apply with originals, duplicates, undo and dependency refusal”
**Gap.** None.

### Intake and requests

#### INTAKE-002 — Configurable request forms and routing

Core · target · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003, BASE-MAIL-001, BASE-OPS-004, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-ROLE-001 · Rules D-1

**Requirement.** Owner or counsel design a request form per agreement type without code: fields (text, number, USD money, date, pick list, person, counterparty, file), conditional questions (a supplier contract over $50,000 asks for a security questionnaire), required attachments, and routing rules that assign the responsible person, reviewer and approval route by type, value, department, region and risk answers. A form or rule change is drafted, previewed against sample answers that show the resulting route and required documents, then published as a new version; requests already in flight keep the version they started with. Each form also names who may launch it, by role, group or department (`REPO-009`). Anyone else does not see the form, and a launch through the API is refused. Detailed operational rules: [the INTAKE-002 record](docs/contract/operational-details.md#intake-002).

**Acceptance.**
1. The journey creates a supplier form with a conditional security question and a rule routing values over $50,000 to counsel, limits launching to the Procurement group, previews two sample requests (one above, one below the threshold) and sees the two routes, publishes, then submits both requests through the form; an in-flight request created before publishing keeps its original route; a requester outside Procurement does not see the form and their API launch is refused.
2. The same journey follows the detailed operational rules linked in the Requirement, including their authority, version, source, refusal and recorded-outcome conditions.

**Evidence.** `tests/browser/journey.spec.ts` — “INTAKE-002 supplier form previews, publishes, freezes routes and limits launching at 1440px/390px”
**Gap.** None.

#### INTAKE-003 — Email intake

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003, BASE-MAIL-001, BASE-OPS-004 · Rules D-1

**Requirement.** Each installation has an intake address (Postmark inbound, or a forwarding rule from a Gmail or Outlook mailbox). An email to it, or a message forwarded by a staff member, becomes a draft request: the sender is matched to an operator, attachments are stored byte-for-byte as the first version and supporting files, and `INTAKE-007` proposes the request details. Mail from unknown senders is held for owner review, never auto-created. Replies on the thread attach to the same request.

**Acceptance.**
1. The journey with a Postmark inbound fake posts a forwarded counterparty MSA with a DOCX and a PDF; a draft request appears for the matched sender with both files and their digests, and proposed details awaiting confirmation.
2. A reply attaches to the same request, and mail from an unknown sender lands in the held queue.
3. A live run against a Postmark inbound stream on a Postmark test server is recorded before the clause is accepted.

**Evidence.** None.
**Gap.** No inbound email path exists

#### INTAKE-004 — CRM intake and status writeback: Salesforce, HubSpot and Orbit

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003 · Rules D-1

**Requirement.** The owner connects Salesforce, HubSpot or Orbit with OAuth. A seller starts a contract request from an opportunity or deal (a Salesforce Lightning action, a HubSpot CRM card, an Orbit deal action); account, contacts, amount in USD and close date populate the request. The deal's products (Salesforce opportunity products, HubSpot line items, Orbit deal lines) come across with product, quantity, unit price, discount and term, and fill the pricing table of the generated order form (`DRAFT-002`). Locket writes the agreement's status, current version link and, on execution, the executed PDF link and key dates back to the deal. Field mappings are visible and editable; a failed writeback is shown on the agreement and the connection (`INT-004`).

**Acceptance.**
1. The journey with a HubSpot API fake and an Orbit fake starts a request from a deal, sees the mapped fields, drives the agreement to executed and reads the deal's status, link and end date written back; a forced 500 on writeback shows a retryable failure on both the agreement and the connection.
2. A deal with three line items produces an order form whose pricing table lists them and totals the deal amount in USD.
3. The same journey runs against a Salesforce fake.
4. Live runs against a Salesforce Developer Edition org and a HubSpot developer test account are recorded before the clause is accepted.
5. The deal's HubSpot company is linked to the counterparty and shown on its `REPO-010` page.

**Evidence.** None.
**Gap.** No CRM connector exists

#### INTAKE-005 — Slack, Microsoft Teams and Nook intake and updates

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-ROLE-001 · Rules D-1

**Requirement.** A `/contract` command or message shortcut in Slack, Microsoft Teams or Nook opens the request form and creates the request as the signed-in person. Request owners and watchers receive status changes, mentions, approval requests and signature completion in a direct message or a chosen channel, each linking to the record. Messages never reveal a restricted agreement to a channel member without access. Detailed operational rules: [the INTAKE-005 record](docs/contract/operational-details.md#intake-005). Notification consent, digest and outcomes follow NOTIFY-001. RL-102 governs provider/native identity and conversation-audience authorization.

**Acceptance.**
1. a journey with a Slack API fake submits a request from the shortcut, receives the approval-needed and executed messages in direct messages, and confirms that a restricted agreement's update is withheld from a channel whose members lack access. The same journey runs against Teams and Nook fakes.
2. Map the authenticated provider identity to the actual native person. Send only generic authenticated links after every current human audience member has required agreement/field access; withhold for incomplete membership or unavailable requested digest delivery. Exclude only the verified app’s own authenticated bot; other bots/apps require explicit handling. Mapping uses owner or explicitly delegated integration-admin authority (RL-102).

**Evidence.** `tests/api/approval-mail.test.mjs`; `tests/browser/notifications.spec.ts`
**Gap.** Teams/Nook request intake, watcher lifecycle and batching remain missing. The cited Slack and notification journeys cover mapped-person intake and authorized generic messages; RL-102 is adopted and does not complete those remaining doors.

#### INTAKE-006 — Request queue, assignment and service levels

Core · target · **partial** · Cites BASE-ACCESSIBILITY-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-DATA-001, BASE-INPUT-003, BASE-ROLE-001 · Rules D-1

**Requirement.** Legal and operations see one queue of open requests with responsible person, assignee, stage, needed-by date, age and the next action, filterable by type, team and status, plus a "my work" view. Assignment rules spread new requests across a team; a person can reassign with a reason. Each type has a service level (for example an NDA turned around in 2 business days); requests close to or past it are flagged and escalated to the team lead. The requester, the responsible person, owner or counsel can cancel a request that is not yet executed, choosing a reason (deal lost, no longer needed, duplicate, replaced by another request, other with a note). A canceled request leaves the open queue, keeps its versions and history, voids any envelope out for signature (`SIGN-002`), withdraws its approvals, and stops its reminders. It appears under a Canceled filter and in `REPORT-001` as canceled with its reason and the stage it reached. The owner or counsel can reopen it with a reason. Detailed operational rules: [the INTAKE-006 record](docs/contract/operational-details.md#intake-006).

**Acceptance.**
1. The journey at 1440 and 390 pixels creates three requests, sees them assigned round-robin, reassigns one, advances the clock past an NDA's 2-business-day service level and sees it flagged and the team lead notified. It cancels one request in negotiation as "deal lost": the request leaves the open queue, appears under Canceled with its reason, and is counted in `REPORT-001`'s canceled-by-reason figures. A viewer's cancel is refused, and counsel reopens the request with a reason. The owner configures one current group, team lead and business-day interval per request type. Stable member-id order and a guarded cursor rotate new requests; inactive or non-working roles are skipped. Membership grants no agreement access: restricted requests use only existing permitted readers. Requester, responsible person, owner or counsel reassign with a reason; only owner/counsel reopen. New requests default to 2 business days for NDAs and 5 for other types until configured, using US-001 business days in the agreement zone; a warning starts one business day before the deadline.
2. The same journey follows the detailed operational rules linked in the Requirement, including their authority, version, source, refusal and recorded-outcome conditions.

**Evidence.** `tests/api/flows.test.mjs` — “INTAKE-006 rotates a guarded team queue, escalates once through personal notifications and preserves reasoned cancellations”; `tests/browser/journey.spec.ts` — “INTAKE-006 request assignment, cancellation and service levels at 1440px/390px”
**Gap.** A journey must cancel an automatically connected envelope and read back confirmed remote void or failure; cited native journeys explicitly close manual local packages and tell a person to void the provider separately.

#### INTAKE-007 — Third-party paper read at intake

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-INPUT-003, BASE-MAIL-001, BASE-OPS-004 · Rules D-1

**Requirement.** Under the held company policy for standard or commitment, when a counterparty's document arrives (upload, email or CRM), the built-in model (`REVIEW-005`) reads it and proposes the request details: agreement type, counterparty legal name, our entity, value, term, governing law and the template or playbook that applies, each citing the passage it came from. The requester confirms or corrects the proposal before the request is created. Agent calls carry standard as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard, a journey with a model-provider fake uploads a supplier's DOCX and a scanned PDF; each yields a cited proposal, a wrong value is corrected before confirmation, and the created request records who confirmed and that the source was a model proposal.
2. The clause is accepted only when a live run under `REVIEW-006` meets the intake bar.

**Evidence.** `src/locket/proposals.ts`
**Gap.** Built-in extraction does not exist

### Repository and ingestion

#### REPO-002 — PDF text and OCR

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-INPUT-003, BASE-SECRET-001 · Rules D-1

**Requirement.** Every PDF, including scanned and image-only signed copies, gets a searchable text layer with page and position anchors, run asynchronously with progress. A PDF that already carries a text layer is read directly. Scanned and image-only pages go to the OCR provider the owner chooses, with the owner's own credentials: Amazon Textract, Google Cloud Document AI (Enterprise Document OCR) or Azure AI Document Intelligence (Read model). Provider choice and switch-off sit with the model settings (`REVIEW-005`). The text layer is a derived rendition under D-1. Search, citations (`REVIEW-001`, `TERMS-001`) and extraction use it, and a person can see each page's OCR confidence and correct a misread passage, which is kept with history.

**Acceptance.**
1. a journey with an OCR-provider fake uploads a 20-page scanned agreement; the text becomes searchable, a term is cited to page 14, the original downloads with its original digest, and a corrected passage keeps the machine reading in history.
2. The same journey runs against Textract, Document AI and Document Intelligence fakes.
3. The clause is accepted only when a live OCR run under `REVIEW-006` meets the OCR bar with at least one named provider.

**Evidence.** `src/locket/docx.ts`
**Gap.** PDF text extraction and OCR do not exist

#### REPO-003 — Bulk repository import with extraction

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-INPUT-003, BASE-ROLE-001 · Rules D-1

**Requirement.** An owner imports a legacy repository in bulk: a ZIP or folder of up to 10,000 PDF and DOCX files (files up to 50 MB, batches streamed in parts), or a connected Google Drive, OneDrive/SharePoint or Chest folder (`INT-001`), with an optional metadata CSV. Locket deduplicates by digest, runs OCR (`REPO-002`) and extraction (`REPO-004`), infers agreement families, and shows a reconciliation report (imported, duplicate, unreadable, needs review) before anything is used. Extracted parties, dates, renewal terms and USD values stay proposed until confirmed, individually or in bulk by a reviewer who has sampled them. On the day an imported agreement's renewal terms are confirmed, `RENEW-009` rolls an auto-renewing agreement forward past every end date already in the past, so it arrives with its current term, lifecycle status and next notice deadline. A batch can be undone until any of its agreements is used, like `MOVE-001`. Agent calls carry standard as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. a journey imports a 500-file fixture ZIP with 12 duplicates, 3 unreadable files and a CSV; the report counts match, every file keeps its digest, 50 sampled extractions are confirmed in bulk and the rest stay proposed, renewal deadlines appear only for confirmed terms, and undo before use removes the batch while keeping the journal.
2. A supplier agreement in the batch signed in 2022 with a 1-year auto-renewing term shows as auto-renewing with its current term and next notice deadline once its terms are confirmed, not a deadline in 2022.

**Evidence.** `src/locket/imports/commands.ts`; `tests/api/move-in.test.mjs`
**Gap.** Generic PDF/DOCX bulk import, OCR, extraction and large-file streaming do not exist

#### REPO-004 — Built-in term and metadata extraction

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-INPUT-003 · Rules D-1

**Requirement.** Under the held company policy for standard or commitment, for any executed or imported agreement, the built-in model proposes parties and our signing entity, effective, end and renewal dates, initial term, renewal type, renewal term, renewals allowed (`RENEW-007`), notice period and method, termination rights, governing law, payment terms, total and annual value in USD (with original currency kept), price-increase caps, liability caps, insurance requirements and every custom field (`REPO-005`), each citing its passage and confidence. Proposals follow `TERMS-001`: nothing drives a deadline until confirmed. Extraction accuracy is measured on a live provider under `REVIEW-006` and shown to the owner per field. A field whose latest live result is below its bar is marked low-confidence on every proposal and is never offered for bulk confirmation (`REPO-003`). Agent calls carry standard as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard, a journey with a model-provider fake extracts 14 standard fields and two custom fields from a fixture MSA with citations; a person confirms twelve, corrects one and rejects one; the renewal deadline appears after the end date and notice period are confirmed.
2. The clause is accepted only when a live run under `REVIEW-006` meets the extraction bars.

**Evidence.** `src/locket/proposals.ts`; `src/locket/obligations.ts`
**Gap.** Built-in extraction does not exist; native custom metadata ships under REPO-005

#### REPO-005 — Custom metadata fields

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-AUDIT-001, BASE-DATA-001, BASE-ROLE-001 · Rules D-1

**Requirement.** The owner defines custom fields (text, number, USD money, date, pick list, yes/no, person, counterparty) per agreement type, with help text, required-at-stage rules and who may edit them. Fields appear on intake forms, the agreement page, extraction proposals, search filters, saved views, reports, exports and the API. Before shipping, custom fields join REPO-007's typed filters, sort, ordered columns and identical scoped CSV executor; unknown or inaccessible custom fields never act as a substitute value. Detailed operational rules: [the REPO-005 record](docs/contract/operational-details.md#repo-005). Agent calls carry standard as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard, a journey adds a "Data processing" yes/no field and a "Cost center" pick list required before approval, sees approval refused until the field is filled, filters the repository by both fields and finds them in the CSV export and the API state.
2. The same journey follows the detailed operational rules linked in the Requirement, including their authority, version, source, refusal and recorded-outcome conditions.

**Evidence.** `tests/api/saved-views.test.mjs` — “REPO-005 typed metadata enforces owner definitions, edit roles, stage requirements and approval context through commands”; `tests/browser/saved-views.spec.ts` — “REPO-005 defines typed fields, blocks incomplete approval, saves metadata views and accepts cited family values at 1440px and 390px”
**Gap.** A journey must include custom metadata in model extraction and every required-stage door; cited journeys prove typed native metadata, queries and guarded proposals.

#### REPO-006 — Search and structured filters

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003, BASE-ROLE-001 · Rules D-1

**Requirement.** People search the full text of every version they may access (DOCX text and OCR text), titles, references, counterparties and field values, with clause-level hits that open the exact passage. Structured filters cover type, workflow stage (draft, in review, approved, out for signature, executed), lifecycle status (`RENEW-012`), counterparty, owner, department, value range, any date range (effective, current term end, next notice deadline, each taken from the current term under `RENEW-008`, plus the original end date), renewal type, governing law, playbook deviations and custom fields, and combine with the text query. Results respect `ACCESS-001`. Detailed operational rules: [the REPO-006 record](docs/contract/operational-details.md#repo-006).

**Acceptance.**
1. a journey searches "limitation of liability" filtered to supplier agreements over $100,000 ending in the next 180 days, opens a hit at its passage, and a viewer without access to a restricted match does not see it. An auto-renewing agreement whose original end date is in 2023 but whose current term ends in the window is found, and filtering by lifecycle status "expired" returns only expired agreements.
2. The same journey follows the detailed operational rules linked in the Requirement, including their authority, version, source, refusal and recorded-outcome conditions.

**Evidence.** `tests/api/search.test.mjs` — “REPO-006 current-term structured search, all version passages, scoped filters, literal offsets and authenticated navigation data”; `tests/browser/search.spec.ts` — “REPO-006 structured current-term search and exact current and older passages at 1440px and 390px”
**Gap.** A journey must search and open cited passages from OCR-derived scanned PDFs; cited journeys prove native DOCX/text passages and structured filters.

#### REPO-007 — Saved views and columns

Core · target · **partial** · Cites BASE-ACCESSIBILITY-001, BASE-AGENT-002, BASE-AGENT-006, BASE-DATA-001, BASE-INPUT-003, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-ROLE-001 · Rules D-1

**Requirement.** A person saves a repository view (query, filters, sort and chosen columns) as private or shared with named current roles, pins it personally, and exports it to CSV. The query searches standard metadata and accessible version text. Filters all match together and support case-insensitive text equality/containment and inclusive lower/upper bounds; USD amounts are entered as decimal dollars and compared as exact cents, dates as calendar dates (created/updated dates are UTC; current-term notice dates use each agreement's zone). Nulls sort last, with agreement identity breaking ties. Chosen columns retain their selected order in the screen and CSV, including value, owner, confirmed original terms and separately labelled derived current-term/notice fields. Original confirmed dates are never replaced by the projection. Detailed operational rules: [the REPO-007 record](docs/contract/operational-details.md#repo-007).

**Acceptance.**
1. REPO-007 public API and browser journeys save "Supplier renewals next quarter" with ordered value, owner and notice-deadline columns, share it with approvers, reopen it as an approver with fewer permitted rows, and export matching CSV. At 1440/390 the controls, personal pins and resulting columns work without horizontal page scrolling. Under the held company policy for standard, external and commitment, the public-door journey cover private and wrong-role definitions hidden by guessed ID, current access grant/revocation, creator-only/stale mutations, independent pins, viewer-owned preferences, agent write refusal, exact USD/date filters and formula-safe multiline CSV. REPO-005 and REPO-009 assert their inherited custom-field/group/field-access behavior before shipping.

**Evidence.** `tests/api/saved-views.test.mjs` — “REPO-007 ROLE-001 saved views execute current visible agreements identically on screen and CSV, with personal pins and creator revisions”; `tests/browser/saved-views.spec.ts` — “REPO-007 saves ordered supplier renewal columns, shares to approvers, pins personally and exports only their visible rows at 1440px and 390px”
**Gap.** A company-policy journey must perform a sponsor-authorized saved-view preference change and its held/refused variants; cited journeys prove human saved views and fixed legacy-agent write refusal.

#### REPO-008 — Agreement families

Core · target · **partial** · Cites BASE-ACCESSIBILITY-001, BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-AUDIT-001, BASE-DATA-001, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-ROLE-001 · Rules D-1

**Requirement.** Agreements link as amends, order under, statement of work under, schedule to, renews and supersedes. The family page shows the parent and every accessible child in ascending recorded start-date order, falling back to creation date, then creation time and identity for ties. Linking rechecks the current session, role, child, parent and ancestry versions atomically and refuses cycles. An agent’s family-link call carries standard, adding commitment for a governing-term decision; the company’s policy decides it. Detailed operational rules: [the REPO-008 record](docs/contract/operational-details.md#repo-008). Agent calls carry standard or commitment as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard or commitment, clause-named the cited journey and the cited journey link an MSA, two orders and an amendment at 1440/390; date order matches the recorded dates, the explicitly selected amended end date cites the amendment, and its source opens. Under the held company policy for standard, external and commitment, the public-door journey cover all six relations, cycle and stale-parent refusal, requester/agent write refusal, a human-decided agent link, stale superseded terms, restricted members hidden, signed-out refusal, attributed audit and complete archive. Browser assertions include the requester's read-only family screen and no horizontal scrolling.

**Evidence.** `tests/api/families.test.mjs` — “REPO-008 six guarded family relations, date order, human-selected cited governing terms and agent proposals”; `tests/browser/families.spec.ts` — “REPO-008 link MSA, orders and amendment and choose its governing end date at 1440px and 390px”
**Gap.** A company-policy journey must choose family links/governing values under both policies; cited journeys prove guarded human selections and held proposals.

#### REPO-009 — Groups, departments and field-level access

Core · target · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-DATA-001, BASE-MAIL-001, BASE-OPS-004, BASE-ROLE-001 · Rules D-1

**Requirement.** Beyond restricted agreements, the owner defines departments and groups (Sales, Procurement, HR, Finance) and grants each visibility by agreement type and department, and can hide specific fields (value, pricing schedules) from roles that may otherwise read the agreement. Every read, search hit, export, notification and connector payload applies the same rules. Before shipping, groups join REPO-007's definition-sharing audiences through current membership checks; field restrictions run before saved-view filters, sort, excerpts or projection, so a definition never grants access or leaks a hidden value indirectly. Detailed operational rules: [the REPO-009 record](docs/contract/operational-details.md#repo-009).

**Acceptance.**
1. a journey grants Sales visibility of customer agreements only and hides value from viewers; a Sales viewer sees customer agreements without value in the register, search, CSV export and API state, and sees no supplier agreement. Owner-configured repository grants now intersect ACCESS-001: after the owner enables them, a non-owner/non-counsel reader needs current membership in a matching group/department, the agreement type and any selected agreement department. Explicit restricted grants do not bypass this intersection. The owner classifies existing agreements by department; published-form department answers supply the department until an explicit classification exists. Group-shared saved definitions use current membership on reads, pins and execution, and never grant agreement access.

**Evidence.** `tests/api/saved-views.test.mjs` — “REPO-009 current group and department grants intersect restricted access and hide fields before all repository projections”; `tests/browser/saved-views.spec.ts` — “REPO-009 Sales visibility, hidden value and current group shares at 1440px and 390px”
**Gap.** None.

#### REPO-010 — Counterparty records

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001 · Rules D-1

**Requirement.** Each counterparty has its legal entity name, entity type and state of formation, EIN where supplied, addresses, notice address and method, contacts and authorized signatories, every agreement in its families, total and annual contracted value in USD, and open obligations and deadlines. Duplicates are merged with history; CRM, accounting and procurement records (`INTAKE-004`, `LINK-001`, `LINK-002`) link to the same counterparty. Detailed operational rules: [the REPO-010 record](docs/contract/operational-details.md#repo-010).

**Acceptance.**
1. a journey adds a counterparty with a notice address, links three agreements, merges a duplicate created by intake, and sees the combined value and open deadlines on the counterparty page; the linked HubSpot company is asserted by `INTAKE-004`'s journey.

**Evidence.** `tests/api/counterparties.test.mjs` — “REPO-010 counterparty details, notice address and signatories, three linked agreements by family, contracted and annual USD, next deadline, and merging an intake duplicate”
**Gap.** A journey must link the counterparty through CRM, accounting and procurement sources and reconcile their combined records; cited journeys prove native counterparty details, merged duplicates, family totals and deadlines.

#### REPO-011 — Bulk repository actions

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-AUDIT-001, BASE-ROLE-001 · Rules D-1

**Requirement.** From a search, filter or saved view, select up to 5,000 agreement revisions, set or clear standard or custom fields, reassign the departing responsible person and their open obligations/reminders, or change group and department access. The guarded batches show per-record outcomes and skip changed or unauthorized records. Each change records activity linked to the operation. The field, group and ownership rules are in [the operational specification](docs/contract/operational-details.md#repo-011). Agent calls carry standard or access as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Filter 300 agreements, set Department = Sales, reassign 40 agreements and their open obligations, and move 25 to Finance; read back the changes and their activity.
2. A viewer is refused; a record changed after selection is skipped and unchanged.

**Evidence.** `tests/api/saved-views.test.mjs` — “REPO-011 REPO-014 REPO-015 REPO-016 reviewed bulk changes preserve custody, reassign open work, round-trip exact CSV differences and revert with history”; `tests/browser/saved-views.spec.ts` — “REPO-011 REPO-015 REPO-016 reviews filtered bulk changes, exact CSV differences and reversible history at 1440px and 390px”
**Gap.** A company-policy journey must apply a bulk change under both policies; cited journeys prove reviewed native changes and direct legacy-agent refusal.

#### REPO-014 — Download selected contract originals

Core · target · **partial** · From REPO-011 · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-INPUT-003, BASE-ROLE-001 · Rules D-1

**Requirement.** Download selected originals, signed files and certificates as a single ZIP with a digest manifest, through the selection’s current record and field access. Agent calls carry standard or access as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Download 20 selected originals and open the ZIP; each file’s bytes and SHA-256 match the selected record.

**Evidence.** `tests/api/saved-views.test.mjs` — “REPO-011 REPO-014 REPO-015 REPO-016 reviewed bulk changes preserve custody, reassign open work, round-trip exact CSV differences and revert with history”; `tests/browser/saved-views.spec.ts` — “REPO-011 REPO-015 REPO-016 reviews filtered bulk changes, exact CSV differences and reversible history at 1440px and 390px”
**Gap.** A company-policy journey must apply a bulk change under both policies; cited journeys prove reviewed native changes and direct legacy-agent refusal.

#### REPO-015 — Update repository metadata through CSV

Core · target · **partial** · From REPO-011 · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-DATA-001, BASE-ROLE-001 · Rules D-1

**Requirement.** Export a selection’s metadata to CSV, edit it and re-import updates bound to the exported identities/revisions. A dry run shows the exact record/field diff; applying that reviewed diff uses each existing field and authority rule. Agent calls carry standard or access as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Correct the type on 15 rows; the dry run shows precisely those 15 changes before application, and read-back shows those changes only.

**Evidence.** `tests/api/saved-views.test.mjs` — “REPO-011 REPO-014 REPO-015 REPO-016 reviewed bulk changes preserve custody, reassign open work, round-trip exact CSV differences and revert with history”; `tests/browser/saved-views.spec.ts` — “REPO-011 REPO-015 REPO-016 reviews filtered bulk changes, exact CSV differences and reversible history at 1440px and 390px”
**Gap.** A company-policy journey must apply a bulk change under both policies; cited journeys prove reviewed native changes and direct legacy-agent refusal.

#### REPO-016 — Revert a bulk repository update

Core · target · **partial** · From REPO-011 · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-AUDIT-001, BASE-ROLE-001 · Rules D-1

**Requirement.** Revert one bulk operation, restoring its prior changed fields while retaining both changes in history. Current versions and permissions are rechecked; unrelated later edits remain and a field edited again is skipped. Agent calls carry standard or access as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Revert Department = Sales and read back prior departments with both activity records; later unrelated edits survive.

**Evidence.** `tests/api/saved-views.test.mjs` — “REPO-011 REPO-014 REPO-015 REPO-016 reviewed bulk changes preserve custody, reassign open work, round-trip exact CSV differences and revert with history”; `tests/browser/saved-views.spec.ts` — “REPO-011 REPO-015 REPO-016 reviews filtered bulk changes, exact CSV differences and reversible history at 1440px and 390px”
**Gap.** A company-policy journey must apply a bulk change under both policies; cited journeys prove reviewed native changes and direct legacy-agent refusal.

#### REPO-012 — Redacted renditions

Core · target · **done** · Cites BASE-INPUT-003, BASE-ROLE-001 · Rules D-1

**Requirement.** Owner or counsel produces a redacted rendition of a version as a new file beside the unchanged original, recording both digests. Counsel approves it for named hidden-field roles, which may then open, download, search and compare only approved renditions. A new version withholds the document until its rendition is approved.

**Acceptance.**
1. the Sales viewer downloads the rendition; searching 748392 misses; the original's bytes are unchanged.

**Evidence.** `tests/api/saved-views.test.mjs` — “Counsel-approved renditions preserve originals and scope every read to the current policy and version”
**Gap.** None.

#### REPO-013 — Access exceptions, review and hidden-field work

Core · target · **done** · Cites BASE-AUDIT-001, BASE-ROLE-001 · Rules D-1

**Requirement.** Owner or counsel shares one agreement with a named person, with a reason and an expiry. The share overrides group grants, never ACCESS-001. Fields can be hidden per group. A hidden-value requester submits a value they cannot read back. Policy and classification changes record before and after in AUDIT-001. Owner and counsel see who can read any agreement and why. Privileged legal notes are visible only to owner and counsel.

**Acceptance.**
1. the share expires; the submitted value is stored and redacted on read-back; the audit CSV shows the diff; the access report names each reader's grant.

**Evidence.** `tests/api/repository-exceptions-journey.mjs` — “repositoryExceptionsJourney”
**Gap.** None.

### Drafting and playbooks

#### DRAFT-002 — Word documents from templates

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-DATA-001, BASE-INPUT-003 · Rules D-1

**Requirement.** A populated template produces a formatted DOCX (and its PDF rendition) that keeps the template's styles, numbering, headers and tables, with conditional clauses chosen by the requester's answers and fields filled. Repeating pricing tables fill from line items (`INTAKE-004`, `LINK-003`) with a USD total. The template's signature blocks carry through as signature fields (`SIGN-006`). Business users generate standard agreements (NDA, MSA, order form, SOW) self-service; the result is the first version with its digest. Detailed operational rules: [the DRAFT-002 record](docs/contract/operational-details.md#draft-002).

**Acceptance.**
1. a journey populates an approved Word-based MSA template whose answers include a conditional data-processing clause; the downloaded DOCX opens with the template's styles and numbering, contains the conditional clause and the fields, renders a three-row pricing table with its total, and its PDF rendition is approved for signing. Word-authored templates (`DRAFT-004`) populate the approved source package’s selected fields and Include/Omit paragraph choices, preserving existing run/paragraph styles, numbering, tables, headers, footers and other untouched parts. A source field may span formatted runs; its replacement inherits the first selected run’s formatting. Values remain plain text, XML-escaped. The generated original DOCX, populated text, fields, chosen clauses and template version join the exact version digest. Text-authored templates retain their existing text/PDF path. For a Word-authored version a person exports/reviews a PDF in their document editor and attaches it through the existing rendition door; adding it withdraws earlier approvals.
2. The same journey follows the detailed operational rules linked in the Requirement, including their authority, version, source, refusal and recorded-outcome conditions.

**Evidence.** `tests/api/clause-library.test.mjs` — “DRAFT-002 populated Word MSA keeps conditional wording and three price rows, requires the reviewed PDF and pins its approval for signing”
**Gap.** A journey must generate the promised formatted PDF rendition and carry template signature blocks into provider field placement; cited journeys prove DOCX population and a person-attached reviewed PDF.

#### DRAFT-003 — Clause library in negotiation

Core · target · **partial** · Cites BASE-ACCESSIBILITY-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-DATA-001, BASE-INPUT-003, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-ROLE-001 · Rules D-1

**Requirement.** Approved clauses (preferred, fallback one, fallback two, walk-away) are searchable by topic with usage notes, the playbook rule they satisfy, and how often each was accepted. An approved template version is the library version. During negotiation a person inserts a clause into a new version in the browser, with the current authority, version and selected-passage checks; the inserted text, variant, library version and playbook provenance are recorded in that version and its digest, and earlier originals stay untouched. The count is once per agreement the person may access whose currently executed version retains that recorded template selection or negotiation insertion and whose execution records document confirmation; unchosen matching text and removed wording do not count. The current browser insertion produces a text PDF; Word formatting remains `DRAFT-002`/`NEG-002`. When the Word door (`NEG-003`) ships, it must provide the same approved-clause search, insertion, immutable provenance, version checks, audit and acceptance counting before it is done.

**Acceptance.**
1. the public-door journey search for "indemnity", inspect all four approved variants with usage notes and the playbook rule, insert fallback one into a new browser version at 1440 and 390 pixels, verify the text and immutable library/playbook provenance, and execute the agreement so the acceptance count rises.
2. They prove the original download is unchanged, template selections also count, removed wording does not, archive export retains provenance, and draft/retired clauses, viewers and stale or mismatched selections are refused.
3. `NEG-003` must assert the same Word-door obligation when it ships.

**Evidence.** `tests/api/clause-library.test.mjs` — “DRAFT-003 searches approved variants and records insertion provenance through execution and export”; `tests/browser/clause-library.spec.ts` — “DRAFT-003 indemnity fallback insertion and executed acceptance at 1440px and 390px”
**Gap.** A cited Word-door journey must insert the approved clause with retained execution provenance and acceptance counts; cited journeys cover browser insertion and native execution.

#### DRAFT-004 — Templates authored from existing Word documents

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003 · Rules D-1

**Requirement.** Owner or counsel upload an existing Word template, mark fields and optional clauses in the browser (or with the Word add-in), preview it with sample answers, and approve it as a template version, keeping the document's formatting.

**Acceptance.**
1. a journey uploads a firm's NDA DOCX, marks four fields and one optional clause, previews with sample answers, approves it, and a requester generates an NDA from it under `DRAFT-002`.
2. The owner/counsel uploads an original DOCX, selects exact source offsets for fields and whole paragraphs for optional clauses, previews explicit sample answers with a downloadable populated DOCX, and approves that exact marking revision.
3. Later marking edits require a fresh preview; approved/retired versions and original bytes are immutable, and an uploaded revision creates a new template version.
4. The existing shared Library read policy applies to Word sources and previews as it does to template bodies.
5. The parser validates ZIP bounds, entry identities, expanded sizes and CRCs.
6. Active content, external relationships, tracked changes, document fields and text boxes are refused with an explicit unsupported-source error, without altering the source; accept/remove them in Word first.
7. Current field markings cover main-document paragraphs and tables; untouched document formatting/parts remain intact.

**Evidence.** `tests/api/clause-library.test.mjs` — “DRAFT-004 authors four source fields and an optional paragraph, previews and approves immutable Word then a requester generates without losing formatting”
**Gap.** A journey must author source fields and optional clauses through the Word add-in as well as the browser; cited journeys cover browser marking and immutable Word generation.

#### PLAY-002 — Playbooks drafted from templates and history

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-ROLE-001 · Rules D-1

**Requirement.** Under the held company policy for standard or commitment, the built-in model drafts playbook rules from the approved templates and past executed agreements: for each clause topic, the preferred position, fallbacks seen in signed deals and suggested exception authority, citing the agreements it learned from. Counsel edits, accepts or rejects each rule; nothing activates until counsel approves a new playbook version under `PLAY-001`. Agent calls carry commitment as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for commitment, a journey with a model-provider fake drafts rules from two templates and 20 executed agreements; counsel accepts six, edits two and rejects one; the new playbook version activates only on approval and cites its source agreements.
2. The clause is accepted only when a live run under `REVIEW-006` meets the playbook-drafting bar.

**Evidence.** None.
**Gap.** Playbooks are authored by hand only

### Negotiation

#### NEG-002 — Word tracked changes round-trip

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003 · Rules D-1

**Requirement.** Locket reads Word tracked changes (insertions, deletions, moves, formatting), comments and their authors from a counterparty's DOCX and shows them as redlines against the version they were made on. It writes a DOCX with Locket-side changes as tracked changes and comments, attributed to the person who made them. Accepting or rejecting changes produces a new version; the counterparty's original file stays byte-for-byte. Clean and redline outputs are both available.

**Acceptance.**
1. a journey uploads a fixture DOCX with 12 tracked changes and 4 comments from two authors; all are listed with authors and positions; accepting 9 and rejecting 3 creates a new version whose downloaded DOCX carries the remaining comments and our replies as Word comments, and the counterparty file downloads with its original digest.
2. The output opens without repair in Word and LibreOffice.

**Evidence.** `tests/api/browser-edits.test.mjs`; `tests/browser/word-review.spec.ts`; `tests/browser/word-review-open.mjs`
**Gap.** Licensed Word opening proof unavailable; structural revisions, text boxes and non-main-story revisions explicitly refused; plain rendition never satisfies this clause

#### NEG-003 — Locket for Word add-in

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-ROLE-001 · Rules D-1 · Register R-4

**Requirement.** An Office add-in for Word on Windows, Mac and the web, distributed through Microsoft AppSource and the buyer's Microsoft 365 admin, signs in with the person's Locket session, opens the current version, shows playbook findings beside the clauses they cite, inserts clause-library text, applies accepted AI redlines as tracked changes, and saves back as a new version with the stale-version check. Approvers can review and approve the exact version from the add-in. Before this door ships it also satisfies `DRAFT-003`: approved-clause search, notes/rules, insertion into a new version, immutable library/playbook provenance, authority and stale/passage checks, command audit and retained-choice acceptance counts.

**Acceptance.**
1. Under the held company policy for standard, external and commitment, a Word-on-the-web journey opens an agreement in the add-in, sees three findings anchored to their clauses, applies one AI redline as a tracked change, saves as version 4, and is refused when saving over a version someone else has replaced; an approver approves version 4 from the add-in and the approval pins its digest.
2. A sideloaded run in Word on the web against a Microsoft 365 developer tenant, and the add-in's passing AppSource validation, are recorded before the clause is accepted.
3. The Word journey also searches indemnity, inserts an approved fallback with its library/playbook provenance and audited version checks, and sees its `DRAFT-003` count rise only after document-confirmed execution.

**Evidence.** None.
**Gap.** No Word add-in exists

#### NEG-004 — Browser redlining and threaded comments

Core · target · **done** · Cites BASE-ACCESSIBILITY-001, BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003, BASE-ROLE-001 · Rules D-1

**Requirement.** People edit a version in the browser with changes recorded as tracked changes, comment on a selected passage, @mention colleagues, reply in threads and resolve them. Saving creates a new version; mentions notify (`NOTIFY-001`). Browser revisions retain the base version, author, time and before/after line changes in the new version's identity, alongside its generated text PDF; comparison shows the edits without rewriting the earlier original. Replies and resolution stay on their root comment's document version; a changed thread revision must be reloaded before resolution. The existing document-edit and comment roles apply.

**Acceptance.**
1. The journey at 1440 and 390 pixels edits two clauses, comments on a third, mentions counsel, who replies and resolves; the saved version shows the tracked edits and the compare view lists exactly those changes.

**Evidence.** `tests/api/browser-edits.test.mjs` — “NEG-004 records two attributed browser edits, exact comparison, selected mention, counsel reply/resolution and archive”; `tests/browser/browser-edits.spec.ts` — “NEG-004 two browser edits, selected mention, reply and resolution at 1440px and 390px”
**Gap.** None.

#### NEG-005 — Internal and external sides of a negotiation

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003, BASE-MAIL-001, BASE-OPS-004 · Rules D-1

**Requirement.** Every comment and version is marked internal or external. Internal comments, findings, approvals and internal-only versions never appear in anything shared with the counterparty (downloads, emails, the secure link). A person sends the external view by choice; Locket warns when an outgoing DOCX still carries internal comments or metadata and strips them.

**Acceptance.**
1. a journey adds two internal and one external comment, shares the version with the counterparty under `NEG-006`, and confirms the counterparty view and the outgoing DOCX contain only the external comment; an attempt to send a file still carrying an internal comment is warned and cleaned.

**Evidence.** `tests/api/browser-edits.test.mjs`; `tests/browser/browser-edits.spec.ts`
**Gap.** ct (22 Oct 2026, 854aeca) approves the owner/counsel explicit-designation and plain-rendition boundary. Gap: format-preserving outgoing Word files (NEG-002) and Gmail/Outlook sends (NEG-006) must apply the same internal-content stripping and warning before they ship; a plain rendition never satisfies NEG-002.

#### NEG-006 — Counterparty exchange by email and secure link

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-INPUT-003, BASE-MAIL-001, BASE-OPS-004, BASE-ROLE-001 · Rules D-1

**Requirement.** A person sends the external version to counterparty contacts from Locket by email (Postmark, or the person's connected Gmail or Outlook) or a secure, expiring link where the counterparty can view, download, comment and upload a markup without an account. Replies with attachments come back as counterparty versions on the same agreement. Every send, open and upload is recorded. Detailed operational rules: [the NEG-006 record](docs/contract/operational-details.md#neg-006).

**Acceptance.**
1. a journey with a Postmark fake sends version 2 to a counterparty contact, opens the secure link as the counterparty, uploads a markup and comments; version 3 appears as a counterparty version with its digest, the activity shows sent, opened and uploaded, and the link refuses access after expiry.

**Evidence.** `tests/api/browser-edits.test.mjs`; `tests/browser/browser-edits.spec.ts`; `tests/browser/exchange-live.mjs`; `tests/api/browser-edits.test.mjs`
**Gap.** Sending through the person’s connected Gmail or Outlook remains blocked on owner mail-account authorization. Original-format round-trip stays with NEG-002. Separate server-generated link and inbound-only reply capabilities now ship; legacy reply addresses require a fresh exchange. No live mail-account receipt is claimed. This round passed real component browser proof against Worker and D1 at 1440 and 390; native rer startup failed and is not claimed as passing.

### Built-in AI review

#### REVIEW-002 — Built-in playbook review

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-INPUT-003, BASE-ROLE-001 · Rules D-1

**Requirement.** Under the held company policy for standard or commitment, on any version (ours or theirs, DOCX or OCR'd PDF), a person runs review: the built-in model checks every rule in the active playbook and returns, per rule, met, breached or cannot determine, with the exact cited passage, the reason, and proposed wording from the rule's fallbacks. Findings arrive as a proposal under `REVIEW-001`; a reviewer accepts, edits or rejects each one, and only accepted findings drive exception approvals. Review of a 40-page agreement against 30 rules completes within 2 minutes at the 90th percentile, measured on a live provider. Accuracy is measured live under `REVIEW-006` and shown to the owner per rule. Agent calls carry standard as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard, a journey with a model-provider fake runs review on a fixture supplier agreement against a 12-rule playbook; findings cite passages that match the version text, a quote that is not in the text is refused, a reviewer edits one proposed wording and rejects one finding, and the exception route reflects only accepted findings.
2. The clause is accepted only when a live run under `REVIEW-006` meets the review bars, including the 2-minute time.

**Evidence.** `src/locket/review.ts`; `src/locket/proposals.ts`; `tests/api/flows.test.mjs`
**Gap.** The built-in model run does not exist

#### REVIEW-003 — Versioned AI redlines

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-ROLE-001 · Rules D-1

**Requirement.** Accepted findings with proposed wording become tracked changes in the next version (browser and Word), each with its reason as a comment that is internal by default. Under the held company policy for standard or commitment, the reviewer edits the wording and the reason before anything is shared, and the version records which changes came from the model and who accepted them. Agent calls carry standard or external as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard or external, a journey accepts three findings, edits one redline's wording and one reason, saves the version, and sees three tracked changes attributed to the reviewer with model provenance, with reasons internal unless marked external.

**Evidence.** `tests/api/browser-edits.test.mjs` — “Word review preserves twelve authored revisions, resolves nine and rejects three, round-trips comments and replies, and strips private outgoing content”; `tests/browser/review-redlines.spec.ts` — “Reviewer edits three accepted findings, saves attributed browser and Word redlines and keeps reasons internal at 1440px/390px”
**Gap.** A journey must produce and open Word tracked-change redlines; cited journeys cover browser changes, comments and internal-side restrictions.

#### REVIEW-004 — Ask the repository

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-ROLE-001 · Rules D-1

**Requirement.** A person asks questions in plain English ("Which supplier agreements auto-renew next quarter with more than 60 days' notice?", "What is our liability cap with Acme?") and gets an answer with a list of matching agreements and cited passages, built only from agreements and fields the person may access. Answers that rely on proposed, unconfirmed values say so. Agent calls carry standard as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard, a journey with a model-provider fake asks both questions over a fixture repository; the first returns the exact matching agreements with their confirmed terms cited, the second cites the clause; a viewer without access to a restricted agreement gets an answer that omits it.
2. The clause is accepted only when a live run under `REVIEW-006` meets the questions bar.

**Evidence.** None.
**Gap.** No question answering exists

#### REVIEW-005 — Model choice, records and switch-off

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-DATA-003, BASE-DATA-006 · Rules D-1

**Requirement.** The owner chooses the model provider (Anthropic or OpenAI with the owner's API key under a no-training, zero-retention agreement, or Cloudflare Workers AI) and can switch AI off for the installation or per agreement type. Every model output records the provider, model, prompt version, playbook version, input document digests and the person who accepted it. Usage and estimated cost are shown in USD per month. The same settings choose the OCR provider (`REPO-002`). Beside each provider and model they show its latest live evaluation (`REVIEW-006`). A task the model has not passed live is not offered. Agent calls carry security as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for security, a journey configures a provider fake, runs review and extraction, reads each output's record (model, prompt, playbook and input digests), switches AI off for NDAs and sees review refused on an NDA, and reads the month's usage in USD.
2. Under the held company policy for security, a model with no passing live evaluation for review is shown as not evaluated, and review is refused with it.

**Evidence.** `tests/api/families.test.mjs` — “REPO-008 six guarded family relations, date order, human-selected cited governing terms and agent proposals”
**Gap.** A journey must enforce the full live-evaluation task/provider availability and refusal bar in REVIEW-006; cited settings journeys show recorded settings, output provenance and switch-off.

#### REVIEW-006 — Live accuracy evidence for every AI and OCR task

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-006 · Rules D-1

**Requirement.** No evaluated AI task (review, extraction, intake proposals, obligation extraction, questions over the repository, summaries or playbook drafting) and no OCR task is offered for a provider and model until an evaluation command in the repository has run the shipped prompts against that real provider and recorded the result. A fake never counts. Each run is committed as an evaluation record: provider, model, prompt version, dataset name, version and digest, per-field and per-rule scores, latency and USD cost. A new prompt version or model needs a new passing run before it is offered.

**Acceptance.**
1. A provider fake cannot be recorded as a live result.
2. A live Anthropic run, and an OpenAI or Workers AI run where offered, plus a named OCR provider, retain dataset digests and per-task results; settings show them. Under the held company policy for standard, external and commitment, a missed task bar withholds that task for that provider/model.
3. A new prompt or model needs a new passing record. Each record includes provider, model, prompt, dataset/version/digest, scores, latency and USD cost.

**Evidence.** None.
**Gap.** No evaluation command, labeled set or recorded live run exists

#### REVIEW-008 — Extraction evaluation

Core · target · **missing** · From REVIEW-006 · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-ROLE-001 · Rules D-1

**Requirement.** the CUAD v1 test split from the Atticus Project (102 of CUAD's 510 US commercial contracts, 41 labeled clause categories). It is scored on the categories that map to Locket fields: parties, agreement, effective and expiration dates, renewal term, notice period to terminate renewal, governing law, termination for convenience, cap on liability, uncapped liability, insurance, audit rights, minimum commitment, price restrictions, exclusivity and most favored nation. a held-out Locket set of 100 US commercial agreements (NDAs, MSAs, order forms, supplier agreements and amendments), labeled by counsel with normalized values (dates, day counts, USD amounts, states). It is kept out of prompt development, and its labels and digest are committed.

**Acceptance.**
1. clause-location recall of at least 0.85 and precision of at least 0.80 for each mapped CUAD category. Exact-value accuracy of at least 0.90 for each normalized field, and at least 0.95 for end date, notice period and auto-renewal, the fields that drive deadlines.
2. at the 90th percentile, review of a 40-page agreement against 30 rules in 2 minutes and extraction of a 40-page agreement in 60 seconds.

**Evidence.** None.
**Gap.** No evaluation command, labeled set or recorded live run exists

#### REVIEW-009 — Review evaluation

Core · target · **missing** · From REVIEW-006 · Cites BASE-AGENT-002, BASE-AGENT-006 · Rules D-1

**Requirement.** 50 agreements from that held-out set against a 12-rule US supplier playbook, each rule labeled met, breached or cannot determine by counsel.

**Acceptance.**
1. per-rule agreement with counsel of at least 0.85. No rule may call a breached case "met" in more than 3% of its breached cases. Every cited quote matches the version text.
2. at the 90th percentile, review of a 40-page agreement against 30 rules in 2 minutes and extraction of a 40-page agreement in 60 seconds.

**Evidence.** None.
**Gap.** No evaluation command, labeled set or recorded live run exists

#### REVIEW-010 — OCR evaluation

Core · target · **missing** · From REVIEW-006 · Cites BASE-AGENT-002, BASE-AGENT-006 · Rules D-1

**Requirement.** the 102 CUAD test contracts rendered as 200-dpi greyscale page images, scored against CUAD's text.

**Acceptance.**
1. character error rate of at most 2% overall and at most 5% on any single contract, with the page anchor correct for every cited passage.

**Evidence.** None.
**Gap.** No evaluation command, labeled set or recorded live run exists

#### REVIEW-011 — Intake evaluation

Core · target · **missing** · From REVIEW-006 · Rules D-1

**Requirement.** the first version of each of the 100 held-out agreements, as it would arrive from a counterparty, labeled by counsel with the intake fields `INTAKE-007` proposes (agreement type, counterparty legal name, our entity, value, term, governing law and the applicable template or playbook).

**Acceptance.**
1. exact-value accuracy of at least 0.90 for each intake field, and at least 0.95 for agreement type and counterparty legal name.

**Evidence.** None.
**Gap.** No evaluation command, labeled set or recorded live run exists

#### REVIEW-012 — Obligations evaluation

Core · target · **missing** · From REVIEW-006 · Rules D-1

**Requirement.** the same 100 held-out agreements, with every obligation labeled by counsel: type, the party bound, due date or recurrence, and the passage that creates it.

**Acceptance.**
1. obligation recall of at least 0.85 and precision of at least 0.80, with the party bound correct for at least 0.95 and the due date or recurrence correct for at least 0.90 of matched obligations. Every cited passage matches the version text.

**Evidence.** None.
**Gap.** No evaluation command, labeled set or recorded live run exists

#### REVIEW-013 — Questions evaluation

Core · target · **missing** · From REVIEW-006 · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-ROLE-001 · Rules D-1

**Requirement.** 100 plain-English questions over the held-out set loaded as one repository, 60 that select agreements by terms and 40 that ask for a value in one agreement. Each is labeled by counsel with the exact matching agreements or the answer value and its passage. Ten are asked as a viewer without access to two restricted agreements in the set.

**Acceptance.**
1. for selection questions, the exact matching set for at least 0.85 of questions, and no answer may include an agreement the asker cannot see. For value questions, the correct value with a passage that matches the version text for at least 0.90 of questions. Every answer that relies on a proposed value says so.

**Evidence.** None.
**Gap.** No evaluation command, labeled set or recorded live run exists

#### REVIEW-014 — Summaries evaluation

Core · target · **missing** · From REVIEW-006 · Rules D-1

**Requirement.** Summaries are evaluated on the 50 review agreements from the counsel-labelled held-out set.

**Acceptance.**
1. every summary line of the 50 review agreements cites a passage that matches the version text, and the term, renewal and notice-deadline lines meet the extraction bars for those fields.

**Evidence.** None.
**Gap.** No evaluation command, labeled set or recorded live run exists

#### REVIEW-015 — Playbook drafting evaluation

Core · target · **missing** · From REVIEW-006 · Rules D-1

**Requirement.** two approved US templates (an MSA and a supplier agreement) and 40 executed agreements from the held-out set. Counsel grades every drafted rule as accepted, accepted with edits or rejected.

**Acceptance.**
1. at least 0.80 of drafted rules accepted or accepted with edits, and every cited source agreement and passage exists.

**Evidence.** None.
**Gap.** No evaluation command, labeled set or recorded live run exists

#### REVIEW-007 — Plain-English summary of one agreement

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-ROLE-001 · Rules D-1

**Requirement.** A person generates a plain-English summary of a single agreement for a business stakeholder. It covers the parties and our entity (`ENTITY-001`); what each side must do; price and payment; the term, renewal and notice deadline; termination rights; liability and insurance; and the playbook exceptions accepted. Every line cites its passage and says whether the value is confirmed or still proposed. The summary is pinned to the version it was made from. It is marked stale when a new version or a corrected term arrives, and is never silently rewritten. It can be shared only with people who may see the agreement. Under the held company policy for standard or commitment, the model run follows `REVIEW-005` and is offered only after the summaries bar in `REVIEW-006` is met. Agent calls carry standard or external as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. a journey with a model-provider fake summarizes a fixture MSA.
2. Every line cites a passage in the version text, and an unconfirmed renewal term is labeled proposed.
3. Adding version 3 marks the summary stale, and a viewer without access to the agreement cannot open the summary.

**Evidence.** `tests/api/families.test.mjs` — “REPO-008 six guarded family relations, date order, human-selected cited governing terms and agent proposals”
**Gap.** A company-policy summary journey and the required passing summary evaluation remain missing; cited journeys show a cited native summary, stale state and restricted read refusal.

### Approval routing

#### APPROVE-002 — Conditional approval rules in USD

Core · target · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-ROLE-001 · Rules D-1

**Requirement.** Owner-configured rules add approvers by agreement type, USD value thresholds, department, counterparty risk and accepted findings (for example: Finance over $100,000, Security when data processing is "yes", the CFO over $500,000), in sequence or in parallel, with named delegates while someone is away. A rule change is previewed against sample agreements before publishing (`INTAKE-002`). Approvals still pin the exact version and context (`APPROVE-001`). Detailed operational rules: [the APPROVE-002 record](docs/contract/operational-details.md#approve-002).

**Acceptance.**
1. a journey publishes rules for $100,000 and $500,000 thresholds and a data-processing condition, submits a $600,000 supplier agreement with data processing and sees Finance, Security and CFO approvals required in order; a delegate approves for an absent approver; a value change withdraws all three. The owner saves a rule draft, previews explicit sample answers, then publishes an immutable version. Each native request captures that version (including an explicit no-rules snapshot) when created; an upgrade backfills pre-existing native requests with no-rules snapshots; later publication cannot reroute it. Within that snapshot, matching uses current recorded native inputs: type, an inclusive minimum USD value, department, low/medium/high/unknown counterparty risk, data-processing yes/no and a person-recorded breached/undetermined finding clause key. Conditions within a rule all match. Rules with equal stage numbers run in parallel; later stages wait for every earlier stage to approve. Matching named commercial steps together satisfy APPROVE-001's commercial requirement; the published form's counsel requirement and every legal exception remain separate.
2. The same journey follows the detailed operational rules linked in the Requirement, including their authority, version, source, refusal and recorded-outcome conditions.

**Evidence.** `tests/api/flows.test.mjs` — “APPROVE-002 publishes previewed conditional routes, orders exact-version decisions and attributes current away delegates”; `tests/browser/approval-reminders.spec.ts` — “APPROVE-002 publishes Finance Security CFO stages, delegates and withdraws changed-value decisions at 1440px/390px”
**Gap.** None.

#### APPROVE-003 — Approve where people work

Core · target · **partial** · Cites BASE-ACCESSIBILITY-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-MAIL-001, BASE-OPS-004, BASE-ROLE-001 · Rules D-1

**Requirement.** The explicit generic approval-email link and phone approval under MOBILE-001 ship today; every channel added here must preserve its authenticated review, permission/version checks, no title/figures/digest in notification, audited outcomes and honest delivery labels. Automatic requests and broader channels remain this clause's work. Approvers are asked by email, Slack, Teams or Nook, in the Word add-in or on a phone (`MOBILE-001`). Every approval, wherever it is given, passes through the same server checks and pins the exact version digest the approver saw; an approval of a version that has since changed is refused and the approver is shown the new version.

**Acceptance.**
1. a journey sends an approval request by email (Postmark fake) and Slack (fake); approving from the Slack action records the approver and version digest; a second approver acting from an email link after a new version was added is refused and shown the new version.

**Evidence.** `tests/api/approval-mail.test.mjs` — “APPROVE-003 / MOBILE-001 / SEC-002 emails a generic authenticated review link once, then records the exact version through the normal approval command”; `tests/browser/mobile-approval.spec.ts` — “APPROVE-003 / MOBILE-001 opens the received approval email, refuses a replaced version, approves the current version and uploads signed evidence at 1440px/390px”
**Gap.** A journey must approve through Slack, Teams, Nook and Word and reject a changed version there; cited journeys prove authenticated email/phone approval only.

#### APPROVE-004 — Approval reminders and escalation

Core · target · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-MAIL-001, BASE-OPS-004 · Rules D-1

**Requirement.** A pending approval reminds its approver through their notification channel (`NOTIFY-001`, `APPROVE-003`) at owner-configured intervals. The default is after 1 business day, then daily, in the approver's US time zone. If it is still pending after a configured time (default 3 business days), it escalates to the approver's delegate (`APPROVE-002`), or to the rule's escalation contact when there is no delegate. Anyone working on the agreement can press "Remind approver", at most once every 4 hours per approver. Every reminder and escalation is recorded in the agreement's activity, and reminders stop as soon as the approval is given, declined or withdrawn. Detailed operational rules: [the APPROVE-004 record](docs/contract/operational-details.md#approve-004).

**Acceptance.**
1. a journey with a mail-provider fake and a controlled clock submits an agreement for approval. The approver is reminded after 1 business day and escalated to their delegate after A manual reminder is sent and a second one within 4 hours is refused. Once the approver approves, no further reminder goes out, and each reminder and the escalation appear in the activity.

**Evidence.** `tests/api/approval-reminders.test.mjs` — “APPROVE-004 / NOTIFY-001 reminds the approver after 1 business day then daily in their zone, escalates to the delegate after 3, limits manual reminders to one per 4 hours and stops once approved”; `tests/browser/approval-reminders.spec.ts` — “APPROVE-004 sets reminder intervals and a delegate, shows the scheduled reminders and escalation, and limits Remind approver at 1440px/390px”
**Gap.** None.

### Signing and execution

#### SIGN-002 — Live Docusign, Adobe Acrobat Sign and Dropbox Sign

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-MAIL-001, BASE-OPS-004, BASE-SECRET-001 · Rules D-1

**Requirement.** The owner connects a Docusign, Adobe Acrobat Sign or Dropbox Sign account with OAuth. From an approved signature package (`SIGN-001`), Locket creates and sends the envelope with every document in the packet and the recipients, signing order, CCs and signature fields that `SIGN-005` decides, records the envelope ID, and tracks status through the provider's webhooks (Docusign Connect, Acrobat Sign webhooks, Dropbox Sign callbacks), verifying each callback's signature. People see sent, viewed, signed, declined and voided per signer, can send reminders, and Locket voids the envelope if the agreement changes after sending. A coordinator (`SIGN-007`) can correct a recipient who has not yet signed without voiding: fix a wrong name or email, or reassign the signer when they delegate to a colleague. Locket does this through each provider's own correction (Docusign's envelope recipient update, Acrobat Sign's participant replacement, Dropbox Sign's signer email update, and Inkwell's equivalent). Each correction records who changed whom and why in the routing manifest, which `EXEC-001` reconciles against. The document and its approval stay unchanged; a provider that cannot correct a recipient is shown as needing void and resend. Detailed operational rules: [the SIGN-002 record](docs/contract/operational-details.md#sign-002).

**Acceptance.**
1. The journey with a Docusign API fake sends an approved two-document package with its `SIGN-005` signers and `SIGN-006` fields, receives signed callbacks for viewed, one signer completed and envelope completed, rejects a callback with a bad signature, and voids an envelope when a new version is added. A counterparty signer's mistyped email is corrected, and a second signer is reassigned to a delegate, both without voiding; the envelope keeps its ID, the manifest records both changes, and `EXEC-001` reconciles cleanly against the corrected signers. The same journey runs against Acrobat Sign and Dropbox Sign fakes. A live sandbox run against each provider's developer account is recorded before the clause is accepted.

**Evidence.** `src/locket/execution.ts`; `tests/api/flows.test.mjs`
**Gap.** OAuth, developer-account live sandbox receipts, verified callbacks, correction, provider reminders and provider voiding remain unproved; SIGN-005 packet transports alone do not complete this clause

#### SIGN-003 — Inkwell signing

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003 · Rules D-1

**Requirement.** Inkwell, the Run Edit Run e-signature product, connects the same way as `SIGN-002`: Locket sends the approved package to the buyer's Inkwell installation, receives signed status events and retrieves the completed file and Inkwell's completion certificate automatically. Detailed operational rules: [the SIGN-003 record](docs/contract/operational-details.md#sign-003).

**Acceptance.**
1. a journey against an Inkwell installation fake sends a package, receives completion and retrieves the file and certificate, which `EXEC-001` reconciles cleanly.

**Evidence.** `src/locket/signature-inkwell.ts`
**Gap.** BLOCKED: Inkwell public machine-send/manage and signed outgoing completion events are absent at 6c4638762028477f6ddba6b6bd8fc18ad2fcbb04; requires the Inkwell seed before automatic signed PDF/certificate retrieval can complete

#### EXEC-002 — Automatic retrieval and filing of executed agreements

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003 · Rules D-1

**Requirement.** When a connected provider reports completion, Locket downloads the signed PDF and the certificate of completion, stores them byte-for-byte, runs `EXEC-001` reconciliation (mismatches held for owner or counsel), marks the agreement executed, starts extraction (`REPO-004`), files copies into the connected Google Drive, OneDrive/SharePoint or Chest folder by the owner's naming rule (`INT-001`), and notifies the requester and CRM. Retrieval failures retry with backoff and stay visible until resolved.

**Acceptance.**
1. a journey with a Docusign fake completes an envelope; within one minute the agreement is executed with the signed file and certificate digests matching the fake's, a copy is in the Drive fake's folder under the naming rule, and HubSpot's deal shows executed; a forced download failure leaves a visible retrying state and no executed status.

**Evidence.** `tests/api/flows.test.mjs` — “01 legacy PDF and DOCX keep original bytes, source identity and provenance”; `tests/browser/execution-comparison.spec.ts` — “AGENT-006 changed signed liability is visible and held until reasoned acceptance at 1440px/390px”
**Gap.** A cited journey must retrieve, file into connected storage, start extraction and write executed status back to CRM; cited journeys prove retrieved signed evidence and guarded follow-up preparation, not all connected outcomes.

#### SIGN-004 — Clickwrap acceptance of published terms

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-AUDIT-001, BASE-DATA-001, BASE-MAIL-001, BASE-OPS-004, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-ROLE-001 · Rules D-1

**Requirement.** Counsel or the owner publishes immutable versioned standard terms (terms of service, data processing addendum, partner terms) for acceptance on the buyer's website or app through an embeddable script or the API. Publishing trims outer whitespace, stores the resulting UTF-8 text and its SHA-256, and never rewrites an earlier version. The embed opens a top-level hosted review; acceptance requires a fresh unchecked checkbox and an explicit Accept action, never silent acceptance or acceptance in a frame. The Base-session door uses the current account and email, with a missing session returning through sign-in to the review; An agent’s terms acceptance carries commitment and follows the company’s policy (`PROPOSE-001`). The customer-site door needs no Locket membership: the customer's server signs its own signer ID and email with the installation's optional server-only signing key. The assertion binds installation, site, terms and exact version/digest, has a one-use nonce and at most ten minutes of validity, and is labeled site-asserted identity (not identity-proofed). Invalid assertions are refused, never replaced by Base authentication. Site identities are scoped by site origin and signer ID. Under the held company policy for standard or commitment, each acceptance records account, email, identity kind, exact terms version/digest, server time, transport IP, user agent and the hosted page shown; caller-supplied evidence cannot replace these values. Both doors preserve `SEC-002` command retry outcomes; reusing a nonce for a new command is refused. A new version can require reacceptance; an optional revision keeps the most recent required version's acceptance sufficient. Owner/counsel search, export and link evidence to counterparties; other Base users read/export only their own evidence. Links are audited annotations beside immutable acceptance evidence. The complete archive retains the terms and acceptances. No identity-proofing, signatory-authority or legal-validity claim is made. Agent calls carry commitment as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. the public-door journey publish version 1, accept it through the real embed on a fixture website as a customer with no Locket session, publish version 2 requiring reacceptance and see the same account prompted with an unchecked checkbox.
2. At 1440/390 the exact terms/digest, site-asserted identity and accepted receipt are visible, a counterparty is linked and the searchable CSV contains both versions, digests, times, IP and page evidence.
3. Under the held company policy for commitment, aPI proof also covers Base acceptance, immutable prior text, optional revisions, same-command retries, refused nonce replay, wrong signatures/origins/expiry/versions and agent-role acceptance, no invalid-assertion fallback, private read scope, attributed audit events and the complete archive.
4. The missing-Base-session browser path returns through sign-in.

**Evidence.** `tests/api/clickwrap.test.mjs` — “SIGN-004 / SEC-002 publishes immutable terms, Base and external website acceptance, reacceptance, counterparty search and export”; `tests/browser/clickwrap.spec.ts` — “SIGN-004 counsel publishes, website embed prompts again, and acceptance browser exports at 1440px and 390px”
**Gap.** A company-policy journey must accept binding terms for a sponsor under both policies; cited journeys prove person/site-asserted acceptance and legacy agent refusal.

#### SIGN-005 — Our signer by rule

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** Locket decides who signs, where they sign and what they sign before an envelope leaves, so nothing needs tagging by hand in the provider. The owner sets rules that choose our signatory by agreement type, USD value, department and our contracting entity (`ENTITY-001`), on the same rule engine and preview as `APPROVE-002`. For example, the VP Sales signs under $100,000 and the CFO at $100,000 or more. Every rule set has a required fallback signer, used when no rule matches or the chosen signer is marked unavailable. Counterparty signers come from the request's contacts and the counterparty's authorized signatories (`REPO-010`). Agent calls carry standard or commitment as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard or commitment, the owner sets rules that choose our signatory by agreement type, USD value, department and our contracting entity (`ENTITY-001`), on the same rule engine and preview as `APPROVE-002`. For example, the VP Sales signs under $100,000 and the CFO at $100,000 or more. Every rule set has a required fallback signer, used when no rule matches or the chosen signer is marked unavailable. Counterparty signers come from the request's contacts and the counterparty's authorized signatories (`REPO-010`).

**Evidence.** `tests/api/signature-packets.test.mjs` — “Signer rules preview and freeze type, exact USD bounds, entity, department and unavailable fallback before packet approval”; `tests/browser/signature-packets.spec.ts` — “Signature coordinator reviews template packet, previews signer rules and places page seven fields with CC at 1440px/390px”
**Gap.** A company-policy journey must coordinate signing under both policies; cited journeys prove native coordinator authority and packet preparation.

#### SIGN-006 — Fields from templates

Core · target · **partial** · From SIGN-005 · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-INPUT-003, BASE-ROLE-001 · Rules D-1

**Requirement.** Templates carry signature blocks per party role: signature, name, title, date and initials. Locket writes these into the signing PDF as each provider's anchor or text tags (Docusign anchor tabs, Acrobat Sign text tags, Dropbox Sign text tags, and the same placements for Inkwell), so fields land on the blocks automatically. Agent calls carry standard or commitment as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Templates carry signature blocks per party role: signature, name, title, date and initials. Locket writes these into the signing PDF as each provider's anchor or text tags (Docusign anchor tabs, Acrobat Sign text tags, Dropbox Sign text tags, and the same placements for Inkwell), so fields land on the blocks automatically.

**Evidence.** `tests/api/signature-packets.test.mjs` — “Signer rules preview and freeze type, exact USD bounds, entity, department and unavailable fallback before packet approval”; `tests/browser/signature-packets.spec.ts` — “Signature coordinator reviews template packet, previews signer rules and places page seven fields with CC at 1440px/390px”
**Gap.** A company-policy journey must coordinate signing under both policies; cited journeys prove native coordinator authority and packet preparation.

#### SIGN-007 — Signature coordinator

Core · target · **partial** · From SIGN-005 · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-ROLE-001 · Rules D-1

**Requirement.** Before sending, a signature coordinator reviews the packet. Coordinators are the roles that may hand an agreement off for signature (`ROLE-001`): the owner, an approver, or the agreement's requester. The owner can narrow coordination to a named Signature coordinators group (`REPO-009`), per agreement type. Counsel and viewers cannot coordinate. Agent coordination carries standard or commitment according to the change and follows company policy (`PROPOSE-001`). They can reorder, add or remove signers and add CCs. On a document with no template blocks, such as counterparty paper, they place fields by hand on a page preview. Every change is recorded in the routing manifest. Agent calls carry standard or commitment as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard or commitment, before sending, a signature coordinator reviews the packet. Coordinators are the roles that may hand an agreement off for signature (`ROLE-001`): the owner, an approver, or the agreement's requester. The owner can narrow coordination to a named Signature coordinators group (`REPO-009`), per agreement type. Under the held company policy for standard, external and commitment, counsel, viewers and agents cannot coordinate; an agent may propose a change for a coordinator to apply (`PROPOSE-001`). They can reorder, add or remove signers and add CCs. On a document with no template blocks, such as counterparty paper, they place fields by hand on a page preview. Every change is recorded in the routing manifest.

**Evidence.** `tests/api/signature-packets.test.mjs` — “Signer rules preview and freeze type, exact USD bounds, entity, department and unavailable fallback before packet approval”; `tests/browser/signature-packets.spec.ts` — “Signature coordinator reviews template packet, previews signer rules and places page seven fields with CC at 1440px/390px”
**Gap.** A company-policy journey must coordinate signing under both policies; cited journeys prove native coordinator authority and packet preparation.

#### SIGN-008 — Packets

Core · target · **partial** · From SIGN-005 · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** One envelope carries the main agreement plus approved signable attachments, such as a DPA, order form or SOW. Each document is pinned by digest and covered by the approval (`APPROVE-001`). Attachments that are not for signature can travel as reference documents. Agent calls carry standard or commitment as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard or commitment, one envelope carries the main agreement plus approved signable attachments, such as a DPA, order form or SOW. Each document is pinned by digest and covered by the approval (`APPROVE-001`). Attachments that are not for signature can travel as reference documents.

**Evidence.** `tests/api/signature-packets.test.mjs` — “Signer rules preview and freeze type, exact USD bounds, entity, department and unavailable fallback before packet approval”; `tests/browser/signature-packets.spec.ts` — “Signature coordinator reviews template packet, previews signer rules and places page seven fields with CC at 1440px/390px”
**Gap.** A company-policy journey must coordinate signing under both policies; cited journeys prove native coordinator authority and packet preparation.

### Obligations and renewals

#### OBL-001 — Obligation extraction, owners and status

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-AUDIT-001 · Rules D-1

**Requirement.** Under the held company policy for standard or commitment, the built-in model proposes obligations from executed agreements (deliverables, payment milestones, service levels, insurance certificates, reporting, audit rights, data return or destruction, exclusivity, minimum commitments), each with the party bound, due date or recurrence, and citation. Confirmed obligations get an owner and status (upcoming, due, done, missed, waived) and appear on the owner's list and the counterparty page. Detailed operational rules: [the OBL-001 record](docs/contract/operational-details.md#obl-001). Agent calls carry standard as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard, a journey with a model-provider fake extracts six obligations from a fixture supplier agreement, a person confirms five with owners and rejects one; the confirmed ones appear on each owner's list with their next due dates and recurrence. The clause is accepted only when a live run under `REVIEW-006` meets the obligations bar.

**Evidence.** `tests/api/flows.test.mjs`; `tests/api/obligation-evidence.test.mjs`; `tests/api/obligation-lifecycle-journey.mjs`; `tests/browser/obligation-evidence.spec.ts`
**Gap.** Built-in extraction of every named obligation kind and its party-bound, date, recurrence and citation fields; six-obligation model-provider-fake extraction journey; counsel-labelled held-out obligations material and a passing exact provider, model and prompt live REVIEW-006 obligations record remain required. An undated manually confirmed recurrence remains unscheduled; no first date is inferred. Native manually cited lifecycle proof does not satisfy extraction acceptance. Built-in extraction stays unavailable. Conservative owner-only reasoned local occurrence waiver default awaits CT approval.

#### OBL-002 — Fulfillment evidence and escalation

Core · target · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003, BASE-MAIL-001, BASE-OPS-004 · Rules D-1

**Requirement.** Marking an obligation done requires evidence when its type says so (a file such as a certificate of insurance, a link, or a note). Overdue obligations notify the owner, then escalate to the agreement's responsible person and to an approver after the configured days; each obligation carries a risk rating that rolls up to the agreement and counterparty. Detailed operational rules: [the OBL-002 record](docs/contract/operational-details.md#obl-002).

**Acceptance.**
1. a journey marks an insurance obligation done and is refused without a certificate, attaches one and succeeds; another obligation passes its due date, its owner is emailed (the installation's mail-provider fake), and after three more days the approver is notified and the counterparty page shows the raised risk.

**Evidence.** `tests/api/obligation-evidence.test.mjs` — “OBL-002 evidence before done, overdue owner notice, escalation to the responsible person and approver after the configured days, and risk raised to the counterparty”; `tests/browser/obligation-evidence.spec.ts` — “OBL-002 refuses an insurance obligation done without its certificate, emails and escalates an overdue one and shows the raised risk on the counterparty page at 1440px/390px”
**Gap.** None.

#### RENEW-002 — Delivered reminders and escalation by email

Core · target · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-MAIL-001, BASE-OPS-004 · Rules D-1

**Requirement.** Each renewal and obligation deadline sends reminder emails at owner-configured offsets (default 90, 60, 30 and 7 days before the notice deadline, taken from the current term under `RENEW-008`, so an auto-renewing agreement is reminded again every term) in the recipient's US time zone, from Postmark or the installation's mail provider, with a daily digest option. If no renewal decision is recorded by the 30-day reminder, Locket escalates to the agreement's approver and the owner. Every message keeps its provider message ID and delivery, bounce and complaint events; a bounced reminder is retried to an alternate recipient and shown on the deadline. Detailed operational rules: [the RENEW-002 record](docs/contract/operational-details.md#renew-002).

**Acceptance.**
1. The journey with a mail-provider fake and a controlled clock confirms an end date and 60-day notice in America/Chicago, advances to each offset and receives the four reminders at 9:00 local time, sees escalation at 30 days without a decision, and sees a bounce event shown on the deadline with the alternate recipient emailed.

**Evidence.** `tests/api/deadline-reminders.test.mjs` — “RENEW-002 emails the four reminders at 9:00 Chicago time, escalates an undecided renewal at 30 days to its approver and the owner, and retries a bounced reminder to the alternate recipient”; `tests/browser/deadline-reminders.spec.ts` — “RENEW-002 / NOTIFY-001 sets offsets and a personal digest preference, shows the sent reminder, its bounce and the alternate retry on the deadline at 1440px and 390px”
**Gap.** None.

#### RENEW-003 — Deadlines on Google Calendar and Outlook

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006 · Rules D-1

**Requirement.** A person connects Google Calendar or Outlook (Microsoft Graph) and chooses which deadlines appear (their own, their team's, all they may see). Notice deadlines, end dates and obligation due dates become calendar events with a link back, updated when a confirmed term is corrected and removed when the agreement ends or the deadline is met. Events follow the current term (`RENEW-008`): when an auto-renewing agreement rolls forward, the next term's notice deadline and end date are added.

**Acceptance.**
1. a journey with Google Calendar and Graph fakes connects both, confirms terms and sees the notice-deadline event created; correcting the end date moves the event; recording the renewal decision marks it done.
2. Live runs against a Google Workspace test calendar and a Microsoft 365 developer tenant are recorded before the clause is accepted.

**Evidence.** `tests/api/portfolio.test.mjs`
**Gap.** Person OAuth, own/team scopes, obligation events, both-provider decision completion and live Workspace/Microsoft 365 proof

#### RENEW-004 — Bulk reminders for imported contracts

Core · target · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-DATA-001, BASE-INPUT-003, BASE-MAIL-001, BASE-OPS-004, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-ROLE-001 · Rules D-1

**Requirement.** After a bulk import (`REPO-003`, `MOVE-*`), a person selects confirmed agreements by view or filter and sets reminder schedules and owners on all of them in one action, with a preview of the deadlines that will be tracked and those skipped for missing confirmed terms. Deadlines come from each agreement's current term (`RENEW-008`), so auto-renewing agreements whose original end dates are past are tracked, and expired or terminated ones are skipped with that reason. Detailed operational rules: [the RENEW-004 record](docs/contract/operational-details.md#renew-004).

**Acceptance.**
1. clause-named the cited journey and the cited journey move a synthetic 40-record fixture through the public DocuSign bulk-import door, select it by view/filter, preview 34 tracked deadlines and six missing-term skips, reload/resume the review, and apply with visible progress at 1440/390. All 20 pre-2025 auto-renewing agreements use future current-term notice deadlines, original terms stay unchanged, owners/offsets/local 09:00 instants match the preview, and stored schedules never claim delivery. The public-door journey include expired/terminated skips, stale/role/access/owner refusals, protected replay, audit/archive, and a larger whole selection resumed across multiple preview/apply batches without a user-facing cap.

**Evidence.** `tests/api/bulk-reminders.test.mjs` — “RENEW-004 reviews 40 imported agreements, stores 34 current-term schedules, audits every outcome and never claims delivery”; `tests/browser/bulk-reminders.spec.ts` — “RENEW-004 selects a filtered imported view, reviews 34 deadlines and 6 skips, stores 34 schedules at 1440px and 390px”
**Gap.** None.

#### RENEW-005 — Renewal briefs and renewal workflows

Core · target · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-DATA-001, BASE-DATA-003, BASE-DATA-006, BASE-INPUT-003, BASE-ROLE-001, BASE-SECRET-001 · Rules D-1

**Requirement.** At a configured lead time before each notice deadline, Locket prepares a renewal brief for the decision-maker: current terms and amendments, price-increase cap, spend to date and invoices (`LINK-001`), obligation and service-level history, open issues and the options (renew, renegotiate, terminate) with their deadlines. Choosing renew or renegotiate opens a renewal request linked as `renews` with the brief attached. Detailed operational rules: [the RENEW-005 record](docs/contract/operational-details.md#renew-005).

**Acceptance.**
1. a journey with an accounting fake reaches the lead time on a supplier agreement; the brief cites the cap clause and shows spend to date; choosing renegotiate opens a linked renewal request routed under `INTAKE-002`. An owner configures the lead time and an active owner/approver decision-maker with current agreement access. The hourly scheduled run prepares one immutable brief per current deadline and source revision, using REPORT-003’s current-term projection; RENEW-007 inherits its expanded term types and durable history. The brief retains confirmed terms and their citations, person-confirmed price-increase caps, accessible amendments, obligations with their evidence and observed service-level history, unresolved comments/findings, and all three options with the current notice deadline. A read-only, owner-authorized QuickBooks vendor link adds dated USD bills incurred since the confirmed effective date (else recorded start, else installation record date). Bills are vendor-period spend, with outstanding balances shown separately; no allocation across contracts or payment total is inferred.
2. The same journey follows the detailed operational rules linked in the Requirement, including their authority, version, source, refusal and recorded-outcome conditions.

**Evidence.** `tests/api/notices.test.mjs` — “RENEW-005 prepares one cited accounting brief at lead time and opens the current intake-routed renewal with exact PDF custody”; `tests/browser/notices.spec.ts` — “RENEW-005 reviews cited cap and accounting spend then opens an intake-routed renegotiation at 1440px and 390px”
**Gap.** None.

#### RENEW-006 — Send approved notices with delivery evidence

Core · target · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-DATA-001, BASE-DATA-003, BASE-DATA-006, BASE-INPUT-003, BASE-MAIL-001, BASE-OPS-004, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-ROLE-001 · Rules D-1

**Requirement.** An approved notice (`RENEW-001`) is sent from Locket by email to the counterparty's approved notice address with the PDF letter attached, or exported as a letter for certified mail or courier with the tracking number recorded. The current email connection is the installation's mail provider (currently Resend); other notice providers added by `INT-004` inherit the same approved-recipient/PDF, single-send and authenticated-event obligations before shipping. Until `REPO-010` adds the counterparty notice-address directory, the preparer enters the notice address on each draft and the approver reviews that exact recipient. `REPO-010` inherits the same frozen recipient when its directory ships. Detailed operational rules: [the RENEW-006 record](docs/contract/operational-details.md#renew-006).

**Acceptance.**
1. `RENEW-006` in the cited journey and the cited journey sends an approved termination notice through the configured Base provider fake, proving its attached PDF is byte-identical to the approved download and its SHA-256, message ID, sent status and signed delivered event appear at 1440/390. A certified-mail notice records its tracking number and stays sent, delivery unconfirmed until manually recorded delivery, visibly separate from provider evidence. The public-door journey cover duplicate/concurrent command replay with one send, invalid/stale signatures, wrong recipients, event replay/collision, bounce history, rejected/suppressed outcomes, denied roles, restricted evidence and full archive retention. The real `rer dev` journey exercises draft/PDF/approval, honest local suppression and courier unconfirmed/delivered states at both widths.

**Evidence.** `tests/api/notices.test.mjs` — “RENEW-006 approved exact PDF/recipient email, signed provider events, retries, archive and manual certified-mail evidence”; `tests/browser/notices.spec.ts` — “RENEW-006 reviews frozen PDF, sends approved email, displays signed delivery and manual certified-mail evidence at 1440px and 390px”
**Gap.** None.

#### RENEW-007 — Renewal terms confirmed

Core · target · **done** · Cites BASE-INPUT-003 · Rules D-1

**Requirement.** Most agreements a buyer brings in are evergreen SaaS and supplier contracts whose original end date is years past. Locket follows each one to its current term, so deadlines keep firing every term. Beside the effective date, end date (or an initial term in months), notice period, auto-renewal and renewal term that `TERMS-001` confirms, a person confirms the renewal type and the renewals allowed, each citing its passage. The renewal type is one of: fixed term (ends at its end date), auto-renews for the renewal term, evergreen (continues until either party gives notice), or optional renewal (renews only when we elect to). Renewals allowed is a whole number, and blank means unlimited. Extraction proposes all of them (`REPO-004`), and the Ironclad Lifecycle preset's properties map onto them (`MOVE-002`).

**Acceptance.**
1. Beside the effective date, end date (or an initial term in months), notice period, auto-renewal and renewal term that `TERMS-001` confirms, a person confirms the renewal type and the renewals allowed, each citing its passage. The renewal type is one of: fixed term (ends at its end date), auto-renews for the renewal term, evergreen (continues until either party gives notice), or optional renewal (renews only when we elect to). Renewals allowed is a whole number, and blank means unlimited. Extraction proposes all of them (`REPO-004`), and the Ironclad Lifecycle preset's properties map onto them (`MOVE-002`).

**Evidence.** `tests/api/portfolio.test.mjs` — “RENEW-008 RENEW-009 RENEW-010 imports durable current terms, rolls once at the deadline and supersedes corrected derivations without rewriting originals”; `tests/api/portfolio.test.mjs` — “RENEW-009 optional election needs this term’s timely sent notice and renewal limits expire the final term”; `tests/api/portfolio.test.mjs` — “RENEW-012 evergreen anniversaries have owner-configured review lead time and no notice deadline”
**Gap.** None.

#### RENEW-008 — Derive the current contract term

Core · target · **done** · From RENEW-007 · Cites BASE-AGENT-002, BASE-AGENT-006 · Rules D-1

**Requirement.** From the confirmed terms Locket derives every term in sequence. Each renewal term starts the day after the previous term ends and ends the day before the same calendar day one renewal term later (a 1-year term starting 1 March 2027 ends 29 February 2028). It derives the current term's start and end, the term number, renewals remaining and the next notice deadline (`RENEW-001`'s rule, in the agreement's zone, with `US-001`'s business-day option). This runs when terms are confirmed, including an imported agreement on the day it is confirmed (`REPO-003`, `MOVE-*`), and on a daily scheduled run (a Cloudflare Cron Trigger) for every agreement.

**Acceptance.**
1. From the confirmed terms Locket derives every term in sequence. Each renewal term starts the day after the previous term ends and ends the day before the same calendar day one renewal term later (a 1-year term starting 1 March 2027 ends 29 February 2028). It derives the current term's start and end, the term number, renewals remaining and the next notice deadline (`RENEW-001`'s rule, in the agreement's zone, with `US-001`'s business-day option). This runs when terms are confirmed, including an imported agreement on the day it is confirmed (`REPO-003`, `MOVE-*`), and on a daily scheduled run (a Cloudflare Cron Trigger) for every agreement.

**Evidence.** `tests/api/portfolio.test.mjs` — “RENEW-008 RENEW-009 RENEW-010 imports durable current terms, rolls once at the deadline and supersedes corrected derivations without rewriting originals”
**Gap.** None.

#### RENEW-009 — Commit an automatic renewal

Core · target · **done** · From RENEW-007 · Rules D-1

**Requirement.** When a notice deadline passes with no terminate decision recorded under `RENEW-001`, the renewal is committed: the next term and its notice deadline appear, and the roll-forward is recorded. For an optional renewal, the term rolls forward only when a renew decision is recorded and its notice is recorded as sent before the deadline; otherwise the agreement expires at the end date. Roll-forward stops after the renewals allowed, and the agreement then expires at the end of its last term.

**Acceptance.**
1. When a notice deadline passes with no terminate decision recorded under `RENEW-001`, the renewal is committed: the next term and its notice deadline appear, and the roll-forward is recorded. For an optional renewal, the term rolls forward only when a renew decision is recorded and its notice is recorded as sent before the deadline; otherwise the agreement expires at the end date. Roll-forward stops after the renewals allowed, and the agreement then expires at the end of its last term.

**Evidence.** `tests/api/portfolio.test.mjs` — “RENEW-008 RENEW-009 RENEW-010 imports durable current terms, rolls once at the deadline and supersedes corrected derivations without rewriting originals”; `tests/api/portfolio.test.mjs` — “RENEW-009 optional election needs this term’s timely sent notice and renewal limits expire the final term”
**Gap.** None.

#### RENEW-010 — Keep superseded term derivations

Core · target · **done** · From RENEW-007 · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-INPUT-003 · Rules D-1

**Requirement.** Each roll-forward is a derived history entry beside the confirmed terms: term number, start, end, notice deadline, the confirmed terms it was computed from, when it was derived, and the decision state for that term (no decision, renew or renegotiate decided by a named person). Entries derived for periods before the agreement was in Locket are labeled as derived at import. The confirmed original end date is never changed. Correcting a confirmed term recomputes the chain, and the earlier derivation is kept as superseded.

**Acceptance.**
1. Each roll-forward is a derived history entry beside the confirmed terms: term number, start, end, notice deadline, the confirmed terms it was computed from, when it was derived, and the decision state for that term (no decision, renew or renegotiate decided by a named person). Entries derived for periods before the agreement was in Locket are labeled as derived at import. The confirmed original end date is never changed. Correcting a confirmed term recomputes the chain, and the earlier derivation is kept as superseded.

**Evidence.** `tests/api/portfolio.test.mjs` — “RENEW-008 RENEW-009 RENEW-010 imports durable current terms, rolls once at the deadline and supersedes corrected derivations without rewriting originals”
**Gap.** None.

#### RENEW-011 — Record termination and its effective date

Core · target · **partial** · From RENEW-007 · Rules D-1

**Requirement.** A terminate decision stops the roll-forward. If no notice is recorded as sent by the notice deadline, the agreement is flagged to owner and counsel as "termination decided, notice not recorded by the deadline", with no roll-forward, until one of them records the notice with its evidence or confirms that the agreement renewed. A recorded termination takes effect on the current term's end date, or on an earlier effective date a person records with the clause that allows it.

**Acceptance.**
1. A terminate decision stops the roll-forward. If no notice is recorded as sent by the notice deadline, the agreement is flagged to owner and counsel as "termination decided, notice not recorded by the deadline", with no roll-forward, until one of them records the notice with its evidence or confirms that the agreement renewed. A recorded termination takes effect on the current term's end date, or on an earlier effective date a person records with the clause that allows it.

**Evidence.** `tests/api/portfolio.test.mjs` — “RENEW-008 RENEW-009 RENEW-010 imports durable current terms, rolls once at the deadline and supersedes corrected derivations without rewriting originals”
**Gap.** A journey must keep a termination with no recorded timely notice from rolling forward until an authorized resolution; the cited portfolio journey flags the missing notice but subsequently rolls forward after the deadline.

#### RENEW-012 — Show the agreement lifecycle

Core · target · **done** · From RENEW-007 · Rules D-1

**Requirement.** Every executed or imported agreement has a derived lifecycle status beside its workflow stage: not yet in effect (effective date in the future), active (in term and not auto-renewing, including a fixed term, an evergreen agreement and one with a termination noticed, which shows its end date), auto-renewing (with the days left to the next notice deadline), expired (past the end of its last term), or terminated (from the termination's effective date). An evergreen agreement has no notice deadline; it is listed for review on each anniversary of its effective date at an owner-configured lead time.

**Acceptance.**
1. Every executed or imported agreement has a derived lifecycle status beside its workflow stage: not yet in effect (effective date in the future), active (in term and not auto-renewing, including a fixed term, an evergreen agreement and one with a termination noticed, which shows its end date), auto-renewing (with the days left to the next notice deadline), expired (past the end of its last term), or terminated (from the termination's effective date). An evergreen agreement has no notice deadline; it is listed for review on each anniversary of its effective date at an owner-configured lead time.

**Evidence.** `tests/browser/renewal-lifecycle.spec.ts` — “Current renewal terms, optional and evergreen types, limits, termination and superseded history agree with every portfolio drilldown at 1440px/390px”
**Gap.** None.

#### RENEW-013 — Reconcile lifecycle dashboard totals

Core · target · **done** · From RENEW-007 · Cites BASE-AUDIT-001 · Rules D-1

**Requirement.** Before RENEW-007 is done, REPORT-003's tiles, values, current-term countdowns and drilldowns must also assert optional/evergreen renewal types, renewal limits, early termination and the durable/superseded derivation history described here.

**Acceptance.**
1. Before RENEW-007 is done, REPORT-003's tiles, values, current-term countdowns and drilldowns must also assert optional/evergreen renewal types, renewal limits, early termination and the durable/superseded derivation history described here.

**Evidence.** `tests/api/portfolio.test.mjs` — “REPORT-003 portfolio tiles match visible records and current-term deadlines, never proposed terms or hidden records”
**Gap.** None.

#### RENEW-014 — Use current terms across contract work

Core · target · **partial** · From RENEW-007 · Cites BASE-DATA-001, BASE-INPUT-003 · Rules D-1

**Requirement.** Search and filters (`REPO-006`), saved views and columns (`REPO-007`), reports and the dashboard (`REPORT-002`, `REPORT-003`), reminders (`RENEW-002`), calendar events (`RENEW-003`), bulk schedules (`RENEW-004`), renewal briefs (`RENEW-005`), the API and webhooks (`INT-002`) and the archive (`PORT-001`) use the current term, its notice deadline and the lifecycle status, never an original end date that has passed.

**Acceptance.**
1. Search and filters (`REPO-006`), saved views and columns (`REPO-007`), reports and the dashboard (`REPORT-002`, `REPORT-003`), reminders (`RENEW-002`), calendar events (`RENEW-003`), bulk schedules (`RENEW-004`), renewal briefs (`RENEW-005`), the API and webhooks (`INT-002`) and the archive (`PORT-001`) use the current term, its notice deadline and the lifecycle status, never an original end date that has passed.

**Evidence.** `tests/api/portfolio.test.mjs` — “RENEW-008 RENEW-009 RENEW-010 imports durable current terms, rolls once at the deadline and supersedes corrected derivations without rewriting originals”
**Gap.** A journey must use current terms through every listed door, including completed API/webhook and calendar products; cited journeys prove native projections, reminder/calendar fixtures and portfolio, while INT-002 and RENEW-003 remain incomplete.

### Commercial systems

#### LINK-001 — Accounting links: Pantry, QuickBooks Online and NetSuite

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006 · Rules D-1

**Requirement.** The owner connects Pantry, QuickBooks Online or NetSuite. Agreements link to the vendor or customer record; Locket reads bills, invoices and payments for linked counterparties to show spend or revenue to date against the contract value and payment schedule in USD, and offers confirmed payment obligations to the accounting system as scheduled bills or invoice reminders for a person to accept there.

**Acceptance.**
1. A journey with a QuickBooks Online fake links a supplier agreement to its vendor, reads 8 bills totaling $84,000 against a $100,000 contract, shows 84% consumed, and a Pantry fake receives a proposed payment schedule that stays pending until accepted there.

**Evidence.** `tests/api/notices.test.mjs`; `tests/browser/notices.spec.ts`
**Gap.** The full LINK-001 target remains unproved for proposed scheduled bills and invoice reminders in QuickBooks Online and NetSuite; the current outbound door targets Pantry only. Prove destination changes and effective loss of field authority through the provider outcome write, beyond the asserted session, role, source and field-policy revision cases. Retain the proved three-provider reads, exact USD allocation, positive unmatched amounts and ambiguous due dates, monthly supplier and customer proposals, independently asserted quarterly and annual supplier preparation dates with clamping, unchanged retained snapshot content after failed reads, separate per-occurrence consent, pending acceptance, guarded attributed accounting consent and outcome history, populated accounting erasure and legal holds, and no uncertain resend. The complete original target and every inherited duty remain owed.

#### LINK-002 — Procurement links: Purse and Coupa

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-006 · Rules D-1

**Requirement.** A purchase request in Purse or Coupa that needs a contract opens a Locket request with supplier, amount and requester. On execution, Locket sends the supplier record the contract's key terms (value cap, dates, payment terms, renewal) so purchase orders draw down against it, and reads PO totals back to show remaining value.

**Acceptance.**
1. a journey with a Purse fake starts a request from a purchase request, executes it, sees the terms on the supplier record in the fake, and reads back two POs showing remaining contract value; the same runs against a Coupa fake.

**Evidence.** None.
**Gap.** No procurement connection exists

#### LINK-003 — Proposal and billing handoffs: Platter and Nectar

Core · target · **partial** · Rules D-1

**Requirement.** An accepted proposal in Platter (or PandaDoc) opens a customer contract request with the quoted products, prices and term. An executed customer agreement sends its confirmed pricing, start date, term and renewal terms to Nectar (or Stripe Billing) as a proposed subscription that a billing person activates there.

**Acceptance.**
1. a journey with a Platter fake converts an accepted proposal into a request with its line items, executes it, and a Nectar fake receives the proposed subscription with matching price, start date and renewal, pending activation.

**Evidence.** `tests/api/flows.test.mjs`; `tests/browser/proposal-pricing-journey.mjs`
**Gap.** Successful Nectar handoff with separately preserved differing initial and renewal terms remains an original LINK-003 obligation, blocked by the receiving setup protocol and subsequent Locket integration and end-to-end evidence. Nectar must preserve and validate both terms in its pending setup proposal and expose matching destination readback before a billing person activates it. Until supported, Locket must refuse before sending without equalizing, omitting or inferring either term, silently changing destination, or treating refusal as success. Prove complete matching Nectar readback; exact displayed-payload consent; execution, signed-source digest, destination-account and connection-revision bindings; prepared-handoff staleness and withdrawn consent; current authority through outcome recording; uncertain Nectar no-resend behavior; attributed decision history, restricted custody, archives, erasure and legal holds; and connected proposal pricing through the validated Word line-item door. Record the billing review, consent and outcome screens at 1440 and 390. Retain gaps for PandaDoc quote-builder, ambiguous adjustments and multiple-choice sections; Stripe arrears, taxable prices and nonzero renewal uplifts; and applicable live-provider evidence. Preserve every previously approved provenance, consent, authority, staleness and uncertainty rule. This dependency transfers or waives no acceptance obligation. LINK-003 remains partial.

### Connections and administration

#### INT-001 — Google Drive, OneDrive/SharePoint and Chest

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003 · Rules D-1

**Requirement.** The owner connects Google Drive, OneDrive/SharePoint or Chest. Locket imports from chosen folders (`REPO-003`) and files executed agreements and certificates into a folder structure by naming rule (for example `Contracts/{counterparty}/{year}`), linking each stored copy back to the record. Locket remains the system of record; changes made to copies in storage do not alter Locket's originals.

**Acceptance.**
1. a journey with Drive and Graph fakes imports a folder of 30 agreements, executes a new agreement and finds it filed under the naming rule in both; editing the stored copy leaves Locket's original digest unchanged.
2. Live runs against a Google Drive test folder and a SharePoint document library in a Microsoft 365 developer tenant are recorded before the clause is accepted.

**Evidence.** None.
**Gap.** No storage connection exists

#### INT-002 — Public API, webhooks, Zapier and Crank

Core · target · **partial** · Cites BASE-ACCESSIBILITY-001, BASE-AGENT-002, BASE-AGENT-006, BASE-MAIL-001, BASE-OPS-004, BASE-ROLE-001, BASE-SECRET-001 · Rules D-1 · Register R-6

**Requirement.** A documented REST API covers every command and read the screens use, with scoped API tokens for integrations. Signed outgoing webhooks fire for request created, submitted, approved, sent for signature, executed, term confirmed, deadline approaching, renewal committed, agreement expired, agreement terminated and obligation overdue, with retries and a delivery log. Published Zapier and Crank apps expose the same triggers and actions. Under RL-101, a labelled short-lived delegated token is issued by the signed-in owner with explicit native scopes and an expiry no later than thirty days. It intersects current native rights, stops on revocation or issuer-session end and cannot mint credentials. This does not replace durable scoped service/integration authorization.

**Acceptance.**
1. a journey creates a scoped token, drives an agreement through the API to executed, and receives each webhook with a valid signature at a test endpoint; a failing endpoint is retried and logged; the Zapier and Crank apps' trigger tests pass against a running installation.
2. Token settings show scopes, expiry, issuer and stopped reason without retaining a displayed secret. Signed hooks, retries, delivery logs and complete command coverage remain required (RL-101).

**Evidence.** `tests/api/browser-edits.test.mjs`; `src/locket/scoped-tokens.ts`; `API.md`
**Gap.** Durable scoped service/integration authorization, complete REST command/read coverage, signed outgoing hooks with retries/delivery log, token settings and in-repository Zapier/Crank trigger journeys remain missing; cited native tests prove bounded delegated calls only. Partner publication is R-6.

#### INT-003 — SSO and SCIM provisioning

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-ROLE-001, BASE-SIGNIN-001 · Rules D-1 · Register R-5

**Requirement.** Okta, Microsoft Entra ID, Google Workspace and Auth identities map provider groups to Locket roles and departments. Vendor-specific receipts remain distinct from standards proof.

**Acceptance.**
1. With Auth as the standards provider, provision a Counsel group member, sign in, read the Locket counsel role and department, then deactivate and observe the next agreement command refused.

**Evidence.** `tests/api/security.test.mjs` — “sessions, roles, idempotent commands and stale writes are enforced by the server”
**Gap.** A journey must run SAML/OIDC/SCIM with Auth as the standards provider and the required group mapping; cited journeys prove signed Okta-schema SAML/SCIM fixtures, not that complete standards-provider journey.

#### INT-004 — Connection health

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-MAIL-001, BASE-OPS-004, BASE-SECRET-001 · Rules D-1

**Requirement.** Every connection (CRM, signing, storage, calendar, chat, accounting, procurement, mail, model) shows its status, the account it acts as, last successful sync, and each failure with its reason and a retry, and the owner is emailed when a connection starts failing or its credentials near expiry.

**Acceptance.**
1. a journey with fakes connects HubSpot and Docusign, forces an expired token on Docusign, and sees the connection marked failing with the reason, the affected agreements listed, an owner email sent, and recovery after reconnecting.

**Evidence.** `tests/api/signature-packets.test.mjs`; `tests/browser/counterparties.spec.ts`; `tests/api/approval-mail.test.mjs`; `tests/api/browser-edits.test.mjs`; `tests/api/notices.test.mjs`; `tests/api/reports.test.mjs`; `tests/api/outcome-report.test.mjs`
**Gap.** Verified acting identities and read-only probes for Nook, Inkwell, scoped Uptime and Linen, and mail transports other than Resend and Postmark remain unproved; Resend sender-domain verification does not establish its acting-account identity; automatic chat membership-read and callback health coverage and expiry discovery beyond HubSpot remain unproved.

#### NOTIFY-001 — Notifications and preferences

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-DATA-001, BASE-DATA-003, BASE-DATA-006, BASE-MAIL-001, BASE-OPS-004, BASE-ROLE-001 · Rules D-1

**Requirement.** People receive personal in-app and email notifications for today's request responsible-person assignment and reassignment, confirmed obligation assignment, explicit comment mentions, pending commercial and exception approvals, manual signature handoff/void/completion and accepted execution, overdue obligations and renewal/obligation deadlines. Only explicit operator identities are mentions; typing a display name never selects a recipient. Automatic approval requests follow the current route and exclude a requester who cannot approve their own request. Signature events go to the requester's and responsible person's accounts. Every recipient must be an active human with current agreement access. Detailed operational rules: [the NOTIFY-001 record](docs/contract/operational-details.md#notify-001).

**Acceptance.**
1. clause-named API and browser journeys mention counsel, assign a request and complete a signature; counsel receives the in-app and email events under personal preferences. Switching to a daily digest batches the next day's notifications into one own-zone 9 a.m. email, including an explicit approval email and existing deadline reminders. Under the held company policy for standard, external and commitment, assertions cover each current event kind, duplicate/concurrent sends, read-state persistence, channel switches, explicit-identity mentions, agent/other-person refusal, current role/access revocation, pending approval/version changes, no restricted viewer disclosure, generic mail, uncertain outcomes without resend, signed deadline-digest evidence and whole-archive retention (the cited journey names NOTIFY-001 and restores channels, read state, records and delivery outcomes through rer export/import). Browser journeys at 1440/390 use the comment mention control, open the inbox and linked agreement, mark read, and save/reload channel, digest and zone preferences without horizontal scrolling. the cited journey asserts cross-door owner refusal, routing-only defaults and concurrent personal-choice preservation; the cited journey proves self-editable and other-person read-only zone/digest with editable routing at both widths.
2. The same journey follows the detailed operational rules linked in the Requirement, including their authority, version, source, refusal and recorded-outcome conditions.

**Evidence.** `tests/api/notifications.test.mjs` — “NOTIFY-001 assignments, explicit mentions, approval requests and signature events reach the personal inbox and generic email exactly once”; `tests/browser/notifications.spec.ts` — “NOTIFY-001 inbox, explicit mention, read state and personal channels at 1440px/390px”
**Gap.** A company-policy journey must change sponsored notification preferences and record the resulting decisions; cited journeys prove native personal channels/digests and fixed legacy-agent preference refusals.

#### US-001 — US defaults

Core · target · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003 · Rules D-1

**Requirement.** A new installation defaults to USD with values entered and shown as US dollars, an installation time zone chosen from US zones (Eastern, Central, Mountain, Arizona, Pacific, Alaska, Hawaii) that new agreements inherit and can change per agreement, US date format, governing law chosen from US states and the District of Columbia (with other jurisdictions available), counterparty EIN in place of ABN, and an option to roll notice deadlines that fall on a weekend or US federal holiday to the previous business day. Agreements in another currency keep their original amount and show the USD equivalent at a recorded rate. Default required attachments: supplier agreements need a certificate of insurance and a Form W-9; customer agreements need a statement of work or order form; amendments need the signed parent; NDAs none. Detailed operational rules: [the US-001 record](docs/contract/operational-details.md#us-001).

**Acceptance.**
1. a fresh installation's request form shows USD and the installation's America/Los_Angeles zone, a supplier request requires a certificate of insurance and W-9, a deadline falling on Thanksgiving rolls back to the Wednesday with the business-day option on, and a GBP agreement shows its USD equivalent and rate.

**Evidence.** `tests/api/us-defaults.test.mjs` — “US-001 installation US zone, USD with recorded-rate other currencies, EINs, US required attachments and Thanksgiving business-day rolling”; `tests/browser/us-defaults.spec.ts` — “US-001 sets the installation's Pacific zone and business-day rolling, shows USD and W-9 at intake, a GBP value at its recorded rate and a Thanksgiving deadline rolled to Wednesday at 1440px and 390px”
**Gap.** None.

#### AUDIT-001 — Filterable activity audit trail

Core · target · **done** · Cites BASE-ACCESSIBILITY-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-DATA-001, BASE-DATA-003, BASE-DATA-006, BASE-INPUT-003, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-ROLE-001 · Rules D-1

**Requirement.** Locket records successful agreement business commands and views of restricted agreements, comparison results and downloaded contract files. The record identifies the agreement, action summary, actor role and downloaded artifact digest.

**Acceptance.**
1. After an approval, a restricted agreement read and a file download, read the attributed agreement activity and the matching audit CSV, including the artifact digest.

**Evidence.** `tests/api/flows.test.mjs` — “AUDIT-001 approvals, restricted reads and downloads filter and export the same attributed trail”; `tests/browser/audit.spec.ts` — “AUDIT-001 filters and matching CSV after approval, restricted view and download at 1440px and 390px”
**Gap.** None.

#### ERASE-001 — Personal-data erasure with legal hold

Core · target · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-DATA-003, BASE-DATA-006, BASE-INPUT-003, BASE-MAIL-001, BASE-OPS-004 · Rules D-1

**Requirement.** On a verified request (for example under the California Consumer Privacy Act), the owner erases a person's personal data from contacts, comments and notifications while keeping executed agreements, signatures and audit records that must be retained, with a recorded reason. Agreements under a legal hold (set by counsel) cannot be deleted or have files removed until the hold is released. Retention rules delete or anonymize expired, unexecuted drafts after a configured period. Detailed operational rules: [the ERASE-001 record](docs/contract/operational-details.md#erase-001).

**Acceptance.**
1. a journey erases a counterparty contact who appears on comments and a notice; their name and email are replaced in those records, the executed agreement and audit entries remain with the erasure recorded; a legal hold refuses deletion of a draft until released.

**Evidence.** `tests/api/counterparties.test.mjs` — “ERASE-001 verified contact erasure preserves execution and audit, counsel holds fence every deletion door, owner approves expired draft retention”
**Gap.** None.

#### ENTITY-001 — Our contracting entities

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006 · Rules D-1

**Requirement.** The owner records each of the business's own legal entities: legal name, entity type, state or country of formation, EIN or foreign tax ID, registered and notice addresses, default currency and time zone, and authorized signatories. Every agreement names the entity that contracts. Templates, clause wordings, playbooks and signer rules (`SIGN-005`) can be limited to an entity. The entity's legal name, notice address and signatory fill templates and outgoing notices (`RENEW-006`). Search, saved views and reports filter and group by entity, and extraction proposes our entity from the document (`INTAKE-007`, `REPO-004`). Detailed operational rules: [the ENTITY-001 record](docs/contract/operational-details.md#entity-001).

**Acceptance.**
1. a journey adds a Delaware parent company and a UK subsidiary. An agreement for the UK entity offers only that entity's template and routes to its signatory. Its termination notice carries the UK entity's notice address, and the register filters agreements by entity.

**Evidence.** `tests/api/entities.test.mjs` — “ENTITY-001 our entities scope templates, wordings, rules and signatories, fill notices and filter the register”; `tests/browser/entities.spec.ts` — “ENTITY-001 records a UK subsidiary, offers only its template at intake and names it on the agreement at 1440px and 390px”
**Gap.** A journey must carry entity scoping through model extraction and all connected signer/notice doors; cited journeys prove native entities, library restrictions, notices and register filters.

#### OPS-001 — Self-hosted install, updates and security answers

Core · target · **partial** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-BACKUP-001, BASE-DATA-005, BASE-INSTALL-001, BASE-OPS-002, BASE-ROLE-001, BASE-SECRET-001 · Rules D-1 · Register R-7

**Requirement.** Locket releases carry release notes and migration lists at least monthly, with security fixes within seven days of an available fix. Notes identify changed AI behavior and backwards-incompatible integration changes. The security answers separate Locket’s controls from the buyer’s and Cloudflare’s responsibilities; [operational details](docs/contract/operational-details.md#ops-001) retain the questionnaire scope.

**Acceptance.**
1. Read a release’s notes, migration list and security answers; the current SIG Lite edition and exact questions are identified, and claimed controls match the installation.

**Evidence.** `tests/api/operations.test.mjs`; `tests/portable.mjs`; `scripts/security-questionnaire.mjs`; `scripts/release-history.mjs`; `scripts/installer/update.mjs`; `OPERATIONS.md`; `tests/operations-live.mjs`
**Gap.** Fresh Cloudflare deployment and the exact previous-release update, migration, record preservation, private R2 backup and removal journey remain unproved. Live proof is blocked on a verified outbound mail sender and credential or an approved Auth SSO installation: none of the 66 RunEditRun account zones had an enabled Cloudflare Email Sending sender on 26 October 2026. The authoritative current 2026 SIG Lite workbook, revision and exact question identifiers and text require licensed access; the public historical 2019 mapping does not complete it. No certification is claimed.

### Reporting

#### REPORT-001 — Cycle time, throughput and bottlenecks

Core · target · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-DATA-001, BASE-INPUT-003, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-ROLE-001 · Rules D-1

**Requirement.** Dashboards show requests opened and completed by type and team, median and 90th-percentile time in each stage (intake, drafting, negotiation, approval, signature), the longest-waiting approvals and counterparties, and service-level performance (`INTAKE-006`), plus requests canceled by reason and the stage they reached, filterable by period. Detailed operational rules: [the REPORT-001 record](docs/contract/operational-details.md#report-001).

**Acceptance.**
1. a journey drives 20 fixture agreements through stages with a controlled clock and sees the stage medians, the slowest approver and the service-level breach count match the fixture's known values. Observed-workflow slice: the portfolio shows request throughput grouped by current agreement type and our entity, completed workflow-stage visits with elapsed-hour median and nearest-rank P90, and longest current approval and signature waits with links to their records. Recording starts with this capability: each observed status change is retained inside the same guarded business transaction and command retries add nothing. Existing stages without a recorded start remain unknown; no history is inferred from last-updated timestamps. Imported agreements are excluded. Repeat stage visits count separately; an open visit does not enter duration statistics. A request completes on its first observed execution. Period bounds are inclusive UTC calendar days: opened counts by creation, completed by execution, visits by exit, and current waits by approval-request or dispatch time; waiting duration continues to the current evaluation time.
2. The same journey follows the detailed operational rules linked in the Requirement, including their authority, version, source, refusal and recorded-outcome conditions.

**Evidence.** `tests/api/analytics.test.mjs` — “REPORT-001 measures twenty public request journeys, period throughput, repeat-stage timing and scoped waiting work”; `tests/browser/analytics.spec.ts` — “REPORT-001 measured workflow, entity and period filters and waiting-work links at 1440px and 390px”
**Gap.** None.

#### REPORT-002 — Custom and scheduled reports

Core · target · **partial** · Cites BASE-ACCESSIBILITY-001, BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-AUDIT-001, BASE-DATA-001, BASE-INPUT-003, BASE-MAIL-001, BASE-OPS-004, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-ROLE-001 · Rules D-1

**Requirement.** A person builds a report from a saved view (`REPO-007`) with grouping and totals (value in USD by counterparty, renewals by month) and schedules it weekly or monthly by email as CSV or PDF to chosen active people, who receive only the rows they may see. Each human role manages its own reports; an agent’s schedule changes carry standard, adding external for outside recipients, and the company’s policy decides them. The report freezes the saved-view definition when created; every preview, download and scheduled attachment executes that definition again with the current reader or recipient's agreement access. Grouping a date uses its calendar month and a USD amount uses formatted dollars; missing grouping values are explicitly unrecorded, and absent USD values are counted separately from the total. Reports also filter and group by our contracting entity (`ENTITY-001`) through the same saved-view executor. CSV contains grouped totals followed by the matching detailed rows, with `REPO-007`'s spreadsheet-safe quoting; PDF contains those same figures. Detailed operational rules: [the REPORT-002 record](docs/contract/operational-details.md#report-002). Agent calls carry standard or external as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard or external, rEPORT-002 API and browser journeys build "Renewals by month" from a saved view, show matching grouped USD totals at 1440/390, download CSV and PDF, schedule it, advance the clock and receive an email through the installation mail-provider fake (Resend today) with a CSV whose totals match the screen. A recipient with narrower current access receives fewer rows, without restricted names or values. Under the held company policy for standard, external and commitment, named The public-door journey cover weekly and monthly schedules, daylight-saving and month-end recurrence, one-use occurrence claims, creator-only/stale stopping, agent write refusal, retained outcomes and archives. Scheduled access and restricted reads are audited under the authorized report's current recipient; each CSV/PDF download records a `report.export` event under `AUDIT-001`; public doors retain Base-session authentication.

**Evidence.** `tests/api/reports.test.mjs` — “REPORT-002 ENTITY-001 groups a saved view, emails weekly/monthly scoped CSV/PDF, claims once, preserves privacy and stops schedules”; `tests/browser/reports.spec.ts` — “REPORT-002 builds scoped renewal totals and schedules CSV and PDF at 1440px and 390px”
**Gap.** A company-policy journey must create/stop a scheduled report under both policies; cited journeys prove native person-owned schedules and recipient-scoped output.

#### REPORT-003 — Portfolio dashboard

Core · target · **done** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-INPUT-003, BASE-ROLE-001 · Rules D-1

**Requirement.** A home dashboard shows total contracted value in USD by type and by lifecycle status (`RENEW-012`), renewals and notice deadlines in the next 30, 60 and 90 days with their value (from each agreement's current term, with a days-to-deadline countdown), overdue obligations, agreements with accepted playbook exceptions, and agreements missing confirmed key terms. this applies to every recorded term and workflow: confirmed fixed/auto-renewing terms project the current term without rewriting the original end date; proposed terms never drive a tile. Contracted value includes executed/imported agreements, including expired ones, grouped by type and lifecycle; absent values are counted separately. Windows include through the named calendar day in the agreement's zone, excluding passed instants. Overdue means a confirmed, unfinished obligation with a due date before in that zone; the tile shows obligation count and distinct agreements, counting each agreement's value once. Accepted exceptions are current-version, non-invalidated approved exception decisions. Missing key terms means effective date, end date, auto-renewal, notice days, governing law or payment terms are unconfirmed, or an auto-renewal lacks its confirmed renewal months. A termination decision stops projection; a sent notice is recorded evidence, and a missed termination notice is flagged. `RENEW-007` must extend the dashboard to its optional/evergreen types, renewal limits, early termination and durable/superseded history before shipping; this clause is done for today's recorded capabilities.

**Acceptance.**
1. `REPORT-003` in the cited journey and the cited journey asserts each tile's count and USD value against the same fixture records and opens every filtered register at 1440/390.
2. The 2022 auto-renewing agreement is term 5 (1 March 2026–28 February 2027), with 30 December 2026 at 23:59:59 Eastern 74 calendar days away: the 90-day notice tile counts it and excludes the expired fixed-term agreement.
3. Tests also assert type/lifecycle groups, 30/60/90-day term/notice windows, overdue obligations, accepted exceptions, missing terms/values, unchanged original end date, ignored proposed corrections, recomputation on confirmation, restricted scope, attributed restricted reads and signed-out refusal.
4. `RENEW-007` asserts its inherited expanded dashboard parity when those terms ship.

**Evidence.** `tests/api/portfolio.test.mjs` — “REPORT-003 portfolio tiles match visible records and current-term deadlines, never proposed terms or hidden records”; `tests/browser/portfolio.spec.ts` — “REPORT-003 every portfolio tile opens its matching register at 1440px/390px”
**Gap.** None.

### Mobile

#### MOBILE-001 — Phone-width web app

Core · target · **done** · Cites BASE-ACCESSIBILITY-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-INPUT-003, BASE-MAIL-001, BASE-OPS-004, BASE-ROLE-001 · Rules D-1 · Register R-1, R-2

**Requirement.** Every screen works at 390 pixels wide: a person can submit a request, read a review summary, approve or decline from a notification link, search, see deadlines and upload a signed copy from the phone's files picker, without horizontal scrolling. Camera capture is carried by MOBILE-002 below, including its acceptance naming MOBILE-001. The current approval notification is an explicit Email approval link action by owner, counsel, approver or requester on an in-review version. Its named recipient must be an active owner/approver able to read the agreement and make its commercial decision. The email contains only a generic request and a signed-in review link, never title, figures or digest; the recipient reviews the current version and uses the same authenticated approval command. A guarded outbox records requester, recipient, time and provider receipt with an audit entry; retries never send the same request twice. The command result is an immutable queued-request acknowledgment under SEC-002; a separate mailReceipt snapshot reports the current provider outcome without rewriting that first result. Provider acceptance is not mailbox delivery, local/demo suppression means no email was sent, and interrupted/failed outcomes never claim acceptance or retry automatically. `APPROVE-003` and `NOTIFY-001` retain broader channels, automatic requests and preferences; they must preserve the same phone layout, authority, version checks, generic-link privacy and honest delivery labels before shipping. Signed-copy upload uses the phone's files picker; camera capture from MOBILE-001 is carried by `MOBILE-002` and must meet the same phone-width checks before shipping.

**Acceptance.**
1. `MOBILE-001` in the cited journey runs request to renewal notice and search/deadlines at 390 pixels; the cited journey uses the actual product component and real Worker API at 1440/390, sends the explicit approval request through a mail-provider fake, follows its captured link as the named approver, refuses a replaced version, approves the current digest and uploads/downloads byte-identical signed PDF evidence from the files picker without horizontal scrolling.
2. the cited journey asserts generic email contents, current authority/access/recipient/version/self-approval refusals, attributed audit, concurrent and serial retry deduplication, and honest local suppression.
3. The browser provider fake captures Resend acceptance; no live delivery or full APPROVE-003 is claimed.
4. Future APPROVE-003/NOTIFY-001 channels must assert the inherited phone flow.

**Evidence.** `tests/api/approval-mail.test.mjs` — “APPROVE-003 / MOBILE-001 / SEC-002 emails a generic authenticated review link once, then records the exact version through the normal approval command”; `tests/browser/journey.spec.ts` — “MOBILE-001 owner runs an agreement from request to renewal notice at 1440px/390px”
**Gap.** None.

#### MOBILE-002 — iOS and Android apps

Core · target · **missing** · Cites BASE-ACCESSIBILITY-001, BASE-INPUT-003, BASE-MAIL-001, BASE-OPS-004, BASE-ROLE-001 · Rules D-1 · Register R-3

**Requirement.** This clause carries MOBILE-001's camera-upload requirement: capture a signed paper copy with the camera as a PDF and attach it to the execution record, keeping the same phone layout, current authority/version checks and byte-preserving file evidence. Native iOS and Android apps (App Store and Google Play) sign in with the installation, receive push notifications for approvals, mentions and deadlines, approve the exact version, search the repository and view documents, and capture a signed paper copy with the camera as a PDF.

**Acceptance.**
1. naming MOBILE-001 and MOBILE-002, device-farm journeys on a current iPhone and Pixel receive an approval push, approve the version with its digest recorded, search for an agreement and scan a two-page signed copy into its execution record.

**Evidence.** None.
**Gap.** No native apps exist

### Move-in from incumbents

#### MOVE-002 — Ironclad move-in

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-DATA-001, BASE-INPUT-003 · Rules D-1

**Requirement.** The kit reads Ironclad's three documented outputs, alone or together: Detailed operational rules: [the MOVE-002 record](docs/contract/operational-details.md#move-002).

**Acceptance.**
1. a journey uses a fixture built from Ironclad's documented export columns, Records API JSON and an attachments ZIP. It holds 50 records, including two parent MSAs with three child order forms and one amendment. The dry run shows the type and property mappings and lists three unmapped properties. After applying, the families are linked with their relations, documents download with matching digests, and each agreement is found by its Ironclad record ID. Proposed terms are confirmed on two, and an unused batch is undone. The same fixture imported through the API path (a Records API fake whose attachment job reports pending, then ready) gives the same result. An authorized real export and a live run against an Ironclad sandbox's API are recorded before the clause is accepted.

**Evidence.** None.
**Gap.** Only the DocuSign kit exists

#### MOVE-003 — Icertis Contract Intelligence (ICI)

Core · target · **missing** · Cites BASE-DATA-001, BASE-INPUT-003, BASE-SECRET-001 · Rules D-1

**Requirement.** Each kit follows `MOVE-002`'s pattern: named sources, a reviewed dry run with an editable mapping, apply, undo and journal as `MOVE-001`. The complete source shapes, field mappings, reviewed apply/undo and byte-preserving evidence rules are in [the migration specification](docs/contract/operational-details.md).

**Acceptance.**
1. Two sources, alone or together: - **Agreement metadata export:** the Excel export of an agreement search in ICI's Agreement Management, run by an ICI administrator over the contract types being moved, with all attributes as columns. It includes the agreement code and system ID, contract type, name, status, first and second parties, effective and expiry dates, value and currency, and the tenant's custom attributes. - **ICI REST APIs:** the agreement entity (by contract type, with its attributes and status), its associated documents (the Document List: the agreement document, executed copy and supporting files) and amendment and parent links, called with a service account's credentials. Icertis publishes its API reference to customers only, so before the fixture is built the kit records the endpoints and JSON shape from the buyer's tenant documentation in the fixture's README, with the ICI release they came from. Contract types map to Locket agreement types and attributes to fields or custom fields (`REPO-005`). Amendments and child agreements become families (`REPO-008`). Every document keeps its bytes and digest, and each agreement keeps its ICI agreement code and system ID, searchable.

**Evidence.** None.
**Gap.** No Icertis or Agiloft kit exists

#### MOVE-008 — Agiloft

Core · target · **missing** · From MOVE-003 · Cites BASE-DATA-001, BASE-INPUT-003 · Rules D-1

**Requirement.** Two sources, alone or together: - **Contracts table export:** the table's Export action, run by an Agiloft admin over a saved search of the Contracts table, as Excel or CSV with every field, including the record ID, contract type, status, company, dates, amount, auto-renewal fields and custom fields. The complete source shapes, field mappings, reviewed apply/undo and byte-preserving evidence rules are in [the migration specification](docs/contract/operational-details.md).

**Acceptance.**
1. Two sources, alone or together: - **Contracts table export:** the table's Export action, run by an Agiloft admin over a saved search of the Contracts table, as Excel or CSV with every field, including the record ID, contract type, status, company, dates, amount, auto-renewal fields and custom fields. - **Agiloft REST API:** the knowledge base's REST interface with a user holding a Web Services license. `EWSelect` or `EWSearch` lists contract record IDs (by a saved search or a WHERE clause), `EWRead` reads each record's fields, `EWAttachInfo` lists each attachment field's files (position, name and size), and `EWRetrieve` downloads each file by table, record ID, field and position. Agiloft's linked Contracts (parent contract and amendments) become families, its attachment fields map to versions and supporting files, and each agreement keeps its Agiloft record ID, searchable. For both, the dry run lists every unmapped attribute or field for a person to create as a custom field or skip, plus files without a record and records without a file. Signed agreements import as executed with imported execution records. Dates, values and renewal fields come in as proposed terms (`TERMS-001`, `RENEW-007`).

**Evidence.** None.
**Gap.** No Icertis or Agiloft kit exists

#### MOVE-004 — SpotDraft

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-SECRET-001 · Rules D-1

**Requirement.** Each kit follows `MOVE-002`'s pattern: named sources, a reviewed dry run with an editable mapping, apply, undo and journal as `MOVE-001`. The complete source shapes, field mappings, reviewed apply/undo and byte-preserving evidence rules are in [the migration specification](docs/contract/operational-details.md).

**Acceptance.**
1. Two sources, used together: - **Repository report:** a report generated from a saved repository View with "All columns", as Excel (XLSX) or CSV. SpotDraft adds a Contract Link column to every report and splits signatories into Your Signatory and Counterparty Signatory, and these map to the counterparty, our signer and `REPO-010` signatories. Every other metadata column (contract type, status, counterparty, dates, value and the workspace's own key fields) maps to a field or custom field. - **SpotDraft public API (v2.1):** called with the workspace's client ID and secret against its regional base URL. For each row, the kit takes the contract's ID from the Contract Link, reads its extracted metadata from the provider’s documented read or action, and fetches the executed file through the provider’s documented read or action. The report alone gives metadata without files. Those agreements are listed as records without a file until the API run or a person's upload supplies them.

**Evidence.** None.
**Gap.** No SpotDraft or Juro kit exists

#### MOVE-009 — Juro

Core · target · **missing** · From MOVE-004 · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-DATA-001, BASE-INPUT-003, BASE-ROLE-001 · Rules D-1

**Requirement.** Juro has no self-serve bulk document export: an admin can download repository contracts as PDFs only after Juro Support enables it for a limited time. The complete source shapes, field mappings, reviewed apply/undo and byte-preserving evidence rules are in [the migration specification](docs/contract/operational-details.md).

**Acceptance.**
1. Juro has no self-serve bulk document export: an admin can download repository contracts as PDFs only after Juro Support enables it for a limited time. The kit obtains files in one of two ways: - **Juro API (v3):** the preferred route, called with the workspace's API key at `https://api.juro.com/v3`. It lists the workspace's contracts, reads each contract's fields (smartfields, parties, status and signing details), and downloads each signed PDF from the provider’s documented read or action. Juro's signing certificate, which Juro appends to the signed PDF, stays inside that file byte-for-byte. - **Support-enabled PDF download:** when the buyer's plan has no API access, the buyer asks Juro Support to enable the export, then downloads the PDFs during that window. The kit takes the folder of PDFs with the repository's table view exported as CSV, and matches each file to its row by contract name and ID. Any PDF it cannot match is listed for a person to match or skip. Juro templates map to agreement types and smartfields to fields or custom fields. Each agreement keeps its Juro contract ID, searchable. For both, the dry run lists unmapped columns or fields, files without a record and records without a file. Signed agreements import as executed with imported execution records. Dates, values and renewal fields come in as proposed terms (`TERMS-001`, `RENEW-007`).

**Evidence.** None.
**Gap.** No SpotDraft or Juro kit exists

#### MOVE-005 — PandaDoc public API

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-INPUT-003, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-SECRET-001 · Rules D-1

**Requirement.** Completed PandaDoc documents and Adobe Acrobat Sign agreements, with their audit trails, import like `MOVE-001`: originals and certificates byte-for-byte, imported execution records and proposed terms. The complete source shapes, field mappings, reviewed apply/undo and byte-preserving evidence rules are in [the migration specification](docs/contract/operational-details.md).

**Acceptance.**
1. called with a production API key, because PandaDoc refuses the protected download with a sandbox key. the provider’s documented read or action lists completed documents (status completed, filtered by `completed_from` and `completed_to`, template and folder). the provider’s documented read or action reads recipients, fields, tokens and pricing tables, and the pricing rows become line items. the provider’s documented read or action fetches the signed, verifiable PDF. The certificate of completion is kept when the account's download includes it; otherwise the document is listed under missing evidence, as `MOVE-001` does for a missing `Summary.pdf`.

**Evidence.** None.
**Gap.** Only the DocuSign kit exists

#### MOVE-010 — Adobe Acrobat Sign

Core · target · **missing** · From MOVE-005 · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-DATA-001, BASE-INPUT-003 · Rules D-1

**Requirement.** two sources, alone or together: - **Reporting data export:** the CSV data export from the account's Reports section, run by an account or group admin. The complete source shapes, field mappings, reviewed apply/undo and byte-preserving evidence rules are in [the migration specification](docs/contract/operational-details.md).

**Acceptance.**
1. two sources, alone or together: - **Reporting data export:** the CSV data export from the account's Reports section, run by an account or group admin. It holds agreement ID, name, status, sender, participants and their dates. - **REST API v6:** with an OAuth integration key. The kit lists agreements (the provider’s documented read or action or the provider’s documented read or action), reads each agreement's status and participants (the provider’s documented read or action), downloads the signed PDF (the provider’s documented read or action), the audit report (the provider’s documented read or action, the Final Audit Report a person can also download per agreement) and the field values (the provider’s documented read or action, which map to fields). When only the CSV export and per-agreement downloads exist, the kit takes the CSV with a folder holding each agreement's PDF and Final Audit Report, named by agreement ID. For both, the dry run lists each row's outcome (import, not completed, missing audit trail, duplicate), unmapped fields, files without a record and records without a file. Agreements that are not completed (out for signature, canceled, expired) are refused.

**Evidence.** None.
**Gap.** Only the DocuSign kit exists

#### MOVE-006 — Ironclad workflows in progress at cutover

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-INPUT-003 · Rules D-1

**Requirement.** On the day the Ironclad license ends, a buyer still has active workflows mid-negotiation. The kit reads them from Ironclad's Workflows API: each workflow's ID, template or third-party paper, launch-form answers, current step, assignees, documents and counterparty. A dry run lists each one as an open Locket agreement at its matching stage. Workflows in create or review steps become drafts, and those in approval or signature steps become agreements in review. The latest document comes in as the current version and the counterparty's files as counterparty versions, byte-for-byte with their digests. Launch-form answers become request fields, and the Ironclad workflow ID is kept and searchable. Approvals and signatures given in Ironclad never carry over: each imported workflow is approved again under `APPROVE-001`. A workflow already out for signature in Ironclad is listed, so the owner can finish it there and import the signed copy under `MOVE-002`, or prepare a new signature package in Locket. Apply and undo follow `MOVE-001`.

**Acceptance.**
1. a journey with a Workflows API fake holds 5 active workflows: two in review, two in negotiation with counterparty markups, and one approved and out for signature.
2. After the dry run and apply, five open agreements appear in the request queue (`INTAKE-006`) at their mapped stages.
3. Their latest documents and counterparty files match the fake's digests, and each shows its Ironclad workflow ID.
4. None carries an approval, and one is then approved under `APPROVE-001`.
5. The workflow out for signature is listed for the owner's decision.
6. A live run against an Ironclad sandbox's Workflows API is recorded before the clause is accepted.

**Evidence.** None.
**Gap.** No Ironclad workflow import exists

#### MOVE-007 — Ironclad Clickwrap acceptance history

Core · target · **missing** · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AUDIT-001, BASE-DATA-001, BASE-INPUT-003, BASE-MAIL-001, BASE-OPS-004, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-ROLE-001, BASE-SECRET-001 · Rules D-1

**Requirement.** A buyer moving clickwrap to `SIGN-004` keeps proof of who accepted what. The kit reads the acceptance activity from Ironclad Clickwrap through either of two sources: the activity CSV export a Clickwrap admin downloads from the dashboard, or the Clickwrap REST API (the former PactSafe API) for signers, activity and contract versions, called with an API access token. The endpoints and columns are recorded in the fixture's README from Ironclad's Clickwrap developer documentation before the fixture is built. It reads the signer's identifier and email, the contract and version accepted, acceptance time, IP address, and each version's document. It imports them as acceptance records labeled imported, linked to each terms version kept byte-for-byte. From then on, Locket's own versions and re-acceptance rules apply. Apply and undo follow `MOVE-001`.

**Acceptance.**
1. a journey with an Ironclad Clickwrap fixture built from the recorded activity export columns and API JSON, holding 200 acceptances over two terms versions, imports them through both the CSV and an API fake as labeled imported acceptances with their versions and digests.
2. A user who accepted only version 1 is prompted to accept Locket's next published version under `SIGN-004`.
3. The export lists imported and native acceptances distinctly, and an unused batch undoes cleanly.
4. An authorized real export and a live run against an Ironclad Clickwrap test site's API are recorded before the clause is accepted.

**Evidence.** None.
**Gap.** No clickwrap import exists

### Push further

#### AGENT-001 — Invoices reconciled against signed terms

Core · push-further · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-DATA-003, BASE-DATA-006, BASE-MAIL-001, BASE-OPS-004, BASE-ROLE-001 · Rules D-1

**Requirement.** joins each executed agreement's confirmed pricing, rate cards, price-increase caps, discounts, payment terms and amendments with the bills, invoices, credits and purchase orders linked through `LINK-001` and `LINK-002`, and flags overcharges, increases above the cap, missed volume discounts, early-payment terms not taken and unclaimed credits, each with the clause and transaction cited and the USD amount at stake. For an approved finding it drafts the dispute or credit request to the supplier. Detailed operational rules: [the AGENT-001 record](docs/contract/operational-details.md#agent-001). Agent calls carry standard, money, commitment and external as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard, money, commitment and external, a journey with QuickBooks and Purse fakes holds a supplier agreement capped at 3% annual increase and invoices showing 7%; the agent flags the overcharge with the clause, invoice and $4,000 at stake, finance approves, the drafted credit request is sent through the installation mail door fake only after approval, and a rejected finding on another invoice is not raised again.
2. The same journey follows the detailed operational rules linked in the Requirement, including their authority, version, source, refusal and recorded-outcome conditions.

**Evidence.** `tests/api/notices.test.mjs`; `tests/browser/reconciliation.spec.ts`
**Gap.** BLOCKED on Purse’s new read-only PO-data token door (ct 22 October 21:55Z; not yet shipped); no invented procurement evidence. Rate-card, discount, payment-term, existing-credit and other-provider comparison remain. Designated authority and exact supplier-message consent approved by ct on 22 October 21:45Z

#### AGENT-002 — Service levels and supplier performance

Core · push-further · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-MAIL-001, BASE-OPS-004 · Rules D-1

**Requirement.** reads service-level commitments (uptime, response and resolution times, delivery dates) from confirmed terms and compares them with performance evidence: monitoring results from Uptime, tickets from Linen or HappyToHelp, delivery records, or the supplier's own reports. It computes service credits owed under the agreement's formula, records misses as obligation breaches by the supplier, and drafts the credit claim before the claim window closes. Detailed operational rules: [the AGENT-002 record](docs/contract/operational-details.md#agent-002). Agent calls carry standard, money, commitment and external as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard, money, commitment and external, a journey with an Uptime fake shows 99.2% monthly availability against a 99.9% commitment with a 10% credit tier; the agent computes the credit in USD, cites the clause and the monitoring evidence, shows the claim deadline, and sends the claim only after the owner approves.

**Evidence.** `tests/api/notices.test.mjs` — “AGENT-002 confirms signed SLA, preserves exact Uptime evidence, records supplier breach and sends one owner-approved USD 1000 claim”; `tests/browser/service-levels.spec.ts` — “AGENT-002 authorizes monitoring, confirms signed terms and approves one exact USD 1000 claim for 99.2% versus 99.9% at 1440px and 390px”
**Gap.** A company-policy journey must run the specialist job under all autonomous and held policies; cited native journeys prove the former fixed-person approval path and its refusal cases.

#### AGENT-003 — Renewal decision to verified notice delivery

Core · push-further · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-DATA-001, BASE-DATA-003, BASE-DATA-006, BASE-INPUT-003, BASE-MAIL-001, BASE-OPS-004, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-ROLE-001 · Rules D-1

**Requirement.** a person selects an exact passage from the executed text rendition, with the confirmed deadline and recorded renewal decision (`RENEW-001`), and the counterparty's recorded email and courier notice address (`REPO-010`). The agent prepares a frozen PDF notice from those facts, labelled "prepared draft, not legal advice or proof of service". It does not infer legal wording or decide adequacy. `REPO-002` inherits selection from future OCR renditions. Sending uses `RENEW-006`'s installation mail door (Resend with signed Svix callbacks today); Postmark and any other provider are configurations of that same door, not separate integrations, and `INT-004` inherits its obligations. Detailed operational rules: [the AGENT-003 record](docs/contract/operational-details.md#agent-003). Agent calls carry standard, commitment and external as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard, commitment and external, clause-named the cited journey and the cited journey decide to terminate 45 days before the confirmed deadline, select the executed notice passage, prepare the labelled draft, review the PDF/digest and margin, approve the exact schedule, and send its identical bytes through the installation-provider fake. The signed bounce creates the decision-maker alert and a courier proposal; no courier sending is possible until a new approval. Its tracking and manually recorded delivered evidence precede 23:59:59 local time. Under the held company policy for standard, external and commitment, the public-door journey cover one-use concurrent schedules, no early sending, invalid passages, PDF mismatch, deadline bounds, agent refusal, missing acknowledgment alerts, uncertain-send nonretry, stale decision/authority cancellation, restricted evidence and complete archive retention. Browser journeys show each state at 1440/390, and real `rer dev` exercises selected-source preparation and frozen schedule approval at both widths.

**Evidence.** `tests/api/notices.test.mjs` — “AGENT-003 selected passage and 45-day termination decision to scheduled frozen PDF, bounce, separately approved courier and predeadline delivery evidence”; `tests/browser/notice-agent.spec.ts` — “AGENT-003 cited draft, exact schedule, bounce alert and newly approved courier delivery at 1440px and 390px”
**Gap.** A company-policy journey must run the specialist job under all autonomous and held policies; cited native journeys prove the former fixed-person approval path and its refusal cases.

#### AGENT-004 — Authorized renegotiation to an executed amendment

Core · push-further · **missing** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-MAIL-001, BASE-OPS-004 · Rules D-1

**Requirement.** under a written mandate from the decision-maker (target price, acceptable term, walk-away and which playbook positions may be offered), it drafts the counterparty email and the amendment from the template and playbook, sends each round as an external call decided by the company’s policy, reads the counterparty's replies and markups (`NEG-006`, `NEG-002`), proposes the next response within the mandate, and stops at execution: the amendment is approved under `APPROVE-001`, signed under `SIGN-002`, and the family's governing terms updated under `AGENT-005`. Detailed operational rules: [the AGENT-004 record](docs/contract/operational-details.md#agent-004). Agent calls carry standard, commitment and external as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard, commitment and external, a journey mandates a 5% reduction with a 2-year term; the agent's first proposal is approved and sent, the counterparty fake counters at 3%, the agent proposes 4% within the mandate, a counter outside the mandate is escalated rather than answered, and the executed amendment updates the governing price on the family page.

**Evidence.** None.
**Gap.** No negotiation agent exists

#### AGENT-005 — Governing terms across a contract family

Core · push-further · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-INPUT-003, BASE-MAIL-001, BASE-OPS-004, BASE-ROLE-001 · Rules D-1

**Requirement.** compares the parent agreement, order forms, statements of work and amendments; finds conflicting dates, prices, notice rights and precedence clauses; and proposes the currently governing value of each key term with the exact passages, propagating confirmed results to deadlines and obligations. Detailed operational rules: [the AGENT-005 record](docs/contract/operational-details.md#agent-005). Agent calls carry standard or commitment as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard or commitment, a journey adds an amendment that changes the notice period from 60 to 90 days while an order form says 30; the agent flags the conflict with three citations, both candidate deadlines show, and counsel's choice updates the renewal deadline and clears the block. Under the held company policy for standard, external and commitment, implemented boundary: owner or counsel prepares an exact snapshot of the family's readable executed texts and confirmed terms; under the held company policy for external and sensitive, the named owner consents to sending that snapshot to the configured model. The model is off until the owner configures and enables it and attests that the provider contract prohibits training on these texts. Without the deployment attestation no request leaves Locket. Every returned candidate passage is located verbatim in its source text and page; invalid or unavailable analysis is never replaced with an invented result. Under the held company policy for standard, external and commitment, the model compares recorded values and unrecorded date, price, notice-right and precedence passages and proposes a choice with reasons.
2. The same journey follows the detailed operational rules linked in the Requirement, including their authority, version, source, refusal and recorded-outcome conditions.

**Evidence.** `tests/api/families.test.mjs`; `tests/browser/family-conflicts.spec.ts`
**Gap.** BLOCKED on owner-supplied 100 counsel-labelled held-out agreements and a passing REVIEW-006 live record for the exact provider, model and prompt; evaluated proposals and governing propagation remain unproved

#### AGENT-006 — Signed document matches the approved version

Core · push-further · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-DATA-001, BASE-DATA-003, BASE-DATA-006, BASE-INPUT-003, BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-ROLE-001 · Rules D-1

**Requirement.** compares the approved version, the provider envelope, the signed document and the extracted terms; identifies edits made after approval, missing pages, missing signatures or initials and signers who differ from the routing; and refreshes obligations only from a confirmed execution. Detailed operational rules: [the AGENT-006 record](docs/contract/operational-details.md#agent-006). Agent calls carry standard or commitment as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard or commitment, a journey returns a signed PDF whose liability cap was changed after approval; the agent flags the passage, the agreement stays unsigned under `EXEC-001`, and counsel's acceptance with a reason is recorded; a clean return executes without intervention.
2. The same journey follows the detailed operational rules linked in the Requirement, including their authority, version, source, refusal and recorded-outcome conditions.

**Evidence.** `src/locket/execution.ts`; `src/locket/execution-comparison.ts`; `src/locket/execution-fields.ts`; `src/locket/obligations.ts`; `tests/api/execution-comparison.test.mjs`; `tests/browser/execution-comparison.spec.ts`
**Gap.** Text/page comparison, signed-text citations and required structured signature/initial-field presence ship; optional/unlabelled or visual/flattened signature and initial detection and OCR remain open

#### AGENT-007 — Exceptions become measured playbook changes

Core · push-further · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-1

**Requirement.** Under the held company policy for commitment and external, compares approved exceptions, counterparty negotiation outcomes and later operational issues (disputes, missed obligations, credits from `AGENT-001` and `AGENT-002`), and recommends a revised clause position with examples, the expected effect on cycle time (`REPORT-001`) and the agreements that would have been affected. Detailed operational rules: [the AGENT-007 record](docs/contract/operational-details.md#agent-007). Agent calls carry standard or commitment as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard or commitment, a journey with 30 fixture negotiations where a liability fallback was accepted 22 times; the agent recommends making it a standard alternative with the 22 citations and a labelled cycle-time saving scenario, never a causal prediction, counsel approves a new playbook version, and earlier findings still cite the old version.

**Evidence.** `tests/api/flows.test.mjs` — “AGENT-007 measures thirty recorded negotiations, preserves twenty-two exact accepted citations and lets counsel scope a new playbook without rewriting history”; `tests/browser/playbook-recommendations.spec.ts` — “AGENT-007 counsel reviews thirty negotiations and twenty-two citations, then scopes a new playbook at 1440px and 390px”
**Gap.** A company-policy journey must run the specialist job under all autonomous and held policies; cited native journeys prove the former fixed-person approval path and its refusal cases.

#### AGENT-008 — Obligation remediation to verified evidence

Core · push-further · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-INPUT-003 · Rules D-1

**Requirement.** for an overdue or at-risk obligation (an expired certificate of insurance, a missing SOC 2 report, an unreturned data-destruction certificate, our own late deliverable), it identifies the responsible party, drafts the request to the supplier contact or the internal owner, chases on schedule, checks returned evidence against the requirement (coverage amount, dates, named insured) and marks the obligation fulfilled only when the evidence matches. Detailed operational rules: [the AGENT-008 record](docs/contract/operational-details.md#agent-008). Agent calls carry standard, commitment and external as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. Under the held company policy for standard, commitment and external, a journey lets a supplier's certificate of insurance expire; the agent's approved request goes to the supplier contact, an uploaded certificate with $1M coverage against a $2M requirement is rejected with the reason, and a compliant certificate marks the obligation done with the evidence attached.

**Evidence.** `tests/api/obligation-evidence.test.mjs` — “AGENT-008 owner approves exact requests and finite chases, rejects insufficient insurance and completes only with matching original evidence”
**Gap.** A company-policy journey must run the specialist job under all autonomous and held policies; cited native journeys prove the former fixed-person approval path and its refusal cases.

#### AGENT-009 — Missed obligations and avoidable spend report

Core · push-further · **partial** · Cites BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-AUDIT-001, BASE-ROLE-001 · Rules D-1

**Requirement.** each month it reports, in USD where measurable, deadlines missed or met late, auto-renewals that renewed without a recorded decision (the roll-forwards `RENEW-010` records with no decision, excluding those derived for periods before the agreement was in Locket), overdue obligations on both sides, overcharges and credits found and recovered (`AGENT-001`, `AGENT-002`) and spend on agreements past their end date, each figure linking to its evidence, and compares with prior months. Detailed operational rules: [the AGENT-009 record](docs/contract/operational-details.md#agent-009). Agent calls carry standard or external as computed in the Agent surface; the company’s policy decides every call, including any review, approval or refusal.

**Acceptance.**
1. a journey on a fixture year of activity produces the monthly report whose counts and dollar totals equal queries over the same data, with every figure linked to its records, delivered to two recipients with different access.

**Evidence.** `tests/api/outcome-report.test.mjs` — “AGENT-009 fixture-year source counts and exact USD totals match the retained records and each recipient’s current access”; `tests/browser/outcome-report.spec.ts` — “AGENT-009 compares months, exposes source records and selects scoped report recipients at 1440px/390px”
**Gap.** A company-policy journey must run the specialist job under all autonomous and held policies; cited native journeys prove the former fixed-person approval path and its refusal cases.

## Agent surface

### Agent surface

#### SURFACE-001 — Registry and shared conformance

Agent surface · target · **missing** · From new · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-013 · Rules D-1

**Requirement.** The contract operations registry equals the tool and non-tool tables above.

**Acceptance.**
1. The Base conformance harness passes on Locket agreement, restricted-record, version, obligation and notice fixtures.
2. Every Core id above is served by its named tool or its stated non-tool reason.

**Evidence.** None.
**Gap.** No Locket MCP registry, class/policy adapter and named conformance journey prove this delta.

#### SURFACE-002 — Contract records as resources

Agent surface · target · **missing** · From new · Cites BASE-AGENT-003 · Rules D-1

**Requirement.** The resource templates above resolve Locket’s agreement and evidence graph.

**Acceptance.**
1. After creating a request and adding a version, its returned links open the same agreement/version/file graph and preserved digests.
2. A restricted agreement and a hidden EIN stay absent from a sponsor without the corresponding native access.

**Evidence.** None.
**Gap.** No Locket MCP registry, class/policy adapter and named conformance journey prove this delta.

#### SURFACE-003 — Sponsored contract work

Agent surface · target · **missing** · From new · Cites BASE-AGENT-004, BASE-AGENT-005 · Rules D-1

**Requirement.** Sponsorship maps to Locket’s owner, counsel, approver, requester and viewer rights and record/field grants.

**Acceptance.**
1. Under the held company policy for standard, external and commitment, the Locket role fixture performs a permitted action and a refused action through MCP with the same visible outcome as the native door.
2. Revoking a restricted-agreement grant between preparation and execution prevents its disclosure or change.

**Evidence.** None.
**Gap.** No Locket MCP registry, class/policy adapter and named conformance journey prove this delta.

#### SURFACE-004 — Internal and outside exposure classes

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006 · Rules D-1

**Requirement.** Locket computes standard and external from the resolved destination and recipients.

**Acceptance.**
1. An internal draft edit is standard with its affected-record count.
2. A notice to a recorded counterparty is external/known, a new recipient external/new and an open contract link external/public, with exact recipient counts.
3. A rendition or move into an outsider-visible destination adds external even when its action name says internal.

**Evidence.** None.
**Gap.** No Locket MCP registry, class/policy adapter and named conformance journey prove this delta.

#### SURFACE-005 — Money and commitment classes

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006 · Rules D-1

**Requirement.** Billing-impacting and binding contract calls use the facts described above.

**Acceptance.**
1. A read-only proposed credit is standard; applying a contracted credit or charge to the accounting/billing handoff adds money with amount, currency and payee.
2. Accepting an exception, governing term, execution mismatch, renewal, termination, waiver or amendment adds commitment with its exact version, value and counterparty.

**Evidence.** None.
**Gap.** No Locket MCP registry, class/policy adapter and named conformance journey prove this delta.

#### SURFACE-006 — Provider, authority and protection classes

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006 · Rules D-1

**Requirement.** Locket computes gated, access and security from the provider step and authority/protection change.

**Acceptance.**
1. A provider-hosted consent or person-only identity step adds gated with its provider and step; the available provider API alternative follows company policy.
2. Changing a person, group, department or grant adds access with the affected people and widening/narrowing direction.
3. Rotating a provider credential or changing verification settings adds security with the setting name and no credential value.

**Evidence.** None.
**Gap.** No Locket MCP registry, class/policy adapter and named conformance journey prove this delta.

#### SURFACE-007 — Erasure, sensitive fields and running services

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006 · Rules D-1

**Requirement.** Locket computes destructive, sensitive and live from the actual affected records, fields and services.

**Acceptance.**
1. Permanent erasure/deletion adds destructive with item count; a reversible bulk correction stays standard.
2. Reading a resolved EIN or bank/card field adds sensitive with record count and data kind; caller-supplied labels do not remove it.
3. Enabling, disabling or changing a running connector, notification dispatcher or model task adds live with the service identity.

**Evidence.** None.
**Gap.** No Locket MCP registry, class/policy adapter and named conformance journey prove this delta.

#### SURFACE-008 — Company policy on contract decisions

Agent surface · target · **missing** · From new · Cites BASE-AGENT-007 · Rules D-1

**Requirement.** Locket’s native agent proposals, MCP tools and integration-token agent calls use the same company decision for the same version and facts.

**Acceptance.**
1. For one cited finding, one outside notice and one binding renewal decision, the all-autonomous policy runs the call and the held policy takes its configured decision; the resulting agreement history matches that decision.
2. A changed version, amount, recipient or source invalidates a pending saved contract decision and requires the company-policy decision on the new facts.

**Evidence.** None.
**Gap.** No Locket MCP registry, class/policy adapter and named conformance journey prove this delta.

#### SURFACE-009 — Contract decision attribution

Agent surface · target · **missing** · From new · Cites BASE-AGENT-008, BASE-AGENT-009 · Rules D-1

**Requirement.** Agreement history distinguishes preparation, company-policy decisions and a person’s actual approval.

**Acceptance.**
1. For a prepared notice approved by the held policy’s signed-in approver, history identifies the agent preparer and actual approver on the exact notice revision.
2. A binding agent decision under all autonomous is shown as the agent acting for its sponsor in the agreement, export and outside message.

**Evidence.** None.
**Gap.** No Locket MCP registry, class/policy adapter and named conformance journey prove this delta.

#### SURFACE-010 — Contract events and source handoffs

Agent surface · target · **missing** · From new · Cites BASE-AGENT-010 · Rules D-1

**Requirement.** The listed contract events link changed records and keep imported history distinguishable from new execution.

**Acceptance.**
1. A version, confirmed obligation and notice outcome each produce the listed event and a link to the resulting record.
2. Replaying a Pantry bill or Inkwell completion event preserves source identity and produces no duplicate contract effect.

**Evidence.** None.
**Gap.** No Locket MCP registry, class/policy adapter and named conformance journey prove this delta.

#### SURFACE-011 — Contract work capacity and policy spend

Agent surface · target · **missing** · From new · Cites BASE-AGENT-011 · Rules D-1

**Requirement.** Locket reports model/OCR provider estimates and the affected agreements/files before a bulk or paid task.

**Acceptance.**
1. A bulk fixture reports its item and byte counts before processing and preserves per-record outcomes when the company policy holds its continuation.
2. A model/OCR estimate and actual spend belong to the selected provider and task; the company’s selected cap or no-cap answer governs the run.

**Evidence.** None.
**Gap.** No Locket MCP registry, class/policy adapter and named conformance journey prove this delta.

#### SURFACE-012 — Version and evidence conflicts

Agent surface · target · **missing** · From new · Cites BASE-AGENT-012 · Rules D-1

**Requirement.** Contract actions retain their source/version bindings through tool retries and interrupted work.

**Acceptance.**
1. Retrying one request, version or notice preparation returns the same recorded contract result.
2. A source document, governing term, recipient or agreement revision changed after preparation refuses the stale effect and leaves the newer state intact.

**Evidence.** None.
**Gap.** No Locket MCP registry, class/policy adapter and named conformance journey prove this delta.

#### SURFACE-013 — A stranger runs a contract week

Agent surface · target · **missing** · From new · Cites BASE-AGENT-013 · Rules D-1 · Register R-8

**Requirement.** Given only the installation URL, a stranger agent completes a seeded week as the contract operations clerk.

**Acceptance.**
1. The week takes two requests through template population, cited review, signing preparation and an official-schema signing fake, then reads execution evidence, one obligation and a renewal deadline.
2. It compares one supplier bill and service-level result to signed terms, sends the resulting notice/claim and reads its separately recorded outcome.
3. Under the company’s all-autonomous policy every class used completes without a person-policy wait or policy refusal.
4. Under the company’s held policy, standard is reviewed and each other used class is approved by the named signed-in test person before its saved effect; the same week’s business results reconcile.
5. Before policy setup, the first call returns the setup link and no effect; after the company answers all used classes the week can start.

**Evidence.** None.
**Gap.** No Locket MCP registry, class/policy adapter and named conformance journey prove this delta.

## Later

None.

## Field proof register

| ID | Proof | Clauses | State | Date | Receipt |
| --- | --- | --- | --- | --- | --- |
| R-1 | Human screen-reader review of Locket’s operator and public journeys | MOBILE-001 | not run | | |
| R-2 | VPAT prepared from a human accessibility review | MOBILE-001 | not run | | |
| R-3 | App Store approval and Google Play listing | MOBILE-002 | not run | | |
| R-4 | Microsoft AppSource listing and validation receipt | NEG-003 | not run | | |
| R-5 | Real Okta, Microsoft Entra ID and Google Workspace tenant receipts | INT-003 | not run | | |
| R-6 | Zapier and Crank partner app publication | INT-002 | not run | | |
| R-7 | Licensed current SIG Lite workbook, revision and exact question identifiers | OPS-001 | not run | | |
| R-8 | MCP client interoperability receipts from Claude, ChatGPT, Codex and Copilot | SURFACE-013 | not run | | |
