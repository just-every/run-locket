# Locket API

The screens and any agent use the same HTTP API. Authenticate with a Base native session (sign in through `/signin`; an agent is an invited operator the owner gave the `agent` role). Commands are same-origin JSON: send `Origin` equal to the installation's origin and `content-type: application/json`.

## Reads

- `GET /api/locket/state` — everything the signed-in person may see: `actor`, `operators`, `parties`, `agreements`, `routes` (required approvals per open agreement), `requirements`, `versions` (with `text` and `digest`), `artifacts` (metadata), `comments`, `templates`, `templateVersions`, `playbooks`, `deviations`, `approvals`, `packages`, `executions`, `terms`, `obligations`, `renewals`, `notices`, `proposals`, `imports` (owner), `access`, `audit`. Rows use database column names. Restricted agreements and their records are absent for people without access.
- `GET /api/locket/clause-library?q=TOPIC` — `{results:[{id,libraryVersionId,libraryVersionNumber,templateName,clauseKey,clauseTitle,variantId,variantLabel,text,notes,ruleKey,rule,playbookVersionId,playbookNumber,acceptanceCount}]}` for approved template/library clauses. Counts are per distinct accessible executed agreement whose current packaged version retains an explicit insertion; ordinary template choices and superseded wording never count.
- `GET /api/locket/search?q=TEXT` — `{results:[{id,reference,title,status,party,match:{version,excerpt}|null}]}` over titles, references, counterparties and version text the person may access.
- `GET /api/locket/compare?from=VERSION_ID&to=VERSION_ID` — `{from,to,lines:[{op:"same"|"del"|"add",text}]}` for two versions of one agreement.
- `GET /api/locket/files/ARTIFACT_ID` — the exact stored bytes; header `x-locket-sha256`.
- `GET /api/locket/export` — owner only: `{format:"locket-archive/1",exportedAt,records:{table:[rows]},files:[{...metadata,base64}]}`.

- `GET /api/locket/audit?person=OPERATOR_ID&agreement=AGREEMENT_ID&action=ACTION&from=YYYY-MM-DD&to=YYYY-MM-DD&q=TEXT` — owner/counsel only: `{rows:[audit entries]}`. All supplied filters intersect; UTC start/end dates are inclusive. Add `format=csv` to download the same rows. CSV records an `audit.export` event after selecting its rows; filtering and reading do not add entries. Restricted workspace/search/comparison reads record `agreement.view`; successful artifact downloads record `file.download`.

## Commands

`POST /api/locket/commands` with `{commandId, type, payload}`. `commandId` is a UUID; retrying the same id and payload returns the first result, a different payload is refused (`IDEMPOTENCY`). Success: `{ok:true,result}`. Failure: `{ok:false,error:{code,message,details}}` with 400, 401, 403, 404, 409, 413 or 415. `STALE` means the record changed since it was read; reload and review. Commands that change an agreement after review take its current `version` (the agreement row's `version`). Files are `{filename, mediaType?, base64}` (5 MB each). Dates are `YYYY-MM-DD`; money is a decimal string in USD (`"48000.50"`).

| Type | Who | Payload |
| --- | --- | --- |
| `party.save` | owner, counsel, approver, requester | `{id?, name, kind:"customer"|"supplier"|"partner"|"other", abn?, email?}` |
| `request.create` | same | `{title, type:"customer"|"supplier"|"nda"|"amendment"|"order_form"|"other", partyId? or party:{name,kind}, value?, ownerId?, neededBy?, startDate?, timezone?, restricted?, parentId?, relation?, requirements?:[label], templateVersionId?, fields?, clauseChoices?, file?, text?}` → `{id, reference, versionId}` |
| `request.update` | same | `{agreementId, version, title?, value?, ownerId?, neededBy?, restricted?}` |
| `requirement.add` / `requirement.attach` | same | `{agreementId, label}` / `{agreementId, requirementId, file}` |
| `requirement.waive` | owner, counsel | `{agreementId, requirementId, reason}` |
| `agreement.submit` | owner, counsel, approver, requester | `{agreementId, version}` |
| `version.upload` | same | `{agreementId, version, kind:"upload"|"counterparty", label?, file, text?}` (DOCX text is read automatically) |
| `version.generate` | same | `{agreementId, version, templateVersionId, fields, clauseChoices}` |
| `clause.insert` | owner, counsel, approver, requester | `{agreementId,version,versionId,libraryVersionId,clauseKey,variantId,start,end,quote}` — replace the exact selected current-version passage (or append with equal offsets at text length and an empty quote), creating a new PDF version. Returns `{versionId,number,digest,clauseLibrary}`. The version’s `fields.clauseLibrary` pins the approved library version, exact wording, usage notes, matching playbook version and inserting person/time. Browser and future Word clients share this command and its stale/authority guards. |
| `version.rendition` | same | `{agreementId, version, versionId, file}` — the PDF a DOCX version will be signed as |
| `comment.add` | same | `{agreementId, versionId, body, quote?}` |
| `legacy.import` | same | `{title, type, partyId? or party, sourceSystem, sourceId, file, signed?, text?, ownerId?, value?, restricted?}` |
| `family.link` | owner, counsel | `{agreementId, version, parentId, relation:"amends"|"order_under"|"schedule_to"|"renews"}` |
| `access.set` | owner, counsel | `{agreementId, operatorId, grant:"grant"|"revoke"}` |
| `template.create` / `template.revise` | owner, counsel | `{name, type, body, fields:[{name,label,required}], clauses:[{key,title,notes?,ruleKey?,variants:[{id,label,text,notes?}]}]}` / `{templateId, body, fields, clauses}`. Body uses `{{field}}`, `{{counterparty}}`, `{{title}}` and `[[clause:key]]`. |
| `template.decide` | owner, counsel | `{versionId, decision:"approve"|"retire"}` |
| `playbook.draft` / `playbook.activate` | owner, counsel | `{rules:[{key,title,preferred,alternatives:[],authority:"counsel"|"approver",guidance?}]}` / `{id}` |
| `deviation.add` | owner, counsel, approver, requester | `{agreementId, versionId, clauseKey, result:"met"|"breached"|"undetermined", start, end, quote, explanation, proposedWording?, questions:[]}`; `quote` must equal the version text from `start` to `end` |
| `approval.decide` | by route: commercial owner/approver; exceptions by the rule's authority | `{agreementId, version, versionId, kind:"commercial"|"exception", deviationId?, decision:"approved"|"rejected", reason?}` |
| `package.prepare` | owner, approver, requester | `{agreementId, version, provider:"docusign"|"adobe-acrobat-sign"|"dropbox-sign"|"pandadoc"|"documenso"|"docuseal"|"paper"|"other", recipients:[{name,email,action:"sign"|"copy",signingFor?}]}` → `{packageId, pdfArtifactId, manifestArtifactId, documentSha256}` |
| `package.sent` / `package.void` | same | `{agreementId, version, packageId, envelopeId}` / `{agreementId, version, packageId, reason}` |
| `execution.record` | same | `{agreementId, version, envelopeId, executedOn, signers:[{name,email,signedAt?}], documentConfirmed, signed:file, certificate?:file}` → `{executionId, status:"reconciled"|"needs_review", checks}` |
| `execution.resolve` | owner, counsel | `{agreementId, version, executionId, reason}` |
| `term.propose` | owner, counsel, approver, requester | `{agreementId, key:"effective_date"|"end_date"|"auto_renew"|"renewal_term_months"|"notice_days"|"governing_law"|"payment_terms", value, citation:{quote, page?}, reason?}` |
| `term.decide` | owner, counsel, approver | `{agreementId, termId, decision:"confirm"|"reject", reason?}` |
| `obligation.add` / `obligation.update` | add: owner, counsel, approver, requester; confirm/reject: owner, counsel, approver; done: its owner or those | `{agreementId, description, ownerId, dueDate?, recurrence:"none"|"monthly"|"quarterly"|"annually", citation}` / `{agreementId, obligationId, action:"confirm"|"reject"|"done"}` |
| `renewal.decide` | owner, approver | `{renewalId, decision:"renew"|"renegotiate"|"terminate", reason?}` |
| `notice.prepare` / `notice.approve` / `notice.sent` | prepare: owner, counsel, approver, requester; approve: owner, approver (not the preparer unless owner); sent: owner, approver, requester | `{renewalId, recipient, body}` / `{noticeId}` / `{noticeId, method:"email"|"post"|"courier"|"hand"|"portal", sentAt, evidence?:file}` |
| `proposal.prepare` | anyone with a role except viewer, including agent | `{kind:"intake"|"review"|"family"|"terms"|"renewal", payload, evidence:[text], assumptions?}` — payloads are the matching command's payload: intake = `request.create`; review = `{agreementId, versionId, findings:[deviation fields]}`; family = `{agreementId, parentId, relation}`; terms = `{agreementId, terms:[{key,value,citation}]}`; renewal = `{renewalId, recipient, body}` |
| `proposal.decide` | intake: owner, counsel, approver, requester; review and family: owner, counsel; terms: owner, counsel, approver; renewal: owner, approver — never the preparer unless owner | `{proposalId, decision:"approve"|"reject", reason?}` |
| `role.set` | owner | `{operatorId, role:"counsel"|"approver"|"requester"|"viewer"|"agent"}` |
| `import.preview` / `import.apply` / `import.undo` | owner | see [IMPORT.md](IMPORT.md) |

Invite people and agents with Base's `POST /auth/invite` `{email, displayName, role:"member"}` as the owner, then `role.set`.

An approved template version is the library version; each insertion pins that immutable version identity. Clause variant identities may be `preferred`, `fallback1`, `fallback2`, and `walk-away`. `ruleKey` defaults to the clause key. Template authoring supports `Notes:`, `Rule:`, and `Notes[variantId]:` lines. Explicit insertion provenance survives later uploaded/generated versions only while their text retains the exact inserted wording; it participates in the version digest. Acceptance requires a reconciled/accepted execution whose document check passed and whose package pins the current version and digest. Counts respect agreement visibility.
