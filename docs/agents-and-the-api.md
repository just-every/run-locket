Company agents enter through Locket's shared `/mcp` door. Their signed Business subject resolves to a current native operator; their sponsor's Locket role, record visibility and field permissions remain authoritative. A company's signed policy decides whether a declared action runs, waits for review, needs a named person's approval or is blocked. People inspect decisions and Pause at `/agents`.

The core declaration supports draft requests and title edits, evidenced intake proposals, agreement reads and title and reference search, counts and people listings, native role assignments and agreement reader grants. It does not claim a complete contract week, signing, provider sends, execution, erasure or the remaining specialist jobs. The declaration exposes tools, policy, Pause, audit, idempotency and bounded specialist prompts. Events, public resources and subscriptions are typed-refused. `agent-surface.json` lists the exact tools, classes, scopes and journey; [API.md](https://github.com/just-every/run-locket/blob/main/API.md#company-agent-door) explains the limits.

## Specialist prompts

Authenticated MCP clients can discover two contract operations clerk jobs with `prompts / list` and retrieve their static guidance with `prompts / get`:

| Prompt | Bounded job |
| --- | --- |
| `locket.contract_operations.prepare_request` | Prepare draft requests, title edits and evidenced intake proposals using the currently listed native tools. |
| `locket.contract_operations.read_agreement` | Read one currently accessible agreement using the native read tool. |

The referenced tool names, operation descriptions, scopes, possible classes and native schemas come from `src/agent-door/catalogue.json`. The prompts take no input and contain no agreement data. Retrieving one does not call a tool, create a request, read an agreement or grant authority. A client must discover the current tools and satisfy their schemas, native access, company policy and any required human approval separately.

Listings and retrieval are authenticated, deterministic and privately cached. Before a policy is set, or while Business or local Pause is active, the listing is empty and retrieval returns the corresponding typed refusal. A blocked standard-read policy may still list static job metadata, but retrieval returns `policy_blocked` without messages. Under the held policy, standard review permits this static guidance; any later native tool call still receives its own class-based decision. An unknown prompt returns JSON-RPC invalid parameters (`-32602`), without messages. The generated [Agent reference](/docs/agents) lists the core registry by job, its scopes, computed classes and executable fixtures under both policies, prompts, resource and event boundaries, limits and error recovery. Discovery instructions use the same registry. The complete specialist week, provider jobs, remaining whole-clause dual-policy acceptance and stranger-agent completion are still owed.

An invited operator with Locket's legacy `agent` role remains a proposal preparer using the native HTTP API. Its narrow role is distinct from a company agent acting for a named sponsor.

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

Locket has no built-in model account. Your own agent works through the API.

For AGENT-003, a human first calls `notice.source {agreementId, quote}` after recording the counterparty email and courier notice address. An agent calls `notice.agent.prepare {sourceId}`, or submits `proposal.prepare` with `kind:"renewal"` and `payload:{sourceId}`. Free-text renewal proposals from agents are refused. The draft is labelled prepared, not legal advice or proof of service. The owner or an approver then reviews its PDF, frozen digest, recipient, method and local time with the displayed lead margin and uses `notice.schedule`; ordinary sending approval cannot bypass this schedule. Failures and missing acknowledgment produce a separate courier draft requiring another approval. Provider acceptance, delivery evidence and acknowledgment remain distinct; counsel decides adequacy.

The runtime door is recorded at Base `2135c394939f4a737adabdc8003b0e667b31ac5a` and the CLI is pinned to released rer 0.2.91. Disposable verification configures the real Resend adapter with a synthetic sender; only the paid network edge is replaced. The signed owner claim, colleague invitation and one-use confirmation use production handlers. No mail provider is configured for a real installation by these test bindings.
