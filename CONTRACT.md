# Locket product contract

Locket is for the owner or operations lead of a 10–100 person Australian service business or small supplier, with sales staff who raise deals and occasional external counsel. Its job: every commercial agreement has a responsible person, an approved exact version, preserved signed evidence and reviewable obligations, so nobody misses the notice that decides a renewal.

This document sets the required behaviour of the first release. [ACCEPTANCE.md](ACCEPTANCE.md) records what is proven and how. Local proof is not hosted, provider, legal or real-owner acceptance.

## Operating rules

- A new installation starts empty: no sample agreements, parties, templates or playbook. The owner enters or imports real records.
- Roles: **owner** (everything), **counsel** (library, legal exceptions, restricted agreements, execution mismatches), **approver** (commercial approval, renewal decisions, notice approval), **requester** (requests, versions, attachments, signature handoff), **viewer** (reads), **agent** (reads and prepares proposals only). The installation's native owner is always owner; other operators are invited through Base sign-in and given a Locket role.
- Every write re-reads the current session and role on the server, in every handler, and repeats the session, role and record-version checks inside the same D1 batch that writes. A changed record, a revoked session or a removed role makes the write fail with nothing saved.
- Every command carries a command identity. Retrying the same identity and content returns the first outcome; reusing it for different content is refused.
- A restricted agreement and everything attached to it (versions, files, findings, approvals, terms, search hits) is visible only to the owner, counsel, its requester, its responsible person and people explicitly granted access. To anyone else it does not exist.
- Uploaded, signed, certificate and imported files keep their exact bytes and SHA-256. Locket never rewrites an original, never re-signs, and never creates a certificate in a provider's name. Imported history stays labelled imported.
- An approval pins the exact version identity (its files' bytes, its text and its populated fields) and the decision context (value, counterparty, review findings). Any change to either makes earlier approvals stop counting, visibly.
- Proposed values (from an agent, an importer or a person) drive nothing until a person with authority confirms them against the executed agreement.
- An approved notice is not a sent notice. Sending is recorded separately with method, time and optional evidence.
- Locket organises and prepares agreements. It does not give legal advice, validate signatory authority, or claim any agreement is legally valid or enforceable.

## First release: twelve flows

1. **Import a legacy agreement.** A person uploads a PDF or DOCX with where it came from and its source ID. Locket keeps the original bytes and SHA-256, the source system and ID, the original filename, who imported it and when, and reads DOCX text. The same bytes or the same source ID cannot be imported twice. *Proven by downloading the stored file and comparing bytes and digest, and by the refused duplicates.*
2. **Capture a request.** A requester records title, request type, counterparty (existing or new), value in AUD, responsible person, needed-by and start dates, and whether it is restricted. Each type carries its required attachments (decided defaults below), and more can be added. A request cannot go to review while a required attachment is missing unless owner or counsel waives it with a reason. Amendments and order forms must name their parent agreement. *Proven by the stored request and the refused submission until the attachment is present.*
3. **Use an approved template.** Owner or counsel author versioned templates with fields and clause wordings, and approve a version for use. A requester can only populate an approved version; required fields must be filled; the chosen clause wording is recorded. A later template version never rewrites a version already produced. *Proven by the refusal of a draft template, the populated text and the unchanged earlier version.*
4. **Maintain the clause playbook.** Owner or counsel keep versioned rules: preferred wording, allowed alternatives and who decides exceptions (counsel or approver). One version is active; each review finding records the playbook version it used. *Proven by activation superseding the earlier version and findings citing it.*
5. **Negotiate in versions.** People add our revisions and counterparty markups (PDF or DOCX), compare any two versions line by line, and comment with quoted passages. Originals stay byte-for-byte. A version added against a stale view of the agreement is refused. *Proven by the comparison of two DOCX versions and the untouched downloads.*
6. **Record review findings.** A reviewer records, against a playbook rule, whether the rule is met, breached or cannot be determined, citing the exact passage by position and quote (checked against the version text), with proposed wording and open questions. Agents submit findings only as proposals. *Proven by the refused mismatched quote and an agent's findings applied only after counsel's approval.*
7. **Approve the exact version.** Every agreement needs commercial approval (owner or approver); each breached or undetermined finding needs an exception decision by the rule's authority. The requester cannot approve their own request unless they are the owner. Approvals pin version identity and decision context; a new version, a signing PDF or a value change withdraws them and the agreement returns to review. *Proven by the route, the role refusals, and the withdrawal after a new version and after a value change.*
8. **Prepare for signature with the existing provider.** From an approved version Locket produces the signature-ready PDF (the approved PDF itself; a text PDF for template versions; DOCX versions need the PDF they will be signed as, attached and approved first) and a routing manifest naming version identity, document SHA-256, approvals, provider and ordered recipients. A person sends it through DocuSign, Adobe Acrobat Sign, Dropbox Sign, PandaDoc, Documenso, DocuSeal, paper or another route, and records the envelope ID. *Proven by the downloaded PDF and manifest and the recorded handoff.*
9. **Record execution.** A person uploads the signed PDF and the provider's certificate. Locket reconciles the envelope ID with the handoff, the signers with the package's signers, the document (the recorder's confirmation and page count) and the certificate's presence. A clean match marks the agreement executed; a mismatch stays unsigned until owner or counsel accepts it with a reason. The same signed file or envelope cannot be recorded twice. *Proven by a reconciled execution, a mismatch held for review, and a refused duplicate.*
10. **Confirm terms and obligations.** People propose effective and end dates, auto-renewal, renewal term, notice period, governing law and payment terms, each citing words from the executed text (or a signed-PDF page when there is no text). Owner, counsel or approver confirm or reject each. Correcting a confirmed term supersedes it and keeps the history. Obligations have an owner, due date and recurrence; they are confirmed and then marked done. *Proven by an agent's terms confirmed by an approver, a correction that keeps the superseded value, and an obligation through to done.*
11. **Work the renewal queue.** Confirmed end date and notice period produce the notice deadline: the end of the deadline day (23:59:59) in the agreement's time zone, Australia/Sydney by default, including daylight-saving changes. Owner or approver decide renew, renegotiate or terminate; a notice is drafted (by a person or an agent proposal), approved for sending by owner or approver (not by its preparer unless owner), and then recorded as sent with method, time and optional evidence. *Proven by deadlines on both sides of the 4 October 2026 daylight-saving change and a notice that stays "approved, not sent" until sending is recorded.*
12. **Search, export and restore.** People search titles, counterparties, references and version text of the agreements they may access. The owner exports a complete archive of every record and every file's exact bytes and digest. `rer export` and `rer import` restore the whole installation into an empty one, after which the restored owner signs in afresh and continues work, including undoing a restored move-in. *Proven by restricted results hidden from others, the archive's digests, and a fresh-install restore compared record by record and byte by byte.*

## Agents prepare, people approve

An agent is an invited operator with the `agent` role using the same HTTP API ([API.md](API.md)). It reads what the agent role may see and prepares proposals, each with evidence and assumptions:

- **Intake:** extracted request details (title, type, counterparty, value, dates, template fields) → approved by owner, counsel, approver or requester, which creates the request as that person.
- **Playbook review:** findings with exact cited passages, results, proposed wording and questions → approved by owner or counsel.
- **Agreement family:** a parent link (amends, order under, schedule to, renews) with any contradictions found → approved by owner or counsel.
- **Terms:** extracted terms with citations from the executed text → approved by owner, counsel or approver, which confirms them.
- **Renewal notice:** a draft notice for a decided renewal → approved by owner or approver as a draft; sending still needs its own approval and evidence.

Approval runs the same checks as doing the work by hand, records who prepared and who decided, and links the result to the proposal. An agent never approves, signs, sends or confirms anything; nobody may decide a proposal they prepared unless they are the owner. Phase one has no embedded model account: the owner's own agent works through the API.

## Move-in: DocuSign archive

The first move-in kit takes a DocuSign Envelope Report CSV and the downloaded completed envelopes (one folder per envelope ID with the signed PDFs and `Summary.pdf`, the Certificate of Completion), on Base's import-kit. A dry run shows every row's outcome (import, not completed, missing evidence, duplicate), missing certificates and files not in the report, and writes nothing. Applying the exact reviewed dry run creates imported agreements with the signed file and certificate kept byte-for-byte, an imported execution record (never a new signature event), and end date and notice period as *proposed* terms. The import journal keeps the report and every supplied file. An unused batch can be undone; once an imported agreement is used (terms confirmed, notices, edits, links), undo is refused and the history stays. Shape and limits: [IMPORT.md](IMPORT.md).

## Decided defaults

These are decided for the first release:

- **Name:** Locket (working name; no legal name clearance claimed).
- **Scope:** owner-reviewed commercial contracts, repository and renewals; keep the owner's existing signing provider. Native signing is the next bounded release, not part of this one.
- **Jurisdiction:** Australian commercial agreements for the first owner; Australia/Sydney time zone by default, changeable per agreement; currency AUD. Templates and execution requirements need the owner's qualified review. No multi-jurisdiction validity claim.
- **Required attachments by request type:** supplier: insurance certificate of currency; customer: statement of work or schedule; amendment: signed parent agreement (and a parent link); order form: a parent link; NDA and other: none. Owners add more per request; owner or counsel may waive with a reason.
- **Approval:** commercial approval always; exceptions by the rule's authority; requester self-approval refused except for the owner.
- **Notice deadline:** end date minus notice days, at 23:59:59 local time in the agreement's zone.
- **Move-in order:** DocuSign archive first, then PandaDoc. Only an authorised real archive with original bytes, source IDs and disclosed missing files is accepted as owner move-in evidence.
- **Limits:** 5 MB per uploaded file; 6 MB of files per move-in batch (split larger archives by date range).

## Not in the first release

Native signing or any signature evidence of Locket's own; qualified or regulated signatures, identity verification and notarisation; legal advice, opinions or validity checks; arbitrary collaborative Word editing (DOCX is kept and read, not edited); PDF text extraction (text comes from DOCX or is supplied); procurement or CPQ; payments, billing or tax; litigation discovery; public precedent datasets; live provider APIs, webhooks or sending email from Locket; embedded model calls; PandaDoc, Ironclad, Juro and SpotDraft move-in kits; brand, homepage, docs site and hosted deployment.
