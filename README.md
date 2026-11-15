# Bmail

A Windows desktop app for local, read-only Gmail and Zoho email backups.
Built with Tauri 2, a bundled Node.js backup engine, and Windows-encrypted
mailbox credentials. Supports isolated accounts, backup selection, schedules,
live progress, and pause/resume/stop controls.

- [Windows setup and development](WINDOWS.md)
- [Backup engine documentation](BACKUP-README.md)
- [Signed OTA updates and releases](OTA.md)

Development happens on `dev`; `main` is reserved for verified releases.
Windows installers are distributed through GitHub Releases. The first build
with OTA support must be installed manually; subsequent versions can be
downloaded, signature-verified, and installed from inside Bmail.

Run `npm.cmd ci`, `npm.cmd test`, and `npm.cmd run build` for local checks.
See the Windows guide for native runtime and installer prerequisites.
