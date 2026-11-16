# Bmail 0.4.0

Released 17 November 2026 for Windows x64.

## Changes

- Home now lists every saved email in the selected folder, with original sent dates, sortable sizes, individual downloads, and a reading pane below the list.
- Email HTML is sanitized and displayed in an isolated reading frame. Complete local backups have a faded background.
- Resizable sidebar, list/reader split, and table columns retain their sizes. Double-click column dividers to fit contents; columns stay within the window.
- Folder downloads export saved mail as ZIP archives. Folder counts and live download progress appear in the status bar.
- Startup new-mail checks show dots beside affected folders and in the status bar. Busy mailbox checks defer and retry automatically.
- Workspace tabs are Home, Backup, Scheduler, Activity, and Preferences, with back/forward navigation.
- Start, Pause/Resume, Stop, Cancel, and detailed progress are in Backup. Activity shows full-width backup history with selected run details below.
- Windows development builds exclude Cargo outputs from the Vite watcher, fixing locked-DLL watcher failures.

## Installation and updates

Download `Bmail_0.4.0_x64-setup.exe` and run it for the current Windows user. The installer includes the Node.js backup runtime; WebView2 can be downloaded if missing. Keep existing application data when upgrading. Re-save schedules after an upgrade to refresh their engine paths.

This EXE release is unsigned. Windows SmartScreen, Smart App Control, or organizational policies may warn or block installation. MSI/MSIX signing and Store distribution are deferred. A SHA-256 checksum is included for download integrity.

## Verification

- 30 engine, installer, metadata, mailbox statistics, polling, and scheduler tests passed.
- 12 Rust tests and four profile migration checks passed.
- Browser checks passed for message rendering, sorting, constrained resizing, history details, backup controls, themes, scheduling, notifications, and startup-check retries.
- Bundled runtime smoke checks passed for saved-mail metadata and message rendering inputs with Node absent from PATH; runtime files match release source and exclude personal data.
- Windows x64 EXE installer built successfully.

Clean-machine installation and upgrade/uninstall checks have not been performed for this release. Automated mailbox checks use local fixtures rather than live provider accounts.

---

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
