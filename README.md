# Bmail

A Windows desktop app for local, read-only Gmail and Zoho email backups.
Built with Tauri 2, a bundled Node.js backup engine, and Windows-encrypted
mailbox credentials. Supports isolated accounts, backup selection, schedules,
live progress, pause/resume/stop controls, and full-mailbox coverage statistics.

- [Download the Windows installer](https://github.com/ayusht9/bmail/releases/latest)
- [Release notes](RELEASES.md)
- [Windows setup and development](docs/WINDOWS.md)
- [Code map and contribution guide](CONTRIBUTING.md)
- [Backup engine documentation](docs/BACKUP-README.md)
- [Google Drive cloud backup and setup](docs/GOOGLE-DRIVE.md)
- [Dropbox cloud backup and public app registration](docs/DROPBOX.md)
- [Backup statistics](docs/STATS.md)
- [Scheduler, advanced preferences, notifications and history](docs/SCHEDULER.md)

Development happens on `dev`; `main` is reserved for verified releases.
Install application updates manually using the Windows setup executable.
The app performs no OTA checks or installations. The manual GitHub Actions
workflow builds an installer artifact without publishing a release.

Run `npm.cmd ci`, `npm.cmd test`, and `npm.cmd run build` for local checks.
See the Windows guide for native runtime and installer prerequisites.

## License

Copyright (c) 2026 Ayush Kumar. Bmail is available under the [MIT License](LICENSE).
You may use, modify, and redistribute it, including commercially, provided you
retain the copyright and license notice in copies or substantial portions of the
software. A visible credit in your app's interface is not required.

Third-party components retain their own licenses and notices. Packaged builds
include Bmail's license in `engine/LICENSE`, Node.js notices in
`engine/NODE-LICENSE.txt`, and the production dependencies' distributed license files.

For Outlook.com, Hotmail, and Microsoft 365, see [Outlook setup](docs/OUTLOOK.md).

### Mail metadata and background updates

Bmail keeps a disposable SQLite metadata index at `<backup directory>/.cache/mail-metadata.db`.
It contains message headers, folder identity, backup status and local file references; email bodies
and attachments stay in the existing `.eml` files. Sorting, search, counts and pagination use this
index. Locale-aware sort orders are computed once per changed metadata snapshot and reused by
indexed database queries. The manifest and JSON server index remain the recovery sources.
The database is rebuilt if missing or corrupt; unavailable SQLite or unwritable storage falls back
to the existing reader. SQLite uses Node's built-in `node:sqlite` (Node 22.13+).

While the app runs, a read-only INBOX IMAP IDLE connection signals mailbox changes. Other folders
are checked every minute; servers without IDLE use the same timed fallback. New-mail checks use
UIDNEXT checkpoints and fetch only missing headers. A count mismatch, UIDVALIDITY change, missing
checkpoint or 30-minute reconciliation deadline triggers a full UID enumeration. Manual mailbox
coverage checks still validate all saved files. Local backups survive server-side deletions.

The watcher releases the backup lock between checks, switches with the active account, and renews
its session every ten minutes so Microsoft OAuth credentials can refresh. Failed sessions are
retried on subsequent dashboard refreshes with a 30-second minimum retry interval. Closing the app
ends monitoring; the next launch catches up. This requires no hosted webhook server. Provider API
webhooks and full flag synchronization are not part of this implementation.
