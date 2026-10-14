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
