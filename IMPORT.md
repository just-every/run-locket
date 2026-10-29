# Moving in: DocuSign archive

The first move-in kit brings completed DocuSign envelopes into Locket as imported agreements with their signed files and Certificates of Completion, on Base's import-kit (`src/modules/import-kit`, D1 port). It is owner-only.

## What to export from DocuSign

1. **Envelope Report CSV.** Reports → Envelope Report, choose the completion date range, include at least **Envelope ID**, **Subject**, **Status** and **Completed On**, and preferably **Recipient Name**, **Recipient Email** and **Sender Email**, then Download (CSV). DocuSign documents that reports downloaded in the app return up to 5,000 rows; scheduled reports return more.
2. **Signed documents.** For each completed envelope, download the documents as **Separate PDFs** and keep them in a folder named by the envelope ID: the signed document(s) and `Summary.pdf`, the Certificate of Completion. A **Combined PDF** includes the certificate only when the account attaches certificates to envelopes; Locket then flags the execution for review because it cannot see a separate certificate.

Optional columns the owner may add to the CSV before import: `Counterparty` (otherwise the first recipient outside the sender's email domain names it, flagged for renaming), `Agreement Type` (customer, supplier, NDA, amendment, order form), `End Date` and `Notice Days`. Dates use the account's display format; choose day/month/year, month/day/year or ISO in the dry run.

This shape comes from DocuSign's published help and an invented fixture (`tests/fixtures/docusign-archive/`). It has not been checked against a real owner's export; an authorised real archive must confirm bulk completeness before the kit is accepted for that owner.

## Dry run, apply, undo

- `import.preview` `{kit:"docusign-archive", label, dateFormat:"dmy"|"mdy"|"iso", manifest:{filename, base64}, files:[{path:"ENVELOPE_ID/file.pdf", base64}]}` reads the report and files, decides each row's outcome — **import** (completed, signed PDF present, not already held), **not completed**, **missing evidence** (no PDF, no envelope ID or an unreadable date) or **duplicate** (repeated in the report, or the envelope or signed file already in Locket) — and lists files not named by the report. It writes no agreement. The import-kit journal keeps the report and every supplied file's exact bytes from this point. Result: `{batchId, counts, fingerprint}`. At most 6 MB of files per batch.
- `import.apply` `{batchId, version, fingerprint}` applies exactly the reviewed dry run (the fingerprint must match). Each imported envelope becomes an agreement with status *imported*, a version labelled with its envelope, the signed PDF and certificate stored byte-for-byte with the envelope ID and path as provenance, an imported execution record (reconciled when a certificate and recipients are present, otherwise needing review), and `End Date` / `Notice Days` as **proposed** terms that drive nothing until confirmed against the signed PDF. A failed apply resumes from the journal when run again.
- `import.undo` `{batchId, version, reason}` removes a batch whose agreements are untouched. If any imported agreement has been used — edited, terms confirmed or rejected, obligations, renewal or notices, comments, access grants or a family link — undo is refused (`IMPORT_DEPENDENCY`) and lists them; correct those records instead. Undo keeps the journal and original files.

Locket never re-signs an imported agreement or produces a certificate in DocuSign's name; imported events stay labelled imported. PandaDoc (bulk ZIP plus separately collected attachments) is the next kit; Ironclad, Juro and SpotDraft need real sample exports first.

## Icertis and Agiloft (`MOVE-003`)

The owner uses **Imports → Move from Icertis or Agiloft**. Choose a metadata
XLSX or CSV and its documents folder, or explicitly authorize the configured
read-only API. Folders are named by source system ID (or ICI agreement code).
The first worksheet is read; save formulas as values and older XLS files as
XLSX. ISO dates and Excel serial calendar dates are supported. Each reviewed
batch holds at most 100 records, 6 MB in total and 5 MB per file; split larger
saved searches. The API additionally bounds pagination, calls and elapsed time.

The dry run lists all rows, source identity/code, contract types, mappings,
proposed terms, linked parent/relation, document roles and SHA-256, duplicate
identities/bytes, records missing a signed PDF, unsigned statuses and orphan
files. Map each source type and every column to a native field, an existing
Library custom field, or **Skip explicitly**. Unmapped fields block apply.
**Review revised mapping** creates a new reviewed fingerprint from the retained
originals, including after reloading the page; the prior review stays journaled.
Supporting files, certificates and additional source versions retain separate
roles. Map attachment-field names or exact paths to `signed`, `version`,
`attachment` or `certificate`. No original is split or rewritten.

`import.preview` accepts `kit:"icertis"|"agiloft"`, `label`, optional `entityId`
and `restricted`, `manifest:{filename,base64}`, `files:[{path,base64}]`, optional
`mapping:{sourceColumn:destination}`, `typeMapping:{sourceType:locketType}`,
`fileRoles:{attachmentFieldOrPath:role}`, and `signedStatuses` (default:
Executed, Signed, Completed). Mapping destinations are id, code, title, type,
status, counterparty, parent, relation, documents (semicolon-separated paths),
effective_date, end_date, auto_renew, renewal_type, initial_term_months,
renewal_term_months, renewals_allowed, notice_days, governing_law, payment_terms, value, currency,
`custom:FIELD_ID` or skip. File paths are plain relative names.

`import.remap {batchId,version,mapping,typeMapping?,fileRoles?}` reuses the
journal's originals without another provider read. Apply and undo keep the
MOVE-001 payloads. Large operations return `applying`/`undoing`, the next batch
`version` and apply progress; repeat that operation against the same fingerprint
until `applied`/`undone`. The browser resumes this automatically. Completed
chunks remain journaled if interrupted. Imported family links within an unused
batch undo together; later edits, confirmed terms, outside family links and
other downstream use refuse undo. Original journal files remain after undo.

Signed source records become `imported` agreements and imported execution
history, with no new signing event or invented signer/date/certificate.
Unverified signing evidence stays `needs_review`. ICI system IDs and agreement
codes, and Agiloft record IDs, are searchable. Source relationships use the
existing scoped family projection, cited human governing selections and
stale-source checks. Dates and renewal fields are proposed native terms.
Amounts, currency and custom values also stay proposed: they do not enter
portfolio totals, metadata queries or deadlines. A person confirms renewal terms
through the normal Terms screen; the existing current-term lifecycle and bulk
reminder preview/apply then operate on them. Confirm a custom field or USD amount
with `import.value.confirm {agreementId,termId,citation:{quote,page}}`, using
words/page from the signed original. Custom definitions must still match the
review. Non-USD amounts require the native value editor's explicit conversion
rate and are not silently converted by the importer.

### Private API profiles

Install `ICERTIS_IMPORT_TOKEN` and `ICERTIS_IMPORT_PROFILE`, or
`AGILOFT_IMPORT_TOKEN` and `AGILOFT_IMPORT_PROFILE`, as private Worker bindings
(and private `.dev.vars` entries for a local installation). Tokens are read-only
bearers, never command inputs. Profiles are JSON with a public HTTPS `baseUrl`,
`release`, `documentation`, `idColumn`, `listPath`, `recordsKey` (dot selector)
and optional `nextKey`. All pages and downloads must remain on that exact
origin; redirects, bad responses and partial downloads refuse the new preview.
No upstream writes or automatic retries occur. `_api/` and `_source/` paths are
reserved for retained source responses and combined-export evidence.

An ICI profile additionally supplies its tenant-documented `documentsPath`
containing `{id}`, `documentsKey`, `documentName` and `documentUrl` selectors.
Agiloft uses `listPath` selecting EWSelect or EWSearch, `readPath` (EWRead),
`recordKey`, `documentsKey`, `knowledgeBase`, `table`, and explicit
`attachmentFields`. EWAttachInfo requires name, zero-based position and size;
EWRetrieve is addressed by `$KB`, `$table`, `$id`, `$field`, `$position`. A
profile base path selects the tenant's REST service root. Its authentication
and response envelope must be validated against that installed release.

For API preview send `source:"api",consent:true` plus the ordinary review
mapping. Optional export `manifest`/`files` combine with API metadata by the
profile identity column: conflicting nonempty metadata or same-path document
bytes are refused. Exact provider JSON and originals join the journal.

**Unproved provider evidence:** no ICI tenant documentation, authentic ICI API
release/shape, authorized real export, licensed Agiloft knowledge base or live
sandbox receipts were supplied. The committed ICI profile is explicitly
synthetic, not vendor documentation. See the fixture README. The clause's
status and acceptance text remain unchanged; no real-provider acceptance is
claimed.

A completed read and a failed read retain an owner-attributed source observation
on **Connections**, including safe failure/recovery reasons. A failed read
accepts no new snapshot or agreements; the owner sees the error and one generic
failure alert through the existing notification transport. A successful read
establishes transport/schema compatibility only, leaving vendor identity
unverified. It never retries a business write.

For these two kits, native `term.decide` confirmation additionally requires a
signed-document `citation:{quote,page}`. The confirmed term preserves both that
citation and the imported metadata source, so family governing choices cite the
actual document rather than an unchecked export cell. The Terms screen requests
these words and page before confirmation. Existing DocuSign behavior is retained.
