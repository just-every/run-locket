# Ironclad move-in fixture

All names, identifiers and document bytes are synthetic. `archive.mjs` constructs
50 repository records, two MSA families each containing three order forms and an
amendment, exact original PDFs, one orphan, CSV, Records JSON and an attachments
ZIP. XLSX uses the same export rows. No customer export or provider receipt is
included.

Source documentation read on 29 October 2026:

- [Export Workflows/Records From Your Dashboard](https://support.ironcladapp.com/hc/en-us/articles/12286394278423-Export-Workflows-Records-From-Your-Dashboard): Record Id, Workflow Id, Parent Id, Record Type, Attachment Filenames, Record Name and Stage. Additional columns are the tenant's properties. The fixture does not import approval/turn/action history as native approvals.
- [Export Record Metadata](https://support.ironcladapp.com/hc/en-us/articles/32212463361047-Export-Record-Metadata): CSV, JSON and XLSX; select all columns and original rather than amended values.
- [Lifecycle Preset Overview](https://support.ironcladapp.com/hc/en-us/articles/22752303578903-Lifecycle-Preset-Overview): agreement/effective and expiration dates, renewal type, renewal term and renewals allowed. The fixture's lifecycle values are proposals, not confirmed deadlines.
- [Contract Families Overview](https://support.ironcladapp.com/hc/en-us/articles/12402562074775-Contract-Families-Overview): one parent per child; amendment relationships and explicit selection of amended values. Locket does not import automatic roll-up judgments.
- [Records API](https://developer.ironcladapp.com/reference/records): the developer reference returned HTTP 403 in this cloud. The network-edge fixture exercises the isolated transport adapter's paginated `GET /records`, attachment-job request, pending/ready poll and separate credential-free ZIP download. Its JSON uses record IDs, record types, properties, attachments and parent IDs. It is not a recorded sandbox response or evidence of live compatibility.

The last three columns are deliberately unmapped. An owner maps Business Unit
to an existing custom field and explicitly skips Cost Center and Legacy Flag.
Every change creates a newly reviewed plan. The API fake returns two pages,
a pending job then a ready job and the identical ZIP. Only network requests are
faked; tests use the public HTTP command, state, search, file and export doors
against the real Worker and D1 schema.

Before owner acceptance, obtain an authorized real export and a live Ironclad
sandbox run, including confirmation of that account's API job response shape.
