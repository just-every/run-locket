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

Locket never re-signs an imported agreement or produces a certificate in DocuSign's name; imported events stay labelled imported. PandaDoc, Juro and SpotDraft retain their separate target kits. The Ironclad repository kit below has network-edge proof; an authorized real export and sandbox receipt remain required.


# Moving in: Ironclad repository

Choose **Imports → Ironclad repository**. An owner can inspect a metadata export
(CSV, JSON/JSONL or the first worksheet of XLSX), an attachments ZIP, or both.
A combined ZIP can include `records.json`, `records.csv` or `records.xlsx`.
Attachments alone produce an orphan report without inventing record identities;
metadata alone lists records missing their files. Export **all original columns**,
with amended-value export disabled: Locket never imports an automatic legal
precedence decision from Ironclad.

The documented Dashboard columns include `Record Id`, `Workflow Id`, `Record
Name`, `Record Type`, `Parent Id`, `Attachment Filenames` and `Stage`. Additional
columns are tenant properties. JSON accepts the Records API `list` or a records
array, with `id`, `workflowId`, `name`, `recordType`, `properties`, `attachments`
and parent/child links. JSON property values can be scalar or typed `{value}`
objects. XLSX supports shared strings, inline strings and date cells; formulas,
external worksheet relationships, encrypted archives and unsafe/duplicate paths
are refused. Each batch is bounded to 250 records, 400 individually supplied
files and 6 MB including expanded archive files. Split larger selections into
reviewable batches. Dates must resolve to ISO calendar dates; renewal durations
are whole months; contract values are explicitly USD. No exchange rate is inferred.

Inspection shows editable record-type, property and family-relation mappings.
Every property must map to a supported native field, an applicable custom field,
or an explicit skip. The owner can create a custom text field from the mapping
screen. Required custom fields must be supplied; imported custom dates and money
remain cited proposals. Unmapped or invalid values stop preview. Family cycles,
multiple parents and missing/non-importable parents are refused. An earlier
Ironclad parent may be linked by its unique source ID and reviewed current
revision, so large families can span batches. An out-of-batch
child link is retained in the source metadata; include its record to import it.

The reviewed dry run lists every record, source identifiers, main document and
additional documents, family relation, duplicates, missing/ambiguous files,
unsupported originals and orphan files. Nothing native is imported at this
point. The import-kit journal retains the metadata and ZIP plus exact original
files. Apply pins the fingerprint, our selected entity and custom definitions.
Guarded bounded batches display progress and can resume after reload. A changed
mapping needs another dry run. Existing IDs or original digests never overwrite
an earlier agreement.

An imported agreement carries its source record and workflow IDs (both searchable),
our entity and its time zone, original digests, imported execution history and
proposed terms. An unknown execution date stays unknown. Imported history is
flagged for human signature-evidence review; Locket creates no signature or
certificate. All original PDF/DOCX attachments are retained byte for byte.
Confirm imported dates or USD values with words and a page from the original
before they drive anything. Lifecycle properties map to the native current-term
projection. Bulk scheduling still requires all native confirmed terms, including
governing law and payment terms, and an accessible active reminder owner. Stored
schedules are never labelled delivered. Family governing values use the existing
cited human selection, visibility and stale-source checks.

An unused batch, including its imported family links, can be undone and imported
again. If native terms, comments, access, links, edits or other use have occurred,
undo refuses and keeps the history. Undo itself resumes in bounded batches; the
journal and source originals remain.

## Ironclad API read

Configure private `IRONCLAD_API_TOKEN` and `IRONCLAD_REGION` installation bindings
(`na1`, `eu1` or `demo`; default `na1`). No credential is entered into a command
or returned in state. The owner explicitly authorizes the repository read, then
checks the visible attachment job until ready. Reads are bound to that owner
session and the private connection, expire after 30 minutes, and never revive on
a later login or changed credential. HTTP errors remain visible and explicit
read retry never applies an agreement. The ready original ZIP enters the same
mapping and journal path as an uploaded export. Download credentials are never
forwarded to signed object-storage URLs or redirects.

The adapter and pending/ready protocol are exercised at the network edge using
synthetic records. The developer reference was unavailable (HTTP 403) during
this build; the attachment-job protocol still requires confirmation on the
owner's Ironclad sandbox before any live compatibility claim. An authorized
real export and a live sandbox run are the remaining MOVE-002 acceptance items.
See [fixture sources](tests/fixtures/ironclad/README.md).
