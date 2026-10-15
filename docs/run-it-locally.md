Everything runs through `rer` from the Locket folder.

## Start and stop

```sh
rer dev
rer dev --stop
```

`rer dev` installs what is missing, sets up the owner the first time, starts Locket and prints a link that opens it signed in. Running it again while it is up reuses the running app. It keeps the port it chose the first time, from 8787 up, and listens only on this computer.

## Check and inspect

```sh
rer verify
rer describe
rer doctor
```

`rer verify` builds Locket and runs its checks. `rer describe` lists the commands and flags this checkout supports.

## Where your data lives

Your agreements and files live in `.wrangler/state` inside the Locket folder. Private settings live in `.dev.vars`, readable only by you. Keep both out of anything you share. To copy or move an installation, see [Back up and restore](/docs/backup-and-restore).

On your own computer no email is sent: open the `RER_OPEN` link that `rer dev` prints and Locket opens signed in as the owner.

## Your own server

`rer deploy` puts Locket on your own Cloudflare account. It needs that account's credentials and a real email provider for sign-in links; `rer deploy --dry-run` builds and checks everything without contacting Cloudflare. The details are in [RUN-LOCALLY.md](https://github.com/just-every/run-locket/blob/main/RUN-LOCALLY.md).
