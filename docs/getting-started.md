Locket runs on your own computer: macOS, Linux or Windows with WSL2.

## Run it on your computer

First install `rer`, the Run Edit Run command. It installs for you alone, with its own Node if you have no Node 22 or later, and changes no shell settings; if its last line puts `rer` on your PATH, run that line too.

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
```

Then start Locket:

```sh
rer dev just-every/run-locket
```

`rer` gets Locket, installs everything, makes you the owner and prints a link that opens Locket signed in. Treat that link like a password: it signs you in as the owner. To start it again later, run `cd run-locket && rer dev`.

Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-locket` does both steps in one line.

To set the installation up for your real mailbox instead of a local owner, set it up first in place of `rer dev just-every/run-locket`, answer the setup prompt, then start it:

```sh
npx -y @runeditrun/rer setup just-every/run-locket
cd run-locket
rer dev
```

## Finish setup

The first time you open Locket it shows **Finish setup** with your name and email. Tick **I confirm this owner account is ready to use.** and choose **Finish setup**. Locket then opens on Agreements.

Until setup is finished, the installation's home page says it is waiting for its owner. After that it offers **Sign in**, which emails a sign-in link. On your own computer no email leaves the machine: `rer dev` prints an `RER_OPEN` link that opens Locket already signed in as the owner.

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
