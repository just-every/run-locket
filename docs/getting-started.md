Locket runs on your own computer. You need Node 22 or later and pnpm 10.12.4, on macOS, Linux or Windows with WSL2.

## Run it on your computer

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
git clone https://github.com/just-every/run-locket.git locket
cd locket && rer dev
```

The first two lines install `rer`, the Run Edit Run command, once per computer and put it on this shell's path (or use `npm install -g @runeditrun/rer`). `rer dev` installs everything, makes you the owner and prints a link that opens Locket signed in. Treat that link like a password: it signs you in as the owner.

To set the installation up for your real mailbox instead of a local owner, run the steps yourself and answer the setup prompt:

```sh
rer install
rer setup
rer dev
```

## Finish setup

The first time you open Locket it shows **Finish setup** with your name and email. Tick **I confirm this owner account is ready to use.** and choose **Finish setup**. Locket then opens on Agreements.

Until setup is finished, the installation's home page says it is waiting for its owner. After that it offers **Sign in**, which emails a sign-in link. On your own computer no email leaves the machine: the sign-in page links to the local development outbox, where the link waits.

## Add your first agreement

1. Choose **New request**.
2. Name the agreement, the counterparty and its value.
3. Attach the draft and submit it for review.

A new installation starts empty, with no sample agreements. To bring your signed history in first, see [Move in from DocuSign](/docs/move-in) or use **Import signed file** for a single PDF or DOCX.

| Role | What they do |
| --- | --- |
| Owner | Everything, including export and move-in |
| Counsel | The library, legal exceptions and restricted agreements |
| Approver | Commercial approval, renewals and notices |

The other roles, and how to invite people, are in [People and roles](/docs/people-and-roles).
