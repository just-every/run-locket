# DocuSign archive fixture (documented shape, synthetic data)

`envelopes.csv` follows the documented shape of a DocuSign eSignature
**Envelope Report** downloaded as CSV (Reports → Envelope Report → Download;
columns such as Envelope ID, Subject, Status, Sender Name, Recipient Name,
Sent On and Completed On are chosen by the sender). The kit needs `Envelope
ID`, `Subject`, `Status` and `Completed On`; it reads `Recipient Name` with
`Recipient Email` (matching `;`-separated lists, or `Name <email>` entries) and
`Sender Email` when present. `Counterparty`, `Agreement Type`, `End Date` and `Notice Days`
are optional columns the owner adds before import. Dates use the account's
display format, here day/month/year.

The signed documents follow the documented **Download → Separate PDFs** layout,
one folder per envelope ID with the signed document(s) and `Summary.pdf`, the
Certificate of Completion. The test builds those PDFs itself
(`tests/api/files.mjs`) so no real agreement is stored here:

| Row | Envelope | What it exercises |
| --- | --- | --- |
| 2 | `3F2A9C10…` | Completed, signed PDF and certificate, end date and notice period → imported, reconciled, proposed terms |
| 3 | `7C1B2D3E…` | Completed, signed PDF only, counterparty inferred from the recipient's domain → imported, flagged for review |
| 4 | `A1B2C3D4…` | Status Sent → not imported |
| 5 | `B2C3D4E5…` | Completed but no PDF supplied → missing evidence |
| 6 | `3F2A9C10…` again | Same envelope twice → duplicate |

All names, domains and IDs are invented. This is not a verified export from a
real DocuSign account; real owner archives may differ (see IMPORT.md).
