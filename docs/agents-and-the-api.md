Agents prepare, people approve. An agent is someone you invite with the agent role, signing in like anyone else and working through the same HTTP API the screens use.

## What an agent can prepare

Each proposal carries its evidence and assumptions, and waits under **Proposals** for a person to decide:

| Proposal | Decided by |
| --- | --- |
| Intake: the details of a new request | Owner, counsel, an approver or a requester |
| Review: findings with exact cited passages | Owner or counsel |
| Agreement family: a link to a parent agreement | Owner or counsel |
| Terms: values with citations from the signed text | Owner, counsel or an approver |
| Renewal notice: a draft for a decided renewal | Owner or an approver |

Approving a proposal runs the same checks as doing the work by hand and records who prepared it and who decided. Nobody decides a proposal they prepared, unless they are the owner. An approved notice draft still needs its own approval for sending.

An agent never approves, signs, sends or confirms anything. A proposal for a restricted request is seen only by its preparer, the owner and counsel, and once approved, only by the people who can see that agreement.

## The API

Reads and commands are plain JSON over the installation's own origin, with a signed-in session. Every command carries an identity, so a retry never applies twice. The full list of reads, commands, payloads and who may send each is in [API.md](https://github.com/just-every/run-locket/blob/main/API.md).

Locket has no built-in model account. Your own agent works through the API.
