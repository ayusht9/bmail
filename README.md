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
- [Backup statistics](docs/STATS.md)
- [Scheduler, advanced preferences, notifications and history](docs/SCHEDULER.md)

Development happens on `dev`; `main` is reserved for verified releases.
Install application updates manually using the Windows setup executable.
The app performs no OTA checks or installations. The manual GitHub Actions
workflow builds an installer artifact without publishing a release.

Run `npm.cmd ci`, `npm.cmd test`, and `npm.cmd run build` for local checks.
See the Windows guide for native runtime and installer prerequisites.
