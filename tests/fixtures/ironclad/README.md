# Ironclad move-in fixture

All names, identifiers and document bytes are synthetic. `archive.mjs` constructs
50 repository records, two MSA families each containing three order forms and an
amendment, 51 exact original PDFs (one record has two attachments), one orphan, CSV, Records JSON and an attachments
ZIP. XLSX uses the same export rows. No customer export or provider receipt is
included.

Source documentation read on 29 October 2026:

- [Export Workflows/Records From Your Dashboard](https://support.ironcladapp.com/hc/en-us/articles/12286394278423-Export-Workflows-Records-From-Your-Dashboard): Record Id, Workflow Id, Parent Id, Record Type, Attachment Filenames, Record Name and Stage. Additional columns are the tenant's properties. The fixture does not import approval/turn/action history as native approvals.
- [Export Record Metadata](https://support.ironcladapp.com/hc/en-us/articles/32212463361047-Export-Record-Metadata): CSV, JSON and XLSX; select all columns and original rather than amended values.
- [Lifecycle Preset Overview](https://support.ironcladapp.com/hc/en-us/articles/22752303578903-Lifecycle-Preset-Overview): agreement/effective and expiration dates, renewal type, renewal term and renewals allowed. The fixture's lifecycle values are proposals, not confirmed deadlines.
- [Contract Families Overview](https://support.ironcladapp.com/hc/en-us/articles/12402562074775-Contract-Families-Overview): one parent per child; amendment relationships and explicit selection of amended values. Locket does not import automatic roll-up judgments.
- [List All Records](https://developer.ironcladapp.com/reference/list-all-records) and the provider's [OpenAPI](https://developer.ironcladapp.com/openapi/ironclad-public-api.json): zero-based pages, total `count`, `RecordModel.type`, keyed attachments, typed `RecordProperties`, `source.workflowId`, `parentId`, `parentLinkType:amendment` and `childIds`.
- [Create Attachment Download URLs](https://developer.ironcladapp.com/reference/create-attachment-download-urls) and [Get Attachment Download URLs Status](https://developer.ironcladapp.com/reference/get-attachment-download-urls-status): request `identifiers` (at most 100), `type:latestSignedCopy`; accepted `jobId/status:processing`; completed `succeeded` identities/file keys/hashes/expiries/URLs and `failed` outcomes. These two endpoint schemas are published on their reference pages even though the combined OpenAPI currently omits them.
- [Retrieve an Attachment on a Record](https://developer.ironcladapp.com/reference/retrieve-an-attachment-on-a-record): additional keyed attachments use the record's authenticated attachment door. Bulk jobs generate signed URLs for latest signed copies, not an attachments ZIP.

The developer reference initially rejected the default command-line user agent
with HTTP 403/1010. A standard browser user agent returned HTTP 200 for the
reference pages and published OpenAPI on 29 October 2026. No live account was
used. `providerRecords` constructs that documented shape; all values, hashes,
URLs and provider responses remain synthetic. Typed dates, USD amounts and
ISO durations represent the same CSV/XLSX values. The related control segment
covers Optional Extension, finite renewals, typed custom fields and unsafe
attachments through the same public HTTP parser.

The last three columns are deliberately unmapped. An owner maps Business Unit
to an existing custom field and explicitly skips Cost Center and Legacy Flag.
Every change creates a newly reviewed plan. The API fake returns two pages,
a pending job then a ready job and individual byte-identical originals. Only network requests are
faked; tests use the public HTTP command, state, search, file and export doors
against the real Worker and D1 schema.

Before owner acceptance, obtain an authorized real export and a live Ironclad
sandbox run, including that account's job receipts and original downloads.
