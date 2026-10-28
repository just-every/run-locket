Agents prepare, people approve. An agent is someone you invite with the agent role, signing in like anyone else and working through the same HTTP API the screens use.

## What an agent can prepare

Each proposal carries its evidence and assumptions, and waits under **Proposals** for a person to decide:

| Proposal | Decided by |
| --- | --- |
| Intake: the details of a new request | Owner, counsel, an approver or a requester |
| Review: findings with exact cited passages | Owner or counsel |
| Agreement family: a link to a parent agreement | Owner or counsel |
| Terms: values with citations from the signed text | Owner, counsel or an approver |
| Renewal notice: a draft from a person-selected executed passage and confirmed decision/deadline | Owner or an approver |

Approving a proposal runs the same checks as doing the work by hand and records who prepared it and who decided. Nobody decides a proposal they prepared, unless they are the owner. An approved notice draft still needs its own approval for sending.

An agent never approves, signs, sends or confirms anything. A proposal for a restricted request is seen only by its preparer, the owner and counsel, and once approved, only by the people who can see that agreement.

## The API

Reads and commands are plain JSON over the installation's own origin, with a signed-in session. Every command carries an identity, so a retry never applies twice. The full list of reads, commands, payloads and who may send each is in [API.md](https://github.com/just-every/run-locket/blob/main/API.md).

Locket's built-in model tasks use the owner's configured provider and retain their native consent and evaluation requirements. Invited agents work through the API with their own current native role.

## Shared company-agent door

The Base agent-door and Business-settings source is recorded at `d555e789cffb744a9f83d76ebe42a2e3bdd7a055` in `base-copies.json`. Additive migrations provide their storage. This source preparation does not enable MCP, company-policy adoption, Business team reconciliation or sponsored native commands. The supported agent interface remains the native API described above.

Sponsored work needs an authenticated consent binding that native commands can retain and recheck before every queued effect. The pinned door validates a Business token's consent, but its exported `ToolContext` carries neither that consent nor an execution binding. Native adapters therefore cannot associate a saved send, retrieval or follow-up with the consent that authorized it. An argument supplied by an agent cannot establish that authority. A Base execution-context contract carrying that binding is required before these jobs can use the shared door.

Existing native session, role, agreement, field, exact-version and provider-consent checks continue to govern the API and scheduled work. Source availability is not conformance or permission to bypass these checks. No company-agent tool, resource, spend control or provider integration is advertised by this preparation.

For AGENT-003, a human first calls `notice.source {agreementId, quote}` after recording the counterparty email and courier notice address. An agent calls `notice.agent.prepare {sourceId}`, or submits `proposal.prepare` with `kind:"renewal"` and `payload:{sourceId}`. Free-text renewal proposals from agents are refused. The draft is labelled prepared, not legal advice or proof of service. The owner or an approver then reviews its PDF, frozen digest, recipient, method and local time with the displayed lead margin and uses `notice.schedule`; ordinary sending approval cannot bypass this schedule. Failures and missing acknowledgment produce a separate courier draft requiring another approval. Provider acceptance, delivery evidence and acknowledgment remain distinct; counsel decides adequacy.
