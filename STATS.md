# Backup statistics

The desktop workspace has an account and folder sidebar and six tabs: Mailbox,
Overview, Backup options, Scheduler, Activity and Preferences. Mailbox shows
every saved email in the selected folder above a reading pane; Overview shows account statistics. Select a
folder to open Mailbox and narrow its tables; use Filter folders to find a name.
Mailbox-check failures remain visible with diagnostic details and Retry until
dismissed or successfully retried. Activity contains backup history and the latest activity log.

## Per-account caching

Each account keeps its own configuration and backup files. A derived summary is
stored at `accounts/<email>/.cache/dashboard-summary.json`; it contains counts,
recorded bytes, folder totals, and the ten most recently saved records. It is
separate from the email files, manifest, and encrypted credentials. No database
migration is required and credentials are never added to the cache.

The app reuses the summary in memory and across restarts while the source
manifest's path, modification time, and size match. It rebuilds when the source
changes. Missing or invalid caches are regenerated; cache write failures do not
block the dashboard. Deleting a manifest does not leave its cached counts visible.
Other unchanged JSON snapshots are reused in memory. Log reads are limited to
the last 64 KB / 120 lines instead of reading the whole log.

Dashboard loading runs on a worker thread. Windows schedule status is cached
for up to 60 seconds per account and invalidated after installing/updating a
schedule. **Refresh** bypasses these caches. Safety checks before starting or
controlling backups continue to use current files and process state.

The dashboard polls local data every 10 seconds while idle and every 2 seconds
during a backup. It pauses automatic calls while hidden and skips them during
UI operations, then refreshes immediately when visible again. These are local
desktop IPC calls, not mail-provider API calls. **Check mailbox** still performs
a fresh read-only server inventory and local file verification; cached summaries
are never used to claim that an unchecked server message is backed up.

Run `npm.cmd run test:cache` for native cache tests, in addition to `npm.cmd test`
and `npm.cmd run test:stats:ui`. Set `CARGO_INCREMENTAL=0` in the terminal if the
Windows incremental-cache permission warning recurs.

## Coverage and new mail

The dashboard shows the active account's saved message count, recorded email
bytes, downloads in the last run, saved mail, and per-folder coverage.
Totals count each saved folder copy; Gmail labels may contain the same email in
several folders. Retained messages from deleted server mail or older UIDVALIDITY
generations remain included in local totals.

**Check mailbox** connects read-only, enumerates every accessible folder and all
message UIDs, and verifies matching local files against their recorded size and
SHA-256. It downloads no message bodies. It ignores the current backup selection
so a partial date range, selected folders, or a download limit cannot be mistaken
for a full mailbox backup. This check can take time for large backups because it
verifies local files. It cannot run alongside a backup or another mailbox check.

Full backup means every message enumerated in every accessible server folder has
a complete, valid local copy during the displayed check. Folders are checked in
turn; new mail arriving during or after the check may not be included. Local totals
come from manifest records; use the mailbox check to detect missing/damaged files.
A successful backup also attempts to refresh these statistics.
Failed checks retain the previous snapshot and its timestamp. The last confirmed
full-backup date remains visible when newer mail makes coverage incomplete.

**New on server** compares the latest successful mailbox inventory with the
previous one. The first check has no baseline. If UIDVALIDITY changes, new-mail
counts become unknown until another check instead of claiming all mail is new.
**Still to back up** includes both never-downloaded mail and missing/damaged local
copies. **Downloaded last run** may include replacement downloads for repaired
files; it is separate from newly discovered server mail.

Snapshots are stored in each account's backup directory as `mailbox-status.json`.
No network checks occur on the dashboard refresh timer. Use Check mailbox to find
mail received since the previous check. Email credentials, backups, and snapshots
stay outside source control.

Application updates are installed manually. OTA startup checks, update commands,
signing dependencies, and automatic release publication are disabled/removed.
Run `npm.cmd run tauri:build` for the Windows installer. Test manual installation
and upgrade on a clean Windows machine before distributing a public release.

## Appearance and interface performance

Preferences includes Light, Dark and Auto themes. Auto follows Windows appearance
changes while the app is open. The selection is saved on this device, independently
of mailbox settings. Changing appearance does not call the mail provider.

Folder search updates folder navigation and coverage rows without rebuilding the
workspace or discarding form edits. Folder names are cached for unchanged source
lists, date/number formatters are reused, and folder coverage is generated only
when the Mailbox tab is displayed. The calendar updates its date highlights only
when the day changes or a new calendar is rendered.

Activity combines backup run history and details with the latest activity log. The latest log is independent of the selected historical run. Each section keeps its own filter.

On startup, Bmail checks each configured account once when opened, after any active backup finishes. A small dot in the status bar and beside affected folders indicates new emails since the previous check. Hover over a dot for the count. The first check establishes a baseline; reset folder identifiers also establish a fresh baseline. Startup checks compare server message IDs without downloading mail or verifying local files. Use Check mailbox to refresh the indicators manually.

Saved mail loads on demand for the selected folder (or all folders) without the dashboard summary's ten-record limit. Subject, From, Folder, and Saved column headings toggle ascending/descending sorting; the active column shows an arrow. The list includes complete saved records from every UID generation and retains individual email downloads.

The folder and mail tables begin directly with column headers. Drag a header edge to resize its column, or focus the divider and press Left/Right (Shift for larger steps). Column widths are saved on this device and survive sorting, navigation, and restarts.

Tables always fill the available width, including after columns are narrowed or the window grows. Double-click a column divider to fit the widest saved value or heading within the available space; width is redistributed among neighboring columns so every column stays inside the table container.

Dragging, keyboard resizing, and auto-fit preserve the visible table width. Other columns retain a minimum usable width; a column stops expanding when no more space is available. Both tables fit the window without horizontal scrolling.

Download icons are fixed row actions inside the last data cell, with no separate download column or resize handle. The idle status text and saved-mail sorting hint are hidden.

If another backup, verification, or mail check owns the mailbox lock at startup, the new-mail check waits and retries after a short cooldown. It does not show a failure for this temporary busy state. Other startup failures show diagnostic details and a Retry button.

The mailbox view opens directly on the email list, with a reading pane below for the selected saved message. Folder counts (saved, on server, remaining) appear in the status bar instead of a coverage table. Messages are decoded locally; HTML is sanitized and sandboxed, with scripts and remote resources blocked. Folder downloads remain in the sidebar.

The mail list shows the original Sent date and message Size, both sortable. Dates for older backups are read from their saved Date headers and cached locally; absent dates show Unknown. Complete records whose local file still exists at the recorded size have a faded row background. Selection keeps its stronger highlight.
