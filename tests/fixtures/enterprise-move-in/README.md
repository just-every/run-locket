# MOVE-003 source fixtures

All agreements, files, identities and credentials are synthetic. The generator is
`tests/api/enterprise-move-fixture.mjs`. Each source contains 30 records: one MSA,
two amendments, three custom attributes, one record without files and (in the
folder export) one file without a record. Agiloft uses two attachment fields,
`signed_document` and `supporting_files`, with explicit role mapping. Its record IDs are numeric; the table uses Record ID, Contract Title, Company, Start Date, End Date and Amount columns. One supporting-field PDF is mapped as an additional original version; the remaining supporting files keep their attachment role.

ICI export columns follow CONTRACT.md's named Agreement Management output:
System ID, Agreement Code, Contract Type, Name, Status, First Party, Second Party,
Effective Date, Expiry Date, Value, Currency, parent/relation and renewal columns.
The XLSX is a real deflated OOXML workbook, not CSV renamed as Excel.

**ICI tenant documentation is not supplied.** There is no claimed ICI release
or authentic tenant response in this fixture. The deliberately synthetic profile
has release `synthetic-ici-profile/1`, documentation `synthetic; tenant validation
required`, `GET /ici/agreements?page=N` -> `{agreements:[column-keyed objects],
next:string|null}`, `GET /ici/agreements/{id}/documents` -> `{documents:[{name,url}]}`,
and same-origin original downloads. These are a configurable reader test, not an
assertion that ICI publishes those endpoints. Before acceptance, replace the
profile with the buyer's documented release, endpoints and response selectors,
and record authorized export and sandbox receipts. The implementation refuses
API use without that explicitly installed profile and credential.

Agiloft fixture protocol models the operations named in CONTRACT.md and the
REST interface documentation at https://wiki.agiloft.com/display/HELP/REST+Interface:
`GET EWSelect` -> `{result:[record IDs]}`; `GET EWRead` with `$id` ->
`{result:{column:scalar}}`; `GET EWAttachInfo` with `$id` and `$field` ->
`{result:[{position,name,size}]}`; `GET EWRetrieve` with `$id`, `$field`, `$position`
-> original bytes. `$KB` and `$table` are pinned by the private profile; the bearer
is private. Response selectors and operation paths must be checked against the
buyer's deployed REST release/authentication configuration. This is an invented
network-edge recording, not a licensed knowledge-base or vendor receipt.

The suite proves export, API, remapping, imported custody, family integration,
proposed values, renewal/reminder inheritance, audit, archive and guarded undo
through the real Worker and D1. Real exports, tenant-specific API compatibility
and live sandbox reads remain excluded account-dependent evidence.
