# Bmail 0.3.0

Released 16 November 2026 for Windows x64.

## Included

- Gmail and Zoho read-only IMAP backups with Windows-encrypted credentials and separate account folders.
- Outlook-style workspace tabs for Mailbox, Overview, Backup options, Scheduler, History, Activity and Preferences.
- Light, Dark and Auto appearance; Auto follows the Windows theme.
- Per-account backup counts, storage size, full-mailbox coverage checks and detection of messages still to back up.
- Folder, date and message filters, retry/timeouts, limits and backup verification.
- One-time, daily, weekly, monthly and hourly schedules, calendar and live clock, power/network conditions and separate scheduled folder selection.
- Backup history, optional Windows notifications and live pause, resume, stop and cancel controls.
- Cached account summaries and folder lists, less frequent idle polling and reduced interface rendering work.

## Installation and updates

Download `Bmail_0.3.0_x64-setup.exe` from GitHub Releases and run it for the current Windows user. The installer bundles the backup runtime; a separate Node.js installation is unnecessary. WebView2 is required and the installer can download it when missing.

Updates are manual. Keep your application data when replacing an earlier installation. Save existing schedules again to use the independent scheduled folder selection and refresh their engine path. Scheduled tasks run while the Windows user is signed in.

This installer is not code signed. Windows may display an unknown-publisher warning. Clean-VM installation, upgrade/uninstall and missing-WebView2 scenarios have not been verified. Automated checks use local fixtures rather than a live mailbox; provider authentication depends on your account and app password.

The release includes a SHA-256 checksum file for the installer.

## Release checks

- 25 engine, installer, statistics, polling and scheduler tests passed.
- 10 Rust tests and four profile migration checks passed.
- Browser checks passed for workspace tabs, themes, calendar, schedule folders, history, notifications and a 1,000-folder search.
- Native desktop checks passed for form submission, Rust IPC, DPAPI credential storage, backup selection, progress, duplicate-run protection, pause/resume/stop/cancel and account isolation.
- Production Windows x64 installer built and extracted successfully; bundled runtime verified an offline backup without Node on PATH. Bundled engine files match the release source, personal runtime files are absent, and the installer manifest requests `asInvoker`.
