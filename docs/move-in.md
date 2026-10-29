The DocuSign move-in brings completed envelopes into Locket as imported agreements, with each signed PDF and Certificate of Completion kept exactly as you exported it. Only the owner moves archives in, under **Imports**.

## Export from DocuSign

1. **Envelope Report.** In DocuSign choose Reports, then Envelope Report. Pick the completion date range and include at least **Envelope ID**, **Subject**, **Status** and **Completed On**; **Recipient Name**, **Recipient Email** and **Sender Email** help too. Download it as CSV.
2. **Signed documents.** For each completed envelope, download the documents as **Separate PDFs** into a folder named by its envelope ID: the signed document and `Summary.pdf`, the Certificate of Completion.

You may add these columns to the CSV before you start: `Counterparty` (otherwise the first recipient outside your own email domain names it), `Agreement Type` (customer, supplier, NDA, amendment or order form), `End Date` and `Notice Days`.

A Combined PDF carries the certificate only when your account attaches it; Locket then marks the execution for review because it cannot see a separate certificate.

## Run a dry run

Open **Imports** and fill in **New DocuSign archive dry run**:

- **Batch name**, for example the date range.
- **Dates in the report are**: Month/Day/Year for a US account, Day/Month/Year for an account outside the US, or Year-Month-Day.
- **Envelope report (CSV)** and the **Downloaded envelopes folder**.

**Run dry run** shows every envelope's outcome and writes nothing: **To import**, **Not completed**, **Missing evidence** (no PDF, no envelope ID or an unreadable date), **Duplicates** (repeated in the report, or already in Locket) and **Missing certificates**, plus any files the report does not name.

A batch holds at most 6 MB of files, and each file at most 5 MB. Split a larger archive by date range.

## Apply it

**Apply this dry run** imports exactly what you reviewed. Each envelope becomes an agreement marked imported, with its signed PDF and certificate stored byte for byte, an imported execution record, and any `End Date` and `Notice Days` as proposed terms. Proposed terms drive nothing until someone confirms them against the signed PDF, so no renewal appears until then.

## Undo a batch

**Undo batch** removes a batch nobody has used yet. Once an imported agreement is in use (edited, terms confirmed or rejected, obligations, a renewal or notices, comments, access grants or a family link), or another agreement names a counterparty the batch created, undo is refused and lists those agreements; correct them instead. Undo never deletes the original files: Locket's import journal keeps the report and every file you supplied.

Locket never re-signs an imported agreement or makes a certificate in DocuSign's name.

## Icertis and Agiloft

Under **Imports**, choose **Move from Icertis or Agiloft**, supply the metadata
XLSX/CSV and documents folder, and review each source column and contract type.
Map custom attributes to fields created in Library, or explicitly skip them.
Apply stays disabled until all columns are reviewed. Review lists missing and
unmatched files, original digests and family links. The source IDs remain
searchable; signed records are imported history, and all dates/amounts stay
proposed until confirmed against the original. The same unused-batch undo and
original-preserving journal apply. Read [the import reference](https://github.com/just-every/run-locket/blob/main/IMPORT.md) for private
read-only API configuration and the currently unproved vendor evidence.
