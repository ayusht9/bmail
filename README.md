# Bmail

A Windows desktop app for local, read-only Gmail and Zoho email backups.
Built with Tauri 2, a bundled Node.js backup engine, and Windows-encrypted
mailbox credentials. Supports isolated accounts, backup selection, schedules,
live progress, pause/resume/stop controls, and full-mailbox coverage statistics.

- [Windows setup and development](WINDOWS.md)
- [Backup engine documentation](BACKUP-README.md)
- [Backup statistics](STATS.md)
- [Scheduler, advanced preferences, notifications and history](SCHEDULER.md)

Development happens on `dev`; `main` is reserved for verified releases.
Install application updates manually using the Windows setup executable.
The app performs no OTA checks or installations. The manual GitHub Actions
workflow builds an installer artifact without publishing a release.

Run `npm.cmd ci`, `npm.cmd test`, and `npm.cmd run build` for local checks.
See the Windows guide for native runtime and installer prerequisites.
