# Locket acceptance record

Each first-release clause in [CONTRACT.md](CONTRACT.md) has one flow test in `tests/api/flows.test.mjs`, run through authenticated HTTP against the real Worker with D1 and every migration applied. `rer verify` runs them with the move-in, security and portability proofs, the emitted-Worker runtime and email-link checks, the build and the typecheck. The browser journeys in `tests/browser/journey.spec.ts` walk the same flows through the screens at 1440 and 390 pixels wide.

Status **LOCAL PROVEN** means the named test passed in a local run of this checkout. It is not hosted, provider, legal or real-owner acceptance.

| # | What a person can do | Test | Status |
| --- | --- | --- | --- |
| 1 | Import a legacy PDF or DOCX keeping exact bytes, source ID and provenance; duplicates refused | `01 legacy PDF and DOCX keep original bytes, source identity and provenance` | LOCAL PROVEN |
| 2 | Capture a request with counterparty, value, owner and dates; review blocked until required attachments exist | `02 intake captures the deal and blocks review until required attachments are present` | LOCAL PROVEN |
| 3 | Populate only an approved template version, with fields and chosen clause wording | `03 only an approved template version populates a request, with its fields and chosen clauses` | LOCAL PROVEN |
| 4 | Keep a versioned clause playbook; findings cite the version used | `04 the clause playbook is versioned and reviews cite the version they used` | LOCAL PROVEN |
| 5 | Add negotiation versions, compare them, comment; originals untouched | `05 successive negotiation versions compare line by line and keep untouched originals and comments` | LOCAL PROVEN |
| 6 | Record met / breached / cannot-determine findings with exact citations; agents only propose | `06 review findings cite exact passages, separate met, breached and cannot-determine, and agents only propose` | LOCAL PROVEN |
| 7 | Route commercial and exception approvals; approvals pin version and context and are withdrawn by changes | `07 approvals route exceptions to the right authority and pin the exact version and context` | LOCAL PROVEN |
| 8 | Produce the signature-ready PDF and routing manifest and record the handoff | `08 an approved version becomes a signature-ready PDF and routing manifest for the existing provider` | LOCAL PROVEN |
| 9 | Ingest signed file and certificate; reconcile envelope, signers, document; hold mismatches; refuse duplicates | `09 execution ingests the signed file and certificate and reconciles envelope, signers and document` | LOCAL PROVEN |
| 10 | Confirm terms and obligations against the executed text; corrections keep history | `10 terms and obligations are confirmed against the executed text, and corrections keep history` | LOCAL PROVEN |
| 11 | Compute notice deadlines in the agreement's zone; decide; approve a notice; record sending separately | `11 the renewal queue computes notice deadlines in the agreement time zone and keeps sending evidence separate` | LOCAL PROVEN |
| 12 | Search only permitted agreements; export the complete archive; restore into an empty installation | `12 search returns only agreements the person may access, and the owner exports every record and file`; `tests/portable.mjs` | LOCAL PROVEN |

High-stakes paths have their own proof:

- **Move-in** (`tests/api/move-in.test.mjs`): the DocuSign archive dry run writes nothing and reports every row; applying the exact reviewed dry run keeps signed files and certificates byte-for-byte; a later batch that repeats held envelopes changes nothing; an unused batch undoes completely while the journal keeps the report and files; re-import after undo works; correcting an imported end date keeps the rejected value; once used, undo is refused.
- **Access** (`tests/api/security.test.mjs`): signed-out and cross-site requests, viewers, agents, demoted approvers and revoked sessions are refused by the server; retried commands return their first outcome; decisions against a stale snapshot are refused.
- **Restore** (`tests/portable.mjs`): a populated installation (library, an executed agreement with files, confirmed terms, a renewal and a DocuSign move-in) goes through `rer export` and `rer import` into an empty installation; every Locket record and file matches; the old session no longer works; the new owner session undoes the restored move-in and corrects a term.

## Boundaries

The DocuSign fixture is a documented-shape synthetic archive (`tests/fixtures/docusign-archive/README.md`), not a verified owner export; an authorised real archive is still needed before move-in is accepted for a real owner. No signing provider, email provider, model or hosted deployment was used. Legal sufficiency of templates, notices and execution evidence remains the owner's and counsel's decision.
