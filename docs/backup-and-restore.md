Locket keeps every record and every file's exact bytes in your own installation. There are two ways to take a copy.

## Export the archive from the app

As the owner, open **Activity** and choose **Export complete archive (JSON with files)**. You get one JSON file holding every record and every file, each with its SHA-256 digest, so you can check later that nothing changed. Keep it somewhere safe; it contains restricted agreements too.

## Back up the whole installation

`rer export` writes the whole installation, people and roles included, to one file you can restore:

```sh
rer dev --stop
rer export --output exports/installation.rer
```

Private settings (the `.dev.vars` file) stay out of the export. Keep your own copy of them.

## Restore into an empty installation

Restore only into a fresh, empty installation: a new clone of Locket that has not been used yet.

```sh
git clone https://github.com/just-every/run-locket.git locket-restored
cd locket-restored
rer import --input ../locket/exports/installation.rer --yes
rer setup --owner-email you@example.com
rer dev
```

Use the same owner email as before. Earlier sign-ins do not carry over: everyone signs in again, and work continues where it stopped, including undoing a restored move-in batch nobody has used.

## Start again

`rer reset --yes` removes the local installation's data. It lists exactly what it removes before you confirm; export first if you may want any of it back.
