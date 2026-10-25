# Procurement response crosswalks

Assessed 26 October 2026. These answers describe the software supplied by this
repository for an installation operated by its buyer. They do not attest that a
buyer has implemented every organizational or platform control. Locket has no
independent SOC 2 report, SIG certification or CAIQ certification.

The main response domains and provider inventory are in
[questionnaire.json](questionnaire.json). The independently authored
[response profiles](response-profiles.json) state the answer, relevant domains,
software evidence, buyer duties and platform responsibilities. Each question ID
in the two mapping files resolves to one profile. A Yes is limited to its stated
software capability; a No means the complete requested control is not established
by repository evidence. Not assessed identifies an installation-specific fact
that source code cannot answer, such as actual processing countries. The buyer
must reconcile its own and provider evidence before returning an installation-wide
questionnaire. No certification, contractual commitment or processing consent
arises from these files.

## CAIQ

The [CAIQ responses](caiq-responses.json) map all **283 identifiers** from CSA's
CAIQ **4.1.0** STAR security workbook generated **2 October 2026**. The
[source index](caiq-source-index.json) records its original filename, retrieval
date, SHA-256 and exact identifiers. This was read from the current official
[CSA bundle](https://cloudsecurityalliance.org/artifacts/cloud-controls-matrix-v4-1),
not reconstructed from domain names or a third party's answers. CSA also publishes
a [machine-readable bundle](https://cloudsecurityalliance.org/artifacts/ccm-machine-readable-bundle-json-yaml-oscal).

The workbook's copyright notice restricts redistribution and modification.
Accordingly, this repository includes factual question identifiers and our own
responses; it does not redistribute the question text, control specifications,
original workbook or a modified CSA questionnaire. Obtain the unchanged official
workbook from CSA and join these responses by ID. This crosswalk is not a STAR
submission or independent assurance.

## SIG Lite: exact remaining limitation

The [historical SIG responses](sig-lite-responses.json) map all **172 identifiers**
from the publicly hosted **2019**
[WalkMe workbook](https://www.walkme.com/wp-content/uploads/2021/07/WalkMe-SIG-Lite-MAR2019-9-.xlsm).
Its [source index](sig-lite-source-index.json) records the exact filename, digest
and identifiers. Only the identifiers were retained; no workbook, macros,
question text, maturity score or WalkMe answer is redistributed. The source
numbering is preserved. A secondary public index had different descriptions for
some identifiers, so its descriptions were not used to infer the workbook's
questions.

This is **not a completed current SIG Lite questionnaire**. The authoritative
**2026** Standard SIG Lite workbook, its release revision, exact question text and
identifier list, plus any buyer-specific scoped additions, were not supplied under
a licence. No current identifier list or question count is invented. The
[publisher FAQ](https://sharedassessments.org/sig-faq/) describes licensed access
and configurable scoping. Its
[content agreement](https://sharedassessments.org/wp-content/uploads/sa-uploads/2024/11/Shared-Assessments-Subscription-Agreement-Membership-Agreement-and-Content-Addendum_2024_updated.pdf)
limits public access to licensed content. A public historical copy does not grant
permission to embed or republish current questionnaire text.

To finish the current mapping, provide a legitimately obtained 2026 Standard SIG
Lite workbook or the exact buyer-issued licensed questionnaire, including its year,
revision, scoped IDs and permission to use the text for assessment. Reconcile each
actual question against these native responses and buyer evidence. Obtain publisher
authorization before any public redistribution of question text. The current
licensed-source gap remains an OPS-001 limitation.

## Provider and build coverage

The inventory includes the buyer Cloudflare account, the optional private R2
update-archive bucket, all signing providers, configured model endpoints,
accounting and monitoring readers, chat, mail, token-based calendars and the
linked Auth and workforce identity flows. Current contract attachment bytes are
stored as D1 chunks. Buyer-owned account location does not establish data residency.
Buyer operators own archive retention, deletion, recovery exercises and access.
Cloudflare documents its own
[D1 encryption](https://developers.cloudflare.com/d1/reference/data-security/);
that platform evidence does not certify Locket.

The checker reads deployment bindings and application binding usage, and derives
provider choices from the shipped mail, signing, calendar, chat and linked identity
registries. This includes choices configured through stored records rather than
secrets. The shipped Messaging mail adapter is disclosed as present but not wired
to the current installation wrapper's required configuration; no working connector
is claimed for it. External sibling services can be buyer-operated; their legal
subprocessor status depends on the buyer's selected operator and contracts.

Run `node scripts/security-questionnaire.mjs` to validate connector disclosures,
source-index completeness, unique question mappings, response domains, evidence
paths and responsibility statements. Its success explicitly preserves the current
SIG limitation. Run `node scripts/security-questionnaire.mjs --require-complete`
when completeness of both current questionnaires is required; it fails while the
2026 licensed SIG source is missing.
